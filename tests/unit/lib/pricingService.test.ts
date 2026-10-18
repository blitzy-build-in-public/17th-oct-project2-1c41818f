/**
 * Path: tests/unit/lib/pricingService.test.ts
 * Purpose: Line and order totals, promo kinds and limits, shipping thresholds and tax rounding
 * Lines: 474
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_CURRENCY,
  FREE_SHIPPING_METHOD_ID,
  FREE_SHIPPING_THRESHOLD_MINOR,
  SHIPPING_METHODS,
} from "@/constants/config";
import { PROMO_REJECTION_MESSAGES } from "@/constants/content";
import { PROMO_KIND_LABELS } from "@/constants/taxonomy";
// The module under test is imported as a namespace, as formatting.test.ts imports src/utils/format.ts:
// this file exercises eleven of its exports, and eleven specifiers named singly cost thirteen lines.
import * as pricing from "@/lib/pricingService";
import { FIXED_DATE, makeApiError, makeCartLine, makePromoCode } from "../../fixtures";

import type { CategoryId, MinorUnits } from "@/types/common";
import type { CartLine, PromoCode, PromoRejectionReason, PricedCart } from "@/types/commerce";

// Every figure asserted below is a whole number of minor units and every date comes from the fixture
// clock, so no case reads the real time. The async reads over the seeded data source live in this suite's
// §0.5.5 split path, tests/unit/lib/pricingSurface.test.ts, which carries the surface the seam serves.

/** The currency every priced figure is in, and the tax the configured rate puts on 10,000 minor units. */
const CURRENCY = DEFAULT_CURRENCY;
const TAX_ON_10_000_MINOR = 825;
/** The configured threshold, the method it waives, that method's own charge and the boundary below it. */
const THRESHOLD_MINOR = FREE_SHIPPING_THRESHOLD_MINOR;
const FREE_METHOD_ID = FREE_SHIPPING_METHOD_ID;
const FREE_METHOD_PRICE_MINOR = 899;
const BELOW_THRESHOLD_MINOR = THRESHOLD_MINOR - 1;
/** A 10% order-scoped code open now with no floor, so every basket below clears it. */
const SAVE_TEN = makePromoCode({ code: "TESTSAVE", value: 10, minSubtotalMinor: 0 });

/** The three seeded fixture products, whose distinct names give a basket distinct product ids. */
type LineName = "Aurora Desk Lamp" | "Cascade Speaker" | "Trailhead Kettle";

/** A cart line of a named fixture product at a unit price and quantity, capped at the fixture's ceiling
 *  of ten: every basket below is built from these, so its subtotal is arithmetic to check by hand. */
function line(name: LineName, unitPriceMinor: MinorUnits, quantity = 1): CartLine {
  return makeCartLine({ name, unitPriceMinor, quantity });
}

/** A priced basket: the one way a case reaches the pricing rule, so no case restates the input shape. */
function priced(
  lines: readonly CartLine[],
  promo?: PromoCode,
  shippingMethodId: string | null = null,
): PricedCart {
  return pricing.priceCartLines({ lines, promo, shippingMethodId });
}

/**
 * The invariants every priced cart satisfies whatever was priced: each amount is a whole number of minor
 * units, the grand total is the four parts added in the documented order, the lines' subtotals add up to
 * the cart's and their discounts to the code's, and each line's total is its subtotal less its own share.
 * Asserted through one helper rather than restated case by case, because a second statement of the same
 * arithmetic is how two cases come to disagree about it.
 */
function expectMoneyInvariants(cart: PricedCart): void {
  const amounts = [cart.subtotalMinor, cart.discountTotalMinor, cart.shippingMinor, cart.taxMinor];
  expect(amounts.every(Number.isInteger)).toBe(true);
  expect(Number.isInteger(cart.freeShippingRemainingMinor)).toBe(true);
  expect(cart.grandTotalMinor).toBe(
    cart.subtotalMinor - cart.discountTotalMinor + cart.shippingMinor + cart.taxMinor,
  );
  expect(cart.currency).toBe(CURRENCY);
  const subtotals = cart.lines.map((item) => item.lineSubtotalMinor);
  const discounts = cart.lines.map((item) => item.discountMinor);
  expect(subtotals.reduce((sum, amount) => sum + amount, 0)).toBe(cart.subtotalMinor);
  expect(discounts.reduce((sum, amount) => sum + amount, 0)).toBe(cart.discountTotalMinor);
  expect(cart.lines.map((item) => item.lineTotalMinor)).toEqual(
    cart.lines.map((item) => item.lineSubtotalMinor - item.discountMinor),
  );
}

