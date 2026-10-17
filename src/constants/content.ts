/**
 * Path: src/constants/content.ts
 * Purpose: All user-facing copy: navigation, section headings, button labels, empty states and help text
 * Lines: 606
 */

import type { PromoRejectionReason } from "@/types/commerce";

/**
 * Picks the singular or plural noun a count needs, and states the two boundaries every export here
 * holds: money and dates arrive already formatted from `src/utils/format.ts` and `src/utils/dates.ts`,
 * and every threshold, cap and limit arrives as an argument from `src/constants/config.ts`.
 */
const noun = (count: number, singular: string, plural: string): string =>
  count === 1 ? singular : plural;

// Identity --------------------------------------------------------------------------------------
/** Product identity. Consumers: `Header.tsx` for the logo, `Footer.tsx` for the legal line. */
export const APP_COPY = {
  APP_NAME: "SalesPro",
  TAGLINE: "A storefront and a sales back office that run in your browser.",
} as const;
/** Browser-tab titles by route. Consumers: the feature pages, through {@link documentTitle}. */
export const PAGE_TITLES = {
  HOME: "Home",
  CATALOG: "All products",
  CATEGORY: "Category",
  SEARCH: "Search",
  PRODUCT: "Product details",
  CART: "Your cart",
  CHECKOUT: "Checkout",
  ORDER_CONFIRMATION: "Order confirmation",
  SIGN_IN: "Sign in",
  REGISTER: "Create an account",
  ACCOUNT: "Your account",
  ORDERS: "Your orders",
  ORDER_DETAIL: "Order details",
  ADDRESSES: "Your addresses",
  DASHBOARD: "Sales dashboard",
  REPORTS: "Reports",
  NOT_FOUND: "Page not found",
} as const;
/** One key per route, derived from {@link PAGE_TITLES} so the union and the titles cannot drift. */
export type PageTitleKey = keyof typeof PAGE_TITLES;
/** Builds a document title, so no page writes the product name into its own title. */
export const documentTitle = (pageTitle: string): string => `${pageTitle} · ${APP_COPY.APP_NAME}`;

// Header, navigation and footer -----------------------------------------------------------------
/** Header copy. Consumer: `src/components/layout/Header.tsx`. */
export const HEADER_COPY = {
  NAV_HOME_LABEL: "Home",
  NAV_CATALOG_LABEL: "Catalog",
  NAV_CART_LABEL: "Cart",
  NAV_ACCOUNT_LABEL: "Account",
  SEARCH_FIELD_LABEL: "Search the catalogue",
  SEARCH_PLACEHOLDER: "Product, brand or category",
  ACCOUNT_MENU_PROFILE_LABEL: "Your profile",
  ACCOUNT_MENU_ORDERS_LABEL: "Your orders",
  ACCOUNT_MENU_ADDRESSES_LABEL: "Your addresses",
  MOBILE_MENU_OPEN_LABEL: "Open menu",
  MOBILE_MENU_CLOSE_LABEL: "Close menu",
} as const;
/** Names the cart button from its item count, singular handled. Consumer: `Header.tsx`. */
export const cartButtonLabel = (itemCount: number): string =>
  itemCount === 0
    ? "Cart, nothing added yet"
    : `Cart, ${itemCount} ${noun(itemCount, "item", "items")}`;

/** Footer copy. Consumer: `src/components/layout/Footer.tsx`. */
export const FOOTER_COPY = {
  SHOP_HEADING: "Shop",
  SHOP_CATALOG_LABEL: "All products",
  SHOP_SEARCH_LABEL: "Search the catalogue",
  SHOP_CART_LABEL: "Your cart",
  ACCOUNT_HEADING: "Account",
  ACCOUNT_SIGN_IN_LABEL: "Sign in or create an account",
  ACCOUNT_ORDERS_LABEL: "Order history",
  ACCOUNT_ADDRESSES_LABEL: "Address book",
  ABOUT_HEADING: "About SalesPro",
  ABOUT_BODY:
    "A demonstration storefront: catalogue, customers, orders and figures are generated in your browser from a fixed seed.",
  CONTACT_HEADING: "Signing in",
  CONTACT_BODY:
    "One administrator and one shopper account are seeded for the demonstration, so the dashboard and an order history open without registering.",
} as const;
/** Builds the footer's copyright line for a given year. */
export const copyrightLabel = (year: number): string =>
  `© ${year} ${APP_COPY.APP_NAME}. All rights reserved.`;

