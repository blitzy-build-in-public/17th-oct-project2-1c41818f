/**
 * Path: tests/unit/state/transactions.test.ts
 * Purpose: Cart and checkout reducer transitions, stock clamping and submission guards
 * Lines: 597
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CURRENCY, STORAGE_KEYS, STORAGE_VERSION } from "@/constants/config";
import {
  cartActions,
  cartReducer,
  clampLineQuantity,
  createCartLine,
  createInitialCartState,
  fromCart,
  isCartLine,
  isCartState,
  mergeCartLine,
  toCart,
} from "@/state/cartReducer";
import {
  CHECKOUT_FORM_STEPS,
  CHECKOUT_STEP_SEQUENCE,
  canAdvanceFrom,
  checkoutActions,
  checkoutReducer,
  createInitialCheckoutState,
  isFinalFormStep,
  nextStep,
  previousStep,
  stepIndex,
} from "@/state/checkoutReducer";
import {
  FIXED_NOW,
  makeApiError,
  makeCart,
  makeCartLine,
  makeCartWithLines,
  makeFieldErrors,
  makeOrder,
  makePricedCart,
  makeProduct,
} from "../../fixtures";

import type { CartState } from "@/state/cartReducer";
import type { CheckoutState, CheckoutStep } from "@/state/checkoutReducer";
import type { Cart, CartLine } from "@/types/commerce";

// Both subjects are pure functions of a state and an action: every case calls one directly.

const ADD_ONE = cartActions.add(makeCartLine({ quantity: 1 }));
const NEXT = checkoutActions.next();
/** A cart holding nothing, pinned to a fixed instant so no assertion reads one. */
const EMPTY_CART: CartState = createInitialCartState({ updatedAt: FIXED_NOW });
/** The fixture's first product once: the cart the cases below act on, and the line it holds. */
const ONE_LINE_CART: CartState = cartReducer(EMPTY_CART, ADD_ONE);
const SEED_LINE: CartLine = ONE_LINE_CART.lines[0];
/** A line identifier no cart under test holds, for the transitions that must change nothing. */
const ABSENT_LINE_ID = makeCartLine({ name: "Trailhead Kettle" }).id;
/** Requested quantities and the whole number a line of ceiling ten may hold of each. */
const QUANTITY_REQUESTS: [number, number][] = [
  [12, 10],
  [0, 1],
  [-4, 1],
  [2.7, 2],
  [Number.NaN, 1],
];
/** A requested quantity, the ceiling it is held against, and the quantity the line may hold. */
const CLAMP_CASES: [number, number, number][] = [
  [5, 3, 3],
  [1, 3, 1],
  [4.9, 10, 4],
  [2, 0, 1],
];
/** Line candidates a stored cart must refuse: one unusable field each, the rest well formed. */
const MALFORMED_LINES: [string, unknown][] = [
  ["id", { ...makeCartLine(), id: "" }],
  ["productId", { ...makeCartLine(), productId: "" }],
  ["quantity", { ...makeCartLine(), quantity: 0 }],
  ["addedAt", { ...makeCartLine(), addedAt: "yesterday" }],
];
/** Every step, the one a forward move reaches, and the one a backward move reaches. */
const STEP_MOVES: { step: CheckoutStep; next: CheckoutStep; previous: CheckoutStep }[] = [
  { step: "shipping", next: "payment", previous: "shipping" },
  { step: "payment", next: "review", previous: "shipping" },
  { step: "review", next: "review", previous: "payment" },
  { step: "confirmation", next: "confirmation", previous: "confirmation" },
];
/** A checkout at its first step, holding the email the shopper signed in with. */
const FRESH_CHECKOUT: CheckoutState = createInitialCheckoutState({
  idempotencyKey: "idem-key",
  email: "dana@example.com",
});
/** The shipping step's values, filled in as the shipping form submits them. */
const SHIPPING_VALUES = { shipping: { fullName: "Dana Okafor", city: "Portland" } };
const FILL = checkoutActions.updateValues(SHIPPING_VALUES);
/** A checkout whose shipping step has been filled in, where the entered values are asserted. */
const FILLED_CHECKOUT = checkoutReducer(FRESH_CHECKOUT, FILL);
/** A checkout standing on the review step, the only step from which a submission may begin. */
const REVIEWING_CHECKOUT = checkoutReducer(checkoutReducer(FILLED_CHECKOUT, NEXT), NEXT);
/** The checkout a placed order leaves behind, where the confirmation is the only step it may hold. */
const PLACED_CHECKOUT = placeOrder(startSubmission(REVIEWING_CHECKOUT));
/** Direct moves refused by identity: forward past validation, and into or out of the confirmation. */
const REFUSED_DIRECT_MOVES: [CheckoutState, CheckoutStep][] = [
  [FRESH_CHECKOUT, "payment"],
  [FRESH_CHECKOUT, "review"],
  [REVIEWING_CHECKOUT, "confirmation"],
  [PLACED_CHECKOUT, "review"],
  [PLACED_CHECKOUT, "payment"],
  [PLACED_CHECKOUT, "shipping"],
];

