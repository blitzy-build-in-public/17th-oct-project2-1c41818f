/**
 * Path: src/data/categories.ts
 * Purpose: The seeded category tree with counts, and the deterministic tile builder for category imagery
 * Lines: 401
 */

import { BRAND_DEFINITIONS, CATEGORY_DEFINITIONS } from "@/constants/taxonomy";
import type { Brand, Category } from "@/types/catalog";
import type { BrandId, CategoryId } from "@/types/common";
import { sum } from "@/utils/collections";
import { brandId, categoryId, initials } from "@/utils/strings";

// Allocation ------------------------------------------------------------------------------------

/**
 * How many products the seeded catalogue holds, and therefore what the per-category and per-brand
 * allocations below sum to. `src/data/products.ts` imports it and generates exactly this many, which
 * is what makes the counts displayed beside a category or a brand the counts the catalogue contains.
 */
export const PRODUCT_TOTAL: number = 140;

/** The fewest products a leaf category may hold, so every category listing has a full row to show. */
const MIN_PRODUCTS_PER_CATEGORY = 8;

/** The fewest products a brand may hold, so the brand facet never offers a value that leads nowhere. */
const MIN_PRODUCTS_PER_BRAND = 6;

/**
 * One entry of a weighted distribution: the key it allocates to, and how strongly it competes for the
 * products left over once every entry has taken its minimum.
 */
interface AllocationWeight<TKey extends string> {
  readonly key: TKey;
  readonly weight: number;
}

/**
 * Weighs each key by its rank in the vocabulary it came from: the first-listed entry competes most
 * strongly for the remainder, so the catalogue's leading categories and brands hold the most products.
 * The weights are consecutive positive integers, which is what keeps the division in {@link allocate}
 * exact integer arithmetic rather than a floating-point proportion.
 */
function rankWeights<TKey extends string>(
  keys: readonly TKey[],
): readonly AllocationWeight<TKey>[] {
  return keys.map((key, index) => ({ key, weight: keys.length - index }));
}

/**
 * Turns key-and-value pairs into a record typed by the key union.
 *
 * The keys are always the caller's own — a vocabulary tuple or the seeded collection the record
 * describes — so the record is complete and correctly typed by construction. TypeScript cannot infer
 * that from a key set it only sees as a variable, and this single assertion is where that is stated.
 */
function toRecord<TKey extends string, TValue>(
  entries: readonly (readonly [TKey, TValue])[],
): Record<TKey, TValue> {
  const record: Record<string, TValue> = {};
  for (const [key, value] of entries) record[key] = value;
  return record as Record<TKey, TValue>;
}

/**
 * Shares `total` across weighted keys: every key takes `minimum` first, and the remainder is divided
 * by weight with largest-remainder rounding, so no part is fractional and the parts sum to exactly
 * `total`.
 *
 * Every operation is integer arithmetic, so the outcome is identical in every process; that
 * reproducibility, not merely stability, is what the seeded counts and the build-time determinism the
 * tests assert both rest on. A remainder the integer division leaves over goes to the largest
 * fractional parts first, and equal residues follow the vocabulary's order, so no part of the result
 * depends on how a sort happens to resolve ties.
 *
 * @param weights - The keys to allocate to, with the weight that competes for the remainder.
 * @param total - The whole quantity being shared.
 * @param minimum - What every key receives before the remainder is divided.
 * @returns A count per key, summing to `total`.
 */
function allocate<TKey extends string>(
  weights: readonly AllocationWeight<TKey>[],
  total: number,
  minimum: number,
): Record<TKey, number> {
  const remaining = total - minimum * weights.length;
  const weightTotal = sum(weights.map((entry) => entry.weight));
  const shares = weights.map((entry, index) => {
    const weighted = remaining * entry.weight;
    return {
      key: entry.key,
      count: minimum + Math.floor(weighted / weightTotal),
      residue: weighted % weightTotal,
      index,
    };
  });
  const byResidue = [...shares].sort(
    (left, right) => right.residue - left.residue || left.index - right.index,
  );
  let unallocated = total - sum(shares.map((share) => share.count));
  for (const share of byResidue) {
    if (unallocated <= 0) break;
    share.count += 1;
    unallocated -= 1;
  }
  return toRecord(shares.map((share) => [share.key, share.count] as const));
}

/**
 * The children of the vocabulary, in declaration order: the twelve categories the category facet
 * offers, and the only ones that hold products. The eight parents exist to group them, and `office`
 * and `automotive` are declared without children — so they hold nothing, which is a property of the
 * taxonomy rather than an omission here, and it keeps every product reachable through the facet.
 */
const CHILD_DEFINITIONS = CATEGORY_DEFINITIONS.filter(
  (definition) => definition.parentSlug !== null,
);

