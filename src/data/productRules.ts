/**
 * Path: src/data/productRules.ts
 * Purpose: The catalogue's generation rules: the seeded draw surface, the knobs its products are priced, stocked, rated and dated by, and the functions that read them.
 * Lines: 204
 */

// Split out of `src/data/products.ts` along the seam between the catalogue's generation rules and the
// code that composes products from them, so Prettier's own formatting of each file fits inside the
// 600-line ceiling; the manifest records the split. `SeededRandom` is declared here because these
// rules read their draws through it and the stream that satisfies it is built one layer up, in
// `src/data/products.ts`, which imports this file: the arrow between the two runs one way only.

import { BRAND_DEFINITIONS, FACET_DEFINITIONS } from "@/constants/taxonomy";
import type { FacetDefinition, FacetDefinitionOption } from "@/constants/taxonomy";
import { BRAND_PRODUCT_QUOTA, CATEGORY_PRODUCT_QUOTA, PRODUCT_TOTAL } from "@/data/categories";
import {
  ANCHOR_PRODUCTS,
  ANCHORS_PER_BRAND,
  ANCHORS_PER_CATEGORY,
  CATEGORY_BRAND_AFFINITY,
  LEAF_CATEGORY_SLUGS,
} from "@/data/productAnchors";
import type { BrandSlug, LeafCategorySlug } from "@/data/productAnchors";
import type { IsoDateString, IsoDateTimeString, MinorUnits } from "@/types/common";
import { addDays, parseIso, toIsoDateTime } from "@/utils/dates";
import { fromMinorUnits, toMinorUnits } from "@/utils/format";
import { roundToTenths } from "@/utils/statistics";
import { brandId, categoryId, sequenceId } from "@/utils/strings";

// The seeded draw surface ------------------------------------------------------------------------

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
  /** Distinct items of a list drawn one stream step at a time, or the whole list when it holds no more than `count`. */
  pickMany<TItem>(items: readonly TItem[], count: number): TItem[];
  /** True for the share of draws `probability` names. */
  chance(probability: number): boolean;
  /** A new array holding the same items in a stream-determined order. */
  shuffle<TItem>(items: readonly TItem[]): TItem[];
}

// Generation knobs -------------------------------------------------------------------------------
/** The retail endings and price step in major units, the span the open-ended top band is priced over, and the
 *  cheapest seeded price, so the band starting at zero never offers 99 cents. */
const PRICE_ENDINGS_MINOR = [0, 95, 99];
const PRICE_STEP_MAJOR = 5;
const OPEN_TOP_BAND_MINOR = 28_000;
const MIN_PRICE_MINOR = 499;
/** Every third product carries a list price above its price, by ten to forty percent: what renders a discount. */
export const DISCOUNT_EVERY = 3;
export const DISCOUNT_RATIOS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4];
/** The stock at or below which a product reads as low, the deepest shelf, and the cycle putting every
 *  twentieth product out of stock and the two after it below the threshold. */
export const LOW_STOCK_THRESHOLD = 8;
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
export function assignBrandSlugs(): readonly BrandSlug[] {
  const categoryRemaining = new Map<LeafCategorySlug, number>(
    LEAF_CATEGORY_SLUGS.map((slug) => [
      slug,
      CATEGORY_PRODUCT_QUOTA[categoryId(slug)] - (ANCHORS_PER_CATEGORY.get(slug) ?? 0),
    ]),
  );
  const brandRemaining = new Map<BrandSlug, number>(
    BRAND_DEFINITIONS.map((definition) => [
      definition.slug,
      BRAND_PRODUCT_QUOTA[brandId(definition.slug)] - (ANCHORS_PER_BRAND.get(definition.slug) ?? 0),
    ]),
  );
  const assigned: BrandSlug[] = [];
  for (const categorySlug of LEAF_CATEGORY_SLUGS) {
    let slots = categoryRemaining.get(categorySlug) ?? 0;
    while (slots > 0) {
      let chosen: BrandSlug | null = null,
        greatestNeed = -1;
      for (const brandSlug of CATEGORY_BRAND_AFFINITY[categorySlug]) {
        const remaining = brandRemaining.get(brandSlug) ?? 0;
        if (remaining === 0) continue;
        let room = 0;
        for (const [other, left] of categoryRemaining)
          if (CATEGORY_BRAND_AFFINITY[other].includes(brandSlug)) room += left;
        const need = room === 0 ? Number.POSITIVE_INFINITY : remaining / room;
        if (need > greatestNeed) {
          greatestNeed = need;
          chosen = brandSlug;
        }
      }
      if (chosen === null)
        throw new Error(`No brand is eligible for the remaining ${categorySlug}.`);
      brandRemaining.set(chosen, (brandRemaining.get(chosen) ?? 1) - 1);
      categoryRemaining.set(categorySlug, slots - 1);
      assigned.push(chosen);
      slots -= 1;
    }
  }
  const stranded = [...brandRemaining.values()].some((remaining) => remaining !== 0);
  if (assigned.length !== PRODUCT_TOTAL - ANCHOR_PRODUCTS.length || stranded)
    throw new Error(
      "The brand allocation left the catalogue short of its category or brand totals.",
    );
  return assigned;
}
/** The vocabulary's name for each brand slug, so a product can name its maker from the slug alone. */
export const BRAND_NAME_BY_SLUG: ReadonlyMap<BrandSlug, string> = new Map(
  BRAND_DEFINITIONS.map((definition) => [definition.slug, definition.name] as const),
);
/** The price bands the price facet declares, read from the vocabulary so no bound is restated here. */
const PRICE_FACET: FacetDefinition | undefined = FACET_DEFINITIONS.find((d) => d.id === "price");
export const PRICE_BANDS: readonly FacetDefinitionOption[] = PRICE_FACET?.options ?? [];
if (PRICE_BANDS.length === 0)
  throw new Error("The price facet declares no bands to price against.");

/** Prices one product inside a band: a whole dollar on a step plus a retail ending, so the band holds what it
 *  advertises. Both conversions go through `src/utils/format.ts`, the one rounding rule for minor units. */
export function choosePriceMinor(rand: SeededRandom, band: FacetDefinitionOption): MinorUnits {
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
export function stockOnHandFor(index: number, rand: SeededRandom): number {
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
export function ratingSummaryFor(
  index: number,
  rand: SeededRandom,
): { average: number; count: number } {
  const count = RATING_COUNT_CYCLE[index % RATING_COUNT_CYCLE.length];
  if (count === 0) return { average: 0, count: 0 };
  const target = rand.int(RATING_TARGET_MIN_TENTHS, RATING_TARGET_MAX_TENTHS);
  const total = Math.round((target * count) / 10);
  return { average: roundToTenths(total / count), count };
}
/** The day and time a product was added, inside the trailing window ending on `anchorDay`: only the day comes
 *  from the clock, and only once per build, so two builds on the same day are identical. */
export function createdAtFor(anchorDay: IsoDateString, rand: SeededRandom): IsoDateTimeString {
  const at = parseIso(addDays(anchorDay, -rand.int(0, CATALOGUE_SPAN_DAYS)));
  if (at === null) throw new TypeError(`createdAtFor requires an ISO day; received "${anchorDay}"`);
  at.setHours(rand.int(8, 20), rand.int(0, 59), 0, 0);
  return toIsoDateTime(at);
}

/** The catalogue code a product is picked and invoiced by: its maker's code and its position. */
export function skuFor(brandSlug: BrandSlug, index: number): string {
  return sequenceId(
    brandSlug
      .replace(/[^a-z]/g, "")
      .slice(0, 3)
      .toUpperCase(),
    index + 1,
  );
}