/** Writes values onto the shipping step, as a form does field by field. */
function editShipping(shipping: Record<string, string>) {
  return checkoutActions.updateValues({ shipping });
}

/** Begins the submission the review step allows, from the state the checkout holds. */
function startSubmission(state: CheckoutState, key = "idem-1"): CheckoutState {
  return checkoutReducer(state, checkoutActions.submitStarted(key));
}

/** The checkout after the demonstration order was placed from it. */
function placeOrder(state: CheckoutState): CheckoutState {
  return checkoutReducer(state, checkoutActions.submitSucceeded(makeOrder()));
}

/**
 * A Web Storage stand-in over an entries map, with a switch that makes a write refuse as a full
 * quota does: the two failures the cart's persistence seam has to survive without throwing.
 */
function createStore(entries = new Map<string, string>()): {
  readonly store: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  readonly refuseWrites: () => void;
} {
  let refusing = false;
  return {
    store: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (refusing) throw new DOMException("Quota exceeded.", "QuotaExceededError");
        entries.set(key, value);
      },
      removeItem: (key: string) => entries.delete(key),
    },
    refuseWrites: () => {
      refusing = true;
    },
  };
}

/** Installs `store` as the environment's Web Storage, the only place the module looks for one. */
function installStore(store: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: store,
  });
}