/**
 * How many products each leaf category holds, keyed by category id: the twelve children sharing
 * {@link PRODUCT_TOTAL} by rank weight above a floor of {@link MIN_PRODUCTS_PER_CATEGORY}.
 *
 * This is the allocation the catalogue is generated from — `src/data/products.ts` reads it and emits
 * exactly this many products per category — so the count a facet or a showcase tile displays cannot
 * disagree with the products that exist. A parent's count is the sum of its children's and is derived
 * in {@link CATEGORY_PRODUCT_COUNT}; only leaves hold an allocation, because counting the same 140
 * products into both levels is what would double the catalogue's apparent size.
 */
export const CATEGORY_PRODUCT_QUOTA: Readonly<Record<CategoryId, number>> = allocate(
  rankWeights(CHILD_DEFINITIONS.map((definition) => categoryId(definition.slug))),
  PRODUCT_TOTAL,
  MIN_PRODUCTS_PER_CATEGORY,
);

/**
 * How many products each brand holds, keyed by brand id: the twelve brands sharing
 * {@link PRODUCT_TOTAL} by rank weight above a floor of {@link MIN_PRODUCTS_PER_BRAND}, by the same
 * rule {@link CATEGORY_PRODUCT_QUOTA} uses, so the two distributions are computed one way.
 */
export const BRAND_PRODUCT_QUOTA: Readonly<Record<BrandId, number>> = allocate(
  rankWeights(BRAND_DEFINITIONS.map((definition) => brandId(definition.slug))),
  PRODUCT_TOTAL,
  MIN_PRODUCTS_PER_BRAND,
);

// Descriptions ----------------------------------------------------------------------------------

/**
 * The slug of one category or brand as the vocabulary declares it, derived from the definitions
 * themselves rather than restated. Typing a description table with it makes the table exhaustive by
 * compile time: a missing or misspelled entry is an error, not a blank line on a page.
 */
type CategorySlug = (typeof CATEGORY_DEFINITIONS)[number]["slug"];

/** The slug of one of the twelve brands, derived as {@link CategorySlug} is. */
type BrandSlug = (typeof BRAND_DEFINITIONS)[number]["slug"];

/**
 * One line of copy per category, in the vocabulary's order, keyed by slug: what the category holds,
 * in the shopper's words. The names themselves are the vocabulary's and are never restated; only this
 * descriptive text is authored here, because it belongs to the catalogue's data rather than to the
 * interface copy in `src/constants/content.ts`.
 */
const CATEGORY_DESCRIPTIONS: Readonly<Record<CategorySlug, string>> = {
  electronics: "Screens, sound and connected kit for the desk, the studio and the road.",
  audio: "Headphones, speakers and turntables for everyday listening at home.",
  cameras: "Mirrorless bodies, lenses and lighting for stills and short film.",
  laptops: "Portable machines, from ultralights for the commute to workstations for editing.",
  "phones-accessories": "Cases, chargers, cables and stands that keep a handset ready to go.",
  "home-kitchen": "Everything the kitchen and the front room need to work and to look right.",
  cookware: "Pans, knives and bakeware built for a hob that never cools down.",
  furniture: "Desks, shelving and seating sized for small rooms and long working days.",
  "sports-outdoors": "Kit for training, travelling and every hour spent off the pavement.",
  fitness: "Weights, mats and trackers for the session that happens before work.",
  camping: "Tents, sleep systems and stoves for the weekend past the last car park.",
  fashion: "Everyday clothing and accessories cut for the office and the weekend.",
  "mens-clothing": "Shirts, knitwear and outerwear in plain colours that layer well.",
  "womens-clothing": "Dresses, knitwear and outerwear that move from desk to dinner.",
  "beauty-health": "Skin, hair and wellbeing essentials for a routine that stays short.",
  "skin-care": "Cleansers, serums and moisturisers for morning and evening, sorted by concern.",
  "toys-games": "Presents, puzzles and playthings for every room in the house.",
  "board-games": "Strategy, party and family games for two players or a full table.",
  office: "Desk supplies, paper and stationery for a home office that stays tidy.",
  automotive: "Care, tools and travel kit for the car on the drive.",
};

/**
 * One line of copy per brand, in the vocabulary's order, keyed by slug: what the brand is known for,
 * as the brand facet, the catalogue tile and the product detail page's brand line display it.
 */