/** Three lines at 1,999 and 12,900 twice and 3,499 once: a subtotal of 35,296, checked by hand. */
const THREE_LINES = [
  line("Aurora Desk Lamp", 1_999, 3),
  line("Cascade Speaker", 12_900, 2),
  line("Trailhead Kettle", 3_499),
];

describe("line and subtotal arithmetic", () => {
  it("prices a line as its unit price times its quantity, at the ceiling it records as purchasable", () => {
    const three = pricing.lineSubtotalMinor(line("Aurora Desk Lamp", 1_999, 3));
    expect(three).toBe(5_997);
    expect(Number.isInteger(three)).toBe(true);
    expect(pricing.lineSubtotalMinor(line("Aurora Desk Lamp", 4_999, 3))).toBe(14_997);
    expect(pricing.lineSubtotalMinor(line("Aurora Desk Lamp", 1_000, 11))).toBe(10_000);
    expect(pricing.lineSubtotalMinor(line("Aurora Desk Lamp", 1_000, 0))).toBe(0);
    expect(pricing.lineSubtotalMinor(line("Aurora Desk Lamp", 1_000, 2.7))).toBe(2_000);
  });

  it("sums the subtotal from the lines' own subtotals and reports what each line carries", () => {
    const plain = priced(THREE_LINES);
    const discounted = priced(THREE_LINES, SAVE_TEN);
    expect(THREE_LINES.map(pricing.lineSubtotalMinor)).toEqual([5_997, 25_800, 3_499]);
    expect(plain.subtotalMinor).toBe(35_296);
    expect(discounted.subtotalMinor).toBe(35_296);
    expect(discounted.discountTotalMinor).toBe(3_530);
    expect(discounted.taxMinor).toBe(2_621);
    expect(discounted.grandTotalMinor).toBe(34_387);
    expectMoneyInvariants(plain);
    expectMoneyInvariants(discounted);
  });

  it("prices an empty basket to zeros rather than to NaN or undefined", () => {
    const cart = priced([]);
    expect(cart.lines).toEqual([]);
    expect(cart.appliedPromos).toEqual([]);
    expect(cart.subtotalMinor).toBe(0);
    expect(cart.discountTotalMinor).toBe(0);
    expect(cart.shippingMinor).toBe(0);
    expect(cart.taxMinor).toBe(0);
    expect(cart.grandTotalMinor).toBe(0);
    expect(cart.freeShippingRemainingMinor).toBe(THRESHOLD_MINOR);
    expect(cart.shippingMethodId).toBeNull();
    expectMoneyInvariants(cart);
  });

  it("shares a discount in whole minor units, the remainder going to the earliest lines", () => {
    const flat = makePromoCode({
      code: "TESTOFF",
      kind: "fixed",
      value: 1_001,
      minSubtotalMinor: 0,
    });
    const cart = priced([line("Aurora Desk Lamp", 1_500), line("Cascade Speaker", 1_500)], flat);
    expect(cart.subtotalMinor).toBe(3_000);
    expect(cart.discountTotalMinor).toBe(1_001);
    expect(cart.lines.map((item) => item.discountMinor)).toEqual([501, 500]);
    expectMoneyInvariants(cart);
  });
});

