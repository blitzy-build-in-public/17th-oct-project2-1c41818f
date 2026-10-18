/**
 * Path: src/state/CheckoutContext.tsx
 * Purpose: The checkout step machine, its entered values, submission state and error map
 * Lines: 590
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { flushSync } from "react-dom";

import { toRejectionError } from "@/lib/apiClient";
import { buildOrderInput, createIdempotencyKey, createOrder } from "@/lib/orderService";
import type { OrderContact } from "@/lib/orderService";
import { priceCart } from "@/lib/pricingService";
import { useAuth } from "@/state/AuthContext";
import { useCart, useCartDispatch } from "@/state/CartContext";
import {
  checkoutActions,
  checkoutReducer,
  createInitialCheckoutState,
} from "@/state/checkoutReducer";
import type {
  CheckoutPaymentValues,
  CheckoutShippingValues,
  CheckoutState,
  CheckoutStep,
  CheckoutValues,
  CheckoutValuesPatch,
} from "@/state/checkoutReducer";
import type { Address, AddressInput } from "@/types/account";
import type { Order, PaymentInput, PricedCart } from "@/types/commerce";
import type { AddressId, ApiError, AsyncStatus, FieldErrors } from "@/types/common";
import { isAbortError } from "@/utils/async";
import {
  fieldErrorsFromApiError,
  hasErrors,
  mergeErrors,
  validateAddress,
  validatePayment,
  validateShippingSubmission,
} from "@/utils/validation";

// Consumer surface ------------------------------------------------------------------------------

/**
 * What a consumer reads from the checkout.
 *
 * Every member is a fact the flow holds — where the shopper is, what they entered, what became of the
 * submission — or something derived from those during render and never stored, because a copy of an
 * answer is a second answer that drifts from the first.
 *
 * The two statuses describe two requests: `status` is the submission's and `pricingStatus` is the price
 * request's, which runs again whenever the basket or the delivery method changes. Between them a page
 * has what all four of its states need — a skeleton, an empty state, the error state with its retry,
 * and the loaded flow.
 */
export interface CheckoutView {
  /** The step in force: the three that own a form, then the confirmation a placed order leads to. */
  readonly step: CheckoutStep;
  /** Everything entered across the steps, grouped as the steps are. */
  readonly values: CheckoutValues;
  /** What is wrong with those values, keyed by the field each message belongs to. */
  readonly errors: FieldErrors;
  /** How many advances this flow has refused: each attempt its step's validators sent back, counted as the
   *  attempt happened. The value changes on every refusal, which is what lets the step's summary claim the
   *  keyboard every time a step is sent with faults and not only the first time — the error map alone is
   *  identical between two refusals of the same faults, so it cannot say that a second one occurred. */
  readonly refusals: number;
  /** Where the submission stands. */
  readonly status: AsyncStatus;
  /** Whether a submission is in flight: the half of the double-submission guard a control reads. */
  readonly isSubmitting: boolean;
  /** The failure the last submission answered with, kept while the review step offers its retry. */
  readonly error: ApiError | null;
  /** The order the submission placed, held so the confirmation renders without a second read. */
  readonly order: Order | null;
  /** The priced cart the buyer reviewed, as `src/lib/pricingService.ts` produced it: the snapshot an
   *  order is built from, and the figures the review step and the summary panel restate. */
  readonly snapshot: PricedCart | null;
  /** Where the price request stands. */
  readonly pricingStatus: AsyncStatus;
  /** The failure the last price request answered with, or `null`. */
  readonly pricingError: ApiError | null;
  /** Whether the submission may start from here, computed during render: the review step, a priced
   *  basket holding at least one line, nothing in flight and no order already placed. */
  readonly canSubmit: boolean;
  /** Whether this flow has placed an order, computed during render. */
  readonly isOrderPlaced: boolean;
}

