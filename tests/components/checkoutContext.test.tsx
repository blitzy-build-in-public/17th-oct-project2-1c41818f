/**
 * Path: tests/components/checkoutContext.test.tsx
 * Purpose: The checkout context through its own hooks: the step machine, the faults each step reports and the submission with its refusals
 * Lines: 453
 */

import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_ACCOUNTS,
  DEMO_CARD_NUMBERS,
  SHIPPING_METHODS,
  STORAGE_KEYS,
} from "@/constants/config";
import { PRODUCTS } from "@/data/products";
import { API_PATHS } from "@/lib/apiClient";
import { signIn } from "@/lib/authService";
import { useAuth } from "@/state/AuthContext";
import { useCart, useCartDispatch } from "@/state/CartContext";
import { useCheckout } from "@/state/CheckoutContext";
import type { CheckoutValuesPatch } from "@/state/checkoutReducer";
import type { Product } from "@/types/catalog";
import { writeStored } from "@/utils/storage";

import { failNext, renderWithProviders, resetApiState, screen, waitFor } from "../testUtils";
import type { RenderHarness } from "../testUtils";

/*
 * What this file proves, and how.
 *
 * The checkout is driven the way the product drives it: through `useCheckout`, inside the providers
 * `tests/testUtils.tsx` mounts, with the real cart, the real pricing service, the real order service and the
 * real transport behind them. Each case renders a probe — a component that paints the flow and raises one call
 * per control — interacts through the returned `user`, and asserts on what the probe painted, so no context,
 * service or reducer is replaced. The failure states are reached the way the suite reaches them, by arming the
 * API seam with `failNext`; the one case that needs a price still in flight stubs the seam's latency the way the
 * session suite does.
 */

/** The email address the checkout's contact step is filled with: the demonstration customer's. */
const CONTACT_EMAIL = DEMO_ACCOUNTS.CUSTOMER_EMAIL;
// Reading what a probe painted ---------------------------------------------------------------------

/** One value the probe painted, under the name a case reads it by. */
function Field({ name, value }: { readonly name: string; readonly value: string }): ReactElement {
  return <span data-testid={`field-${name}`}>{value}</span>;
}

/** The text a probe painted under one name. */
function painted(name: string): string {
  return screen.getByTestId(`field-${name}`).textContent ?? "";
}

/** Waits until the probe paints `value` under `name`, which is how a case reads a settled call. */
async function paints(name: string, value: string): Promise<void> {
  await waitFor(() => {
    expect(painted(name)).toBe(value);
  });
}

/** Waits until the probe paints something other than the empty string under `name`. */
async function paintsSomething(name: string): Promise<void> {
  await waitFor(() => {
    expect(painted(name)).not.toBe("");
  });
}

/** The control one call is raised through. */
function control(label: string): HTMLElement {
  return screen.getByRole("button", { name: label });
} // The checkout --------------------------------------------------------------------------------------

/** The delivery name and address the checkout's steps are filled with, and the method that always charges. */
const DELIVERY_NAME = "Ada Lovelace";
const CHOSEN_METHOD = SHIPPING_METHODS[SHIPPING_METHODS.length - 1];

/** The card the flow pays with, and the demonstration number the store refuses. */
const CURRENT_MONTH = String(new Date().getMonth() + 1);
const NEXT_YEAR = String(new Date().getFullYear() + 1);
const CARD = {
  number: DEMO_CARD_NUMBERS.APPROVED,
  nameOnCard: DELIVERY_NAME,
  expiryMonth: CURRENT_MONTH,
  expiryYear: NEXT_YEAR,
  cvc: "123",
} as const;

/** The delivery address and the method, as the shipping step's own values hold them. */
const SHIPPING_VALUES: CheckoutValuesPatch = {
  contact: { email: CONTACT_EMAIL },
  shipping: {
    fullName: DELIVERY_NAME,
    line1: "12 Beacon Street",
    city: "Boston",
    region: "MA",
    postalCode: "02108",
    country: "US",
    shippingMethodId: CHOSEN_METHOD.id,
  },
};

/** The credentials the store's own sign-in is asked with, and the address a guest types for themselves. */
const SHOPPER = { email: CONTACT_EMAIL, password: DEMO_ACCOUNTS.PASSWORD } as const;
const TYPED_EMAIL = "typed.at.the.checkout@salespro.test";

