/**
 * Path: src/state/checkoutReducer.ts
 * Purpose: Checkout step transitions, validation errors, submission and success
 * Lines: 574
 */

import { hasErrors } from "@/utils/validation";
import type { AddressInput } from "@/types/account";
import type { Order, PricedCart } from "@/types/commerce";
import type {
  AddressId,
  ApiError,
  AsyncStatus,
  FieldErrors,
  IsoDateTimeString,
} from "@/types/common";

// Steps ----------------------------------------------------------------------------------------

/**
 * Where a shopper stands: the three steps that own a form, plus the confirmation a placed order
 * leads to. A union rather than booleans, because booleans reach states that cannot happen — paid
 * but not reviewed, reviewed but still at shipping — and every transition below is total over it.
 */
export type CheckoutStep = "shipping" | "payment" | "review" | "confirmation";

/**
 * The steps that own a form, in order: what the step indicator renders as reachable, and whose
 * validators the checkout context runs before advancing. Their labels come from
 * `src/constants/content.ts`.
 */
export const CHECKOUT_FORM_STEPS = ["shipping", "payment", "review"] as const;

/** Every step in the order the checkout walks them; `stepIndex` reads this same order. */
export const CHECKOUT_STEP_SEQUENCE: readonly CheckoutStep[] = [
  "shipping",
  "payment",
  "review",
  "confirmation",
];

// Values ---------------------------------------------------------------------------------------

/** The address an order confirms to: prefilled from the session, or typed by a guest. */
export interface CheckoutContactValues {
  readonly email: string;
}

/**
 * Where the order goes and how it travels. The address members carry `AddressInput`'s names — the
 * names `src/utils/validation.ts` keys its errors by — so the shipping form binds straight to this
 * shape. `savedAddressId` names the book entry the values came from and is `null` for a typed
 * address; `shippingMethodId` is empty until one is chosen; `billing` is the separate address
 * submitted while `billingSameAsShipping` is false.
 */
export interface CheckoutShippingValues {
  readonly fullName: string;
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
  readonly country: string;
  readonly phone: string;
  readonly savedAddressId: AddressId | null;
  readonly shippingMethodId: string;
  readonly billingSameAsShipping: boolean;
  readonly billing: AddressInput;
}

/**
 * The card as the payment step holds it while the shopper types it.
 *
 * Demonstration boundary: these members live for the length of the checkout and no longer, blanked
 * when the order is placed and when the checkout resets; an order keeps only the brand, the last
 * four digits and the decision, as `PaymentSummary` describes.
 *
 * The names are `CardInput`'s, so the payment form binds directly and the card errors
 * `src/utils/validation.ts` returns are keyed by the names held here. The two expiry members hold
 * the digits as typed rather than numbers, so a half-typed or cleared field is the empty string
 * instead of `NaN`; the numeric members `CardInput` needs are built where the order is assembled.
 */
export interface CheckoutPaymentValues {
  readonly number: string;
  readonly nameOnCard: string;
  readonly expiryMonth: string;
  readonly expiryYear: string;
  readonly cvc: string;
}

/**
 * Everything entered across the steps. The groups are separate because the steps are: moving from
 * shipping to payment leaves the address exactly as it was.
 */
export interface CheckoutValues {
  readonly contact: CheckoutContactValues;
  readonly shipping: CheckoutShippingValues;
  readonly payment: CheckoutPaymentValues;
}

/** A change to the shipping group, with the billing address patchable within it. */
export type CheckoutShippingPatch = Partial<Omit<CheckoutShippingValues, "billing">> & {
  readonly billing?: Partial<AddressInput>;
};

/**
 * A change to the values, keyed by the field names the values use. Every field a patch touches has
 * its error cleared; the fields it does not touch keep theirs.
 */
export type CheckoutValuesPatch = {
  readonly contact?: Partial<CheckoutContactValues>;
  readonly shipping?: CheckoutShippingPatch;
  readonly payment?: Partial<CheckoutPaymentValues>;
};

// State ----------------------------------------------------------------------------------------