/**
 * Every change the checkout accepts, one member each, stable for the life of the provider.
 *
 * Naming the changes rather than exposing a reducer's `dispatch` keeps the flow's rules out of the
 * components: `next` runs the step's validators, `submit` decides whether an attempt may start, and
 * `reset` mints the key a fresh attempt is submitted under. Each member is a `useCallback` over stable
 * inputs and the object holding them is memoised, so a control that only ever drives the flow is not
 * re-rendered when a value it does not read changes. `submit` resolves rather than rejecting, so a
 * caller needs no `try`/`catch`.
 */
export interface CheckoutActions {
  /** Returns to a step already completed, keeping every group of values exactly as it was entered. The
   *  reducer refuses anything but a return to an earlier form step, so a forward jump and a move out of
   *  a placed order are not reachable from here either. */
  setStep(step: CheckoutStep): void;
  /** Validates the step in force and moves on only when it passes.
   *
   * A step that fails has its complaints dispatched as the field-keyed errors the forms render inline
   * and the flow stays where it is; a step that passes clears what the previous attempt left first. */
  next(): void;
  /** Moves back one step, keeping every group of values exactly as it was entered. */
  back(): void;
  /** Writes a patch into the values, clearing the error of each field it names and leaving every other
   *  field's error where it was, so correcting one control does not silence a complaint about another. */
  updateValues(values: CheckoutValuesPatch): void;
  /** Places the order the flow holds and reports the outcome through the view.
   *
   * The attempt is refused while one is already in flight, while the flow is not standing on the review
   * step, and while the basket holds nothing priced. The order is built from the priced snapshot taken
   * before completion — so no price change after the request can alter what was placed — and submitted
   * under one idempotency key that a retry sends again, the guard the endpoint itself enforces. On
   * success the cart is cleared through its own actions; on failure the `ApiError` and any field it
   * named are recorded for the review step. */
  submit(): Promise<void>;
  /** Prices the basket again after a pricing failure, aborting whatever is still in flight. */
  retryPricing(): void;
  /** Starts the checkout again at its first step under a fresh idempotency key, aborting any attempt
   *  still in flight, so the checkout a shopper begins over is one no earlier attempt can finish. */
  reset(): void;
}

// Pricing state ---------------------------------------------------------------------------------

/** The lifecycle of the price request: where the last pass stands and what it answered with. */
interface PricingSnapshot {
  readonly status: AsyncStatus;
  readonly error: ApiError | null;
}

/** The three states a price request passes through, shared rather than allocated per pass: React
 *  compares state with `Object.is`, so a pass that changes nothing re-renders nobody. */
const IDLE_PRICING: PricingSnapshot = { status: "idle", error: null };
const LOADING_PRICING: PricingSnapshot = { status: "loading", error: null };
const SETTLED_PRICING: PricingSnapshot = { status: "success", error: null };

// Reading the entered values --------------------------------------------------------------------

/** The shipping values in the shape the one address rule and the order body both take. `label` is the
 *  address book's own name for an address and the checkout types none, so it travels empty. */
function addressInputOf(shipping: CheckoutShippingValues): AddressInput {
  return {
    label: "",
    fullName: shipping.fullName,
    line1: shipping.line1,
    line2: shipping.line2,
    city: shipping.city,
    region: shipping.region,
    postalCode: shipping.postalCode,
    country: shipping.country,
    phone: shipping.phone,
  };
}

/**
 * The identifier an address typed in the checkout carries: the empty string, which the order endpoint
 * reads as "no book entry". The cast is the only one in this file — a phantom brand cannot be reached by
 * an unprefixed string, and `""` is the one value that means none.
 */
const NO_ADDRESS_ENTRY = "" as AddressId;

/** One address snapshot an order keeps: the values as typed, with no default of either kind, because
 *  the two flags belong to the address book and an order is not a book entry. */
function addressSnapshot(input: AddressInput, id: AddressId | null): Address {
  return {
    id: id ?? NO_ADDRESS_ENTRY,
    ...input,
    isDefaultShipping: false,
    isDefaultBilling: false,
  };
}