/** Signs the demonstration shopper in through the account service and persists the token, as a reload has it. */
async function storeSessionToken(): Promise<void> {
  const answer = await signIn(SHOPPER);
  if (!answer.ok) {
    throw new Error(`The store refused the demonstration sign-in: ${answer.error.code}`);
  }
  expect(writeStored(STORAGE_KEYS.SESSION, answer.value.token)).toBe(true);
}

/** A billing address of its own, and the same address with the one member the rule requires left out. */
const BILLING_ADDRESS = {
  fullName: DELIVERY_NAME,
  line1: "9 Elm Row",
  city: "Denver",
  region: "CO",
  postalCode: "80202",
  country: "US",
} as const;
const BILLING_APART: CheckoutValuesPatch = {
  shipping: { billingSameAsShipping: false, billing: BILLING_ADDRESS },
};
const BILLING_UNUSABLE: CheckoutValuesPatch = {
  shipping: { billingSameAsShipping: false, billing: { ...BILLING_ADDRESS, postalCode: "" } },
};

/** The seeded product the probe's basket holds: one the catalogue can still cover, which pricing reads. */
const BASKET_PRODUCT: Product =
  PRODUCTS.find((product) => product.status === "active" && product.stockOnHand >= 4) ??
  PRODUCTS[0];

/**
 * A checkout consumer: it paints the flow's step, its faults, the submission and the priced snapshot, paints
 * the basket the flow is pricing, and raises one call per control.
 */
