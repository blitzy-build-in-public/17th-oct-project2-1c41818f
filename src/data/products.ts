/**
 * Path: src/data/products.ts
 * Purpose: The seeded catalogue: hand-authored anchor products expanded deterministically, with specs and generated imagery
 * Lines: 594
 */

import { DEFAULT_CURRENCY } from "@/constants/config";
import { BRAND_DEFINITIONS, CATEGORY_DEFINITIONS, FACET_DEFINITIONS } from "@/constants/taxonomy";
import type { FacetDefinition, FacetDefinitionOption } from "@/constants/taxonomy";
import { BRAND_PRODUCT_QUOTA, CATEGORY_PRODUCT_QUOTA, IMAGERY_PALETTE, PRODUCT_TOTAL } from "@/data/categories";
import type { Inventory, Product, ProductImage, ProductSpec, ProductStatus } from "@/types/catalog";
import type { IsoDateString, IsoDateTimeString, MinorUnits } from "@/types/common";
import { countBy } from "@/utils/collections";
import { addDays, parseIso, toIsoDate, toIsoDateTime } from "@/utils/dates";
import { formatAvailability, fromMinorUnits, roundMinorUnits, toMinorUnits } from "@/utils/format";
import { brandId, categoryId, initials, productId, sequenceId, slugify } from "@/utils/strings";

// Deterministic sampling -------------------------------------------------------------------------

/**
 * The seed every collection in `src/data/` is derived from: this catalogue, the customers, the orders, the
 * reviews and the daily sales facts. A fixed literal, never the clock, so one build produces the same data.
 */
export const DATA_SEED = 8_675_309;

/**
 * A deterministic source of the variation the seeded collections are composed from. Every method is a pure
 * function of the stream's own state, so one seed yields one sequence in every process; the surface is small
 * because the four other seed modules in this folder draw from it.
 */
export interface SeededRandom {
  /** The next value in `[0, 1)`, advancing the stream. */
  next(): number;
  /** A whole number in `[min, max]`, both ends included. */
  int(min: number, max: number): number;
  /** One item of a non-empty list. */
  pick<TItem>(items: readonly TItem[]): TItem;
  /** Distinct items of a list, or the whole list when it holds no more than `count`. */
  pickMany<TItem>(items: readonly TItem[], count: number): TItem[];
  /** True for the share of draws `probability` names. */
  chance(probability: number): boolean;
  /** A new array holding the same items in a stream-determined order. */
  shuffle<TItem>(items: readonly TItem[]): TItem[];
}

/**
 * Builds the generator from a seed with mulberry32's arithmetic: 32-bit integer steps that a JavaScript number
 * represents exactly, so the sequence depends on the seed alone and never on floating-point rounding.
 *
 * @param seed - The stream's seed; the same seed always yields the same sequence.
 * @returns The generator this folder's seed modules compose their variation from.
 */