describe("cart transitions", () => {
  it("adds a product as a line priced in minor units, and merges a second add into it", () => {
    const product = makeProduct({ priceMinor: 4_999, stockOnHand: 15 });
    const added = cartActions.add(createCartLine(product, 2, FIXED_NOW));
    const next = cartReducer(EMPTY_CART, added);

    expect(next.lines).toHaveLength(1);
    expect(next.lines[0]).toMatchObject({
      productId: product.id,
      unitPriceMinor: 4_999,
      maxQuantity: 15,
      quantity: 2,
      addedAt: FIXED_NOW,
    });
    expect(next.updatedAt).toBe(FIXED_NOW);

    // A second add lands on the line the product already holds, up to the stock ceiling it carries.
    const laterInstant = "2025-10-16T09:00:00.000Z";
    const merge = cartActions.add(makeCartLine({ quantity: 4, addedAt: laterInstant }));
    const merged = cartReducer(next, merge);
    expect(merged.lines).toHaveLength(1);
    expect(merged.lines[0]).toMatchObject({
      id: next.lines[0].id,
      quantity: 6,
      addedAt: FIXED_NOW,
    });
    // An add records the instant the line that joined was built, which is when the cart changed.
    expect(merged.updatedAt).toBe(laterInstant);

    const eight = cartReducer(EMPTY_CART, cartActions.add(makeCartLine({ quantity: 8 })));
    const full = cartReducer(eight, cartActions.add(makeCartLine({ quantity: 5 })));
    expect(full.lines[0]).toMatchObject({ quantity: 10, maxQuantity: 10 });
    // A line already holding all the stock absorbs the add by keeping the cart's own reference.
    expect(cartReducer(full, merge)).toBe(full);
  });

  it.each(QUANTITY_REQUESTS)("holds a requested quantity of %d at %d", (requested, expected) => {
    const change = cartActions.updateQuantity(SEED_LINE.id, requested, FIXED_NOW);
    const next = cartReducer(ONE_LINE_CART, change);

    expect(next.lines[0].quantity).toBe(expected);
    expect(Number.isInteger(next.lines[0].quantity)).toBe(true);
    expect(next.updatedAt).toBe(FIXED_NOW);
    // A line the cart does not hold leaves it alone, and the quantity it already holds is a no-op.
    const absent = cartActions.updateQuantity(ABSENT_LINE_ID, 3);
    expect(cartReducer(ONE_LINE_CART, absent)).toBe(ONE_LINE_CART);
    const unchanged = cartActions.updateQuantity(SEED_LINE.id, 1);
    expect(cartReducer(ONE_LINE_CART, unchanged)).toBe(ONE_LINE_CART);
  });

  it("removes one line, then empties the cart and the code together", () => {
    const lines = makeCartWithLines(2).lines;
    const cart = createInitialCartState({ lines, promoCode: "SAVE10", updatedAt: FIXED_NOW });
    const removed = cartReducer(cart, cartActions.remove(lines[0].id, FIXED_NOW));

    // The code is order-level, so the lines it still applies to keep it.
    expect(removed.lines.map((line) => line.id)).toEqual([lines[1].id]);
    expect(removed.promoCode).toBe("SAVE10");
    expect(removed.updatedAt).toBe(FIXED_NOW);
    expect(cartReducer(removed, cartActions.remove(ABSENT_LINE_ID))).toBe(removed);

    const applied = cartReducer(EMPTY_CART, cartActions.applyPromo(" save10 ", FIXED_NOW));
    expect(applied.promoCode).toBe("save10");
    expect(cartReducer(applied, cartActions.applyPromo("save10", FIXED_NOW))).toBe(applied);
    expect(cartReducer(applied, cartActions.applyPromo("   ", FIXED_NOW)).promoCode).toBeNull();

    const cleared = cartReducer(removed, cartActions.clear(FIXED_NOW));
    expect(cleared.lines).toEqual([]);
    expect(cleared.promoCode).toBeNull();
    expect(cartReducer(cleared, cartActions.clear(FIXED_NOW))).toBe(cleared);
  });

  it("adopts lines and states built elsewhere", () => {
    const built = makeCartLine({ quantity: 9, maxQuantity: 3 });
    const replaced = cartReducer(EMPTY_CART, cartActions.replaceLines([built], FIXED_NOW));
    const stored = createInitialCartState({
      lines: makeCartWithLines(2).lines,
      updatedAt: FIXED_NOW,
    });
    expect(replaced.lines[0]).toMatchObject({ quantity: 3, maxQuantity: 3 });
    expect(cartReducer(EMPTY_CART, cartActions.restore(stored))).toBe(stored);
    // Re-clamping lines that already conform keeps the array, so the cart keeps its own reference.
    const same = cartActions.replaceLines(EMPTY_CART.lines, FIXED_NOW);
    expect(cartReducer(EMPTY_CART, same)).toBe(EMPTY_CART);
  });
});

describe("cart line construction", () => {
  it("copies the product's facts onto the line, and merges on the product", () => {
    const product = makeProduct({ priceMinor: 12_900, stockOnHand: 7 });
    const line = createCartLine(product, 3, FIXED_NOW);

    expect(line).toMatchObject({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      unitPriceMinor: 12_900,
      maxQuantity: 7,
      quantity: 3,
      imageUrl: product.images[0].url,
    });
    // One identifier per product, so a second add merges rather than opening a second line.
    expect(createCartLine(product, 5, FIXED_NOW).id).toBe(line.id);
    expect(line.id.startsWith("line_")).toBe(true);
    // A product with nothing on hand is one purchasable unit, not an unpurchasable line of none.
    const outOfStock = createCartLine(makeProduct({ stockOnHand: 0 }), 4, FIXED_NOW);
    expect(outOfStock).toMatchObject({ maxQuantity: 1, quantity: 1 });
    // A merge keys on the product, keeps the line's identity and follows the product as it stands.
    const handBuilt: CartLine = { ...makeCartLine({ quantity: 2 }), id: ABSENT_LINE_ID };
    const merged = mergeCartLine([SEED_LINE], handBuilt);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: SEED_LINE.id, addedAt: SEED_LINE.addedAt, quantity: 3 });
    const repriced: CartLine = { ...makeCartLine(), unitPriceMinor: 6_500, maxQuantity: 2 };
    expect(mergeCartLine([SEED_LINE], repriced)[0]).toMatchObject({ unitPriceMinor: 6_500 });
  });

  it.each(CLAMP_CASES)("clamps %d against ceiling %d to %d", (requested, ceiling, expected) => {
    expect(clampLineQuantity(requested, ceiling)).toBe(expected);
  });
});