// Home ------------------------------------------------------------------------------------------
/** Home page copy. Consumers: `src/features/home/*`. */
export const HOME_COPY = {
  HERO_EYEBROW: "Everything in one storefront",
  HERO_HEADLINE: "Browse a catalogue built to be browsed",
  HERO_BODY:
    "Search it, filter it, read the reviews, fill a cart and place an order. Every screen works end to end, and nothing is charged.",
  HERO_PRIMARY_ACTION_LABEL: "Shop the catalogue",
  HERO_SECONDARY_ACTION_LABEL: "Search products",
  FEATURED_TITLE: "Featured products",
  FEATURED_SUBTITLE: "Well-reviewed products from across the catalogue.",
  FEATURED_VIEW_ALL_LABEL: "View all products",
  SHOWCASE_TITLE: "Shop by category",
  SHOWCASE_SUBTITLE: "Every category, with the number of products inside it.",
  PROMO_HEADING: "Delivery is free on larger baskets",
  PROMO_BODY:
    "Pass the free-delivery threshold and the delivery charge drops to nothing. Your cart shows how much is left to go.",
  PROMO_ACTION_LABEL: "Start shopping",
  TRUST_REVIEWS_CLAIM: "Reviews come from seeded customers and keep their verified-purchase mark.",
  TRUST_CART_CLAIM: "Your cart is stored in this browser, so it is still there after a reload.",
  TRUST_CHECKOUT_CLAIM:
    "Checkout is a demonstration: no payment is processed and no card is stored.",
} as const;
/** States the free-delivery rule using a threshold the caller has already formatted. */
export const freeDeliveryClaim = (formattedThreshold: string): string =>
  `Delivery is free once your basket reaches ${formattedThreshold}.`;

// Catalogue and product detail ------------------------------------------------------------------
/** Catalogue and product copy. Consumers: the catalog feature and the product components. */
export const CATALOG_COPY = {
  ALL_PRODUCTS_HEADING: "All products",
  SORT_GROUP_LABEL: "Sort products by",
  RESULTS_REGION_LABEL: "Product results",
  QUICK_ADD_LABEL: "Quick add",
  QUICK_ADD_UNAVAILABLE_LABEL: "Out of stock",
  IN_STOCK_LABEL: "In stock and ready to ship",
  OUT_OF_STOCK_LABEL: "Currently out of stock",
  ADD_TO_CART_LABEL: "Add to cart",
  BUY_NOW_LABEL: "Buy now",
  DESCRIPTION_HEADING: "Description",
  FEATURES_HEADING: "Features",
  SPECIFICATIONS_HEADING: "Specifications",
  SPECIFICATIONS_EMPTY: "This product has no specifications listed.",
  RELATED_HEADING: "Related products",
  REVIEWS_HEADING: "Customer reviews",
  REVIEWS_RATING_FILTER_LABEL: "Filter reviews by rating",
  REVIEW_FORM_RATING_LABEL: "Your rating",
  REVIEW_FORM_TITLE_LABEL: "Review title",
  REVIEW_FORM_BODY_LABEL: "Your review",
  REVIEW_FORM_SUBMIT_LABEL: "Submit review",
  WRITE_REVIEW_LABEL: "Write a review",
  SIGN_IN_TO_REVIEW_LABEL: "Sign in to write a review",
} as const;
/** Builds the heading of a category listing from the category's name. */
export const categoryPageHeading = (name: string): string => `Products in ${name}`;
/** Result-set, live-region and stock labels. Consumers: `src/features/catalog/ProductList.tsx`. */
export const productCountLabel = (count: number): string =>
  `${count} ${noun(count, "product", "products")}`;
export const productCountAnnouncement = (count: number): string =>
  count === 0
    ? "No products match the current filters."
    : `Now showing ${productCountLabel(count)}.`;
export const lowStockLabel = (count: number): string => `Only ${count} left in stock`;

