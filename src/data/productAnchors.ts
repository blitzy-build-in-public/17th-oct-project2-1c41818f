/**
 * Path: src/data/productAnchors.ts
 * Purpose: The catalogue's hand-authored source: the leaf-category vocabulary, the copy pools each category is written from, and the twelve anchor products the seeded catalogue expands.
 * Lines: 397
 */

// Split out of `src/data/products.ts` along the seam between the hand-authored catalogue source and
// the code that expands it, so Prettier's own formatting of each file fits inside the 600-line
// ceiling; `src/data/products.ts` imports what it needs from here, and the manifest records the split.

import { BRAND_DEFINITIONS, CATEGORY_DEFINITIONS } from "@/constants/taxonomy";
import type { MinorUnits } from "@/types/common";
import { countBy } from "@/utils/collections";

// Catalogue types --------------------------------------------------------------------------------
/** One specification row of an anchor: a label and the value beside it, as a pair a seed can destructure. */
type AnchorSpecRow = readonly [string, string];

/**
 * A category definition that hangs under a parent, and therefore holds products: one of the twelve the facets
 * and the listings offer. A category the taxonomy gains fails to compile here until it is given copy/brands.
 */
type LeafDefinition = Extract<(typeof CATEGORY_DEFINITIONS)[number], { parentSlug: string }>;
export type LeafCategorySlug = LeafDefinition["slug"];
/** A brand's slug, as the vocabulary declares it. */
export type BrandSlug = (typeof BRAND_DEFINITIONS)[number]["slug"];

/** The twelve leaf categories in the vocabulary's order; the parents group them and hold no products. */
const LEAF_CATEGORIES: readonly LeafDefinition[] = CATEGORY_DEFINITIONS.filter(
  (definition): definition is LeafDefinition => definition.parentSlug !== null,
);
export const LEAF_CATEGORY_SLUGS: readonly LeafCategorySlug[] = LEAF_CATEGORIES.map(
  (entry) => entry.slug,
);

/** The copy pools of one leaf category, keyed by the leaf-slug union: the lines it sells, the materials and
 *  uses its copy is written around, and one detail sentence that closes the generated description of every
 *  line listed here — so it must hold for all of them, not just the line it was written for. */
interface CategoryCopy {
  readonly lines: readonly string[];
  readonly materials: readonly string[];
  readonly uses: readonly string[];
  readonly detail: string;
}

export const CATEGORY_COPY: Readonly<Record<LeafCategorySlug, CategoryCopy>> = {
  audio: {
    lines: ["Over-Ear Headphones", "Bookshelf Speakers", "Turntable", "Soundbar"],
    materials: ["aluminium", "recycled ABS"],
    uses: ["long listening sessions", "a small front room"],
    detail:
      "It is made for long listening in a small room, where an even mid-range matters more than volume.",
  },
  cameras: {
    lines: ["Mirrorless Camera", "Prime Lens", "Travel Tripod", "Camera Backpack"],
    materials: ["magnesium alloy", "carbon fibre"],
    uses: ["travel photography", "a full day of shooting"],
    detail:
      "It is made for travel photography, where the gear is carried all day and set up wherever the light is.",
  },
  laptops: {
    lines: ["Ultralight Laptop", "Workstation Laptop", "Convertible Laptop", "Compact Laptop"],
    materials: ["recycled aluminium", "carbon fibre"],
    uses: ["a daily commute", "editing on the move"],
    detail:
      "It is built to be carried between places and opened and closed a few thousand times a year.",
  },
  "phones-accessories": {
    lines: ["Charging Stand", "Protective Case", "USB-C Cable", "Phone Grip"],
    materials: ["recycled ABS", "silicone"],
    uses: ["charging at a desk", "a phone that travels"],
    detail: "It is made to sit with a phone every day, at a desk or in a pocket.",
  },
  cookware: {
    lines: ["Cast Iron Skillet", "Chef's Knife", "Saucepan", "Baking Tray"],
    materials: ["cast iron", "forged stainless steel"],
    uses: ["family kitchens", "a slow Sunday"],
    detail: "It is built for a kitchen that cooks most nights and washes up straight after.",
  },
  furniture: {
    lines: ["Standing Desk", "Bookshelf", "Dining Chair", "Storage Bench"],
    materials: ["solid oak", "powder-coated steel"],
    uses: ["a home office", "small rooms"],
    detail:
      "It is built to be moved from one small room to another and to stay square when it gets there.",
  },
  fitness: {
    lines: ["Adjustable Dumbbell", "Exercise Mat", "Resistance Band Set", "Kettlebell"],
    materials: ["cast iron", "natural rubber"],
    uses: ["early sessions", "a home gym"],
    detail:
      "It is built for a home gym, where it has to store small and survive being used every day.",
  },
  camping: {
    lines: ["Backpacking Tent", "Sleeping Bag", "Camp Stove", "Camp Chair"],
    materials: ["ripstop nylon", "anodised aluminium"],
    uses: ["weekend trips", "a wet night"],
    detail:
      "It is made for trips where everything has to pack small and be carried rather than wheeled.",
  },
  "mens-clothing": {
    lines: ["Merino Half-Zip Sweater", "Oxford Shirt", "Waxed Jacket", "Chino Trousers"],
    materials: ["merino wool", "organic cotton twill"],
    uses: ["the office", "the weekend"],
    detail:
      "The fabric is chosen to hold its shape through a winter of wear, not just the season it was bought in.",
  },
  "womens-clothing": {
    lines: ["Merino Wrap Dress", "Wool Coat", "Linen Shirt", "Cotton Trousers"],
    materials: ["merino wool", "washed linen"],
    uses: ["the desk and the dinner after", "the shoulder season"],
    detail: "It is cut so the fabric falls straight rather than clinging at the waist.",
  },
  "skin-care": {
    lines: ["Cleansing Balm", "Hydrating Serum", "Day Cream", "Body Lotion"],
    materials: ["shea butter", "cold-pressed jojoba"],
    uses: ["a short morning routine", "reactive skin"],
    detail: "It is made for a routine short enough to keep, morning and evening.",
  },
  "board-games": {
    lines: ["Strategy Board Game", "Party Game", "Card Game", "Family Board Game"],
    materials: ["recycled board", "beech wood"],
    uses: ["game nights", "a full table"],
    detail: "The rules are taught in five minutes and stay interesting past twenty plays.",
  },
};