describe("cart persistence shape", () => {
  it("round-trips a cart through the shape a reload restores", () => {
    const lines = makeCartWithLines(3).lines;
    const state = createInitialCartState({ lines, promoCode: "SAVE10", updatedAt: FIXED_NOW });
    const cart = toCart(state);

    expect(cart).toMatchObject({
      version: STORAGE_VERSION,
      currency: DEFAULT_CURRENCY,
      promoCode: "SAVE10",
      updatedAt: FIXED_NOW,
    });
    const restored = fromCart(cart);
    expect(restored).toEqual(state);
    expect(restored.lines.map((line) => line.id)).toEqual(lines.map((line) => line.id));
    expect(restored.lines.map((line) => line.quantity)).toEqual([1, 2, 3]);
    expect(restored.lines.every((line) => Number.isInteger(line.unitPriceMinor))).toBe(true);
    // The guards accept what the application itself builds, at both levels.
    expect(isCartLine(SEED_LINE)).toBe(true);
    expect(isCartState(ONE_LINE_CART)).toBe(true);
    expect(isCartState({ lines: [], promoCode: null, updatedAt: FIXED_NOW })).toBe(true);
  });

  it.each(MALFORMED_LINES)("rejects a line whose %s is unusable", (_field, bad) => {
    expect(isCartLine(bad)).toBe(false);
  });

  it("repairs a stored cart whose line outgrew its ceiling, and refuses what is not one", () => {
    const stale: Cart = {
      version: STORAGE_VERSION,
      lines: [{ ...SEED_LINE, quantity: 9, maxQuantity: 4 }],
      promoCode: "  ",
      currency: DEFAULT_CURRENCY,
      updatedAt: FIXED_NOW,
    };
    const state = fromCart(stale);

    expect(state.lines[0]).toMatchObject({ quantity: 4, maxQuantity: 4 });
    expect(state.promoCode).toBeNull();
    expect(state.updatedAt).toBe(FIXED_NOW);
    // One unusable line rejects the state it sits in; so does a state of the wrong shape.
    const unusable = { lines: [{ ...SEED_LINE, quantity: 1.5 }], updatedAt: FIXED_NOW };
    expect(isCartState(unusable)).toBe(false);
    expect(isCartState({ lines: [], promoCode: 7, updatedAt: FIXED_NOW })).toBe(false);
    expect(isCartState({ lines: [], promoCode: null, updatedAt: "2025-13-45" })).toBe(false);
    expect(isCartState(null)).toBe(false);
    expect(isCartState("cart")).toBe(false);
    // A value that is not an object at all is not a line either.
    expect(isCartLine(null)).toBe(false);
    expect(isCartLine("line_prod")).toBe(false);
  });
});

describe("checkout step machine", () => {
  it("walks the form steps in one ordered sequence, ending at the confirmation", () => {
    expect(CHECKOUT_STEP_SEQUENCE).toEqual(["shipping", "payment", "review", "confirmation"]);
    expect(CHECKOUT_FORM_STEPS).toEqual(["shipping", "payment", "review"]);
    CHECKOUT_STEP_SEQUENCE.forEach((step, index) => {
      expect(stepIndex(step)).toBe(index);
      expect(isFinalFormStep(step)).toBe(step === "review");
    });
    // The step indicator reaches an earlier step directly; the current one changes nothing.
    expect(checkoutReducer(REVIEWING_CHECKOUT, checkoutActions.setStep("payment")).step).toBe(
      "payment",
    );
    expect(checkoutReducer(FRESH_CHECKOUT, checkoutActions.setStep("shipping"))).toBe(
      FRESH_CHECKOUT,
    );
  });

  it.each(REFUSED_DIRECT_MOVES)("refuses a direct move that is not a return", (state, step) => {
    expect(checkoutReducer(state, checkoutActions.setStep(step))).toBe(state);
  });

  it.each(STEP_MOVES)("moves $step to $next, and back to $previous", ({ step, next, previous }) => {
    expect(nextStep(step)).toBe(next);
    expect(previousStep(step)).toBe(previous);
  });

  it("keeps the entered values when the shopper moves forward and back", () => {
    const advanced = checkoutReducer(FILLED_CHECKOUT, NEXT);
    const returned = checkoutReducer(advanced, checkoutActions.back());

    expect(advanced.step).toBe("payment");
    expect(returned.step).toBe("shipping");
    expect(returned.values).toBe(FILLED_CHECKOUT.values);
    expect(returned.values.shipping).toMatchObject({ fullName: "Dana Okafor", city: "Portland" });
    // A step's complaints block the move until they are cleared, and the flow never leaves its end.
    expect(canAdvanceFrom("shipping", {})).toBe(true);
    expect(canAdvanceFrom("review", makeFieldErrors())).toBe(false);
    expect(canAdvanceFrom("confirmation", {})).toBe(false);
  });
});

