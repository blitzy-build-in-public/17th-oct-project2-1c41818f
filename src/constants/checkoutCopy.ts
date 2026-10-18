/**
 * Path: src/constants/checkoutCopy.ts
 * Purpose: The checkout and confirmation copy: the step indicator's labels, the address and card field labels, the error-summary wording and the confirmation headings
 * Lines: 118
 */

import { countNoun } from "@/constants/content-reports";

/**
 * The checkout surface's copy, split out of `src/constants/content.ts`, which stands at the request's
 * 600-line ceiling: the ceiling splits the concern into a second file rather than being raised, exactly as
 * `src/utils/isoInstants.ts` stands beside `src/utils/dates.ts` and `src/styles/catalog-landing.css`
 * beside `src/styles/catalog.css`. Every label, sentence and builder below is the one the copy library held,
 * moved unchanged. The singular/plural helper is imported from `src/constants/content-reports.ts` rather than
 * written again, because that rule keeps its one home there.
 */

/** The checkout's steps in order. Consumers: `CheckoutSteps.tsx` and `CheckoutPage.tsx`. */
export const CHECKOUT_STEP_TITLES = ["Shipping", "Payment", "Review"] as const;
/** One of the three states a step can hold while the shopper works through the flow. */
export type StepIndicatorStatus = "current" | "completed" | "upcoming";
const STEP_STATUS_LABELS: Readonly<Record<StepIndicatorStatus, string>> = {
  current: "Current step",
  completed: "Completed step",
  upcoming: "Upcoming step",
};
/** Names one step's state, for the visually hidden text of the ordered step list. */
export const stepIndicatorStatusLabel = (status: StepIndicatorStatus): string =>
  STEP_STATUS_LABELS[status];
/** Checkout copy. Consumers: `src/features/checkout/*`. */
export const CHECKOUT_COPY = {
  SHIPPING_STEP_HEADING: "Where should this order go?",
  SHIPPING_STEP_SUPPORTING: "Enter a delivery address, or reuse one saved to your account.",
  PAYMENT_STEP_HEADING: "How would you like to pay?",
  PAYMENT_STEP_SUPPORTING: "Some card numbers are approved and some declined. Nothing is charged.",
  REVIEW_STEP_HEADING: "Check your order before placing it",
  REVIEW_STEP_SUPPORTING: "This is exactly what the order will record and what it will cost.",
  ERROR_SUMMARY_HEADING: "There is a problem",
  SAVED_ADDRESS_LABEL: "Use a saved address",
  USE_NEW_ADDRESS_LABEL: "Enter a new address",
  SHIPPING_METHOD_LEGEND: "Choose a delivery method",
  FULL_NAME_LABEL: "Full name",
  ADDRESS_LINE_1_LABEL: "Address line 1",
  ADDRESS_LINE_2_LABEL: "Address line 2",
  ADDRESS_LINE_2_HINT: "Apartment, suite or building, if it applies",
  CITY_LABEL: "City",
  REGION_LABEL: "State or region",
  POSTAL_CODE_LABEL: "Postal code",
  COUNTRY_LABEL: "Country",
  PHONE_LABEL: "Phone",
  PHONE_HINT: "Used only to reach you about this delivery",
  NAME_ON_CARD_LABEL: "Name on card",
  CARD_NUMBER_LABEL: "Card number",
  CARD_NUMBER_HINT: "Validated in the browser, then discarded",
  CARD_EXPIRY_LABEL: "Expiry date",
  CARD_EXPIRY_MONTH_LABEL: "Expiry month",
  CARD_EXPIRY_YEAR_LABEL: "Expiry year",
  CARD_SECURITY_CODE_LABEL: "Security code",
  CARD_SECURITY_CODE_HINT: "The digits printed on the back of the card",
  BACK_TO_CART_LABEL: "Back to your cart",
  CONTINUE_TO_PAYMENT_LABEL: "Continue to payment",
  CONTINUE_TO_REVIEW_LABEL: "Continue to review",
  PLACE_ORDER_LABEL: "Place order",
  SUBMITTING_LABEL: "Placing your order…",
  DUPLICATE_SUBMISSION_NOTICE: "This button stays disabled until the order finishes.",
  REVIEW_ITEMS_HEADING: "Items",
  REVIEW_SHIPPING_HEADING: "Shipping address",
  REVIEW_BILLING_HEADING: "Billing address",
  REVIEW_DELIVERY_METHOD_HEADING: "Delivery method",
  FREE_DELIVERY_CHARGE_LABEL: "Free",
  REVIEW_PAYMENT_HEADING: "Payment",
  CONFIRMATION_THANK_YOU: "Your demonstration order is recorded and the cart is empty again.",
  CONFIRMATION_ORDER_NUMBER_LABEL: "Order number",
  CONFIRMATION_PLACED_DATE_LABEL: "Placed on",
  CONFIRMATION_ESTIMATE_LABEL: "Estimated delivery",
  CONFIRMATION_ITEMS_HEADING: "What you ordered",
  CONFIRMATION_TOTALS_HEADING: "Order totals",
  CONFIRMATION_ADDRESS_HEADING: "Delivered to",
  CONFIRMATION_PAYMENT_HEADING: "Payment summary",
  CONFIRMATION_CONTINUE_SHOPPING_LABEL: "Continue shopping",
  CONFIRMATION_ORDER_HISTORY_LABEL: "View your order history",
  CONFIRMATION_HOME_LABEL: "Back to the home page",
} as const;
/** States the step inside the flow; `CheckoutPage.tsx` composes it into the page title. */
export const stepProgressLabel = (step: number, total: number): string =>
  `Step ${step} of ${total}`;