/**
 * One hand-authored catalogue record: the copy, specification rows, tags and prices of a product written out
 * rather than generated, and the category and brand it belongs to. These twelve — one per leaf category, naming
 * eleven of the twelve brands — are the template the catalogue is expanded from: a generated product reads its
 * category's copy pools and quotes its anchor's rows, which are therefore worded to hold for every line there.
 */
export interface AnchorProduct {
  readonly name: string;
  readonly category: LeafCategorySlug;
  readonly brand: BrandSlug;
  readonly summary: string;
  readonly description: string;
  /** The material this anchor's own description names, so the `Material` row derived for it cannot contradict it. */
  readonly material: string;
  readonly features: readonly string[];
  readonly specs: readonly AnchorSpecRow[];
  readonly tags: readonly string[];
  readonly priceMinor: MinorUnits;
  readonly listPriceMinor: MinorUnits;
}

/** The hand-authored anchors, one per leaf category, priced so that every band the price facet declares is represented. */
export const ANCHOR_PRODUCTS: readonly AnchorProduct[] = [
  {
    name: "Aurelia Audio Over-Ear Headphones AX-45",
    category: "audio",
    brand: "aurelia-audio",
    summary: "Closed-back headphones that hold their composure through a long mix.",
    description:
      "A closed-back design that keeps the room out and the mix in, with earcups machined from aluminium and lined with memory foam. The headband folds flat into the case, so the headphones travel in a bag rather than under an arm. A single charge runs for thirty hours, and the cable in the box is a spare rather than the only way to listen.",
    features: ["45 mm drivers", "30-hour battery", "Folding earcups", "USB-C charging"],
    specs: [
      ["Frequency response", "20 Hz – 20 kHz"],
      ["Power", "USB-C or mains"],
      ["Weight", "265 g"],
    ],
    tags: ["audio", "over-ear", "wireless", "studio"],
    priceMinor: 24_999,
    listPriceMinor: 29_999,
    material: "aluminium",
  },
  {
    name: "Kestrel Optics Mirrorless Camera K-24",
    category: "cameras",
    brand: "kestrel-optics",
    summary: "A 24-megapixel body small enough to carry for a whole day.",
    description:
      "A 24-megapixel sensor on a magnesium body that weighs less than a filled water bottle. The dials sit where a right thumb expects them, so shutter speed, aperture and exposure compensation never need a menu. Weather sealing keeps it working through a wet afternoon, and the battery takes about 480 frames between charges.",
    features: ["24 MP full-frame sensor", "Weather-sealed body", "480-frame battery"],
    specs: [
      ["Weather sealing", "Fully sealed"],
      ["Mount thread", "1/4 inch"],
      ["Weight", "620 g"],
    ],
    tags: ["cameras", "mirrorless", "full-frame"],
    priceMinor: 189_999,
    listPriceMinor: 209_999,
    material: "magnesium alloy",
  },
  {
    name: "Lumen Labs Ultralight Laptop L-14",
    category: "laptops",
    brand: "lumen-labs",
    summary: "An ultralight for the commute, with a screen that stays readable outdoors.",
    description:
      "The chassis is machined from a single block of recycled aluminium, so it flexes less than the plastic shells it competes with. The display is matte and reaches 400 nits, which is what makes it usable on a train in daylight. Two working days fit in one charge, and the ports are split across both sides.",
    features: ["14-inch matte display", "Two-day battery", "Machined aluminium body"],
    specs: [
      ["Display size", "14 inches"],
      ["Memory", "16 GB"],
      ["Weight", "1.2 kg"],
    ],
    tags: ["laptops", "ultralight", "aluminium"],
    priceMinor: 129_999,
    listPriceMinor: 129_999,
    material: "recycled aluminium",
  },
  {
    name: "Tidewell Magnetic Charging Stand T-2",
    category: "phones-accessories",
    brand: "tidewell",
    summary: "A weighted stand that charges a handset upright.",
    description:
      "The base is filled, so the stand stays where it is put while a phone is lifted off or dropped on. The contact surface is silicone, which holds the handset without marking the case. It delivers 15 watts to a magnetic handset and 7.5 watts over Qi.",
    features: ["15 W magnetic charging", "Weighted non-slip base", "Silicone contact surface"],
    specs: [
      ["Compatibility", "USB-C and Qi"],
      ["Finish", "Matte"],
      ["Weight", "180 g"],
    ],
    tags: ["phones", "charging", "desk"],
    priceMinor: 2_499,
    listPriceMinor: 2_499,
    material: "silicone",
  },
  {
    name: "Northcrest Cast Iron Skillet N-28",
    category: "cookware",
    brand: "northcrest",
    summary: "A 28 cm skillet that seasons as it is used.",
    description:
      "Cast in one piece, so there is no joint to loosen and no coating to wear through. It heats evenly across the base and holds that heat after the hob goes off, which is what a sear needs. It arrives pre-seasoned and takes twenty minutes in the oven whenever the surface dulls.",
    features: ["Pre-seasoned cast iron", "Oven-safe to 260 °C", "28 cm cooking surface"],
    specs: [
      ["Care", "Hand wash and dry"],
      ["Oven-safe", "To 260 °C"],
      ["Weight", "2.7 kg"],
    ],
    tags: ["cookware", "cast-iron", "skillet"],
    priceMinor: 7_999,
    listPriceMinor: 9_499,
    material: "cast iron",
  },
  {
    name: "Emberlane Home Oak Standing Desk E-160",
    category: "furniture",
    brand: "emberlane-home",
    summary: "A solid oak desk that rises to standing height.",
    description:
      "The top is solid oak rather than veneer, finished with a hard wax oil that can be repaired in place instead of replaced. Two motors lift the surface from 68 to 118 centimetres, quietly enough to stay on a call. The frame is powder-coated steel and the feet level on a floor that is not quite flat.",
    features: ["Solid oak top", "68 – 118 cm range", "Two quiet motors"],
    specs: [
      ["Assembly", "Flat-packed, tools included"],
      ["Height", "75 cm"],
      ["Weight", "32 kg"],
    ],
    tags: ["furniture", "desk", "oak"],
    priceMinor: 64_999,
    listPriceMinor: 74_999,
    material: "solid oak",
  },
  {
    name: "Vantage Sports Adjustable Dumbbell V-24",
    category: "fitness",
    brand: "vantage-sports",
    summary: "One dumbbell that covers what a small rack used to.",
    description:
      "Resistance moves from 5 to 24 kilograms with a twist of the handle, so a set runs from press to row without stopping to change plates. The plates seat on a steel shaft, which keeps the balance the same at every weight. Grip is knurled where the hand lands and smooth where it does not.",
    features: ["5 – 24 kg per dumbbell", "Twist-to-change plates", "Knurled steel grip"],
    specs: [
      ["Resistance", "5 – 24 kg"],
      ["Grip", "Knurled steel"],
      ["Weight", "24 kg loaded"],
    ],
    tags: ["fitness", "weights", "home-gym"],
    priceMinor: 19_999,
    listPriceMinor: 19_999,
    material: "cast iron",
  },
  {
    name: "Summit Gear Backpacking Tent S-2",
    category: "camping",
    brand: "summit-gear",
    summary: "A two-person tent light enough to carry alone.",
    description:
      "The poles run through sleeves rather than over the top, which shortens pitching in wind and leaves the fly tight. The fly is proofed to 5,000 mm and every seam is taped, so a night of rain stays outside. Two doors and two porches keep the packs out of the sleeping space.",
    features: ["2-person, 3-season", "Taped, proofed seams", "Packs to 55 × 18 cm"],
    specs: [
      ["Season rating", "3-season"],
      ["Packed size", "55 × 18 cm"],
      ["Weight", "2.4 kg"],
    ],
    tags: ["camping", "tent", "backpacking"],
    priceMinor: 34_999,
    listPriceMinor: 42_999,
    material: "ripstop nylon",
  },
  {
    name: "Meridian Merino Half-Zip Sweater M-3",
    category: "mens-clothing",
    brand: "meridian",
    summary: "A fine merino sweater that layers under a jacket.",
    description:
      "Knitted from 280 gsm merino, which is warm without bulk and does not hold a smell after a day of wear. The half-zip sits flat under a collar, and the shoulder seams are set back so a bag strap does not rub. It is cut to layer over a shirt without pulling.",
    features: ["280 gsm merino", "Set-back shoulder seams", "Machine washable"],
    specs: [
      ["Fit", "Regular"],
      ["Knit weight", "280 gsm"],
      ["Care", "Machine wash"],
    ],
    tags: ["mens", "merino", "knitwear"],
    priceMinor: 12_999,
    listPriceMinor: 15_999,
    material: "merino wool",
  },
  {
    name: "Boreal Outdoors Down Parka B-6",
    category: "womens-clothing",
    brand: "boreal-outdoors",
    summary: "A long parka built for a northern winter.",
    description:
      "Recycled down fills channels that stay where they are put, so there are no cold spots across the back. The shell is windproof and treated to shed a wet snow shower. It is cut long enough to cover a jumper, with a hood that adjusts without a mirror.",
    features: ["Recycled down fill", "Windproof shell", "Adjustable hood"],
    specs: [
      ["Fit", "Relaxed"],
      ["Length", "Mid-thigh"],
      ["Lining", "Recycled down"],
    ],
    tags: ["womens", "parka", "winter"],
    priceMinor: 27_999,
    listPriceMinor: 32_999,
    material: "recycled down",
  },
  {
    name: "Emberlane Home Botanical Cleansing Balm E-1",
    category: "skin-care",
    brand: "emberlane-home",
    summary: "A balm that lifts make-up without stripping the skin.",
    description:
      "Shea butter and cold-pressed jojoba melt at body temperature, so the balm spreads without pulling at the skin. It rinses clean with warm water and leaves no film behind. Fragrance is left out, which is what most reactive skin reacts to.",
    features: ["Shea butter and jojoba", "Fragrance-free", "Rinses without residue"],
    specs: [
      ["Size", "100 ml"],
      ["Format", "Balm"],
      ["Suited to", "All skin types"],
    ],
    tags: ["skincare", "cleanser", "fragrance-free"],
    priceMinor: 3_499,
    listPriceMinor: 3_499,
    material: "shea butter",
  },
  {
    name: "Pinnacle Play Strategy Board Game P-4",
    category: "board-games",
    brand: "pinnacle-play",
    summary: "A strategy game that teaches in ten minutes.",
    description:
      "Players take turns placing workers, and every placement changes what the next player can do, which is what keeps a table talking. The board is double-sided, so the first games are shorter than the later ones. Everything packs back into a box that holds its lid flat.",
    features: ["2 – 4 players", "60 – 90 minutes", "Double-sided board"],
    specs: [
      ["Players", "2 – 4 players"],
      ["Play time", "60 – 90 minutes"],
      ["Age", "12 and up"],
    ],
    tags: ["board-games", "strategy", "family"],
    priceMinor: 3_999,
    listPriceMinor: 3_999,
    material: "recycled board",
  },
];

/** How many anchors each leaf category and brand already accounts for, so the generated half tops them up. */
export const ANCHORS_PER_CATEGORY: ReadonlyMap<LeafCategorySlug, number> = countBy(
  ANCHOR_PRODUCTS,
  (anchor) => anchor.category,
);
export const ANCHORS_PER_BRAND: ReadonlyMap<BrandSlug, number> = countBy(
  ANCHOR_PRODUCTS,
  (anchor) => anchor.brand,
);

/**
 * The brands a product of each leaf category may plausibly carry, most natural first: what keeps a generated
 * name from reading like a brand with no business in that aisle. Every brand appears in at least one category
 * and every category offers at least three, so a brand's remaining products always have somewhere to go.
 */
export const CATEGORY_BRAND_AFFINITY: Readonly<Record<LeafCategorySlug, readonly BrandSlug[]>> = {
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