// Search and filters ----------------------------------------------------------------------------
/** Search copy. Consumers: `src/features/search/*`. */
export const SEARCH_COPY = {
  FIELD_LABEL: "Search products",
  PLACEHOLDER: "Try a product name, a brand, or a category",
  SUGGESTIONS_LIST_LABEL: "Search suggestions",
  SUGGESTIONS_PRODUCTS_HEADING: "Products",
  SUGGESTIONS_BRANDS_HEADING: "Brands",
  SUGGESTIONS_CATEGORIES_HEADING: "Categories",
  RECENT_HEADING: "Recent searches",
  RECENT_CLEAR_LABEL: "Clear recent searches",
  ACTIVE_FILTERS_HEADING: "Applied filters",
  FILTER_PANEL_HEADING: "Filters",
  OPEN_FILTERS_LABEL: "Open filters",
  CLOSE_FILTERS_LABEL: "Close filters",
} as const;
/** Summarises a search as a sentence, singular and plural handled. */
export const searchSummaryLabel = (query: string, count: number): string =>
  count === 0
    ? `No results for "${query}"`
    : `${count} ${noun(count, "result", "results")} for "${query}"`;
/** Filter-chip, live-region and paging labels. Consumers: `src/features/search/*`. */
export const clearFacetLabel = (facetLabel: string): string => `Clear ${facetLabel}`;
export const removeFilterLabel = (filterLabel: string): string => `Remove filter: ${filterLabel}`;
export const resultsUpdatedAnnouncement = (count: number): string =>
  productCountAnnouncement(count);
export const pageAnnouncement = (page: number, pageCount: number): string =>
  `Page ${page} of ${pageCount}`;

// Cart and mini-cart ----------------------------------------------------------------------------
/** Cart copy. Consumers: `src/features/cart/*`. */
export const CART_COPY = {
  PAGE_HEADING: "Your cart",
  PROMO_FIELD_LABEL: "Promo code",
  PROMO_PLACEHOLDER: "Enter a code",
  PROMO_APPLY_LABEL: "Apply code",
  SUMMARY_SUBTOTAL_LABEL: "Subtotal",
  SUMMARY_DISCOUNT_LABEL: "Discount",
  SUMMARY_SHIPPING_LABEL: "Shipping",
  SUMMARY_SHIPPING_AT_CHECKOUT_LABEL: "Calculated at checkout",
  SUMMARY_TAX_LABEL: "Tax",
  SUMMARY_TOTAL_LABEL: "Total",
  FREE_DELIVERY_EARNED_LABEL: "Your basket qualifies for free delivery.",
  CONTINUE_SHOPPING_LABEL: "Continue shopping",
  PROCEED_TO_CHECKOUT_LABEL: "Proceed to checkout",
  MINI_CART_HEADING: "In your cart",
  MINI_CART_VIEW_CART_LABEL: "View cart",
  MINI_CART_CLOSE_LABEL: "Close cart",
  AVAILABILITY_WARNING: "This product is out of stock. Remove the line or check back later.",
  QUANTITY_CLAMPED_NOTICE: "Your quantity was reduced to what is still in stock.",
} as const;
/** Cart line, promo and count labels. Consumers: `src/features/cart/*` and `MiniCart.tsx`. */
export const removeLineLabel = (productName: string): string => `Remove ${productName}`;
export const quantityLabel = (productName: string): string => `Quantity for ${productName}`;
export const appliedPromoLabel = (code: string): string => `Promo code ${code} applied`;
export const freeShippingProgressLabel = (formattedRemaining: string): string =>
  `Add ${formattedRemaining} more to unlock free delivery.`;
export const cartItemCountLabel = (count: number): string =>
  count === 0
    ? "Nothing in your cart yet"
    : `${count} ${noun(count, "item", "items")} in your cart`;

// Checkout and confirmation ---------------------------------------------------------------------
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
  REVIEW_DELIVERY_METHOD_HEADING: "Delivery method",
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

