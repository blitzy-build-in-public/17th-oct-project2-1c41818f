/**
 * Path: tests/helpers/pricingHarness.ts
 * Purpose: The invariants both pricing suites assert over a priced cart: every amount a whole number of minor units, the grand total the four parts added in the documented order, and the lines' subtotals and discounts adding up to the cart's.
 * Lines: 35
 */

import { expect } from "vitest";

import { DEFAULT_CURRENCY } from "@/constants/config";
import type { PricedCart } from "@/types/commerce";

/**
 * The invariants every priced cart satisfies whatever was priced: each amount is a whole number of minor
 * units, the grand total is the four parts added in the documented order, the lines' subtotals add up to
 * the cart's and their discounts to the code's, and each line's total is its subtotal less its own share.
 * The expected currency is read from `src/constants/config`, the constant's own home, rather than restated
 * here, so the two suites cannot hold two opinions about it. Both suites call this helper instead of each
 * restating the arithmetic, because a second statement of it is how two files come to disagree about it.
 */
export function expectMoneyInvariants(cart: PricedCart): void {
  const amounts = [cart.subtotalMinor, cart.discountTotalMinor, cart.shippingMinor, cart.taxMinor];
  expect(amounts.every(Number.isInteger)).toBe(true);
  expect(Number.isInteger(cart.freeShippingRemainingMinor)).toBe(true);
  expect(cart.grandTotalMinor).toBe(
    cart.subtotalMinor - cart.discountTotalMinor + cart.shippingMinor + cart.taxMinor,
  );
  expect(cart.currency).toBe(DEFAULT_CURRENCY);
  const subtotals = cart.lines.map((item) => item.lineSubtotalMinor);
  const discounts = cart.lines.map((item) => item.discountMinor);
  expect(subtotals.reduce((sum, amount) => sum + amount, 0)).toBe(cart.subtotalMinor);
  expect(discounts.reduce((sum, amount) => sum + amount, 0)).toBe(cart.discountTotalMinor);
  expect(cart.lines.map((item) => item.lineTotalMinor)).toEqual(
    cart.lines.map((item) => item.lineSubtotalMinor - item.discountMinor),
  );
}