describe("checkout values and errors", () => {
  it("merges a patch into its own group and leaves the others as they were", () => {
    const patch = checkoutActions.updateValues({ payment: { cvc: "123" } });
    const patched = checkoutReducer(FILLED_CHECKOUT, patch);

    expect(patched.values.payment.cvc).toBe("123");
    expect(patched.values.payment.number).toBe("");
    expect(patched.values.shipping).toBe(FILLED_CHECKOUT.values.shipping);
    expect(patched.values.contact).toBe(FILLED_CHECKOUT.values.contact);
    // A patch naming no field changes nothing, at any depth, so the state keeps its own reference.
    for (const values of [{}, { shipping: {} }, { contact: {} }, { shipping: { billing: {} } }]) {
      expect(checkoutReducer(FILLED_CHECKOUT, checkoutActions.updateValues(values))).toBe(
        FILLED_CHECKOUT,
      );
    }
    // The priced cart the buyer reviewed is held whole, so an order is built from what they saw.
    const snapshot = makePricedCart({ lines: [makeCartLine({ quantity: 2 })] });
    const held = checkoutReducer(FRESH_CHECKOUT, checkoutActions.setSnapshot(snapshot));
    expect(held.snapshot).toBe(snapshot);
    expect(Number.isInteger(held.snapshot?.grandTotalMinor)).toBe(true);
    expect(checkoutReducer(held, checkoutActions.setSnapshot(null)).snapshot).toBeNull();
  });

  it("merges a nested billing patch and clears the error it names there", () => {
    const patch = checkoutActions.updateValues({ shipping: { billing: { postalCode: "97201" } } });
    const failed = checkoutReducer(
      FILLED_CHECKOUT,
      checkoutActions.setErrors({ "billing.postalCode": "Enter a postal code." }),
    );
    const corrected = checkoutReducer(failed, patch);
    // A real field merges into the billing address, keeps the flat fields, and clears its error.
    expect(corrected.values.shipping.billing).toMatchObject({ postalCode: "97201", city: "" });
    expect(corrected.values.shipping.fullName).toBe("Dana Okafor");
    expect(corrected.errors).toEqual({});
  });

  it("stores a field-keyed error map and empties it again", () => {
    const errors = { fullName: "Enter the full name.", postalCode: "Enter a postal code." };
    const failed = checkoutReducer(FRESH_CHECKOUT, checkoutActions.setErrors(errors));
    expect(failed.errors).toEqual(errors);
    expect(checkoutReducer(failed, checkoutActions.setErrors({ ...errors }))).toBe(failed);
    expect(checkoutReducer(failed, checkoutActions.clearErrors()).errors).toEqual({});
    expect(checkoutReducer(FRESH_CHECKOUT, checkoutActions.clearErrors())).toBe(FRESH_CHECKOUT);
  });

  it("clears the error of the field the shopper corrected, under either spelling", () => {
    const two = { fullName: "Enter the full name.", email: "Enter an email." };
    const failed = checkoutReducer(FRESH_CHECKOUT, checkoutActions.setErrors(two));
    const corrected = checkoutReducer(failed, editShipping({ fullName: "Dana Okafor" }));
    const cityError = { "shipping.city": "Enter a city." };
    const qualified = checkoutReducer(FRESH_CHECKOUT, checkoutActions.setErrors(cityError));
    const requalified = checkoutReducer(qualified, editShipping({ city: "Portland" }));
    // Correcting one control silences its own complaint and leaves the one beside it standing.
    expect(corrected.errors).toEqual({ email: "Enter an email." });
    expect(requalified.errors).toEqual({});
  });
});