/**
 * The checkout's whole state: where the shopper is, what they entered, what is wrong with it, and
 * what became of the submission.
 *
 * Cart lines are deliberately absent — the cart owns them, and completion hands the cleared cart
 * back to the cart reducer — while `snapshot` carries the priced cart the buyer reviewed, which is
 * what an order is built from.
 *
 * `submitting` is the single-submission guard: `submit-started` is refused while it is set, and
 * `idempotencyKey` is the stronger guard behind it — minted once by the caller, kept across a
 * failed attempt and sent again on the retry, so an attempt that did reach the server replays the
 * order it created instead of placing a second.
 */
export interface CheckoutState {
  readonly step: CheckoutStep;
  readonly values: CheckoutValues;
  readonly errors: FieldErrors;
  readonly status: AsyncStatus;
  readonly submitting: boolean;
  readonly error: ApiError | null;
  readonly order: Order | null;
  readonly snapshot: PricedCart | null;
  readonly idempotencyKey: string;
  readonly submittedAt: IsoDateTimeString | null;
}

/** An empty address in `AddressInput`'s members: what billing holds before anything is typed. */
const EMPTY_ADDRESS_INPUT: AddressInput = {
  label: "",
  fullName: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
  phone: "",
};

/** An empty shipping group: nothing typed, no saved address adopted, no method chosen. */
const EMPTY_SHIPPING_VALUES: CheckoutShippingValues = {
  fullName: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
  phone: "",
  savedAddressId: null,
  shippingMethodId: "",
  billingSameAsShipping: true,
  billing: EMPTY_ADDRESS_INPUT,
};

/**
 * An empty payment group, shared by the factory and by the transition that blanks the card, so
 * "the card is gone" has one definition rather than two.
 */
const EMPTY_PAYMENT_VALUES: CheckoutPaymentValues = {
  number: "",
  nameOnCard: "",
  expiryMonth: "",
  expiryYear: "",
  cvc: "",
};

/**
 * The state a fresh checkout starts in: the shipping step, nothing entered but the email the
 * caller already knows, no errors and no order.
 *
 * The idempotency key arrives from the caller — the checkout context asks
 * `src/lib/orderService.ts` for it — which keeps this module independent of the data layer, free of
 * the clock and randomness a generated key would need, and deterministic under test.
 */
export function createInitialCheckoutState(input: {
  readonly idempotencyKey: string;
  readonly email?: string;
}): CheckoutState {
  return {
    step: "shipping",
    values: {
      contact: { email: input.email ?? "" },
      shipping: EMPTY_SHIPPING_VALUES,
      payment: EMPTY_PAYMENT_VALUES,
    },
    errors: {},
    status: "idle",
    submitting: false,
    error: null,
    order: null,
    snapshot: null,
    idempotencyKey: input.idempotencyKey,
    submittedAt: null,
  };
}

// Actions --------------------------------------------------------------------------------------

/**
 * Every transition the checkout can make, as one discriminated union. Naming each transition
 * rather than exposing setters is what keeps the flow's rules here: a second submission and an
 * advance past the review step are decisions this module makes, so a caller cannot bypass them by
 * writing the state it wants.
 */
export type CheckoutAction =
  | { readonly type: "checkout/set-step"; readonly step: CheckoutStep }
  | { readonly type: "checkout/next" }
  | { readonly type: "checkout/back" }
  | { readonly type: "checkout/update-values"; readonly values: CheckoutValuesPatch }
  | { readonly type: "checkout/set-errors"; readonly errors: FieldErrors }
  | { readonly type: "checkout/clear-errors" }
  | { readonly type: "checkout/set-snapshot"; readonly snapshot: PricedCart | null }
  | { readonly type: "checkout/submit-started"; readonly idempotencyKey: string }
  | { readonly type: "checkout/submit-succeeded"; readonly order: Order }
  | {
      readonly type: "checkout/submit-failed";
      readonly error: ApiError;
      /** Field-keyed complaints the failure named, merged over the stored ones. */
      readonly errors?: FieldErrors;
    }
  | { readonly type: "checkout/reset"; readonly idempotencyKey: string };