export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let scrambled = state;
    scrambled = Math.imul(scrambled ^ (scrambled >>> 15), scrambled | 1);
    scrambled ^= scrambled + Math.imul(scrambled ^ (scrambled >>> 7), scrambled | 61);
    return ((scrambled ^ (scrambled >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <TItem>(items: readonly TItem[]): TItem => {
    if (items.length === 0) throw new TypeError("A seeded draw needs a non-empty list.");
    return items[Math.floor(next() * items.length)];
  };
  const shuffle = <TItem>(items: readonly TItem[]): TItem[] => {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(next() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return shuffled;
  };
  return {
    next, pick, shuffle,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pickMany: (items, count) => shuffle(items).slice(0, count),
    chance: (probability) => next() < probability,
  };
}

// Catalogue vocabulary ---------------------------------------------------------------------------

/** The status every seeded product carries: the catalogue holds only sellable records. */
const SELLABLE_STATUS: ProductStatus = "active";

/** The descriptor a generated name slots between its brand and its line: "Northcrest Compact Skillet". */
const PRODUCT_DESCRIPTORS = ["Everyday", "Compact", "Signature", "Classic", "Pro", "Travel"];
/** The warranty wordings a specification row, a feature line and a description sentence quote. */
const WARRANTY_TERMS = ["1 year", "2 years", "3 years", "5 years"];
/** The retail endings and price step in major units, the span the open-ended top band is priced over, and the
 *  cheapest seeded price, so the band starting at zero never offers 99 cents. */
const PRICE_ENDINGS_MINOR = [0, 95, 99];
const PRICE_STEP_MAJOR = 5;
const OPEN_TOP_BAND_MINOR = 28_000;
const MIN_PRICE_MINOR = 499;
/** Every third product carries a list price above its price, by ten to forty percent: what renders a discount. */
const DISCOUNT_EVERY = 3;
const DISCOUNT_RATIOS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4];
/** The stock at or below which a product reads as low, the deepest shelf, and the cycle putting every
 *  twentieth product out of stock and the two after it below the threshold. */
const LOW_STOCK_THRESHOLD = 8;
const MAX_STOCK_ON_HAND = 160;
const STOCK_CYCLE = 20;
const LOW_STOCK_POSITIONS = 2;

/** The review counts products take in turn. The twenty values sum to sixty and the catalogue covers the cycle
 *  seven times, so the 140 products hold exactly 420 reviews; `src/data/reviews.ts` generates these counts. */
const RATING_COUNT_CYCLE = [3, 4, 2, 5, 3, 2, 4, 0, 3, 6, 3, 2, 5, 3, 2, 4, 0, 5, 3, 1];
/** The tenths a product's rating aims at: the band of averages integer ratings can reproduce exactly. */
const RATING_TARGET_MIN_TENTHS = 36;
const RATING_TARGET_MAX_TENTHS = 49;

/** The trailing window products are dated across, in days. */
const CATALOGUE_SPAN_DAYS = 730;
/** How many images a product carries, their size, the views they are named after, and the gradients they paint —
 *  `IMAGERY_PALETTE`, the imagery palette `src/data/categories.ts` owns and this module draws from. */
const IMAGE_COUNT_MIN = 2;
const IMAGE_COUNT_SPREAD = 3;
const IMAGE_WIDTH = 800;
const IMAGE_HEIGHT = 600;
const IMAGE_VIEWS = ["Front view", "Detail view", "In use", "Packaging"];

// Catalogue types --------------------------------------------------------------------------------
/** One specification row of an anchor: a label and the value beside it, as a pair a seed can destructure. */
type AnchorSpecRow = readonly [string, string];

/**
 * A category definition that hangs under a parent, and therefore holds products: one of the twelve the facets
 * and the listings offer. A category the taxonomy gains fails to compile here until it is given copy/brands.
 */
type LeafDefinition = Extract<(typeof CATEGORY_DEFINITIONS)[number], { parentSlug: string }>;
type LeafCategorySlug = LeafDefinition["slug"];
/** A brand's slug, as the vocabulary declares it. */
type BrandSlug = (typeof BRAND_DEFINITIONS)[number]["slug"];

/** The twelve leaf categories in the vocabulary's order; the parents group them and hold no products. */
const LEAF_CATEGORIES: readonly LeafDefinition[] = CATEGORY_DEFINITIONS.filter(
  (definition): definition is LeafDefinition => definition.parentSlug !== null,
);
const LEAF_CATEGORY_SLUGS: readonly LeafCategorySlug[] = LEAF_CATEGORIES.map((entry) => entry.slug);

/** The copy pools of one leaf category, keyed by the leaf-slug union: the lines it sells, the materials and
 *  uses its copy is written around, and one detail sentence that closes the generated description of every
 *  line listed here — so it must hold for all of them, not just the line it was written for. */
interface CategoryCopy {
  readonly lines: readonly string[]; readonly materials: readonly string[];
  readonly uses: readonly string[]; readonly detail: string;
}


const CATEGORY_COPY: Readonly<Record<LeafCategorySlug, CategoryCopy>> = {
  audio: { lines: ["Over-Ear Headphones", "Bookshelf Speakers", "Turntable", "Soundbar"],
    materials: ["aluminium", "recycled ABS"], uses: ["long listening sessions", "a small front room"], detail: "It is made for long listening in a small room, where an even mid-range matters more than volume." },
  cameras: { lines: ["Mirrorless Camera", "Prime Lens", "Travel Tripod", "Camera Backpack"],
    materials: ["magnesium alloy", "carbon fibre"], uses: ["travel photography", "a full day of shooting"], detail: "It is made for travel photography, where the gear is carried all day and set up wherever the light is." },
  laptops: { lines: ["Ultralight Laptop", "Workstation Laptop", "Convertible Laptop", "Compact Laptop"],
    materials: ["recycled aluminium", "carbon fibre"], uses: ["a daily commute", "editing on the move"], detail: "It is built to be carried between places and opened and closed a few thousand times a year." },
  "phones-accessories": { lines: ["Charging Stand", "Protective Case", "USB-C Cable", "Phone Grip"],
    materials: ["recycled ABS", "silicone"], uses: ["charging at a desk", "a phone that travels"], detail: "It is made to sit with a phone every day, at a desk or in a pocket." },
  cookware: { lines: ["Cast Iron Skillet", "Chef's Knife", "Saucepan", "Baking Tray"],
    materials: ["cast iron", "forged stainless steel"], uses: ["family kitchens", "a slow Sunday"], detail: "It is built for a kitchen that cooks most nights and washes up straight after." },
  furniture: { lines: ["Standing Desk", "Bookshelf", "Dining Chair", "Storage Bench"],
    materials: ["solid oak", "powder-coated steel"], uses: ["a home office", "small rooms"], detail: "It is built to be moved from one small room to another and to stay square when it gets there." },
  fitness: { lines: ["Adjustable Dumbbell", "Exercise Mat", "Resistance Band Set", "Kettlebell"],
    materials: ["cast iron", "natural rubber"], uses: ["early sessions", "a home gym"], detail: "It is built for a home gym, where it has to store small and survive being used every day." },
  camping: { lines: ["Backpacking Tent", "Sleeping Bag", "Camp Stove", "Camp Chair"],
    materials: ["ripstop nylon", "anodised aluminium"], uses: ["weekend trips", "a wet night"], detail: "It is made for trips where everything has to pack small and be carried rather than wheeled." },
  "mens-clothing": { lines: ["Merino Half-Zip Sweater", "Oxford Shirt", "Waxed Jacket", "Chino Trousers"],
    materials: ["merino wool", "organic cotton twill"], uses: ["the office", "the weekend"], detail: "The fabric is chosen to hold its shape through a winter of wear, not just the season it was bought in." },
  "womens-clothing": { lines: ["Merino Wrap Dress", "Wool Coat", "Linen Shirt", "Cotton Trousers"],
    materials: ["merino wool", "washed linen"], uses: ["the desk and the dinner after", "the shoulder season"], detail: "It is cut so the fabric falls straight rather than clinging at the waist." },
  "skin-care": { lines: ["Cleansing Balm", "Hydrating Serum", "Day Cream", "Body Lotion"],
    materials: ["shea butter", "cold-pressed jojoba"], uses: ["a short morning routine", "reactive skin"], detail: "It is made for a routine short enough to keep, morning and evening." },
  "board-games": { lines: ["Strategy Board Game", "Party Game", "Card Game", "Family Board Game"],
    materials: ["recycled board", "beech wood"], uses: ["game nights", "a full table"], detail: "The rules are taught in five minutes and stay interesting past twenty plays." },
};

/**
 * One hand-authored catalogue record: the copy, specification rows, tags and prices of a product written out
 * rather than generated, and the category and brand it belongs to. These twelve — one per leaf category, naming
 * eleven of the twelve brands — are the template the catalogue is expanded from: a generated product reads its
 * category's copy pools and quotes its anchor's rows, which are therefore worded to hold for every line there.
 */
interface AnchorProduct {
  readonly name: string; readonly category: LeafCategorySlug; readonly brand: BrandSlug;
  readonly summary: string; readonly description: string;
  /** The material this anchor's own description names, so the `Material` row derived for it cannot contradict it. */
  readonly material: string;
  readonly features: readonly string[]; readonly specs: readonly AnchorSpecRow[];
  readonly tags: readonly string[]; readonly priceMinor: MinorUnits; readonly listPriceMinor: MinorUnits;
}

/** The hand-authored anchors, one per leaf category, priced so that every band the price facet declares is represented. */
const ANCHOR_PRODUCTS: readonly AnchorProduct[] = [
  { name: "Aurelia Audio Over-Ear Headphones AX-45", category: "audio", brand: "aurelia-audio",
    summary: "Closed-back headphones that hold their composure through a long mix.",
    description: "A closed-back design that keeps the room out and the mix in, with earcups machined from aluminium and lined with memory foam. The headband folds flat into the case, so the headphones travel in a bag rather than under an arm. A single charge runs for thirty hours, and the cable in the box is a spare rather than the only way to listen.",
    features: ["45 mm drivers", "30-hour battery", "Folding earcups", "USB-C charging"],
    specs: [["Frequency response", "20 Hz – 20 kHz"], ["Power", "USB-C or mains"], ["Weight", "265 g"]],
    tags: ["audio", "over-ear", "wireless", "studio"], priceMinor: 24_999, listPriceMinor: 29_999, material: "aluminium" },
  { name: "Kestrel Optics Mirrorless Camera K-24", category: "cameras", brand: "kestrel-optics",
    summary: "A 24-megapixel body small enough to carry for a whole day.",
    description: "A 24-megapixel sensor on a magnesium body that weighs less than a filled water bottle. The dials sit where a right thumb expects them, so shutter speed, aperture and exposure compensation never need a menu. Weather sealing keeps it working through a wet afternoon, and the battery takes about 480 frames between charges.",
    features: ["24 MP full-frame sensor", "Weather-sealed body", "480-frame battery"],
    specs: [["Weather sealing", "Fully sealed"], ["Mount thread", "1/4 inch"], ["Weight", "620 g"]],
    tags: ["cameras", "mirrorless", "full-frame"], priceMinor: 189_999, listPriceMinor: 209_999, material: "magnesium alloy" },
  { name: "Lumen Labs Ultralight Laptop L-14", category: "laptops", brand: "lumen-labs",
    summary: "An ultralight for the commute, with a screen that stays readable outdoors.",
    description: "The chassis is machined from a single block of recycled aluminium, so it flexes less than the plastic shells it competes with. The display is matte and reaches 400 nits, which is what makes it usable on a train in daylight. Two working days fit in one charge, and the ports are split across both sides.",
    features: ["14-inch matte display", "Two-day battery", "Machined aluminium body"],
    specs: [["Display size", "14 inches"], ["Memory", "16 GB"], ["Weight", "1.2 kg"]],
    tags: ["laptops", "ultralight", "aluminium"], priceMinor: 129_999, listPriceMinor: 129_999, material: "recycled aluminium" },
  { name: "Tidewell Magnetic Charging Stand T-2", category: "phones-accessories", brand: "tidewell",
    summary: "A weighted stand that charges a handset upright.",
    description: "The base is filled, so the stand stays where it is put while a phone is lifted off or dropped on. The contact surface is silicone, which holds the handset without marking the case. It delivers 15 watts to a magnetic handset and 7.5 watts over Qi.",
    features: ["15 W magnetic charging", "Weighted non-slip base", "Silicone contact surface"],
    specs: [["Compatibility", "USB-C and Qi"], ["Finish", "Matte"], ["Weight", "180 g"]],
    tags: ["phones", "charging", "desk"], priceMinor: 2_499, listPriceMinor: 2_499, material: "silicone" },
  { name: "Northcrest Cast Iron Skillet N-28", category: "cookware", brand: "northcrest",
    summary: "A 28 cm skillet that seasons as it is used.",
    description: "Cast in one piece, so there is no joint to loosen and no coating to wear through. It heats evenly across the base and holds that heat after the hob goes off, which is what a sear needs. It arrives pre-seasoned and takes twenty minutes in the oven whenever the surface dulls.",
    features: ["Pre-seasoned cast iron", "Oven-safe to 260 °C", "28 cm cooking surface"],
    specs: [["Care", "Hand wash and dry"], ["Oven-safe", "To 260 °C"], ["Weight", "2.7 kg"]],
    tags: ["cookware", "cast-iron", "skillet"], priceMinor: 7_999, listPriceMinor: 9_499, material: "cast iron" },
  { name: "Emberlane Home Oak Standing Desk E-160", category: "furniture", brand: "emberlane-home",
    summary: "A solid oak desk that rises to standing height.",
    description: "The top is solid oak rather than veneer, finished with a hard wax oil that can be repaired in place instead of replaced. Two motors lift the surface from 68 to 118 centimetres, quietly enough to stay on a call. The frame is powder-coated steel and the feet level on a floor that is not quite flat.",
    features: ["Solid oak top", "68 – 118 cm range", "Two quiet motors"],
    specs: [["Assembly", "Flat-packed, tools included"], ["Height", "75 cm"], ["Weight", "32 kg"]],
    tags: ["furniture", "desk", "oak"], priceMinor: 64_999, listPriceMinor: 74_999, material: "solid oak" },
  { name: "Vantage Sports Adjustable Dumbbell V-24", category: "fitness", brand: "vantage-sports",
    summary: "One dumbbell that covers what a small rack used to.",
    description: "Resistance moves from 5 to 24 kilograms with a twist of the handle, so a set runs from press to row without stopping to change plates. The plates seat on a steel shaft, which keeps the balance the same at every weight. Grip is knurled where the hand lands and smooth where it does not.",
    features: ["5 – 24 kg per dumbbell", "Twist-to-change plates", "Knurled steel grip"],
    specs: [["Resistance", "5 – 24 kg"], ["Grip", "Knurled steel"], ["Weight", "24 kg loaded"]],
    tags: ["fitness", "weights", "home-gym"], priceMinor: 19_999, listPriceMinor: 19_999, material: "cast iron" },
  { name: "Summit Gear Backpacking Tent S-2", category: "camping", brand: "summit-gear",
    summary: "A two-person tent light enough to carry alone.",
    description: "The poles run through sleeves rather than over the top, which shortens pitching in wind and leaves the fly tight. The fly is proofed to 5,000 mm and every seam is taped, so a night of rain stays outside. Two doors and two porches keep the packs out of the sleeping space.",
    features: ["2-person, 3-season", "Taped, proofed seams", "Packs to 55 × 18 cm"],
    specs: [["Season rating", "3-season"], ["Packed size", "55 × 18 cm"], ["Weight", "2.4 kg"]],
    tags: ["camping", "tent", "backpacking"], priceMinor: 34_999, listPriceMinor: 42_999, material: "ripstop nylon" },
  { name: "Meridian Merino Half-Zip Sweater M-3", category: "mens-clothing", brand: "meridian",
    summary: "A fine merino sweater that layers under a jacket.",
    description: "Knitted from 280 gsm merino, which is warm without bulk and does not hold a smell after a day of wear. The half-zip sits flat under a collar, and the shoulder seams are set back so a bag strap does not rub. It is cut to layer over a shirt without pulling.",
    features: ["280 gsm merino", "Set-back shoulder seams", "Machine washable"],
    specs: [["Fit", "Regular"], ["Knit weight", "280 gsm"], ["Care", "Machine wash"]],
    tags: ["mens", "merino", "knitwear"], priceMinor: 12_999, listPriceMinor: 15_999, material: "merino wool" },
  { name: "Boreal Outdoors Down Parka B-6", category: "womens-clothing", brand: "boreal-outdoors",
    summary: "A long parka built for a northern winter.",
    description: "Recycled down fills channels that stay where they are put, so there are no cold spots across the back. The shell is windproof and treated to shed a wet snow shower. It is cut long enough to cover a jumper, with a hood that adjusts without a mirror.",
    features: ["Recycled down fill", "Windproof shell", "Adjustable hood"],
    specs: [["Fit", "Relaxed"], ["Length", "Mid-thigh"], ["Lining", "Recycled down"]],
    tags: ["womens", "parka", "winter"], priceMinor: 27_999, listPriceMinor: 32_999, material: "recycled down" },
  { name: "Emberlane Home Botanical Cleansing Balm E-1", category: "skin-care", brand: "emberlane-home",
    summary: "A balm that lifts make-up without stripping the skin.",
    description: "Shea butter and cold-pressed jojoba melt at body temperature, so the balm spreads without pulling at the skin. It rinses clean with warm water and leaves no film behind. Fragrance is left out, which is what most reactive skin reacts to.",
    features: ["Shea butter and jojoba", "Fragrance-free", "Rinses without residue"],
    specs: [["Size", "100 ml"], ["Format", "Balm"], ["Suited to", "All skin types"]],
    tags: ["skincare", "cleanser", "fragrance-free"], priceMinor: 3_499, listPriceMinor: 3_499, material: "shea butter" },
  { name: "Pinnacle Play Strategy Board Game P-4", category: "board-games", brand: "pinnacle-play",
    summary: "A strategy game that teaches in ten minutes.",
    description: "Players take turns placing workers, and every placement changes what the next player can do, which is what keeps a table talking. The board is double-sided, so the first games are shorter than the later ones. Everything packs back into a box that holds its lid flat.",
    features: ["2 – 4 players", "60 – 90 minutes", "Double-sided board"],
    specs: [["Players", "2 – 4 players"], ["Play time", "60 – 90 minutes"], ["Age", "12 and up"]],
    tags: ["board-games", "strategy", "family"], priceMinor: 3_999, listPriceMinor: 3_999, material: "recycled board" },
];

/** How many anchors each leaf category and brand already accounts for, so the generated half tops them up. */
const ANCHORS_PER_CATEGORY: ReadonlyMap<LeafCategorySlug, number> = countBy(
  ANCHOR_PRODUCTS,
  (anchor) => anchor.category,
);
const ANCHORS_PER_BRAND: ReadonlyMap<BrandSlug, number> = countBy(
  ANCHOR_PRODUCTS,
  (anchor) => anchor.brand,
);

/**
 * The brands a product of each leaf category may plausibly carry, most natural first: what keeps a generated
 * name from reading like a brand with no business in that aisle. Every brand appears in at least one category
 * and every category offers at least three, so a brand's remaining products always have somewhere to go.
 */
const CATEGORY_BRAND_AFFINITY: Readonly<Record<LeafCategorySlug, readonly BrandSlug[]>> = {
  audio: ["aurelia-audio", "lumen-labs", "kestrel-optics", "tidewell"],
  cameras: ["kestrel-optics", "lumen-labs", "aurelia-audio", "tidewell"],
  laptops: ["lumen-labs", "tidewell", "aurelia-audio", "cobalt-works"],
  "phones-accessories": ["tidewell", "aurelia-audio", "cobalt-works", "lumen-labs"],
  cookware: ["northcrest", "emberlane-home", "cobalt-works", "summit-gear"],
  furniture: ["emberlane-home", "northcrest", "boreal-outdoors", "meridian"],
  fitness: ["vantage-sports", "summit-gear", "boreal-outdoors", "cobalt-works"],
  camping: ["summit-gear", "boreal-outdoors", "vantage-sports", "kestrel-optics"],
  "mens-clothing": ["meridian", "vantage-sports", "boreal-outdoors", "summit-gear"],
  "womens-clothing": ["meridian", "emberlane-home", "vantage-sports", "boreal-outdoors"],
  "skin-care": ["emberlane-home", "northcrest", "meridian"],
  "board-games": ["pinnacle-play", "tidewell", "northcrest", "emberlane-home"],
};

// Brand allocation -------------------------------------------------------------------------------
/**
 * Shares the generated products between the brands so both allocations hold exactly: each leaf category
 * receives its quota less the anchor it already accounts for, and each brand receives its own quota.
 *
 * At each slot the product goes to the eligible brand with the greatest remaining need — its outstanding
 * allocation over the room its remaining eligible slots offer — which stops a brand being stranded: the only
 * brand a category's last slots can serve is served before brands with room to spare.
 *
 * @returns One brand slug per generated product, in category order.
 * @throws Error - When a category has no eligible brand, or a brand's quota is left unconsumed; either would
 *   leave the catalogue short of `PRODUCT_TOTAL` products and make the served counts untrue.
 */
function assignBrandSlugs(): readonly BrandSlug[] {
  const categoryRemaining = new Map<LeafCategorySlug, number>(LEAF_CATEGORY_SLUGS.map((slug) => [slug,
    CATEGORY_PRODUCT_QUOTA[categoryId(slug)] - (ANCHORS_PER_CATEGORY.get(slug) ?? 0)]));
  const brandRemaining = new Map<BrandSlug, number>(BRAND_DEFINITIONS.map((definition) => [definition.slug,
    BRAND_PRODUCT_QUOTA[brandId(definition.slug)] - (ANCHORS_PER_BRAND.get(definition.slug) ?? 0)]));
  const assigned: BrandSlug[] = [];
  for (const categorySlug of LEAF_CATEGORY_SLUGS) {
    let slots = categoryRemaining.get(categorySlug) ?? 0;
    while (slots > 0) {
      let chosen: BrandSlug | null = null, greatestNeed = -1;
      for (const brandSlug of CATEGORY_BRAND_AFFINITY[categorySlug]) {
        const remaining = brandRemaining.get(brandSlug) ?? 0;
        if (remaining === 0) continue;
        let room = 0;
        for (const [other, left] of categoryRemaining)
          if (CATEGORY_BRAND_AFFINITY[other].includes(brandSlug)) room += left;
        const need = room === 0 ? Number.POSITIVE_INFINITY : remaining / room;
        if (need > greatestNeed) { greatestNeed = need; chosen = brandSlug; }
      }
      if (chosen === null) throw new Error(`No brand is eligible for the remaining ${categorySlug}.`);
      brandRemaining.set(chosen, (brandRemaining.get(chosen) ?? 1) - 1);
      categoryRemaining.set(categorySlug, slots - 1);
      assigned.push(chosen);
      slots -= 1;
    }
  }
  const stranded = [...brandRemaining.values()].some((remaining) => remaining !== 0);
  if (assigned.length !== PRODUCT_TOTAL - ANCHOR_PRODUCTS.length || stranded)
    throw new Error("The brand allocation left the catalogue short of its category or brand totals.");
  return assigned;
}
/** The vocabulary's name for each brand slug, so a product can name its maker from the slug alone. */
const BRAND_NAME_BY_SLUG: ReadonlyMap<BrandSlug, string> = new Map(
  BRAND_DEFINITIONS.map((definition) => [definition.slug, definition.name] as const),
);
/** The price bands the price facet declares, read from the vocabulary so no bound is restated here. */
const PRICE_FACET: FacetDefinition | undefined = FACET_DEFINITIONS.find((d) => d.id === "price");
const PRICE_BANDS: readonly FacetDefinitionOption[] = PRICE_FACET?.options ?? [];
if (PRICE_BANDS.length === 0) throw new Error("The price facet declares no bands to price against.");

/** Prices one product inside a band: a whole dollar on a step plus a retail ending, so the band holds what it
 *  advertises. Both conversions go through `src/utils/format.ts`, the one rounding rule for minor units. */
function choosePriceMinor(rand: SeededRandom, band: FacetDefinitionOption): MinorUnits {
  const floorMinor = Math.max(MIN_PRICE_MINOR, band.minMinor ?? 0);
  const ceilingMinor = band.maxMinor ?? floorMinor + OPEN_TOP_BAND_MINOR;
  const lower = Math.ceil(fromMinorUnits(floorMinor));
  const ending = rand.pick(PRICE_ENDINGS_MINOR);
  const highest = Math.floor(fromMinorUnits(ceilingMinor - ending));
  const steps = Math.max(1, Math.floor((highest - lower) / PRICE_STEP_MAJOR) + 1);
  return toMinorUnits(lower + rand.int(0, steps - 1) * PRICE_STEP_MAJOR) + ending;
}

// Derived fields ---------------------------------------------------------------------------------
/** The stock a product holds, by its position: every twentieth product is out of stock and the two after it
 *  are low, so the availability facet, the stock badge and the cart's clamp are all reachable. */
function stockOnHandFor(index: number, rand: SeededRandom): number {
  const position = index % STOCK_CYCLE;
  if (position === 0) return 0;
  if (position <= LOW_STOCK_POSITIONS) return rand.int(1, LOW_STOCK_THRESHOLD - 1);
  return rand.int(LOW_STOCK_THRESHOLD + 1, MAX_STOCK_ON_HAND);
}
/**
 * The rating pair a product carries: how many reviews it holds, and the one-decimal average of them.
 *
 * The average is derived from a whole total rather than chosen — an integer figure between 3.6 and 4.9 per
 * review, rounded to tenths — which makes it one `src/data/reviews.ts` can reproduce exactly by generating
 * that many integer ratings. A product with no reviews averages zero, as its count of zero tells a caller.
 */
function ratingSummaryFor(index: number, rand: SeededRandom): { average: number; count: number } {
  const count = RATING_COUNT_CYCLE[index % RATING_COUNT_CYCLE.length];
  if (count === 0) return { average: 0, count: 0 };
  const target = rand.int(RATING_TARGET_MIN_TENTHS, RATING_TARGET_MAX_TENTHS);
  const total = Math.round((target * count) / 10);
  return { average: Math.round((total / count) * 10) / 10, count };
}
/** The day and time a product was added, inside the trailing window ending on `anchorDay`: only the day comes
 *  from the clock, and only once per build, so two builds on the same day are identical. */
function createdAtFor(anchorDay: IsoDateString, rand: SeededRandom): IsoDateTimeString {
  const at = parseIso(addDays(anchorDay, -rand.int(0, CATALOGUE_SPAN_DAYS)));
  if (at === null) throw new TypeError(`createdAtFor requires an ISO day; received "${anchorDay}"`);
  at.setHours(rand.int(8, 20), rand.int(0, 59), 0, 0);
  return toIsoDateTime(at);
}

/** The catalogue code a product is picked and invoiced by: its maker's code and its position. */
function skuFor(brandSlug: BrandSlug, index: number): string {
  return sequenceId(brandSlug.replace(/[^a-z]/g, "").slice(0, 3).toUpperCase(), index + 1);
}

// Product construction ---------------------------------------------------------------------------
/** A product the catalogue still has to build: where it sits, and the category and brand it carries. */
interface ProductPlan {
  readonly index: number; readonly anchorDay: IsoDateString; readonly offset: number;
  readonly categorySlug: LeafCategorySlug; readonly brandSlug: BrandSlug;
}
/** Everything a product is composed of before the catalogue derives its identity, stock and imagery. */
interface ProductCore {
  readonly name: string; readonly sku: string; readonly tags: readonly string[];
  readonly categorySlug: LeafCategorySlug; readonly brandSlug: BrandSlug;
  readonly summary: string; readonly description: string; readonly features: readonly string[];
  readonly specs: readonly ProductSpec[]; readonly priceMinor: MinorUnits;
  readonly listPriceMinor: MinorUnits;
}
/** The three rows every product ends its specification table with: its material, its warranty and its code. */
function derivedSpecRows(material: string, warranty: string, sku: string): readonly ProductSpec[] {
  return [{ label: "Material", value: material }, { label: "Warranty", value: warranty },
    { label: "Item code", value: sku }];
}
/** The category's rows a generated product shows, taken from its anchor by rotation so no two read alike. */
function categoryRowsFor(anchor: AnchorProduct, offset: number): readonly ProductSpec[] {
  return Array.from({ length: 2 }, (_item, step) => {
    const [label, value] = anchor.specs[(offset + step) % anchor.specs.length];
    return { label, value };
  });
}

/**
 * Draws one view of a product as a self-contained inline SVG and returns it as a data URI, so the catalogue
 * ships no image file and no image request leaves the page.
 *
 * The picture is a function of the product and of the view number: the gradient comes from the product's name
 * length and price, the accent and the band from the view, and the label from its initials. That is a checksum
 * rather than a digest, which keeps a second hashing rule out of this module, and the markup is inert — no
 * external reference, no linked font, no bitmap, no script — so nothing in it can load or run.
 *
 * @param product - The product to draw; its name and price are read.
 * @param index - The view being drawn, counted from zero.
 * @returns A `data:image/svg+xml` URI holding the encoded picture.
 */
export function buildProductImage(product: Product, index: number): string {
  const checksum = product.name.length + product.priceMinor + index;
  const gradient = IMAGERY_PALETTE[checksum % IMAGERY_PALETTE.length];
  const accentX = IMAGE_WIDTH - 80 - ((checksum * 7) % 220);
  const accentY = 60 + ((checksum * 3) % 180);
  const accentRadius = 90 + (checksum % 4) * 40;
  const bandHeight = 28 + (index % 5) * 14;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" ` +
    `viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}">` +
    `<defs><linearGradient id="product" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${gradient.from}"/><stop offset="1" stop-color="${gradient.to}"/>` +
    `</linearGradient></defs><rect width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" fill="url(#product)"/>` +
    `<circle cx="${accentX}" cy="${accentY}" r="${accentRadius}" fill="#ffffff" opacity="0.14"/>` +
    `<rect y="${IMAGE_HEIGHT - bandHeight}" width="${IMAGE_WIDTH}" height="${bandHeight}" fill="#ffffff" ` +
    `opacity="0.08"/><text x="64" y="${IMAGE_HEIGHT - 72}" fill="#ffffff" font-weight="700" ` +
    `font-size="128" letter-spacing="4" font-family="system-ui, sans-serif">${initials(product.name)}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
/** A product's images: two to four views, each with its own picture, alt text naming the product and the view,
 *  and the intrinsic size the gallery and the catalogue tile reserve for it. */
function imagesOf(product: Product, index: number): readonly ProductImage[] {
  const count = IMAGE_COUNT_MIN + (index % IMAGE_COUNT_SPREAD);
  return Array.from({ length: count }, (_item, position) => ({
    id: `${product.id}-${position + 1}`, productId: product.id, position,
    url: buildProductImage(product, position), alt: `${product.name} — ${IMAGE_VIEWS[position]}`,
    width: IMAGE_WIDTH, height: IMAGE_HEIGHT,
  }));
}
/**
 * Completes a core into a whole product: the identifier and slug its name implies, the branded category and
 * brand identifiers, the currency, the stock, the rating pair, the status, the day it was added and its
 * imagery. The stock, the rating and the date follow the product's position, so a rebuild reads them in the
 * same order and with the same values, and no half-built product leaves here.
 */
function completeProduct(core: ProductCore, plan: ProductPlan, rand: SeededRandom): Product {
  const rating = ratingSummaryFor(plan.index, rand);
  const draft: Product = {
    id: productId(core.name), sku: core.sku, slug: slugify(core.name), name: core.name,
    brandId: brandId(core.brandSlug), categoryId: categoryId(core.categorySlug), tags: core.tags,
    summary: core.summary, description: core.description, specs: core.specs, features: core.features,
    images: [], currency: DEFAULT_CURRENCY, status: SELLABLE_STATUS, lowStockThreshold: LOW_STOCK_THRESHOLD,
    priceMinor: core.priceMinor, listPriceMinor: core.listPriceMinor, ratingAverage: rating.average,
    ratingCount: rating.count, stockOnHand: stockOnHandFor(plan.index, rand),
    createdAt: createdAtFor(plan.anchorDay, rand),
  };
  return { ...draft, images: imagesOf(draft, plan.index) };
}
/**
 * Composes the core of one generated product: its name from its brand, a descriptor and one of its category's
 * lines, its copy from that category's materials and uses, its price from the band it is due, and its
 * specification rows from its anchor. The line and the descriptor follow the position inside its own category
 * — four lines by six descriptors covers the largest allocation — so no two products of a category are named
 * alike however the brands fall.
 */
function generatedCore(plan: ProductPlan, rand: SeededRandom): ProductCore {
  const copy = CATEGORY_COPY[plan.categorySlug];
  const anchor = ANCHOR_PRODUCTS.find((entry) => entry.category === plan.categorySlug);
  if (anchor === undefined) throw new Error(`The ${plan.categorySlug} category has no anchor to expand.`);
  const line = copy.lines[plan.offset % copy.lines.length];
  const descriptor =
    PRODUCT_DESCRIPTORS[Math.floor(plan.offset / copy.lines.length) % PRODUCT_DESCRIPTORS.length];
  const brandName = BRAND_NAME_BY_SLUG.get(plan.brandSlug) ?? plan.brandSlug;
  const material = rand.pick(copy.materials); const use = rand.pick(copy.uses);
  const warranty = WARRANTY_TERMS[plan.index % WARRANTY_TERMS.length];
  const sku = skuFor(plan.brandSlug, plan.index);
  const priceMinor = choosePriceMinor(rand, PRICE_BANDS[plan.index % PRICE_BANDS.length]);
  const listPriceMinor = plan.index % DISCOUNT_EVERY === 0
    ? roundMinorUnits(priceMinor / (1 - rand.pick(DISCOUNT_RATIOS))) : priceMinor;
  const categoryRows = categoryRowsFor(anchor, plan.offset);
  return {
    name: `${brandName} ${descriptor} ${line}`, sku, categorySlug: plan.categorySlug,
    brandSlug: plan.brandSlug, priceMinor, listPriceMinor, tags: [plan.categorySlug, ...slugify(line).split("-")],
    summary: `${line} by ${brandName}, made from ${material} for ${use}.`,
    description: [`The ${line} by ${brandName} is made from ${material} for ${use}.`, copy.detail,
      `The warranty runs for ${warranty}.`].join(" "),
    features: [`Made from ${material}`, `Built for ${use}`, `Warranty: ${warranty}`,
      ...categoryRows.map((row) => `${row.label}: ${row.value}`)],
    specs: [...categoryRows, ...derivedSpecRows(material, warranty, sku)],
  };
}

/** Completes one anchor: its hand-authored copy, material, rows and prices, with the three rows every product shows. */
function anchorCore(anchor: AnchorProduct, plan: ProductPlan): ProductCore {
  const material = anchor.material;
  const warranty = WARRANTY_TERMS[plan.index % WARRANTY_TERMS.length];
  const sku = skuFor(plan.brandSlug, plan.index);
  return {
    name: anchor.name, sku, categorySlug: plan.categorySlug, brandSlug: plan.brandSlug,
    summary: anchor.summary, description: anchor.description, tags: anchor.tags,
    features: [...anchor.features, `Warranty: ${warranty}`], priceMinor: anchor.priceMinor,
    specs: [...anchor.specs.map(([label, value]) => ({ label, value })),
      ...derivedSpecRows(material, warranty, sku)], listPriceMinor: anchor.listPriceMinor,
  };
}

/** Builds every generated product, category by category in the vocabulary's order, with the brands the
 *  allocation handed out for those same positions. */
function generatedProducts(rand: SeededRandom, anchorDay: IsoDateString): readonly Product[] {
  const brandSlugs = assignBrandSlugs();
  const products: Product[] = [];
  let cursor = 0;
  for (const categorySlug of LEAF_CATEGORY_SLUGS) {
    const count = CATEGORY_PRODUCT_QUOTA[categoryId(categorySlug)] -
      (ANCHORS_PER_CATEGORY.get(categorySlug) ?? 0);
    for (let offset = 0; offset < count; offset += 1) {
      const plan: ProductPlan = {
        index: ANCHOR_PRODUCTS.length + cursor, anchorDay, offset, categorySlug, brandSlug: brandSlugs[cursor],
      };
      products.push(completeProduct(generatedCore(plan, rand), plan, rand));
      cursor += 1;
    }
  }
  return products;
}
/**
 * Builds the seeded catalogue: the twelve anchors, then the generated products that bring every leaf category
 * and every brand to exactly the count its allocation declares.
 *
 * Pure and re-callable: one seed stream and one reading of the clock reduced to a day, nothing else, so two
 * calls on the same day return deeply equal collections — the property the seed's determinism is measured by.
 *
 * @returns All `PRODUCT_TOTAL` products, the anchors first.
 */
export function buildProducts(): readonly Product[] {
  const rand = createSeededRandom(DATA_SEED);
  const anchorDay = toIsoDate(new Date());
  const anchors = ANCHOR_PRODUCTS.map((anchor, index) => {
    const plan: ProductPlan = {
      index, anchorDay, offset: 0, categorySlug: anchor.category, brandSlug: anchor.brand,
    };
    return completeProduct(anchorCore(anchor, plan), plan, rand);
  });
  return [...anchors, ...generatedProducts(rand, anchorDay)];
}
/** The seeded catalogue, exactly as {@link buildProducts} builds it: the collection
 *  `src/data/repositories.ts` serves for `GET /api/products`, for a product's detail, related and search
 *  routes, and for the facet counts describing them. */
export const PRODUCTS: readonly Product[] = buildProducts();
/**
 * The availability of a product, derived from the stock it holds. The rule itself is applied by
 * `src/utils/format.ts` (`formatAvailability`), which owns it for the badge, the facet and the cart, so this
 * module only attaches the product the level belongs to.
 *
 * @param product - The product to report availability for.
 * @returns Its stock, its threshold, and the level and purchasability they imply.
 */
export function inventoryStatusOf(product: Product): Inventory {
  const { status, available } = formatAvailability(product.stockOnHand, product.lowStockThreshold);
  return {
    productId: product.id, stockOnHand: product.stockOnHand,
    lowStockThreshold: product.lowStockThreshold, status, available,
  };
}