// Accounts --------------------------------------------------------------------------------------
/** Account copy. Consumers: `src/features/account/*`. */
export const ACCOUNT_COPY = {
  SIGN_IN_HEADING: "Sign in to SalesPro",
  SIGN_IN_SUBHEADING: "Use a seeded demonstration account. Nothing is sent to an inbox.",
  REGISTER_HEADING: "Create your account",
  REGISTER_SUBHEADING: "Registration keeps your orders and addresses in this browser.",
  EMAIL_LABEL: "Email address",
  PASSWORD_LABEL: "Password",
  SHOW_PASSWORD_LABEL: "Show password",
  HIDE_PASSWORD_LABEL: "Hide password",
  SIGN_IN_SUBMIT_LABEL: "Sign in and continue",
  REGISTER_SUBMIT_LABEL: "Create my account",
  GO_TO_REGISTER_LABEL: "Create an account instead",
  GO_TO_SIGN_IN_LABEL: "Already have an account? Sign in",
  SIGN_IN_FAILED_MESSAGE: "That email address and password do not match an account.",
  DUPLICATE_EMAIL_MESSAGE: "An account already exists for that email address.",
  NAV_PROFILE_LABEL: "Profile",
  NAV_ORDERS_LABEL: "Orders",
  NAV_ADDRESSES_LABEL: "Addresses",
  PROFILE_HEADING: "Your profile",
  FIRST_NAME_LABEL: "First name",
  LAST_NAME_LABEL: "Last name",
  PHONE_LABEL: "Phone number",
  MARKETING_OPT_IN_LABEL: "Email me about offers and new products",
  ORDERS_HEADING: "Order history",
  ORDERS_STATUS_FILTER_LABEL: "Filter by status",
  ORDERS_DATE_FILTER_LABEL: "Filter by the date the order was placed",
  ORDERS_COLUMN_ORDER: "Order",
  ORDERS_COLUMN_PLACED: "Placed",
  ORDERS_COLUMN_STATUS: "Status",
  ORDERS_COLUMN_ITEMS: "Items",
  ORDERS_COLUMN_TOTAL: "Total",
  ORDER_DETAIL_BACK_LABEL: "Back to your orders",
  ORDER_DETAIL_ITEMS_HEADING: "Items",
  ORDER_DETAIL_TOTALS_HEADING: "Totals",
  ORDER_DETAIL_ADDRESS_HEADING: "Shipping address",
  ORDER_DETAIL_PAYMENT_HEADING: "Payment",
  ORDER_DETAIL_HISTORY_HEADING: "Status history",
  ADDRESS_BOOK_HEADING: "Address book",
  ADD_ADDRESS_LABEL: "Add an address",
  DEFAULT_SHIPPING_BADGE: "Default shipping",
  DEFAULT_BILLING_BADGE: "Default billing",
  SET_DEFAULT_SHIPPING_LABEL: "Make this the default shipping address",
  SET_DEFAULT_BILLING_LABEL: "Make this the default billing address",
  REMOVE_ADDRESS_DIALOG_TITLE: "Remove this address?",
  REMOVE_ADDRESS_DIALOG_BODY: "Orders already placed keep the address they were sent to.",
  CONFIRM_REMOVE_ADDRESS_LABEL: "Remove address",
} as const;
/** Describes the password rule from the minimum length `src/constants/config.ts` owns. */
export const passwordHintLabel = (minLength: number): string =>
  `At least ${minLength} characters, with one letter and one digit.`;
/** Names the control that deletes one address, using that address's own label. */
export const removeAddressLabel = (addressLabel: string): string => `Remove ${addressLabel}`;
/** Lists the seeded demonstration accounts and the password they share. */
export const demoSignInHint = (adminEmail: string, userEmail: string, password: string): string =>
  `Seeded accounts: ${adminEmail} for the dashboard and ${userEmail} for a customer account, both with the password ${password}.`;

// Dashboard and reports, over their shared range control ----------------------------------------
/** The range control's labels, presets and messages, kept once for both consumers. */
export const DATE_RANGE_COPY = {
  LABEL: "Reporting period",
  FROM_LABEL: "Start date",
  TO_LABEL: "End date",
  APPLY_LABEL: "Apply range",
  THIS_MONTH_PRESET_LABEL: "This month",
  THIS_YEAR_PRESET_LABEL: "This year",
  RANGE_INVERTED_MESSAGE: "The end date is before the start date. Swap the two dates.",
  RANGE_IN_FUTURE_MESSAGE: "The period cannot include dates after today.",
  /**
   * States whose days a period boundary falls on, so a range control says which "today" its figures are
   * bounded by instead of leaving it to be inferred. Rendered under the resolved range by every range
   * control: `src/features/reports/DateRangePicker.tsx` and the dashboard's own.
   */
  LOCAL_TIME_NOTE: "Period boundaries are whole days in your local time zone.",
} as const;
/** Names the preset that reaches back a given number of days. */
export const lastDaysLabel = (days: number): string => `Last ${days} days`;
/** Preset and range labels, each taking the value its caller has already resolved. */
export const resolvedRangeLabel = (formattedFrom: string, formattedTo: string): string =>
  `${formattedFrom} to ${formattedTo}`;