/**
 * A creator for every action, defined once at module scope so a holder can keep one in a
 * dependency list without its identity changing between renders.
 */
export const checkoutActions = {
  /**
   * Returns to a step already completed, as the step indicator's earlier form steps do, keeping
   * every group of values as it was entered. Forward movement is `next`, which the checkout context
   * gates on `canAdvanceFrom` after the step's validators have run, and the confirmation cannot be
   * left, because the only thing waiting there is a second submission of the order already placed.
   */
  setStep: (step: CheckoutStep): CheckoutAction => ({ type: "checkout/set-step", step }),
  next: (): CheckoutAction => ({ type: "checkout/next" }),
  back: (): CheckoutAction => ({ type: "checkout/back" }),
  /** Writes a patch's fields and clears the error of each field it touched. */
  updateValues: (values: CheckoutValuesPatch): CheckoutAction => ({
    type: "checkout/update-values",
    values,
  }),
  setErrors: (errors: FieldErrors): CheckoutAction => ({ type: "checkout/set-errors", errors }),
  clearErrors: (): CheckoutAction => ({ type: "checkout/clear-errors" }),
  setSnapshot: (snapshot: PricedCart | null): CheckoutAction => ({
    type: "checkout/set-snapshot",
    snapshot,
  }),
  /** Begins the submission, carrying the key a repeat must send with it. */
  submitStarted: (idempotencyKey: string): CheckoutAction => ({
    type: "checkout/submit-started",
    idempotencyKey,
  }),
  /** Records the placed order and moves to the confirmation. */
  submitSucceeded: (order: Order): CheckoutAction => ({ type: "checkout/submit-succeeded", order }),
  /** Records a failure, with any field-keyed errors the response named alongside it. */
  submitFailed: (error: ApiError, errors?: FieldErrors): CheckoutAction =>
    errors === undefined
      ? { type: "checkout/submit-failed", error }
      : { type: "checkout/submit-failed", error, errors },
  /** Starts the checkout again at its first step, with a fresh idempotency key. */
  reset: (idempotencyKey: string): CheckoutAction => ({ type: "checkout/reset", idempotencyKey }),
};

// Reducer --------------------------------------------------------------------------------------

/**
 * Applies one transition, returning the state itself when the action changes nothing. The
 * reference is kept on a no-op deliberately: the checkout context's value is memoised, so a fresh
 * object for an action that changed nothing — a second `submit-started`, an advance pressed twice
 * on the review step — would re-render every consumer of the checkout for nothing.
 *
 * The reducer is pure: no clock, no randomness, no storage and no request. A submission begins and
 * ends through actions the checkout context dispatches around its own call to
 * `src/lib/orderService.ts`.
 */