/** One half of a typed expiry as the number the order body carries: the integer the digits state, or
 *  `NaN` when they state none — deliberately not `0`, which a reader could take for a real month. An
 *  unreadable expiry is one the card was already refused for, and the endpoint refuses it again. */
function expiryNumber(value: string): number {
  const digits = value.trim();
  return /^\d+$/.test(digits) ? Number.parseInt(digits, 10) : Number.NaN;
}

/** The payment the order is submitted with. The method is named here rather than carried in the values,
 *  because a card is what the payment step collects and what the demonstration seam settles. The card
 *  lives for the length of the request and nowhere else: the reducer blanks it once an order is placed,
 *  and nothing here writes it to a store, a log or a payload it keeps. */
function paymentInputOf(payment: CheckoutPaymentValues): PaymentInput {
  return {
    method: "card",
    card: {
      number: payment.number,
      nameOnCard: payment.nameOnCard,
      expiryMonth: expiryNumber(payment.expiryMonth),
      expiryYear: expiryNumber(payment.expiryYear),
      cvc: payment.cvc,
    },
  };
}

/** Everything a submission needs beside the snapshot: the contact email the order records, both address
 *  snapshots, the delivery method and the card as typed. While the billing address is the shipping
 *  address, the two travel as one snapshot, which is what an order records then. */
function orderContactOf(values: CheckoutValues): OrderContact {
  const shippingAddress = addressSnapshot(
    addressInputOf(values.shipping),
    values.shipping.savedAddressId,
  );
  return {
    email: values.contact.email,
    shippingAddress,
    billingAddress: values.shipping.billingSameAsShipping
      ? shippingAddress
      : addressSnapshot(values.shipping.billing, null),
    shippingMethodId: values.shipping.shippingMethodId,
    payment: paymentInputOf(values.payment),
  };
}

/** The address rule's complaints about the billing address, filed under the group they sit in — the
 *  qualified spelling the order endpoint keys a billing fault by and the one the values patch clears. */
function billingErrors(billing: AddressInput): FieldErrors {
  const errors: FieldErrors = {};
  for (const [member, message] of Object.entries(validateAddress(billing))) {
    errors[`billing.${member}`] = message;
  }
  return errors;
}

/**
 * What is wrong with the step being left. Each field is judged by the validator
 * `src/utils/validation.ts` exports for it — the same address rule the account's address book reuses
 * unchanged — so no rule is restated here, and the review step is empty because its submission is the
 * order rather than a form.
 */
function stepErrors(step: CheckoutStep, values: CheckoutValues): FieldErrors {
  switch (step) {
    case "shipping": {
      const shipping = validateShippingSubmission({
        address: addressInputOf(values.shipping),
        email: values.contact.email,
        shippingMethodId: values.shipping.shippingMethodId,
      });
      return values.shipping.billingSameAsShipping
        ? shipping
        : mergeErrors(shipping, billingErrors(values.shipping.billing));
    }
    case "payment":
      return validatePayment({ method: "card", card: values.payment });
    default:
      return {};
  }
}

/** The state a fresh mount starts from: the contact email the session already holds, and the key this
 *  attempt is submitted under. `useReducer` calls this once, as its lazy initialiser, so the key is read
 *  for the flow rather than for every render and the shipping step is prefilled before the first
 *  paint. */
function initialCheckoutState(email: string | null): CheckoutState {
  return createInitialCheckoutState({
    idempotencyKey: createIdempotencyKey(),
    email: email ?? "",
  });
}

// Context ---------------------------------------------------------------------------------------

/** The whole surface a consumer receives: the view, with the actions that change it beside it. */
type CheckoutValue = CheckoutView & { readonly actions: CheckoutActions };

/** The checkout, private to this module: consumers reach it through `useCheckout()`. The `null` default
 *  is the "no provider above this consumer" sentinel the hook turns into an error naming what is
 *  missing, rather than an empty flow that hides a wiring mistake. */
const CheckoutContext = createContext<CheckoutValue | null>(null);

// Provider --------------------------------------------------------------------------------------

