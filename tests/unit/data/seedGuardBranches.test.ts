/**
 * Path: tests/unit/data/seedGuardBranches.test.ts
 * Purpose: The facts the seeded catalogue's own guards rest on — every leaf category is anchored and quota'd, every brand the allocation hands out is one the vocabulary names, and the price bands the rules price against are declared — together with the order history's documented shopper, whose attributed history stays clear of a cancellation over every anchor day the clock can hand the seed
 * Lines: 169
 */

import { describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS } from "@/constants/config";
import { FACET_DEFINITIONS } from "@/constants/taxonomy";
import { BRAND_PRODUCT_QUOTA, CATEGORY_PRODUCT_QUOTA, PRODUCT_TOTAL } from "@/data/categories";
import { CUSTOMERS } from "@/data/customers";
import { buildOrders } from "@/data/orders";
import { ANCHORS_PER_CATEGORY, ANCHOR_PRODUCTS, LEAF_CATEGORY_SLUGS } from "@/data/productAnchors";
import type { LeafCategorySlug } from "@/data/productAnchors";
import {
  BRAND_NAME_BY_SLUG,
  PRICE_BANDS,
  assignBrandSlugs,
  choosePriceMinor,
} from "@/data/productRules";
import { DATA_SEED, PRODUCTS, createSeededRandom } from "@/data/products";
import type { Customer } from "@/types/account";
import type { Product } from "@/types/catalog";
import { brandId, categoryId } from "@/utils/strings";

// The subject is the set of guards the three seed modules carry but their own generators never reach: the
// catalogue's no-anchor refusal and its two fallbacks over the hand-authored maps, the brand allocation's
// refusals and fallbacks over the quota tables, the price facet's empty-band refusal, and the history's
// repair of a cancellation drawn for the documented shopper. None of them is reachable by an argument — the
// allocation takes none, the rest sit behind private generators reading module constants — so each is pinned
// here on the fact a caller can check: the collection the guard would have to break, or the boundary the
// function's own documentation says it holds. A vocabulary or seed change that made one of them live fails
// this file rather than passing unnoticed.

/** The catalogue the seeded build produced, which is what the generated path expanded. */
const CATALOGUE: readonly Product[] = PRODUCTS;

/** The catalogue's products inside one leaf category. */
function catalogueOf(slug: LeafCategorySlug): readonly Product[] {
  return CATALOGUE.filter((product) => product.categoryId === categoryId(slug));
}

/** The seeded account the demonstration credentials sign in as, whose history the seed keeps cancellable-free. */
function documentedShopper(): Customer {
  const shopper = CUSTOMERS.find((customer) => customer.email === DEMO_ACCOUNTS.CUSTOMER_EMAIL);
  if (shopper === undefined) {
    throw new Error("The seeded accounts do not hold the documented shopper.");
  }
  return shopper;
}

/**
 * One anchor day per weekday, which is the whole input the history's clock can offer: the plan measures every
 * date as an offset from the anchor day, so only its weekday moves the volumes and the draws that follow them.
 */
const ANCHOR_DAYS: readonly (readonly [
  label: string,
  year: number,
  monthIndex: number,
  day: number,
])[] = [
  ["Sunday", 2025, 5, 15],
  ["Monday", 2025, 5, 16],
  ["Tuesday", 2025, 5, 17],
  ["Wednesday", 2025, 5, 18],
  ["Thursday", 2025, 5, 19],
  ["Friday", 2025, 5, 20],
  ["Saturday", 2025, 5, 21],
];

