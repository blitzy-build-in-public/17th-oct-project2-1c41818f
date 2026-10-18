/**
 * Path: src/constants/feedbackCopy.ts
 * Purpose: The loading, failure, outcome and empty-state copy every data-backed surface renders
 * Lines: 109
 */

/*
 * A §0.5.5 split of `src/constants/content.ts`, which had reached the request's 600-line ceiling with this
 * concern inside it: the copy module keeps the page-by-page wording — identity, navigation, the catalogue,
 * the cart, the checkout, the account, the dashboard, the reports, the shared verbs and the field messages —
 * and the states every screen can be in live here, because loading, failing, finishing and being empty are
 * concerns of the same kind. `src/constants/content.ts` re-exports every name below, so a consumer's path
 * still resolves the whole vocabulary and no call site changed; nothing here imports the module that
 * publishes this one, so the direction is one-way and no cycle exists.
 */

// Feedback, empty states and the error boundary -------------------------------------------------
/** Loading, failure and outcome copy. Consumers: `Feedback.tsx`, `Toast.tsx` and the error boundary. */
/** The retry action's label is {@link COMMON_ACTIONS}.RETRY, so the verb has a single home. */
export const FEEDBACK_COPY = {
  LOADING: "Loading…",
  ERROR_STATE_TITLE: "This part of the page could not load",
  ERROR_STATE_BODY: "The request failed, so there is nothing to show here.",
  ERROR_STATE_HINT: "Try again, or go back and return to this page.",
  ERROR_BOUNDARY_TITLE: "This page ran into a problem",
  ERROR_BOUNDARY_BODY: "The screen stopped rendering. Reloading usually clears it.",
  ERROR_BOUNDARY_RELOAD_LABEL: "Reload the page",
  ERROR_BOUNDARY_HOME_LABEL: "Go to the home page",
  TOAST_REMOVED_FROM_CART: "That item was removed from your cart.",
  TOAST_CART_CLEARED: "Your cart is now empty.",
  TOAST_PROMO_APPLIED: "Your promo code was applied and the total recalculated.",
  TOAST_PROFILE_SAVED: "Your profile changes were saved.",
  TOAST_ADDRESS_SAVED: "Your address was saved.",
  TOAST_ADDRESS_REMOVED: "That address was removed from your address book.",
  TOAST_SIGNED_OUT: "You are signed out.",
  TOAST_EXPORT_READY: "The export is ready and the download has started.",
  TOAST_EXPORT_FAILED: "The export could not be prepared. Try downloading it again.",
  TOAST_SESSION_EXPIRED: "Your session has expired. Sign in again to reach your account.",
  SIGN_IN_REQUIRED: "Sign in to your account to continue.",
} as const;
/** Outcome messages that name what they acted on. Consumers: the feature that reports them. */
export const addedToCartMessage = (productName: string): string =>
  `${productName} was added to your cart.`;
export const signedInMessage = (name: string): string => `Welcome back, ${name}.`;
/** The greeting a registration raises: the account was created by this visit rather than returned to. */
export const registeredMessage = (name: string): string => `Welcome to SalesPro, ${name}.`;
export const orderPlacedMessage = (orderNumber: string): string =>
  `Order ${orderNumber} is placed.`;
/** One empty state: what is empty, why, and the single action that helps. */
export interface EmptyStateCopy {
  readonly title: string;
  readonly description: string;
  readonly actionLabel?: string;
}
/** The empty state of every surface that can hold nothing. Consumers: the pages that render them. */
export const EMPTY_STATES = {
  catalogue: {
    title: "No products to show",
    description: "Nothing matches these filters.",
    actionLabel: "Clear all filters",
  },
  searchResults: {
    title: "No products match your search",
    description: "Try a broader word or browse by category.",
    actionLabel: "Browse the full catalogue",
  },
  cart: {
    title: "Your cart is empty",
    description: "Nothing has been added yet.",
    actionLabel: "Start shopping",
  },
  orders: {
    title: "No orders yet",
    description: "Orders placed while signed in appear here.",
    actionLabel: "Browse the catalogue",
  },
  addresses: {
    title: "No addresses saved",
    description: "Save one to reuse it at checkout.",
    actionLabel: "Add an address",
  },
  reviews: {
    title: "No reviews yet",
    description: "Nobody has reviewed this product.",
    actionLabel: "Write a review",
  },
  relatedProducts: {
    title: "Nothing else in this category",
    description: "This product stands alone, so there is nothing to compare it with.",
  },
  dashboardRange: {
    title: "No sales in this period",
    description: "Widen the period to see earlier activity.",
    actionLabel: "Widen the period",
  },
  reportRange: {
    title: "Nothing to report for these dates",
    description: "No orders were placed in the period you chose.",
    actionLabel: "Choose another period",
  },
} as const;
/** One surface that can hold nothing, derived from {@link EMPTY_STATES}. */
export type EmptyStateKey = keyof typeof EMPTY_STATES;
/** The not-found view, composed by `src/components/ui/NotFoundView.tsx` and mounted by `src/Router.tsx`. */
export const NOT_FOUND_COPY = {
  TITLE: "Page not found",
  BODY: "That address does not match a page in SalesPro. It may have been mistyped.",
  ACTION_LABEL: "Go to the catalogue",
} as const;