export function checkoutReducer(state: CheckoutState, action: CheckoutAction): CheckoutState {
  switch (action.type) {
    case "checkout/set-step": {
      // The direct move is the step indicator's return path to an earlier form step. Anything else
      // returns the state itself rather than jumping into a step whose validation never ran, or
      // back into the flow from a placed order: forward movement is `next`, which the checkout
      // context has already gated on `canAdvanceFrom` by the time it is dispatched.
      return isReturnStep(state.step, action.step) ? { ...state, step: action.step } : state;
    }

    case "checkout/next": {
      // Validation is the context's call: it runs the step's validators and dispatches `set-errors`
      // instead of this action when the step is not ready to be left.
      const step = nextStep(state.step);
      return step === state.step ? state : { ...state, step };
    }

    case "checkout/back": {
      const step = previousStep(state.step);
      return step === state.step ? state : { ...state, step };
    }

    case "checkout/update-values": {
      return applyValuesPatch(state, action.values);
    }

    case "checkout/set-errors": {
      return areSameErrors(state.errors, action.errors)
        ? state
        : { ...state, errors: action.errors };
    }

    case "checkout/clear-errors": {
      return hasErrors(state.errors) ? { ...state, errors: {} } : state;
    }

    case "checkout/set-snapshot": {
      return action.snapshot === state.snapshot ? state : { ...state, snapshot: action.snapshot };
    }

    case "checkout/submit-started": {
      // The single-submission guard, and the reason a submission begins only where the buyer has
      // reviewed the order: begun anywhere else it would place an order nobody confirmed.
      if (state.submitting || !isFinalFormStep(state.step)) {
        return state;
      }
      return {
        ...state,
        status: "loading",
        submitting: true,
        error: null,
        idempotencyKey: action.idempotencyKey,
      };
    }

    case "checkout/submit-succeeded": {
      return {
        ...state,
        step: "confirmation",
        status: "success",
        submitting: false,
        error: null,
        order: action.order,
        values: { ...state.values, payment: EMPTY_PAYMENT_VALUES },
        // The placed order's own instant, so this reducer reads no clock of its own.
        submittedAt: action.order.placedAt,
      };
    }

    case "checkout/submit-failed": {
      // `idempotencyKey` is left untouched: the retry sends the same key, so an attempt that did
      // reach the server replays the order it created rather than placing a second.
      return {
        ...state,
        status: "error",
        submitting: false,
        error: action.error,
        errors: withFailureErrors(state.errors, action.error, action.errors),
      };
    }

    case "checkout/reset": {
      return createInitialCheckoutState({ idempotencyKey: action.idempotencyKey });
    }

    default: {
      return assertNever(action);
    }
  }
}

// Step helpers ---------------------------------------------------------------------------------

/** The position of a step in the checkout's order, counting from zero. */
export function stepIndex(step: CheckoutStep): number {
  return CHECKOUT_STEP_SEQUENCE.findIndex((candidate) => candidate === step);
}

/**
 * The step a forward move reaches. It stops at the review step, because the submission is an
 * explicit action of its own rather than something an advance can trigger, and the confirmation is
 * terminal because the order it reports is already placed.
 */
export function nextStep(step: CheckoutStep): CheckoutStep {
  switch (step) {
    case "shipping":
      return "payment";
    case "payment":
      return "review";
    default:
      return step;
  }
}

/**
 * The step a backward move reaches. It stops at the shipping step — the cart is a page outside the
 * checkout, reached by the link the step renders rather than by this transition — and the
 * confirmation is terminal, since moving back to the review step would invite a second submission
 * of an order already placed.
 */
export function previousStep(step: CheckoutStep): CheckoutStep {
  switch (step) {
    case "payment":
      return "shipping";
    case "review":
      return "payment";
    default:
      return step;
  }
}

/** Whether `step` is the last step that owns a form, where the next move is the submission. */
export function isFinalFormStep(step: CheckoutStep): boolean {
  return step === "review";
}

/**
 * Whether the shopper may leave `step` for the next one. Validation belongs to
 * `src/utils/validation.ts` and the checkout context runs it, so this only reads the map that came
 * back: any complaint blocks the move, and the confirmation can never be advanced because the flow
 * has already ended there.
 */
export function canAdvanceFrom(step: CheckoutStep, errors: FieldErrors): boolean {
  if (step === "confirmation") {
    return false;
  }
  return !hasErrors(errors);
}

// Internal helpers ------------------------------------------------------------------------------

/**
 * Whether a direct move from `from` to `to` is the return transition the step indicator takes: both
 * ends must be steps that own a form — so the confirmation, which is reached by a submission and
 * left by nothing, is excluded at both ends — and the target must sit earlier in the sequence than
 * the current step. Every other pair is refused by the caller, which is what keeps a forward jump
 * and a move out of a placed order out of the flow rather than in whichever component dispatches it.
 */
function isReturnStep(from: CheckoutStep, to: CheckoutStep): boolean {
  return (
    CHECKOUT_FORM_STEPS.some((formStep) => formStep === from) &&
    CHECKOUT_FORM_STEPS.some((formStep) => formStep === to) &&
    stepIndex(to) < stepIndex(from)
  );
}

/** Proof at compile time that every action was handled: a new member fails to type-check here. */
function assertNever(value: never): never {
  throw new Error(`Unhandled checkout action: ${JSON.stringify(value)}`);
}