describe("the catalogue's seeded allocation", () => {
  it.each(LEAF_CATEGORY_SLUGS)(
    "gives %s every product its quota declares, so no leaf category is left without an anchor",
    (slug) => {
      const quota = CATEGORY_PRODUCT_QUOTA[categoryId(slug)];

      // A category with no anchor would leave `generatedCore` refusing the plan, and one with no entry in the
      // anchor count would leave its share read as undefined rather than as its allocation: the quota is
      // positive, the anchor count holds the category, and the catalogue expanded the whole of it.
      expect(quota).toBeGreaterThan(0);
      expect(catalogueOf(slug)).toHaveLength(quota);
      expect(ANCHORS_PER_CATEGORY.get(slug)).toBeGreaterThan(0);
    },
  );

  it.each([...BRAND_NAME_BY_SLUG.keys()])(
    "gives %s every product its brand quota declares, so the allocation strands no brand",
    (slug) => {
      const quota = BRAND_PRODUCT_QUOTA[brandId(slug)];
      const held = CATALOGUE.filter((product) => product.brandId === brandId(slug));

      expect(quota).toBeGreaterThan(0);
      expect(held).toHaveLength(quota);
    },
  );

  it("hands the generated products one brand each, every one of them a name the vocabulary holds", () => {
    const assigned = assignBrandSlugs();

    // The allocation's own two refusals — a category left with no eligible brand, and a brand left with quota
    // unspent — are decided by these totals alone, and every slug it returns is drawn from the brand
    // vocabulary, which is the same list `BRAND_NAME_BY_SLUG` is built from.
    expect(assigned).toHaveLength(PRODUCT_TOTAL - ANCHOR_PRODUCTS.length);
    expect(assigned.filter((slug) => !BRAND_NAME_BY_SLUG.has(slug))).toEqual([]);
  });
});

describe("the price bands the rules price against", () => {
  it("declares the bands the price facet declares, so no product is priced against an empty list", () => {
    const facet = FACET_DEFINITIONS.find((definition) => definition.id === "price");

    expect(PRICE_BANDS.length).toBeGreaterThan(0);
    expect(PRICE_BANDS).toEqual(facet?.options ?? []);
  });

  it.each(PRICE_BANDS)("prices inside the $label band's own reach", (band) => {
    const price = choosePriceMinor(createSeededRandom(DATA_SEED), band);

    expect(Number.isInteger(price)).toBe(true);
    expect(price).toBeGreaterThanOrEqual(band.minMinor ?? 0);
    if (band.maxMinor !== undefined) {
      expect(price).toBeLessThanOrEqual(band.maxMinor);
    }
  });

  it("floors a price drawn from the band open at the bottom, so it never offers 99 cents", () => {
    const openBottom = PRICE_BANDS.find((band) => band.minMinor === undefined);
    if (openBottom === undefined) {
      throw new Error("The price facet declares no band open at the bottom.");
    }

    // The band states no floor, so the module's own cheapest seeded price is the one that holds: a whole
    // dollar on the five-dollar step, which is 500 minor units, plus the retail ending.
    const price = choosePriceMinor(createSeededRandom(DATA_SEED), openBottom);

    expect(price).toBeGreaterThanOrEqual(500);
  });
});

describe("the documented shopper's own history", () => {
  it.each(ANCHOR_DAYS)(
    "holds no cancellation on a %s anchor day, however the draws fall that day",
    (_label, year, monthIndex, day) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(year, monthIndex, day, 9, 0, 0, 0));
      const history = buildOrders();
      vi.useRealTimers();

      const shopper = documentedShopper();
      const own = history.filter((order) => order.customerId === shopper.id);
      const others = history.filter(
        (order) => order.customerId !== null && order.customerId !== shopper.id,
      );

      // The shopper's history is the one a status filter has to be able to narrow to nothing, so the seed
      // repairs a cancellation or a refund drawn for one of their orders. Every anchor day is driven, because
      // the weekday decides how many orders each day trades and therefore which draw each attributed order
      // receives — and none of the seven reaches that repair.
      expect(own.length).toBeGreaterThan(0);
      expect(own.filter((order) => order.status === "cancelled")).toEqual([]);
      expect(own.filter((order) => order.status === "refunded")).toEqual([]);
      // The control: the same build draws both for the accounts that are not the shopper's, so the comparison
      // above is not passing because the day happened to hold no cancellation at all.
      expect(others.some((order) => order.status === "cancelled")).toBe(true);
      expect(others.some((order) => order.status === "refunded")).toBe(true);
    },
  );
});
