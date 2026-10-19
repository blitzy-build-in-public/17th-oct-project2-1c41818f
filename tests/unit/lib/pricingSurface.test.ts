/**
 * Path: tests/unit/lib/pricingSurface.test.ts
 * Purpose: The pricing service's transport-backed surface: promo validation, the delivery methods, a basket
 * priced over the seam, the shelf each line is checked against and the catalogue's price a line is priced at.
 * Lines: 233
 */

import { beforeEach, describe, expect, it } from "vitest";

import { DEMO_CARD_NUMBERS, PAGE_SIZE_OPTIONS, SHIPPING_METHODS } from "@/constants/config";
import { PROMO_REJECTION_MESSAGES } from "@/constants/content";
import { salesProDataSource } from "@/data/repositories";
import { postJson } from "@/lib/apiClient";
import { API_PATHS, failNext, registerDataSource, resetMockServer } from "@/lib/mockServer";
// The module under test is imported as a namespace, as formatting.test.ts imports src/utils/format.ts:
// this file exercises five of its exports, and five specifiers named singly cost seven lines.
import * as pricing from "@/lib/pricingService";
import { DEFAULT_FILTER_STATE } from "@/utils/queryParams";
import { makeCartLine, makePromoCode } from "../../fixtures";
// The money invariants both pricing suites assert now have one home in tests/helpers/pricingHarness.ts,
// imported here and by the pure half of the suite, so the two cannot come to disagree about the arithmetic.
import { expectMoneyInvariants } from "../../helpers/pricingHarness";

import type { Product } from "@/types/catalog";
import type { ApiError, Result } from "@/types/common";
import type { CartLine, Order, PricedCart } from "@/types/commerce";

import { orderBody } from "./mockServerHarness";

// The contract these cases hold: promo validation, the delivery methods, a basket priced over the seam and
// the shelf each line is checked against. Every case answers through the real transport over the seeded data
// source — no case mocks a module, and the only isolation used is the seam's own failure injection — and
// every figure asserted is a whole number of minor units.

/** The largest page a listing may be read at, so reading the whole seeded catalogue costs three reads. */
const LARGEST_PAGE_SIZE = Math.max(...PAGE_SIZE_OPTIONS);

/** The payload a request returned, for a case expecting it to have succeeded. */
function valueOf<TValue>(result: Result<TValue>): TValue {
  if (!result.ok) throw new Error(`expected a success but the seam answered ${result.error.code}`);
  return result.value;
}

/** The failure a request returned: asserting `ok` here keeps every failure case from restating the shape
 *  that says the request failed. */
function failureOf<TValue>(result: Result<TValue>): ApiError {
  if (result.ok) throw new Error("expected a failure but the seam answered a payload");
  return result.error;
}

/**
 * The seeded catalogue, read one full page at a time: the cases below take the product they price off the
 * catalogue itself rather than restating a seeded value, because the pricing read now checks every line
 * against the shelf that catalogue holds.
 */
function readCatalogue(): readonly Product[] {
  const query = { ...DEFAULT_FILTER_STATE, pageSize: LARGEST_PAGE_SIZE };
  const first = salesProDataSource.listProducts(query);
  const rows: Product[] = [...first.items];
  for (let page = 2; page <= first.pageCount; page += 1) {
    rows.push(...salesProDataSource.listProducts({ ...query, page }).items);
  }
  return rows;
}

/** The catalogue's own rows. */
const CATALOGUE = readCatalogue();

/** The first catalogue row of a kind a case needs, or a failure naming the seeded data rather than a case
 *  quietly pricing a product it did not pick. */
function findServedProduct(predicate: (product: Product) => boolean, kind: string): Product {
  const found = CATALOGUE.find(predicate);
  if (found === undefined) throw new Error(`The seeded catalogue serves no ${kind} product.`);
  return found;
}

/** The two shelves the stock case prices: a product the store holds and one it has run out of. */
const SELLABLE = findServedProduct((product) => product.stockOnHand > 0, "in-stock");
const SOLD_OUT = findServedProduct((product) => product.stockOnHand === 0, "out-of-stock");