/**
 * Holds the checkout and provides it to the checkout slice.
 *
 * The provider owns orchestration and no rule of its own: the reducer decides every transition — the
 * two guards a submission depends on included, since `submit-started` is refused while one is in flight
 * and nowhere but the review step — `src/lib/pricingService.ts` produces every figure,
 * `src/lib/orderService.ts` builds and places the order, and `src/utils/validation.ts` judges each
 * step's fields.
 *
 * Two handoffs define the flow: the order is built from the `PricedCart` snapshot the reducer holds
 * rather than from the cart again, so the amount placed is the amount reviewed; and completion
 * dispatches the cart's own clear through `useCartDispatch()` rather than touching lines here. Render it
 * inside `AuthProvider` and `CartProvider`, the nesting `src/App.tsx` composes.
 *
 * @param props.children - The subtree that may read the flow and drive it.
 * @returns The provider wrapping the subtree.
 */
export function CheckoutProvider({ children }: { children: ReactNode }): ReactElement {
  const { email: sessionEmail, session } = useAuth();
  const { lines, promoCode } = useCart();
  const cartActions = useCartDispatch();

  const [state, dispatch] = useReducer(checkoutReducer, sessionEmail, initialCheckoutState);

  /** The state the actions read, held in a ref: a callback cannot depend on the state without changing
   *  identity every time a value, a step or a submission does, and an action whose identity changes
   *  re-renders every consumer of the flow. Kept current by an effect rather than during render, so no
   *  render writes it — the arrangement `src/state/AuthContext.tsx` uses for its own actions. */
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [pricing, setPricing] = useState<PricingSnapshot>(IDLE_PRICING);
  /**
   * The refusals this flow has answered, one per advance its validators sent back. It is this provider's
   * own state rather than the reducer's, because no transition of the flow is decided by it: it exists so
   * that two refusals of one step are two distinguishable facts, and the step's summary — whose focus move
   * is keyed to the identity it reads — takes the keyboard on each of them.
   */
  const [refusals, setRefusals] = useState(0);
  // Every retry of one basket gets a token of its own, so the effect below runs again without the lines
  // having to change: that is what the pricing error state's retry needs.
  const [pricingRunToken, setPricingRunToken] = useState(0);
  // The request the last pass issued, aborted by the pass that supersedes it and by unmounting. This is
  // what bounds the pricing to one request in flight, and the signal is the one `src/lib/apiClient.ts`
  // honours, so a superseded request stops rather than merely being ignored.
  const pricingControllerRef = useRef<AbortController | null>(null);
  const shippingMethodId = state.values.shipping.shippingMethodId;

  /**
   * Prices the basket whenever it changes: the lines, the code they carry and the delivery method.
   *
   * The priced cart is the only place the flow's figures come from and the reducer holds it, because the
   * order is built from it; the status and the failure are this provider's own state, because they
   * describe a request rather than the flow.
   *
   * An empty basket is not priced — the snapshot is cleared instead, so a checkout with nothing in it
   * renders its empty state and has nothing to submit. The state changes land from a microtask rather
   * than in the effect's synchronous phase, so the loading render is its own instead of one cascaded out
   * of the effect that triggered the request.
   */
  useEffect(() => {
    const controller = new AbortController();
    const superseded = pricingControllerRef.current;
    pricingControllerRef.current = controller;
    superseded?.abort();

    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      if (lines.length === 0) {
        setPricing(IDLE_PRICING);
        dispatch(checkoutActions.setSnapshot(null));
        return;
      }
      setPricing(LOADING_PRICING);
      void priceCart(lines, promoCode ?? undefined, shippingMethodId, {
        signal: controller.signal,
      }).then(
        (answer) => {
          // A superseded request reports nothing: the pass that cancelled it owns the state from here.
          if (controller.signal.aborted) return;
          if (!answer.ok) {
            setPricing({ status: "error", error: answer.error });
            return;
          }
          dispatch(checkoutActions.setSnapshot(answer.value));
          setPricing(SETTLED_PRICING);
        },
        (cause: unknown) => {
          if (controller.signal.aborted || isAbortError(cause)) return;
          // Unreachable through the shipped transport, which resolves every failure as a value: kept so
          // a rejection could not leave the surface loading forever.
          setPricing({ status: "error", error: toRejectionError(cause) });
        },
      );
    });

    return () => {
      controller.abort();
    };
  }, [dispatch, lines, promoCode, shippingMethodId, pricingRunToken]);

  /** Adopts the session's email address when it arrives after the flow has started: `useAuth()`
   *  revalidates a stored session asynchronously, so a reload into the checkout finds no identity on its
   *  first render. It is adopted once, and only while the shopper has typed none of their own, so a field
   *  they clear or replace is never written over beneath their fingers. */
  const emailAdoptedRef = useRef(false);
  const contactEmail = state.values.contact.email;
  useEffect(() => {
    if (emailAdoptedRef.current || sessionEmail === null) return;
    emailAdoptedRef.current = true;
    if (contactEmail.length > 0) return;
    dispatch(checkoutActions.updateValues({ contact: { email: sessionEmail } }));
  }, [dispatch, sessionEmail, contactEmail]);

  /** Whether a submission is in flight, set the moment an attempt starts: the second line of the
   *  double-submission guard, behind the submit control's own disabled state, which the synchronous commit
   *  in `submit` puts in place before that handler returns. It still refuses an activation that reaches
   *  `submit` from anywhere other than the control's own listener. The idempotency key is the guard behind
   *  both, and the one the endpoint enforces. */
  const submittingRef = useRef(false);
  const submitControllerRef = useRef<AbortController | null>(null);

  // A submission cannot outlive the flow it belongs to: unmounting aborts whatever is in flight, so a
  // page that navigates away mid-submission leaves no answer to settle into it.
  useEffect(
    () => () => {
      submitControllerRef.current?.abort();
    },
    [],
  );

  const setStep = useCallback(
    (step: CheckoutStep): void => {
      dispatch(checkoutActions.setStep(step));
    },
    [dispatch],
  );

  const next = useCallback((): void => {
    const current = stateRef.current;
    const errors = stepErrors(current.step, current.values);
    if (hasErrors(errors)) {
      dispatch(checkoutActions.setErrors(errors));
      // Counted because the map this refusal produces may be exactly the one already standing: the count is
      // what tells the step in hand that this attempt was refused as well, so its summary takes the keyboard
      // again. The update is functional, so this callback's identity does not change with it.
      setRefusals((count) => count + 1);
      return;
    }
    // A step that passes on a second attempt clears the complaints the first one left, so a message a
    // shopper has just satisfied does not stay on screen behind them.
    if (hasErrors(current.errors)) {
      dispatch(checkoutActions.clearErrors());
    }
    dispatch(checkoutActions.next());
  }, [dispatch]);

  const back = useCallback((): void => {
    dispatch(checkoutActions.back());
  }, [dispatch]);

  const updateValues = useCallback(
    (values: CheckoutValuesPatch): void => {
      dispatch(checkoutActions.updateValues(values));
    },
    [dispatch],
  );

  const retryPricing = useCallback((): void => {
    setPricingRunToken((token) => token + 1);
  }, []);

  const submit = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    const snapshot = current.snapshot;
    // The three refusals: an attempt already in flight, a flow that is not standing on the step the
    // order was reviewed at, and a basket with nothing priced to place. The endpoint judges the body
    // again and stays the authority; these exist so a buyer is told without a request being made.
    if (submittingRef.current || current.step !== "review") return;
    if (snapshot === null || snapshot.lines.length === 0) return;

    const controller = new AbortController();
    const superseded = submitControllerRef.current;
    submitControllerRef.current = controller;
    superseded?.abort();
    submittingRef.current = true;

    // The submitting state is committed to the DOM before this handler returns, because the control's own
    // disabled state is what refuses the second press: a React update cannot be committed between two
    // activations of one control raised in the same task, so both would otherwise reach this callback while
    // the control still reads as enabled. The flush belongs here, in a click handler — never in a render or
    // a lifecycle method, where it has nothing left to flush.
    flushSync(() => {
      dispatch(checkoutActions.submitStarted(current.idempotencyKey));
    });

    const answer = await createOrder(
      buildOrderInput(snapshot, orderContactOf(current.values), current.idempotencyKey),
      { sessionToken: session?.token, signal: controller.signal },
    );

    submittingRef.current = false;
    // A superseded or abandoned attempt reports nothing at all: `reset` aborts the attempt it starts
    // over, and a flow that is no longer mounted has nobody left to report to.
    if (controller.signal.aborted) return;

    if (!answer.ok) {
      dispatch(checkoutActions.submitFailed(answer.error, fieldErrorsFromApiError(answer.error)));
      return;
    }

    dispatch(checkoutActions.submitSucceeded(answer.value));
    // A placed order leaves nothing for a form to complain about: the failure a refused attempt
    // recorded is cleared with the success, so no step's controls can render a stale message behind a
    // flow that has moved on to its confirmation.
    dispatch(checkoutActions.clearErrors());
    // Completion hands the cart its own clear rather than emptying lines here: the cart owns its state,
    // and this is the product's one clearing path.
    cartActions.clearCart();
  }, [dispatch, cartActions, session]);

  const reset = useCallback((): void => {
    // An attempt still in flight belongs to the flow being given up: aborting it keeps its answer out of
    // the checkout a shopper has just started over, and the key the fresh flow mints is the next
    // attempt's own.
    submitControllerRef.current?.abort();
    submitControllerRef.current = null;
    submittingRef.current = false;
    dispatch(checkoutActions.reset(createIdempotencyKey()));
    // The fresh flow starts from nothing entered, so the identity the session holds is written back into
    // it: the same prefill the first attempt began with, dispatched after the reset so both land in one
    // render.
    if (sessionEmail !== null) {
      dispatch(checkoutActions.updateValues({ contact: { email: sessionEmail } }));
    }
  }, [dispatch, sessionEmail]);

  // Derived during render rather than stored: whether the submission may start is a question the state
  // and the price request already answer between them, and a copy of it would be a second answer.
  const canSubmit =
    state.step === "review" &&
    state.submitting === false &&
    state.order === null &&
    pricing.status === "success" &&
    state.snapshot !== null &&
    state.snapshot.lines.length > 0;

  const actions = useMemo<CheckoutActions>(
    () => ({ setStep, next, back, updateValues, submit, retryPricing, reset }),
    [setStep, next, back, updateValues, submit, retryPricing, reset],
  );

  const value = useMemo<CheckoutValue>(
    () => ({
      step: state.step,
      values: state.values,
      errors: state.errors,
      refusals,
      status: state.status,
      isSubmitting: state.submitting,
      error: state.error,
      order: state.order,
      snapshot: state.snapshot,
      pricingStatus: pricing.status,
      pricingError: pricing.error,
      canSubmit,
      isOrderPlaced: state.order !== null,
      actions,
    }),
    [state, pricing, canSubmit, actions, refusals],
  );

  return <CheckoutContext value={value}>{children}</CheckoutContext>;
}

// Consumer hook ---------------------------------------------------------------------------------

/**
 * Reads the checkout: where the shopper is, what they entered, what the submission became, and the
 * actions that change any of it.
 *
 * Returns the provider's single memoised value, so every consumer receives the same object while nothing
 * about the flow changed and an unrelated parent render does not re-render one. The actions inside that
 * value are memoised on their own stable callbacks, so they keep their identity when a value changes and
 * a memoised child handed one action is not re-rendered by a keystroke.
 *
 * @returns The flow as the view, with its actions.
 * @throws When called above every `CheckoutProvider`, naming the missing provider.
 */
export function useCheckout(): CheckoutView & { readonly actions: CheckoutActions } {
  const value = useContext(CheckoutContext);
  if (value === null) {
    throw new Error("useCheckout must be called from a component within a CheckoutProvider.");
  }
  return value;
}