const BRAND_DESCRIPTIONS: Readonly<Record<BrandSlug, string>> = {
  "aurelia-audio": "Audio specialists building headphones, speakers and turntables in batches.",
  northcrest: "Home and kitchen goods designed for compact rooms and hard daily use.",
  "kestrel-optics": "Optics and imaging gear made for photographers who travel light.",
  "lumen-labs": "Lighting and display makers working in even, adjustable, low-glare light.",
  tidewell: "Everyday carry and desk accessories in hard-wearing recycled materials.",
  "emberlane-home": "Furniture and textiles built in solid wood and washable natural fibres.",
  "vantage-sports": "Training equipment and sportswear for club players and weekend runners.",
  "summit-gear": "Camping and hiking kit tested above the tree line, season after season.",
  meridian: "Tailored clothing and leather goods cut for long wear and quiet colours.",
  "boreal-outdoors": "Cold-weather gear, packs and camp furniture for northern trips.",
  "cobalt-works": "Workshop and automotive tools with a lifetime repair promise.",
  "pinnacle-play": "Board games and toys for families who play at the same table.",
};

// Entities --------------------------------------------------------------------------------------

/**
 * Builds the twenty seeded categories from the vocabulary, in the vocabulary's own order.
 *
 * An identifier is derived from the definition's slug, so a category's id, its route and its facet
 * value all name the same thing and none of them has to be stored to be recomputed. A child's
 * `parentId` is its parent's identifier, which is what makes the two-level tree resolvable without a
 * second lookup, and `position` is the definition's index: ordering by it reproduces the authored
 * order at both levels of the tree through one rule, so the navigation, the showcase and the chips
 * cannot drift apart.
 *
 * @returns A new array of all twenty categories — the eight parents and the twelve children that hang
 *   under them, interleaved as the vocabulary declares them.
 */
export function buildCategories(): readonly Category[] {
  return CATEGORY_DEFINITIONS.map((definition, position) => ({
    id: categoryId(definition.slug),
    slug: definition.slug,
    name: definition.name,
    parentId: definition.parentSlug === null ? null : categoryId(definition.parentSlug),
    description: CATEGORY_DESCRIPTIONS[definition.slug],
    position,
  }));
}

/**
 * The seeded categories, exactly as {@link buildCategories} builds them: the collection
 * `src/data/repositories.ts` serves for `GET /api/categories`, in vocabulary order.
 */
export const CATEGORIES: readonly Category[] = buildCategories();

/**
 * Builds the twelve seeded brands from the vocabulary, in the vocabulary's own order.
 *
 * `productCount` is read from {@link BRAND_PRODUCT_QUOTA} rather than counted from a product list,
 * because the quota is what `src/data/products.ts` generates against: the count is therefore true by
 * construction, costs nothing to recompute at render time, and cannot fall out of step with the
 * catalogue it describes.
 *
 * @returns A new array of all twelve brands.
 */
export function buildBrands(): readonly Brand[] {
  return BRAND_DEFINITIONS.map((definition) => {
    const id = brandId(definition.slug);
    return {
      id,
      slug: definition.slug,
      name: definition.name,
      description: BRAND_DESCRIPTIONS[definition.slug],
      productCount: BRAND_PRODUCT_QUOTA[id],
    };
  });
}

/**
 * The seeded brands, exactly as {@link buildBrands} builds them: the collection
 * `src/data/repositories.ts` serves for `GET /api/brands`.
 */
export const BRANDS: readonly Brand[] = buildBrands();

/**
 * Rolls each leaf category's allocation up to its parent, so a category's displayed count is true
 * whether it is a child holding products or a parent holding the children that do.
 *
 * A parent takes the sum of its children and never an allocation of its own — the two levels describe
 * the same 140 products — and a parent the vocabulary declares without children settles at zero.
 */
function buildCategoryCounts(categories: readonly Category[]): Record<CategoryId, number> {
  const counts = new Map<CategoryId, number>();
  for (const category of categories) {
    counts.set(category.id, category.parentId === null ? 0 : CATEGORY_PRODUCT_QUOTA[category.id]);
  }
  for (const category of categories) {
    const parentId = category.parentId;
    if (parentId === null) continue;
    const running = counts.get(parentId);
    if (running === undefined) continue;
    counts.set(parentId, running + CATEGORY_PRODUCT_QUOTA[category.id]);
  }
  return toRecord([...counts.entries()]);
}

/**
 * How many products sit in each of the twenty categories, keyed by category id: a leaf's own
 * allocation, or the sum of its children's, or zero for a childless parent.
 *
 * The category tree `GET /api/categories` answers with carries its counts, and `Category` holds no
 * count field, so this record is the tree's count half rather than a restatement of it. Like a
 * brand's count it is derived once, beside the allocation it is derived from, so the number the
 * showcase tile, the navigation and the category facet show is the number of products that exist.
 */
export const CATEGORY_PRODUCT_COUNT: Readonly<Record<CategoryId, number>> =
  buildCategoryCounts(CATEGORIES);