/** Field, estimate and section controls. Consumers: `src/features/checkout/*`. */
export const errorSummaryFieldAnchor = (fieldId: string): string => `#${fieldId}`;
/** Says how many fields the step's error summary lists. Consumers: `CheckoutErrorSummary.tsx`. */
export const errorSummaryCountLabel = (count: number): string =>
  `${count} ${countNoun(count, "field", "fields")} ${count === 1 ? "needs" : "need"} attention.`;
export const deliveryEstimateLabel = (formattedEstimate: string): string =>
  `Estimated delivery: ${formattedEstimate}`;
export const optionalFieldLabel = (label: string): string => `${label} (optional)`;
export const editSectionLabel = (sectionLabel: string): string => `Edit ${sectionLabel}`;
/** Builds the confirmation heading from the order number the order was created with. */
export const orderConfirmationHeading = (orderNumber: string): string =>
  `Order ${orderNumber} is placed`;
/** States that no payment is processed, naming the two demonstration card numbers. */
export const demoPaymentNote = (approved: string, declined: string): string =>
  `No payment is processed and no card number is stored. Use ${approved} for an approved card, or ${declined} for a declined one; both outcomes are decided in your browser.`;
/** What the seam answers a declined card with: nothing was ordered, and which number is approved. */
export const paymentDeclinedNote = (approved: string): string =>
  `Your card was declined and no order was placed. Use ${approved} to place the order with an approved card.`;
/**
 * States the transit window a delivery method covers, as the shipping step's own rows read it: `5–8 days`,
 * `1 day`, and nothing for a method collected the same day, whose own description already says so. The dash
 * is the en dash the row already uses.
 *
 * @param minDays - The window's lower bound in days.
 * @param maxDays - The window's upper bound in days, and the bound the unit is read from.
 * @returns The window in words, or an empty string when it covers no day.
 */
export const transitWindowLabel = (minDays: number, maxDays: number): string => {
  if (maxDays <= 0) return "";
  const unit = maxDays === 1 ? "day" : "days";
  return maxDays === minDays ? `${maxDays} ${unit}` : `${minDays}–${maxDays} ${unit}`;
};