export const rangeTooLongMessage = (maxDays: number): string =>
  `Choose a period of ${maxDays} days or fewer.`;

/** Dashboard copy. Consumers: `src/features/admin/*`, with ranges from {@link DATE_RANGE_COPY}. */
export const ADMIN_COPY = {
  HEADING: "Sales dashboard",
  SUBHEADING: "Revenue, orders and product performance for the period you choose.",
  BASELINE_CONTROL_LABEL: "Compare with",
  KPI_REVENUE_LABEL: "Revenue",
  KPI_ORDERS_LABEL: "Orders",
  KPI_UNITS_LABEL: "Units sold",
  KPI_AVERAGE_ORDER_VALUE_LABEL: "Average order value",
  CHART_HEADING: "Revenue over time",
  CHART_SERIES_CONTROL_LABEL: "Show",
  CHART_SERIES_TOTAL_LABEL: "Total",
  CHART_SERIES_CATEGORY_LABEL: "By category",
  CHART_SERIES_CHANNEL_LABEL: "By channel",
  BREAKDOWN_HEADING: "Where the revenue came from",
  TOP_PRODUCTS_HEADING: "Top products",
  TOP_PRODUCTS_RANK_CONTROL_LABEL: "Rank by",
  RECENT_ORDERS_HEADING: "Recent orders",
  NOT_AUTHORIZED_TITLE: "This area is for administrators",
  NOT_AUTHORIZED_BODY: "The signed-in account does not hold the administrator role.",
  NOT_AUTHORIZED_ACTION_LABEL: "Go to the storefront",
} as const;
/** The name each sales channel shows in the revenue breakdown's series labels. */
export const CHANNEL_LABELS = { web: "Web", mobile: "Mobile app", store: "Store" } as const;
/** States how one KPI moved against its named baseline, from both values already formatted. */
export const kpiChangeLabel = (formattedChange: string, baselineLabel: string): string =>
  `${formattedChange} versus the ${baselineLabel.toLowerCase()}`;

/** Reports copy. Consumers: `src/features/reports/*`, with ranges from {@link DATE_RANGE_COPY}. */
export const REPORTS_COPY = {
  HEADING: "Reports",
  INTRO: "Run a report over any period, then take the rows away as CSV.",
  SELECTOR_LABEL: "Report",
  EXPORT_LABEL: "Download CSV",
  TOTALS_ROW_LABEL: "Total",
  SALES_CHART_HEADING: "Revenue by period",
  PRODUCT_CHART_HEADING: "Revenue by product",
  CUSTOMER_CHART_HEADING: "New and returning customers",
} as const;
/** Describes the export's row cap and cell limit, and whose clock its dates use. */
export const exportNote = (rowCap: number, cellLimit: number): string =>
  `The export holds up to ${rowCap} rows and clips each cell at ${cellLimit} characters, so it opens in a spreadsheet. Dates and times are yours, not the server's.`;

// Shared actions --------------------------------------------------------------------------------
/** Shared verbs, so one action is never labelled two ways. Consumers: every feature and component. */
export const COMMON_ACTIONS = {
  SAVE: "Save",
  SAVE_CHANGES: "Save changes",
  CANCEL: "Cancel",
  CLOSE: "Close",
  EDIT: "Edit",
  REMOVE: "Remove",
  ADD: "Add",
  RETRY: "Retry",
  APPLY: "Apply",
  CLEAR: "Clear",
  CLEAR_ALL: "Clear all",
  CONFIRM: "Confirm",
  BACK: "Back",
  CONTINUE: "Continue",
  NEXT: "Next",
  PREVIOUS: "Previous",
  SEARCH: "Search",
  SIGN_IN: "Sign in",
  SIGN_OUT: "Sign out",
  CREATE_ACCOUNT: "Create account",
  VIEW_DETAILS: "View details",
  VIEW_ALL: "View all",
} as const;

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
/** The not-found view, composed inside `src/Router.tsx` from the shared primitives. */
export const NOT_FOUND_COPY = {
  TITLE: "Page not found",
  BODY: "That address does not match a page in SalesPro. It may have been mistyped.",
  ACTION_LABEL: "Go to the catalogue",
} as const;

