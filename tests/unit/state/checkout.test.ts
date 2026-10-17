/**
 * Path: tests/unit/state/checkout.test.ts
 * Purpose: Checkout transitions: the step machine, value and error patches, and the submission guards
 * Lines: 241
 */

import { describe, expect, it } from "vitest";

import { cartActions, cartReducer, createInitialCartState } from "@/state/cartReducer";
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
  makeCartLine,
  makeFieldErrors,
  makeOrder,
  makePricedCart,
} from "../../fixtures";

import type { CartState } from "@/state/cartReducer";
import type { CheckoutState, CheckoutStep } from "@/state/checkoutReducer";

// The checkout reducer and its actions are pure: every case calls one directly.

const NEXT = checkoutActions.next();
/** The one line the success case clears, built the way the cart's own add action builds it. */
const ONE_LINE_CART: CartState = cartReducer(
  createInitialCartState({ updatedAt: FIXED_NOW }),
  cartActions.add(makeCartLine({ quantity: 1 })),
);
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