// Imagery ---------------------------------------------------------------------------------------

/** The tile's intrinsic size in pixels: the 3:2 frame the showcase and the facet tiles render it in. */
const TILE_WIDTH = 480;
const TILE_HEIGHT = 320;

/**
 * The range a slug's digest is reduced into before it is split between the palette entry and the
 * accent's geometry. A multiple of the palette's length, so the palette choice stays evenly spread
 * across the gradients instead of favouring the early ones.
 */
const TILE_DIGEST_RANGE = 720;

/** One two-stop gradient a category tile paints: the fill its background rectangle takes. */
interface TileGradient {
  readonly from: string;
  readonly to: string;
}

/**
 * The tile palette: eight hand-chosen gradients, each dark enough for white initials to read on and
 * distinct enough that two categories sharing one still look apart. A category's place in the palette
 * comes from its slug, so it keeps the same tile across builds and across reloads.
 */
const TILE_PALETTE = [
  { from: "#1f4e79", to: "#2f7fb8" },
  { from: "#2b5d4a", to: "#3f8f6d" },
  { from: "#5b3a7e", to: "#8a63b8" },
  { from: "#7a3d24", to: "#b8623c" },
  { from: "#1f5b5e", to: "#2f8b8f" },
  { from: "#6b2f4a", to: "#a24d73" },
  { from: "#3c4a7a", to: "#5f73ad" },
  { from: "#4a4a2f", to: "#7c7c4c" },
] as const satisfies readonly TileGradient[];

/**
 * Reduces a category's slug to the number the tile's palette entry and accent are drawn from: a
 * rolling accumulation over the slug's code units.
 *
 * Not the digest in `src/utils/strings.ts` — that one is domain-separated for credentials and
 * identifiers and is deliberately unexported — because a tile needs only a value that is stable,
 * allocation-free and spread over the twenty slugs, and takes no part in identity.
 */
function slugDigest(slug: string): number {
  let digest = 0;
  for (let position = 0; position < slug.length; position += 1) {
    digest = (digest * 31 + slug.charCodeAt(position)) % TILE_DIGEST_RANGE;
  }
  return digest;
}

/**
 * Builds a category's tile: a gradient panel carrying the category's initials, as a self-contained
 * inline SVG data URI.
 *
 * Both the gradient and the accent's size and corner come from one digest of the slug, so a category
 * keeps its tile across builds and no two of the twenty render alike — the accent is what separates
 * two categories that happen to share a gradient and the same initials, which the palette and a
 * name's letters alone would not.
 *
 * The tile is deliberately free of anything that could leave the page — no external reference, no
 * linked font, no embedded bitmap and no `<script>` — and free of the category's name, which the link
 * beside the tile already carries: the image is decorative, so it needs no accessible name of its own,
 * and leaving the name out is also what keeps the markup free of characters that would have to be
 * escaped inside an XML attribute. Pure: the same category yields the identical string every time, so
 * the product ships no image file and no image request.
 *
 * @param category - The category to build a tile for; only its slug and name are read.
 * @returns A `data:image/svg+xml` URI holding the encoded tile.
 */
export function buildCategoryImage(category: Category): string {
  const digest = slugDigest(category.slug);
  const gradient = TILE_PALETTE[digest % TILE_PALETTE.length];
  const accentRadius = 96 + (digest % 5) * 16;
  const accentX = TILE_WIDTH - 24 - (digest % 96);
  const accentY = 8 + (digest % 112);
  const label = initials(category.name);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_WIDTH}" height="${TILE_HEIGHT}" ` +
    `viewBox="0 0 ${TILE_WIDTH} ${TILE_HEIGHT}">` +
    `<defs><linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${gradient.from}"/>` +
    `<stop offset="1" stop-color="${gradient.to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${TILE_WIDTH}" height="${TILE_HEIGHT}" fill="url(#tile)"/>` +
    `<circle cx="${accentX}" cy="${accentY}" r="${accentRadius}" fill="#ffffff" opacity="0.12"/>` +
    `<text x="40" y="${TILE_HEIGHT - 40}" fill="#ffffff" font-family="system-ui, sans-serif" ` +
    `font-size="96" font-weight="700" letter-spacing="3">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Every category's tile, keyed by category id.
 *
 * `Category` declares no imagery field, so the tiles live in this record rather than on the entities,
 * and they are built once here rather than per render: the showcase, the navigation and the facet
 * panel then read a tile instead of rebuilding one, and the shared type stays as it is.
 */
export const CATEGORY_TILES: Readonly<Record<CategoryId, string>> = toRecord(
  CATEGORIES.map((category) => [category.id, buildCategoryImage(category)] as const),
);
