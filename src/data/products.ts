/**
 * Path: src/data/products.ts
 * Purpose: The seeded catalogue: hand-authored anchor products expanded deterministically, with specs and generated imagery
 * Lines: 368
 */

import { DEFAULT_CURRENCY } from "@/constants/config";
import { CATEGORY_PRODUCT_QUOTA, IMAGERY_PALETTE } from "@/data/categories";
import {
  ANCHOR_PRODUCTS,
  ANCHORS_PER_CATEGORY,
  CATEGORY_COPY,
  LEAF_CATEGORY_SLUGS,
} from "@/data/productAnchors";
import type { AnchorProduct, BrandSlug, LeafCategorySlug } from "@/data/productAnchors";
import {
  BRAND_NAME_BY_SLUG,
  DISCOUNT_EVERY,
  DISCOUNT_RATIOS,
  LOW_STOCK_THRESHOLD,
  PRICE_BANDS,
  assignBrandSlugs,
  choosePriceMinor,
  createdAtFor,
  ratingSummaryFor,
  skuFor,
  stockOnHandFor,
} from "@/data/productRules";
import type { SeededRandom } from "@/data/productRules";
import type { Inventory, Product, ProductImage, ProductSpec, ProductStatus } from "@/types/catalog";
import type { IsoDateString, MinorUnits } from "@/types/common";
import { toIsoDate } from "@/utils/dates";
import { formatAvailability, roundMinorUnits } from "@/utils/format";
import { brandId, categoryId, initials, productId, slugify } from "@/utils/strings";

/** The seeded draw surface, re-exported so the other seed modules in this folder keep drawing it here. */
export type { SeededRandom };

// Deterministic sampling -------------------------------------------------------------------------

/**
 * The seed every collection in `src/data/` is derived from: this catalogue, the customers, the orders, the
 * reviews and the daily sales facts. A fixed literal, never the clock, so one build produces the same data.
 */
export const DATA_SEED = 8_675_309;

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
    next,
    pick,
    shuffle,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pickMany: (items, count) => {
      const size = Math.min(count, items.length);
      const drawn = new Set<number>();
      while (drawn.size < size) drawn.add(Math.floor(next() * items.length));
      return [...drawn].map((index) => items[index]);
    },
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

/** How many images a product carries, their size, the views they are named after, and the gradients they paint —
 *  `IMAGERY_PALETTE`, the imagery palette `src/data/categories.ts` owns and this module draws from. */
const IMAGE_COUNT_MIN = 2;
const IMAGE_COUNT_SPREAD = 3;
const IMAGE_WIDTH = 800;
const IMAGE_HEIGHT = 600;
const IMAGE_VIEWS = ["Front view", "Detail view", "In use", "Packaging"];