describe("checkout submission", () => {
  it("takes one submission at a time, and only from the review step", () => {
    const submitting = startSubmission(REVIEWING_CHECKOUT);
    expect(submitting).toMatchObject({ submitting: true, status: "loading", error: null });
    expect(submitting.idempotencyKey).toBe("idem-1");
    // A second start is refused while the first is in flight, so the key the attempt carries holds.
    expect(startSubmission(submitting, "idem-2")).toBe(submitting);
    expect(startSubmission(FRESH_CHECKOUT)).toBe(FRESH_CHECKOUT);
    expect(startSubmission(FILLED_CHECKOUT)).toBe(FILLED_CHECKOUT);
  });

  it("records the placed order, then keeps the confirmation terminal until a reset", () => {
    const order = makeOrder();
    const started = startSubmission(REVIEWING_CHECKOUT);
    const placed = checkoutReducer(started, checkoutActions.submitSucceeded(order));

    expect(placed.step).toBe("confirmation");
    expect(placed).toMatchObject({ status: "success", submitting: false, error: null, order });
    expect(placed.submittedAt).toBe(order.placedAt);
    expect(Object.values(placed.values.payment).every((value) => value === "")).toBe(true);
    // Moving back from a placed order would invite a second submission of the order already placed.
    expect(checkoutReducer(placed, NEXT)).toBe(placed);
    expect(checkoutReducer(placed, checkoutActions.back())).toBe(placed);
    const reset = checkoutReducer(placed, checkoutActions.reset("idem-2"));
    expect(reset).toEqual(createInitialCheckoutState({ idempotencyKey: "idem-2" }));
    expect(reset).toMatchObject({ step: "shipping", order: null, submittedAt: null });
  });

  it("releases the guard after a failure, keeping the values and the key for the retry", () => {
    const failure = makeApiError({ status: 402, code: "card-declined", field: "cvc" });
    const named = { number: "Enter the card number." };
    const started = startSubmission(REVIEWING_CHECKOUT);
    const failed = checkoutReducer(started, checkoutActions.submitFailed(failure, named));

    expect(failed).toMatchObject({ status: "error", submitting: false });
    expect(failed.error?.code).toBe("card-declined");
    // The failure's own field and the map beside it both mark their controls.
    expect(failed.errors["number"]).toBe("Enter the card number.");
    expect(failed.errors["cvc"]).toBe(failure.message);
    expect(failed.values.shipping.fullName).toBe("Dana Okafor");
    expect(failed.idempotencyKey).toBe("idem-1");
    // The retry is accepted again, and it sends the same key so a placed order cannot double.
    expect(startSubmission(failed)).toMatchObject({ submitting: true, error: null });
  });

  it("leaves an emptied cart to the cart reducer, which the checkout dispatches on success", () => {
    // The checkout holds no cart lines of its own: clearing the cart is the cart reducer's own
    // transition, so an empty cart after a placed order can only have come from the cart state.
    const placed = placeOrder(startSubmission(REVIEWING_CHECKOUT));
    const cleared = cartReducer(ONE_LINE_CART, cartActions.clear(FIXED_NOW));
    expect(placed).not.toHaveProperty("lines");
    expect(cleared.lines).toEqual([]);
    expect(cleared.promoCode).toBeNull();
  });
});