describe("the pricing surface the cart and the checkout call", () => {
  // The async reads answer through the real transport over the seeded data source: no case mocks a module,
  // and the only isolation used is the seam's own failure injection.
  beforeEach(() => {
    registerDataSource(salesProDataSource);
  });

  /** The code the data layer issues with no floor and an open window: 10% off an order. */
  const SEEDED_CODE = "SAVE10";

  /** The basket every case here prices: a product the catalogue serves and holds stock for — the shelf the
   *  pricing read checks a line against — at the catalogue's own price for it and quantity one, so its
   *  subtotal, its discount and its tax stay arithmetic to check by hand. The `unitPriceMinor` a case states
   *  is not a price the seam reads: the pricing read re-prices every line from the catalogue. */
  const basket = [
    makeCartLine({
      productId: SELLABLE.id,
      sku: SELLABLE.sku,
      name: SELLABLE.name,
      unitPriceMinor: SELLABLE.priceMinor,
    }),
  ];

  it("returns the stored code a seeded spelling names, however it was typed", async () => {
    const promo = valueOf(await pricing.validatePromoCode(" save10 ", basket));
    expect(promo.code).toBe(SEEDED_CODE);
    expect(promo.kind).toBe("percent");
    expect(promo.value).toBe(10);
    expect(Number.isInteger(promo.minSubtotalMinor)).toBe(true);
  });

  it("answers an unknown code with the reason as a value, never by throwing", async () => {
    const error = failureOf(await pricing.validatePromoCode("ZZZZ9", basket));
    expect(error.status).toBe(409);
    expect(error.field).toBe("promoCode");
    expect(pricing.promoRefusalMessage(error)).toBe(PROMO_REJECTION_MESSAGES.unknown);
    expect(error.message).toBe(PROMO_REJECTION_MESSAGES.unknown);
  });

  it.each(["ab", "   ", "ABCDEFGHIJKLMNOPQ"])(
    "refuses the spelling %j without asking the store",
    async (spelling) => {
      const error = failureOf(await pricing.validatePromoCode(spelling, basket));
      expect(error.status).toBe(422);
      expect(error.code).toBe("validation-failed");
      expect(error.field).toBe("promoCode");
    },
  );

  it("offers the five configured delivery methods, with their prices intact", async () => {
    const methods = valueOf(await pricing.listShippingMethods());
    expect(methods).toHaveLength(5);
    expect(methods).toEqual([...SHIPPING_METHODS]);
  });

  it("prices one basket identically twice, through the one pricing implementation", async () => {
    const first = valueOf(await pricing.priceCart(basket, SEEDED_CODE, null));
    const second = valueOf(await pricing.priceCart(basket, SEEDED_CODE, null));
    const equivalent = makePromoCode({ code: SEEDED_CODE, value: 10, minSubtotalMinor: 0 });
    expect(second).toEqual(first);
    // The catalogue's own price, a tenth off it and the configured tax rate: a hand-set unit price is not a
    // figure the pricing read prices, which is what makes these four the seam's answer rather than a case's.
    expect(first.subtotalMinor).toBe(SELLABLE.priceMinor);
    expect(first.discountTotalMinor).toBe(1_860);
    expect(first.taxMinor).toBe(1_381);
    expect(first.grandTotalMinor).toBe(18_120);
    expect(first).toEqual(
      pricing.priceCartLines({ lines: basket, promo: equivalent, shippingMethodId: null }),
    );
    expectMoneyInvariants(first);
  });

  it("answers a line that can no longer be bought with 422 naming the basket", async () => {
    const error = failureOf(
      await pricing.priceCart(
        [makeCartLine({ name: "Aurora Desk Lamp", unitPriceMinor: 4_999, quantity: 11 })],
        undefined,
        null,
      ),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe("insufficient-stock");
    expect(error.field).toBe("lines");
  });

  it("refuses a line whose ceiling overstates the shelf, and prices that line where the shelf covers it", async () => {
    const shelfLine = (product: Product): CartLine =>
      makeCartLine({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unitPriceMinor: product.priceMinor,
        quantity: 1,
        maxQuantity: 1,
      });
    const error = failureOf(await pricing.priceCart([shelfLine(SOLD_OUT)], undefined, null));
    expect(error.status).toBe(422);
    expect(error.code).toBe("insufficient-stock");
    expect(error.field).toBe("lines");
    const priced = valueOf(await pricing.priceCart([shelfLine(SELLABLE)], undefined, null));
    expect(priced.subtotalMinor).toBe(SELLABLE.priceMinor);
  });

  it("answers a code that no longer applies with 409 carrying its reason", async () => {
    const error = failureOf(await pricing.priceCart(basket, "SUMMER25", null));
    expect(error.status).toBe(409);
    expect(error.field).toBe("promoCode");
    expect(pricing.promoRefusalMessage(error)).toBe(PROMO_REJECTION_MESSAGES.expired);
  });

  it("prices a line at the catalogue's price and keeps a submitted total out of the order it places", async () => {
    // A submission the seam itself priced, then doctored: a hand-made body may name any line price and any
    // total, so the quote and the order are both asked what the catalogue charges for the same basket.
    const submitted = (await orderBody("key-catalogue-priced", DEMO_CARD_NUMBERS.APPROVED)) as {
      readonly snapshot: PricedCart;
    } & Record<string, unknown>;
    const [cataloguePriced] = submitted.snapshot.lines;
    if (cataloguePriced === undefined) throw new Error("The priced snapshot holds no line.");
    const doctored = [
      { ...cataloguePriced, unitPriceMinor: 1, lineSubtotalMinor: 1, lineTotalMinor: 1 },
    ];
    const quoted = valueOf(await pricing.priceCart(doctored, undefined, null));
    expect(quoted.lines[0]?.unitPriceMinor).toBe(cataloguePriced.unitPriceMinor);
    expect(quoted.subtotalMinor).toBe(cataloguePriced.lineSubtotalMinor);
    const order = valueOf(
      await postJson<Order>(API_PATHS.ORDERS, {
        ...submitted,
        snapshot: { ...submitted.snapshot, grandTotalMinor: 1, lines: doctored },
      }),
    );
    expect(order.pricedCart.grandTotalMinor).toBe(submitted.snapshot.grandTotalMinor);
    expect(order.lines.map((line) => line.unitPriceMinor)).toEqual([
      cataloguePriced.unitPriceMinor,
    ]);
  });

  it("hands an injected failure back as a value, so no caller needs a try/catch", async () => {
    const message = "The pricing service is unavailable.";
    failNext({ path: API_PATHS.CART_PRICE, status: 500, code: "unexpected-error", message });
    const error = failureOf(await pricing.priceCart(basket, undefined, null));
    expect(error.status).toBe(500);
    expect(error.code).toBe("unexpected-error");
    expect(error.message).toBe(message);
    expect(pricing.promoRefusalMessage(error)).toBeUndefined();
  });

  it("answers 503 before any data source has been bound", async () => {
    resetMockServer();
    const error = failureOf(await pricing.priceCart(basket, undefined, null));
    expect(error.status).toBe(503);
    expect(error.code).toBe("data-source-unavailable");
  });
});