/** Shallow comparison, so an identical map arriving again keeps its identity. */
function areSameErrors(current: FieldErrors, next: FieldErrors): boolean {
  const currentKeys = Object.keys(current);
  return (
    currentKeys.length === Object.keys(next).length &&
    currentKeys.every((key) => current[key] === next[key])
  );
}

/** A group the patch does not name comes back as it was, so nothing reading it sees a new object. */
function mergeGroup<TGroup extends object>(
  current: TGroup,
  patch: Partial<TGroup> | undefined,
): TGroup {
  return patch === undefined ? current : { ...current, ...patch };
}

/**
 * The values with a patch applied and the error of every field it touched cleared. What the patch
 * touches is {@link touchedFields}' answer, read once here: a patch that names no field — `{}`, or
 * a group with no key inside it — changes nothing and comes back as the state it was handed.
 */
function applyValuesPatch(state: CheckoutState, patch: CheckoutValuesPatch): CheckoutState {
  const touched = touchedFields(patch);
  if (touched.size === 0) {
    return state;
  }
  const { contact, shipping, payment } = patch;
  const { billing, ...shippingFields } = shipping ?? {};
  const values: CheckoutValues = {
    contact: mergeGroup(state.values.contact, contact),
    payment: mergeGroup(state.values.payment, payment),
    shipping:
      shipping === undefined
        ? state.values.shipping
        : {
            ...state.values.shipping,
            ...shippingFields,
            billing: mergeGroup(state.values.shipping.billing, billing),
          },
  };
  return { ...state, values, errors: clearErrorsFor(state.errors, touched) };
}

/**
 * The field names a patch carries: for every field it names in `contact`, `payment` and `shipping`
 * — the shipping group's billing patch included, under the group name it is patched by — the bare
 * member name and the name qualified by the group it sits in. Empty exactly when the patch names no
 * field, which is the one answer both the values merge above and the error clearing below read, so a
 * patch like `{ shipping: {} }` cannot mean one thing to one of them and another to the other.
 */
function touchedFields(patch: CheckoutValuesPatch): ReadonlySet<string> {
  const touched = new Set<string>();
  const addKeys = (group: string, fields: object): void => {
    for (const name of Object.keys(fields)) {
      touched.add(name);
      touched.add(`${group}.${name}`);
    }
  };
  addKeys("contact", patch.contact ?? {});
  const shipping = patch.shipping;
  if (shipping !== undefined) {
    const { billing, ...shippingFields } = shipping;
    addKeys("shipping", shippingFields);
    addKeys("billing", billing ?? {});
  }
  addKeys("payment", patch.payment ?? {});
  return touched;
}

/**
 * The stored errors plus whatever a failure named: the `field` an `ApiError` carries marks its own
 * control with the failure's message, and a map passed beside it is merged over the top, so a
 * validation response naming several fields marks all of them.
 */
function withFailureErrors(
  errors: FieldErrors,
  failure: ApiError,
  extra: FieldErrors | undefined,
): FieldErrors {
  const merged: FieldErrors = { ...errors, ...extra };
  if (failure.field !== undefined) {
    merged[failure.field] = failure.message;
  }
  return merged;
}

/**
 * The error map with the error of every field the patch named removed and every other error left
 * where it was: a shopper who has just typed into a field must not be left reading the complaint
 * about the value they replaced.
 *
 * `touched` is the set {@link touchedFields} read from the patch. A field is cleared under both
 * spellings a validator might key it by — the bare member name, and the name qualified by the group
 * it sits in — while a field the patch does not name keeps its error, so correcting one control
 * cannot silence the complaint about another. An error map from which nothing was cleared keeps its
 * own reference.
 */
function clearErrorsFor(errors: FieldErrors, touched: ReadonlySet<string>): FieldErrors {
  const next: FieldErrors = {};
  let cleared = false;
  for (const [key, message] of Object.entries(errors)) {
    if (touched.has(key)) {
      cleared = true;
    } else {
      next[key] = message;
    }
  }
  return cleared ? next : errors;
}