// Product construction ---------------------------------------------------------------------------
/** A product the catalogue still has to build: where it sits, and the category and brand it carries. */
interface ProductPlan {
  readonly index: number;
  readonly anchorDay: IsoDateString;
  readonly offset: number;
  readonly categorySlug: LeafCategorySlug;
  readonly brandSlug: BrandSlug;
}
/** Everything a product is composed of before the catalogue derives its identity, stock and imagery. */
interface ProductCore {
  readonly name: string;
  readonly sku: string;
  readonly tags: readonly string[];
  readonly categorySlug: LeafCategorySlug;
  readonly brandSlug: BrandSlug;
  readonly summary: string;
  readonly description: string;
  readonly features: readonly string[];
  readonly specs: readonly ProductSpec[];
  readonly priceMinor: MinorUnits;
  readonly listPriceMinor: MinorUnits;
}
/** The three rows every product ends its specification table with: its material, its warranty and its code. */
function derivedSpecRows(material: string, warranty: string, sku: string): readonly ProductSpec[] {
  return [
    { label: "Material", value: material },
    { label: "Warranty", value: warranty },
    { label: "Item code", value: sku },
  ];
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
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" ` +
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
    id: `${product.id}-${position + 1}`,
    productId: product.id,
    position,
    url: buildProductImage(product, position),
    alt: `${product.name} — ${IMAGE_VIEWS[position]}`,
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
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
    id: productId(core.name),
    sku: core.sku,
    slug: slugify(core.name),
    name: core.name,
    brandId: brandId(core.brandSlug),
    categoryId: categoryId(core.categorySlug),
    tags: core.tags,
    summary: core.summary,
    description: core.description,
    specs: core.specs,
    features: core.features,
    images: [],
    currency: DEFAULT_CURRENCY,
    status: SELLABLE_STATUS,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    priceMinor: core.priceMinor,
    listPriceMinor: core.listPriceMinor,
    ratingAverage: rating.average,
    ratingCount: rating.count,
    stockOnHand: stockOnHandFor(plan.index, rand),
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
  if (anchor === undefined)
    throw new Error(`The ${plan.categorySlug} category has no anchor to expand.`);
  const line = copy.lines[plan.offset % copy.lines.length];
  const descriptor =
    PRODUCT_DESCRIPTORS[Math.floor(plan.offset / copy.lines.length) % PRODUCT_DESCRIPTORS.length];
  const brandName = BRAND_NAME_BY_SLUG.get(plan.brandSlug) ?? plan.brandSlug;
  const material = rand.pick(copy.materials);
  const use = rand.pick(copy.uses);
  const warranty = WARRANTY_TERMS[plan.index % WARRANTY_TERMS.length];
  const sku = skuFor(plan.brandSlug, plan.index);
  const priceMinor = choosePriceMinor(rand, PRICE_BANDS[plan.index % PRICE_BANDS.length]);
  const listPriceMinor =
    plan.index % DISCOUNT_EVERY === 0
      ? roundMinorUnits(priceMinor / (1 - rand.pick(DISCOUNT_RATIOS)))
      : priceMinor;
  const categoryRows = categoryRowsFor(anchor, plan.offset);
  return {
    name: `${brandName} ${descriptor} ${line}`,
    sku,
    categorySlug: plan.categorySlug,
    brandSlug: plan.brandSlug,
    priceMinor,
    listPriceMinor,
    tags: [plan.categorySlug, ...slugify(line).split("-")],
    summary: `${line} by ${brandName}, made from ${material} for ${use}.`,
    description: [
      `The ${line} by ${brandName} is made from ${material} for ${use}.`,
      copy.detail,
      `The warranty runs for ${warranty}.`,
    ].join(" "),
    features: [
      `Made from ${material}`,
      `Built for ${use}`,
      `Warranty: ${warranty}`,
      ...categoryRows.map((row) => `${row.label}: ${row.value}`),
    ],
    specs: [...categoryRows, ...derivedSpecRows(material, warranty, sku)],
  };
}

/** Completes one anchor: its hand-authored copy, material, rows and prices, with the three rows every product shows. */
function anchorCore(anchor: AnchorProduct, plan: ProductPlan): ProductCore {
  const material = anchor.material;
  const warranty = WARRANTY_TERMS[plan.index % WARRANTY_TERMS.length];
  const sku = skuFor(plan.brandSlug, plan.index);
  return {
    name: anchor.name,
    sku,
    categorySlug: plan.categorySlug,
    brandSlug: plan.brandSlug,
    summary: anchor.summary,
    description: anchor.description,
    tags: anchor.tags,
    features: [...anchor.features, `Warranty: ${warranty}`],
    priceMinor: anchor.priceMinor,
    specs: [
      ...anchor.specs.map(([label, value]) => ({ label, value })),
      ...derivedSpecRows(material, warranty, sku),
    ],
    listPriceMinor: anchor.listPriceMinor,
  };
}

/** Builds every generated product, category by category in the vocabulary's order, with the brands the
 *  allocation handed out for those same positions. */
function generatedProducts(rand: SeededRandom, anchorDay: IsoDateString): readonly Product[] {
  const brandSlugs = assignBrandSlugs();
  const products: Product[] = [];
  let cursor = 0;
  for (const categorySlug of LEAF_CATEGORY_SLUGS) {
    const count =
      CATEGORY_PRODUCT_QUOTA[categoryId(categorySlug)] -
      (ANCHORS_PER_CATEGORY.get(categorySlug) ?? 0);
    for (let offset = 0; offset < count; offset += 1) {
      const plan: ProductPlan = {
        index: ANCHOR_PRODUCTS.length + cursor,
        anchorDay,
        offset,
        categorySlug,
        brandSlug: brandSlugs[cursor],
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
      index,
      anchorDay,
      offset: 0,
      categorySlug: anchor.category,
      brandSlug: anchor.brand,
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
    productId: product.id,
    stockOnHand: product.stockOnHand,
    lowStockThreshold: product.lowStockThreshold,
    status,
    available,
  };
}