// Accessibility, validation and promo-code messages ---------------------------------------------
/** Words assistive technology reads and sighted visitors do not. Consumers: the landmark owners. */
export const A11Y_COPY = {
  SKIP_TO_CONTENT: "Skip to main content",
  MAIN_NAV_LABEL: "Main",
  FOOTER_NAV_LABEL: "Footer",
  ACCOUNT_NAV_LABEL: "Account sections",
  ACCOUNT_MENU_LABEL: "Account menu",
  BREADCRUMB_LABEL: "Breadcrumb",
  PAGINATION_LABEL: "Pagination",
  TOAST_REGION_LABEL: "Notifications",
  CLOSE_DIALOG_LABEL: "Close this dialog",
  LOADING_ANNOUNCEMENT: "Loading content",
  INERT_BACKGROUND_NOTE: "The rest of the page stays inactive while this panel is open.",
} as const;
/** Captions a chart's paired data table, so no figure is reachable through colour alone. */
export const chartDataTableCaption = (chartTitle: string): string =>
  `The values behind the chart "${chartTitle}"`;
/** Chart and rating text alternatives, so no value is conveyed by colour or stars alone. */
export const ratingSummaryLabel = (formattedRating: string, count: number): string =>
  `Rated ${formattedRating} from ${count} ${noun(count, "review", "reviews")}`;

/** One message per rule, in the field-independent form. Consumer: `src/utils/validation.ts`. */
export const VALIDATION_MESSAGES = {
  REQUIRED: "This field is required.",
  EMAIL_FORMAT: "Enter an email address in the form name@example.com.",
  PHONE_FORMAT: "Enter a phone number with at least seven digits.",
  PASSWORD_POLICY: "Your password is too short, or it is missing a letter or a digit.",
  POSTAL_CODE_FORMAT: "Enter the postal code in the format this country uses.",
  CARD_NUMBER: "Check the digits and enter them as printed on the card.",
  CARD_EXPIRY: "Enter an expiry date that has not passed.",
  CARD_SECURITY_CODE: "Enter the security code printed on the card.",
  QUANTITY_RANGE: "Choose a quantity that is still in stock.",
  REVIEW_TITLE_LENGTH: "Give the review a title, or shorten the one you wrote.",
  REVIEW_BODY_LENGTH: "Write a review long enough to be useful, or shorten it.",
  PROMO_CODE_FORMAT: "Enter a code made of letters and numbers only.",
} as const;
/** One rule a field can break, derived from {@link VALIDATION_MESSAGES}. */
export type ValidationMessageKey = keyof typeof VALIDATION_MESSAGES;
/** States the password rule as the field hint does, so both read identically. */
export const passwordPolicyMessage = (minLength: number): string => passwordHintLabel(minLength);
/** The parameterised rule messages, each taking the limit `src/constants/config.ts` owns. */
export const postalCodeFormatMessage = (countryLabel: string): string =>
  `Enter the postal code in the format ${countryLabel} uses.`;
export const quantityRangeMessage = (max: number): string =>
  max === 1 ? "Only one is in stock." : `Choose a quantity between 1 and ${max}.`;
export const reviewTitleLengthMessage = (minValue: number, maxValue: number): string =>
  `Use between ${minValue} and ${maxValue} characters for the title.`;
export const reviewBodyLengthMessage = (minValue: number, maxValue: number): string =>
  `Write between ${minValue} and ${maxValue} characters.`;
/** States the ceiling a name may not pass, from the bound `src/utils/validation.ts` owns. */
export const nameLengthMessage = (max: number): string => `Use ${max} characters or fewer.`;

/** What a shopper is told when a promo code will not apply, per `PromoRejectionReason`. */
export const PROMO_REJECTION_MESSAGES: Readonly<Record<PromoRejectionReason, string>> = {
  unknown: "We do not recognise that code. Check the spelling and try again.",
  inactive: "That code has been withdrawn and can no longer be used.",
  "not-started": "That code is not available yet. Try it again later.",
  expired: "That code has expired.",
  "below-minimum": "Your basket is below the minimum this code needs.",
  "usage-limit": "That code has reached its usage limit.",
  "already-applied": "That code is already applied to your basket.",
  "ineligible-category": "That code does not apply to anything in your basket.",
};
/** Says how much more the basket needs before a code applies, from a formatted amount. */
export const promoMinimumShortfallMessage = (formattedShortfall: string): string =>
  `Add ${formattedShortfall} more to your basket to use this code.`;