describe("the cart's persistence seam", () => {
  // `src/state/cartReducer.ts` imports no storage module by design and the cart's persistence lives
  // in `src/state/CartContext.tsx`, a React file this node test cannot render, so the contract the
  // cart persists through is asserted here against the module that owns it.
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let storage: typeof import("@/utils/storage");
  let entries: Map<string, string>;
  let store: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  let refuseWrites: () => void;

  beforeEach(async () => {
    // The availability probe answers once per module instance, so every case gets its own instance.
    vi.resetModules();
    storage = await import("@/utils/storage");
    entries = new Map<string, string>();
    ({ store, refuseWrites } = createStore(entries));
    installStore(store);
  });

  afterEach(() => {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "localStorage");
    } else {
      Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    }
  });

  it("writes a cart in the versioned envelope, and falls back on a value its guard rejects", () => {
    const state = createInitialCartState({
      lines: makeCartWithLines(2).lines,
      promoCode: "SAVE10",
      updatedAt: FIXED_NOW,
    });
    entries.set("someone-else.key", "kept");

    expect(storage.isStorageAvailable()).toBe(true);
    expect(storage.writeStored(STORAGE_KEYS.CART, toCart(state))).toBe(true);
    expect(storage.hasStored(STORAGE_KEYS.CART)).toBe(true);
    expect(storage.getStoredVersion(STORAGE_KEYS.CART)).toBe(STORAGE_VERSION);
    const stored = storage.readStored<Cart | null>(STORAGE_KEYS.CART, null);
    expect(stored === null ? null : fromCart(stored)).toEqual(state);

    storage.removeStored(STORAGE_KEYS.CART);
    expect(storage.hasStored(STORAGE_KEYS.CART)).toBe(false);
    expect(storage.getStoredVersion(STORAGE_KEYS.CART)).toBeUndefined();
    expect(storage.readStored(STORAGE_KEYS.CART, "none")).toBe("none");
    // Only the product's own keys are dropped; another application's entry on the origin stays.
    expect(storage.writeStored(STORAGE_KEYS.SESSION, "ses_demo")).toBe(true);
    storage.clearStoredKeys();
    expect(entries.has("someone-else.key")).toBe(true);
    expect(storage.hasStored(STORAGE_KEYS.SESSION)).toBe(false);
    // A payload the caller's guard rejects is a fallback, not a partly decoded value.
    const wrong = { ...createInitialCartState({ updatedAt: FIXED_NOW }), promoCode: 7 };
    expect(storage.writeStored(STORAGE_KEYS.CART, wrong)).toBe(true);
    expect(storage.readStored<CartState | null>(STORAGE_KEYS.CART, null, isCartState)).toBeNull();
  });

  it("discards a payload another writer left or a write it could not perform", () => {
    const stale = { version: STORAGE_VERSION + 1, value: makeCart() };
    entries.set(STORAGE_KEYS.CART, JSON.stringify(stale));
    entries.set(STORAGE_KEYS.SESSION, "{not json");
    entries.set(STORAGE_KEYS.REPORT_RANGE, JSON.stringify([1, 2, 3]));

    expect(storage.getStoredVersion(STORAGE_KEYS.CART)).toBe(STORAGE_VERSION + 1);
    expect(storage.hasStored(STORAGE_KEYS.CART)).toBe(false);
    expect(storage.readStored(STORAGE_KEYS.CART, "none")).toBe("none");
    expect(storage.readStored(STORAGE_KEYS.SESSION, "none")).toBe("none");
    expect(storage.getStoredVersion(STORAGE_KEYS.REPORT_RANGE)).toBeUndefined();

    // A value that cannot be serialised, and a store that refuses the write, both report failure.
    const state = createInitialCartState({ lines: [SEED_LINE], updatedAt: FIXED_NOW });
    expect(storage.writeStored(STORAGE_KEYS.CART, state)).toBe(true);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(storage.writeStored(STORAGE_KEYS.CART, cyclic)).toBe(false);
    refuseWrites();
    const empty = createInitialCartState({ updatedAt: FIXED_NOW });
    expect(storage.writeStored(STORAGE_KEYS.CART, empty)).toBe(false);
    // The refused write left the value the key already held exactly as it was.
    expect(storage.readStored(STORAGE_KEYS.CART, null, isCartState)).toEqual(state);
  });

  it("degrades to its fallbacks where no store can be reached", () => {
    const fallback = createInitialCartState({ updatedAt: FIXED_NOW });
    Reflect.deleteProperty(globalThis, "localStorage");

    expect(storage.isStorageAvailable()).toBe(false);
    expect(storage.writeStored(STORAGE_KEYS.CART, fallback)).toBe(false);
    expect(storage.readStored(STORAGE_KEYS.CART, fallback)).toBe(fallback);
    expect(storage.getStoredVersion(STORAGE_KEYS.CART)).toBeUndefined();
    expect(() => storage.clearStoredKeys()).not.toThrow();

    // A profile that throws on access rather than on a call is answered the same way.
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage is blocked.", "SecurityError");
      },
    });

    expect(storage.isStorageAvailable()).toBe(false);
    expect(storage.readStored(STORAGE_KEYS.SESSION, "none")).toBe("none");
    expect(storage.writeStored(STORAGE_KEYS.SESSION, "ses_demo")).toBe(false);
    expect(storage.hasStored(STORAGE_KEYS.SESSION)).toBe(false);
    expect(() => storage.removeStored(STORAGE_KEYS.SESSION)).not.toThrow();
  });
});