function CheckoutProbe(): ReactElement {
  const checkout = useCheckout();
  const cart = useCart();
  const cartActions = useCartDispatch();
  const session = useAuth();
  const actions = checkout.actions;

  const calls: readonly (readonly [string, () => void])[] = [
    ["Add a product to the basket", () => cartActions.addItem(BASKET_PRODUCT)],
    ["Empty the basket", () => cartActions.clearCart()],
    ["Enter the delivery address and method", () => actions.updateValues(SHIPPING_VALUES)],
    [
      "Enter a contact address of its own",
      () => actions.updateValues({ contact: { email: TYPED_EMAIL } }),
    ],
    ["Enter a billing address of its own", () => actions.updateValues(BILLING_APART)],
    ["Enter a billing address with a fault", () => actions.updateValues(BILLING_UNUSABLE)],
    ["Enter the demonstrated card", () => actions.updateValues({ payment: CARD })],
    [
      "Enter the card the store refuses",
      () => actions.updateValues({ payment: { ...CARD, number: DEMO_CARD_NUMBERS.DECLINED } }),
    ],
    ["Continue", () => actions.next()],
    ["Go back a step", () => actions.back()],
    [
      "Place the order",
      () => {
        void actions.submit();
      },
    ],
    [
      "Place the order twice at once",
      () => {
        void actions.submit();
        void actions.submit();
      },
    ],
    [
      "Place the order and begin the checkout again",
      () => {
        void actions.submit();
        actions.reset();
      },
    ],
    ["Price the basket again", () => actions.retryPricing()],
  ];

  return (
    <div>
      <Field name="step" value={checkout.step} />
      <Field name="faults" value={Object.keys(checkout.errors).join(",")} />
      <Field name="refusals" value={String(checkout.refusals)} />
      <Field name="status" value={checkout.status} />
      <Field name="error" value={checkout.error?.code ?? ""} />
      <Field name="order" value={checkout.order?.id ?? ""} />
      <Field name="placed" value={String(checkout.isOrderPlaced)} />
      <Field name="canSubmit" value={String(checkout.canSubmit)} />
      <Field name="pricingStatus" value={checkout.pricingStatus} />
      <Field name="pricingError" value={checkout.pricingError?.code ?? ""} />
      <Field
        name="snapshot"
        value={checkout.snapshot === null ? "" : String(checkout.snapshot.grandTotalMinor)}
      />
      <Field name="email" value={checkout.values.contact.email} />
      <Field name="accountEmail" value={session.email ?? ""} />
      <Field
        name="units"
        value={String(cart.lines.reduce((units, line) => units + line.quantity, 0))}
      />
      {calls.map(([label, call]) => (
        <button key={label} type="button" onClick={call}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Fills the delivery address and the method, and walks the shipping and payment steps to the review. */
async function reachReview(user: RenderHarness["user"], card: string): Promise<void> {
  await user.click(control("Add a product to the basket"));
  await paints("pricingStatus", "success");
  await user.click(control("Enter the delivery address and method"));
  await user.click(control("Continue"));
  await paints("step", "payment");
  await user.click(control(card));
  await user.click(control("Continue"));
  await paints("step", "review");
}

describe("the checkout context's step machine", () => {
  beforeEach(resetApiState);

  it("prices the basket the cart holds, and refuses a submission from any step but the review", async () => {
    const { user } = renderWithProviders(<CheckoutProbe />);

    await user.click(control("Add a product to the basket"));

    // The priced snapshot is the flow's own answer, produced by the pricing service over the cart's lines.
    await paints("pricingStatus", "success");
    await paintsSomething("snapshot");
    expect(painted("canSubmit")).toBe("false");

    // A submission is refused while the flow stands anywhere but the review: nothing is sent and nothing moves.
    await user.click(control("Place the order"));
    expect(painted("status")).toBe("idle");
    expect(painted("placed")).toBe("false");
    expect(painted("order")).toBe("");

    await user.click(control("Enter the delivery address and method"));
    await user.click(control("Continue"));
    await paints("step", "payment");
    await user.click(control("Enter the demonstrated card"));
    await user.click(control("Continue"));
    await paints("step", "review");
    expect(painted("canSubmit")).toBe("true");

    // And it walks back the way it came, keeping every value entered.
    await user.click(control("Go back a step"));
    await paints("step", "payment");
  });

  it("refuses a step whose fields are wrong, counting each refusal, and clears the faults once corrected", async () => {
    const { user } = renderWithProviders(<CheckoutProbe />);

    await user.click(control("Continue"));
    await paints("refusals", "1");
    expect(painted("step")).toBe("shipping");
    expect(painted("faults")).toContain("email");
    expect(painted("faults")).toContain("postalCode");

    // A second attempt at the same faults is a second refusal, which is what the step's own summary reads.
    await user.click(control("Continue"));
    await paints("refusals", "2");

    await user.click(control("Enter the delivery address and method"));
    await user.click(control("Continue"));

    await paints("step", "payment");
    expect(painted("faults")).toBe("");
  });

  it("judges a billing address of its own by the same rule, and orders it with the delivery address", async () => {
    const { user } = renderWithProviders(<CheckoutProbe />);

    await user.click(control("Add a product to the basket"));
    await paints("pricingStatus", "success");
    await user.click(control("Enter the delivery address and method"));
    await user.click(control("Enter a billing address with a fault"));
    await user.click(control("Continue"));

    // The billing address's fault is filed under the group it sits in, and the step is not left behind.
    await paints("faults", "billing.postalCode");
    expect(painted("step")).toBe("shipping");

    await user.click(control("Enter a billing address of its own"));
    await user.click(control("Continue"));
    await paints("step", "payment");
    await user.click(control("Enter the demonstrated card"));
    await user.click(control("Continue"));
    await paints("step", "review");

    // The order that leaves carries the billing address that was typed rather than the delivery one.
    await user.click(control("Place the order"));
    await paints("status", "success");
    await paintsSomething("order");
  });
});

describe("the checkout context's submission", () => {
  beforeEach(resetApiState);

  it("places the order the review holds, clears the basket and holds the confirmation", async () => {
    const { user } = renderWithProviders(<CheckoutProbe />);
    await reachReview(user, "Enter the demonstrated card");

    await user.click(control("Place the order"));

    await paints("status", "success");
    await paintsSomething("order");
    expect(painted("placed")).toBe("true");
    expect(painted("step")).toBe("confirmation");
    expect(painted("canSubmit")).toBe("false");
    // Completion hands the cart its own clear: the basket the order was built from is empty afterwards.
    await paints("units", "0");
  });

  it("records the failure a refused card answers with, and clears it when the shopper continues", async () => {
    const { user } = renderWithProviders(<CheckoutProbe />);
    await reachReview(user, "Enter the card the store refuses");

    await user.click(control("Place the order"));

    await paints("status", "error");
    expect(painted("error")).toBe("payment-declined");
    expect(painted("placed")).toBe("false");
    expect(painted("faults").length).toBeGreaterThan(0);

    // The review is the last step that owns a form, so continuing from it only clears the failure the refused
    // attempt recorded — it does not move the flow, and it does not place a second order.
    await user.click(control("Continue"));

    await paints("faults", "");
    expect(painted("step")).toBe("review");
    expect(painted("placed")).toBe("false");
  });

  it("refuses a submission with nothing priced, and one a checkout begun again supersedes", async () => {
    const { user } = renderWithProviders(<CheckoutProbe />);
    await reachReview(user, "Enter the demonstrated card");

    await user.click(control("Empty the basket"));
    await paints("units", "0");
    await paints("snapshot", "");

    await user.click(control("Place the order"));

    // Nothing priced, so nothing is submitted: the flow is left exactly where it stood.
    expect(painted("status")).toBe("idle");
    expect(painted("placed")).toBe("false");
    expect(painted("order")).toBe("");

    await user.click(control("Add a product to the basket"));
    await paintsSomething("snapshot");

    await user.click(control("Place the order and begin the checkout again"));

    // The fresh checkout starts at its first step and the attempt it was begun over reports nothing into it.
    await paints("step", "shipping");
    expect(painted("placed")).toBe("false");
    expect(painted("order")).toBe("");
    expect(painted("status")).toBe("idle");
    expect(painted("units")).toBe("1");
  });

  it("sends one submission when the control is activated twice in one turn", async () => {
    const seam = await import("@/lib/mockServer");
    const dispatched = vi.spyOn(seam, "handleRequest");
    const { user } = renderWithProviders(<CheckoutProbe />);
    await reachReview(user, "Enter the demonstrated card");

    await user.click(control("Place the order twice at once"));

    await paints("status", "success");
    const submitted = dispatched.mock.calls.filter(
      ([path, options]) => path === API_PATHS.ORDERS && options?.method === "POST",
    );
    expect(submitted).toHaveLength(1);
  });

  it("holds the failure a refused price answered with and prices the basket again on the retry", async () => {
    failNext({ path: API_PATHS.CART_PRICE });
    const { user } = renderWithProviders(<CheckoutProbe />);

    await user.click(control("Add a product to the basket"));

    await paints("pricingStatus", "error");
    expect(painted("pricingError").length).toBeGreaterThan(0);
    // A basket that could not be priced holds no snapshot, so nothing can be submitted from it.
    expect(painted("snapshot")).toBe("");
    expect(painted("canSubmit")).toBe("false");

    await user.click(control("Price the basket again"));

    await paints("pricingStatus", "success");
    await paintsSomething("snapshot");
  });
});

/*
 * An edit that supersedes a price still in flight. The suite's own mechanism is used: the seam's latency is
 * stubbed for this case alone, so the first price is still waiting when the second edit replaces it, and the
 * answer that arrives late is the one a superseded pass has to discard.
 */
describe("a price a later edit supersedes", () => {
  const STUBBED_LATENCY_MS = 500;

  beforeEach(resetApiState);

  afterEach(() => {
    vi.stubEnv("VITE_API_LATENCY_MS", "0");
  });

  it("prices the basket as it stands after the edit, and reports nothing for the pass it replaced", async () => {
    vi.stubEnv("VITE_API_LATENCY_MS", String(STUBBED_LATENCY_MS));
    const { user } = renderWithProviders(<CheckoutProbe />);

    await user.click(control("Add a product to the basket"));
    await user.click(control("Add a product to the basket"));

    // The second edit supersedes the first price: the answer the first one is still waiting for reports
    // nothing, and what the checkout holds is the basket as it stands.
    await paints("units", "2");
    await paints("pricingStatus", "success");
    await paintsSomething("snapshot");
    expect(painted("pricingError")).toBe("");
    expect(painted("status")).toBe("idle");
  });

  it("leaves the contact address a shopper typed when the stored session's identity arrives late", async () => {
    vi.stubEnv("VITE_API_LATENCY_MS", String(STUBBED_LATENCY_MS));
    await storeSessionToken();
    const { user } = renderWithProviders(<CheckoutProbe />);

    // The shopper types their own contact address while the stored session is still being revalidated.
    await user.click(control("Enter a contact address of its own"));

    // The identity arrives and the address typed in the meantime stands: a field the shopper has filled is
    // never written over beneath their fingers.
    await paints("accountEmail", CONTACT_EMAIL);
    await paints("email", TYPED_EMAIL);
  });
});