describe("the one rounding rule", () => {
  it.each<[number, number]>([
    [12.5, 13],
    [-12.5, -13],
    [12.4, 12],
    [0.5, 1],
    [864.15, 864],
    [1_234.5, 1_235],
  ])("rounds %s to %s, half away from zero", (value, expected) => {
    expect(pricing.roundToMinor(value)).toBe(expected);
    expect(Number.isInteger(pricing.roundToMinor(value))).toBe(true);
  });

  it("settles a figure that is not a finite number on zero", () => {
    expect(pricing.roundToMinor(Number.NaN)).toBe(0);
    expect(pricing.roundToMinor(Number.POSITIVE_INFINITY)).toBe(0);
    expect(pricing.roundToMinor(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("clamps a discount to the subtotal it is applied to, never below zero", () => {
    expect(pricing.clampDiscount(300, 5_000)).toBe(300);
    expect(pricing.clampDiscount(300, -100)).toBe(0);
    expect(pricing.clampDiscount(0, 500)).toBe(0);
    expect(pricing.clampDiscount(1_000, 400.4)).toBe(400);
  });
});

describe("what a promo code is worth", () => {
  it("takes a percentage off the subtotal, rounded once through the one rule", () => {
    const ten = pricing.applyPromo(20_000, SAVE_TEN, []);
    expect(ten.amountMinor).toBe(2_000);
    expect(ten.label).toBe(`TESTSAVE · ${PROMO_KIND_LABELS.percent}`);
    const seven = pricing.applyPromo(12_345, makePromoCode({ code: "TESTSEVEN", value: 7 }), []);
    expect(seven.amountMinor).toBe(864);
    expect(Number.isInteger(seven.amountMinor)).toBe(true);
  });

  it("takes a fixed amount off, clamped to the subtotal it is applied to", () => {
    const flat = makePromoCode({
      code: "TESTFLAT",
      kind: "fixed",
      value: 500,
      minSubtotalMinor: 0,
    });
    const huge = makePromoCode({
      code: "TESTFLAT",
      kind: "fixed",
      value: 5_000,
      minSubtotalMinor: 0,
    });
    expect(pricing.applyPromo(3_000, flat, []).amountMinor).toBe(500);
    expect(pricing.applyPromo(300, huge, []).amountMinor).toBe(300);
  });

  it("waives the delivery charge for a free-shipping code and leaves the goods alone", () => {
    const free = makePromoCode({ code: "TESTFREE", kind: "free_shipping", minSubtotalMinor: 0 });
    const cart = priced([line("Aurora Desk Lamp", 3_000)], free, "ship_express");
    expect(cart.subtotalMinor).toBe(3_000);
    expect(cart.discountTotalMinor).toBe(0);
    expect(cart.shippingMinor).toBe(0);
    expect(cart.taxMinor).toBe(248);
    expect(cart.grandTotalMinor).toBe(3_248);
    expect(cart.appliedPromos).toHaveLength(1);
    expect(cart.appliedPromos[0].code).toBe("TESTFREE");
    expect(cart.appliedPromos[0].amountMinor).toBe(0);
    expect(cart.appliedPromos[0].label).toBe(`TESTFREE · ${PROMO_KIND_LABELS.free_shipping}`);
    expectMoneyInvariants(cart);
  });

  it("applies one code at a time, refusing the code the basket already carries", () => {
    const basket = [line("Aurora Desk Lamp", 3_000)];
    expect(priced(basket, SAVE_TEN).appliedPromos).toHaveLength(1);
    expect(priced(basket).appliedPromos).toHaveLength(0);
    const already = { code: "TESTSAVE", promo: SAVE_TEN, alreadyAppliedCode: " testsave " };
    expect(pricing.decidePromo({ ...already, lines: basket, today: FIXED_DATE })).toBe(
      "already-applied",
    );
  });
});

describe("the order of operations", () => {
  // A basket of 8,000 minor units: above the free-delivery threshold before its discount and below the
  // threshold after it, which is the one arrangement in which the discount → shipping order is visible.
  const basket = [line("Aurora Desk Lamp", 8_000)];

  it("charges delivery on the subtotal left after the discount, not on the one before it", () => {
    const plain = priced(basket, undefined, FREE_METHOD_ID);
    const discounted = priced(basket, SAVE_TEN, FREE_METHOD_ID);
    expect(plain.subtotalMinor).toBe(8_000);
    expect(plain.shippingMinor).toBe(0);
    expect(plain.taxMinor).toBe(pricing.computeTax(8_000));
    expect(plain.grandTotalMinor).toBe(8_660);
    expect(discounted.discountTotalMinor).toBe(800);
    expect(discounted.shippingMinor).toBe(FREE_METHOD_PRICE_MINOR);
    expectMoneyInvariants(plain);
    expectMoneyInvariants(discounted);
  });

  it("taxes the discounted goods and never the delivery charge", () => {
    const cart = priced(basket, SAVE_TEN, FREE_METHOD_ID);
    expect(cart.taxMinor).toBe(594);
    // Every other base lands elsewhere — the pre-discount goods would be taxed 660 and the goods with the
    // delivery charge added 668 — so a wrong base cannot pass this case.
    expect(pricing.computeTax(8_000)).toBe(660);
    expect(pricing.computeTax(7_200 + FREE_METHOD_PRICE_MINOR)).toBe(668);
  });

  it("states the grand total as subtotal minus discount plus shipping plus tax", () => {
    const cart = priced(basket, SAVE_TEN, FREE_METHOD_ID);
    expect(cart.grandTotalMinor).toBe(8_000 - 800 + FREE_METHOD_PRICE_MINOR + 594);
    expect(cart.grandTotalMinor).toBe(8_693);
    expectMoneyInvariants(cart);
  });
});

describe("the delivery charge", () => {
  it.each(SHIPPING_METHODS.map((method): [string, number] => [method.id, method.priceMinor]))(
    "prices %s from the configured table at %i minor units",
    (methodId, priceMinor) => {
      const resolved = pricing.resolveShipping(1_000, methodId);
      expect(resolved.id).toBe(methodId);
      expect(resolved.priceMinor).toBe(priceMinor);
      expect(Number.isInteger(resolved.priceMinor)).toBe(true);
    },
  );

  it("falls back to the first configured method for an id that names none, and for none chosen", () => {
    for (const methodId of ["ship_nope", "", null]) {
      expect(pricing.resolveShipping(1_000, methodId)).toEqual(SHIPPING_METHODS[0]);
    }
    // A caller supplying no list at all is priced against the configured set.
    expect(pricing.resolveShipping(1_000, null, [])).toEqual(SHIPPING_METHODS[0]);
  });

  it.each<[number, number]>([
    [BELOW_THRESHOLD_MINOR, FREE_METHOD_PRICE_MINOR],
    [THRESHOLD_MINOR, 0],
    [THRESHOLD_MINOR + 1, 0],
    [0, FREE_METHOD_PRICE_MINOR],
  ])(
    "waives the configured method at and above the threshold: %i costs %i",
    (subtotalMinor, charge) => {
      const resolved = pricing.resolveShipping(subtotalMinor, FREE_METHOD_ID);
      expect(resolved.id).toBe(FREE_METHOD_ID);
      expect(resolved.priceMinor).toBe(charge);
    },
  );

  it("waives only the method the configuration names, leaving the others charged", () => {
    expect(pricing.resolveShipping(9_000, FREE_METHOD_ID).priceMinor).toBe(0);
    expect(pricing.resolveShipping(9_000, "ship_economy").priceMinor).toBe(599);
    expect(pricing.resolveShipping(9_000, "ship_express").priceMinor).toBe(2_499);
  });

  it("echoes the method that was chosen, and names none when none was", () => {
    const chosen = priced([line("Aurora Desk Lamp", 3_000)], undefined, "ship_express");
    expect(chosen.shippingMethodId).toBe("ship_express");
    expect(chosen.shippingMinor).toBe(2_499);
    const unnamed = priced([line("Aurora Desk Lamp", 3_000)], undefined, "ship_nope");
    expect(unnamed.shippingMethodId).toBeNull();
    expect(unnamed.shippingMinor).toBe(0);
  });

  it("reports the shortfall to free delivery, never a negative one", () => {
    // 8,000 of goods less the 800 the code takes off leaves 7,200: 300 short of the threshold.
    const below = priced([line("Aurora Desk Lamp", 8_000)], SAVE_TEN, FREE_METHOD_ID);
    expect(pricing.freeShippingProgress(below).remainingMinor).toBe(300);
    expect(pricing.freeShippingProgress(below).ratio).toBe(0.96);
    expect(pricing.freeShippingProgress(below).qualifies).toBe(false);
    const at = priced([line("Cascade Speaker", THRESHOLD_MINOR)]);
    expect(pricing.freeShippingProgress(at).remainingMinor).toBe(0);
    expect(pricing.freeShippingProgress(at).qualifies).toBe(true);
    const above = priced([line("Cascade Speaker", 20_000)]);
    expect(pricing.freeShippingProgress(above).remainingMinor).toBe(0);
    expect(pricing.freeShippingProgress(above).ratio).toBe(1);
    expect(pricing.freeShippingProgress(above).qualifies).toBe(true);
  });
});

describe("tax on the discounted goods", () => {
  it("applies the configured rate to the base it is given", () => {
    expect(pricing.computeTax(10_000)).toBe(TAX_ON_10_000_MINOR);
    expect(pricing.computeTax(7_200)).toBe(594);
  });

  it.each<[number, number]>([
    [100, 8],
    [3, 0],
    [0, 0],
    [1_234, 102],
  ])("lands %i minor units of taxable goods on %i, a whole minor unit", (base, expected) => {
    expect(pricing.computeTax(base)).toBe(expected);
    expect(Number.isInteger(pricing.computeTax(base))).toBe(true);
  });

  it("lands an exact half-cent away from zero, where rounding to even would fall the other way", () => {
    // 200 times the configured rate is exactly 16.5 minor units: half away from zero gives 17, even 16.
    expect(pricing.computeTax(200)).toBe(17);
  });

  it("taxes nothing rather than producing a figure from an unusable base or rate", () => {
    expect(pricing.computeTax(-500)).toBe(0);
    expect(pricing.computeTax(1_000, 0)).toBe(0);
    expect(pricing.computeTax(1_000, -0.5)).toBe(0);
    expect(pricing.computeTax(1_000, Number.NaN)).toBe(0);
    expect(pricing.computeTax(1_000, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("whether a code applies", () => {
  /** The reason a code earns against the basket below, or `undefined` where it applies. */
  type Decision = PromoRejectionReason | undefined;

  /** A basket of 4,999 minor units: above the fixture code's floor of 2,500, and below the floors the
   *  table below raises to reach the floor refusal. */
  const basket = [line("Aurora Desk Lamp", 4_999)];
  /** The decision's two fixed inputs, so a case states only the code, its stored form and the day. */
  const DAY = { lines: basket, today: FIXED_DATE };
  /** The overrides three rows need, hoisted so every row of the table stays one line. */
  const FLOOR_5_000: Partial<PromoCode> = { minSubtotalMinor: 5_000 };
  const AT_LIMIT: Partial<PromoCode> = { usageLimit: 10, usageCount: 10 };
  const OPENS_TOMORROW: Partial<PromoCode> = { startsAt: "2025-10-16" };

  /** One row per way the decision can go: a spelling, the stored code's overrides (`null` for no stored
   *  code at all), the code the basket already carries, and the reason expected of the pair. */
  const DECISIONS: [string, string, Partial<PromoCode> | null, string | undefined, Decision][] = [
    ["refuses an unissued spelling", "ZZZZ9", null, undefined, "unknown"],
    ["refuses a spelling of the wrong shape", "AB-1", {}, undefined, "unknown"],
    ["refuses a withdrawn code", "RETIRED10", { active: false }, undefined, "inactive"],
    ["refuses a code not open yet", "SOON10", OPENS_TOMORROW, undefined, "not-started"],
    ["refuses a lapsed code", "GONE10", { endsAt: "2025-10-14" }, undefined, "expired"],
    ["refuses a basket under the floor", "BIG500", FLOOR_5_000, undefined, "below-minimum"],
    ["refuses a code out of uses", "USED10", AT_LIMIT, undefined, "usage-limit"],
    ["refuses the code already carried", "TESTSAVE", {}, " testsave ", "already-applied"],
    ["accepts a code that applies", "TESTSAVE", {}, undefined, undefined],
    ["accepts a pasted spelling's spacing and case", "  testsave ", {}, undefined, undefined],
  ];

  it.each(DECISIONS)("%s", (_label, promoCode, overrides, alreadyAppliedCode, expected) => {
    const promo = overrides === null ? undefined : makePromoCode({ code: promoCode, ...overrides });
    const input = { ...DAY, code: promoCode, promo, alreadyAppliedCode };
    expect(pricing.decidePromo(input)).toBe(expected);
  });

  it("includes both dates of a code's own window", () => {
    const opensToday = makePromoCode({ code: "OPEN10", startsAt: FIXED_DATE });
    const closesToday = makePromoCode({ code: "CLOSE10", endsAt: FIXED_DATE });
    expect(pricing.decidePromo({ ...DAY, code: "OPEN10", promo: opensToday })).toBeUndefined();
    expect(pricing.decidePromo({ ...DAY, code: "CLOSE10", promo: closesToday })).toBeUndefined();
  });

  it("judges the floor against the basket's own goods, accepting a basket exactly at it", () => {
    const exact = makePromoCode({ code: "FLOOR10", minSubtotalMinor: 4_999 });
    const above = makePromoCode({ code: "FLOOR10", minSubtotalMinor: 5_000 });
    expect(pricing.decidePromo({ ...DAY, code: "FLOOR10", promo: exact })).toBeUndefined();
    expect(pricing.decidePromo({ ...DAY, code: "FLOOR10", promo: above })).toBe("below-minimum");
  });

  it("keeps the last use of a code available", () => {
    const lastUse = makePromoCode({ code: "USED10", usageLimit: 10, usageCount: 9 });
    expect(pricing.decidePromo({ ...DAY, code: "USED10", promo: lastUse })).toBeUndefined();
  });

  const LIGHTS = "cat_lights" as CategoryId;
  const AUDIO = "cat_audio" as CategoryId;
  const lamp = line("Aurora Desk Lamp", 5_000);
  const speaker = line("Cascade Speaker", 5_000);
  const scoped = makePromoCode({ code: "LIGHTS15", appliesTo: "category", categoryIds: [LIGHTS] });
  const BY_PRODUCT = new Map([
    [lamp.productId, LIGHTS],
    [speaker.productId, AUDIO],
  ]);

  it("accepts a category-scoped code only where a line sits in one of its categories", () => {
    const inScope = new Map([[lamp.productId, LIGHTS]]);
    const outOfScope = new Map([[lamp.productId, AUDIO]]);
    const decide = (lines: readonly CartLine[], byProduct?: ReadonlyMap<string, CategoryId>) =>
      pricing.decidePromo({
        ...DAY,
        code: "LIGHTS15",
        promo: scoped,
        lines,
        categoryIdsByProductId: byProduct,
      });
    expect(decide([lamp], inScope)).toBeUndefined();
    expect(decide([speaker], outOfScope)).toBe("ineligible-category");
    // A caller holding no catalogue narrows nothing, which is the order-scoped reading of the code.
    expect(decide([speaker])).toBeUndefined();
  });

  it("narrows what a category-scoped code discounts to the lines its categories cover", () => {
    const applied = pricing.applyPromo(10_000, scoped, [lamp, speaker], {
      categoryIdsByProductId: BY_PRODUCT,
    });
    expect(applied.amountMinor).toBe(500);
    const cart = pricing.priceCartLines({
      lines: [lamp, speaker],
      promo: scoped,
      shippingMethodId: null,
      categoryIdsByProductId: BY_PRODUCT,
    });
    expect(cart.subtotalMinor).toBe(10_000);
    expect(cart.discountTotalMinor).toBe(500);
    expect(cart.lines.map((item) => item.discountMinor)).toEqual([500, 0]);
    expect(cart.lines.map((item) => item.lineTotalMinor)).toEqual([4_500, 5_000]);
    expect(cart.taxMinor).toBe(784);
    expect(cart.grandTotalMinor).toBe(10_284);
    expectMoneyInvariants(cart);
  });
});

describe("the wording a refusal carries", () => {
  /** The eight reasons a code can be refused, read from the copy module that holds a sentence for each. */
  const REASONS = Object.keys(PROMO_REJECTION_MESSAGES) as PromoRejectionReason[];

  it("holds a sentence for each of the eight reasons", () => {
    expect(REASONS).toHaveLength(8);
  });

  it.each(REASONS)("reads %s out of a failed request and names the sentence for it", (reason) => {
    const error = makeApiError({ status: 409, code: reason });
    expect(pricing.promoRejectionReason(error)).toBe(reason);
    expect(pricing.promoRejectionMessage(error)).toBe(PROMO_REJECTION_MESSAGES[reason]);
  });

  it("reports no promo reason for a failure that is not one of the eight", () => {
    for (const code of ["insufficient-stock", "validation-failed", "unexpected-error"]) {
      const error = makeApiError({ code });
      expect(pricing.promoRejectionReason(error)).toBeUndefined();
      expect(pricing.promoRejectionMessage(error)).toBeUndefined();
    }
  });
});
