/**
 * Path: src/constants/content.ts
 * Purpose: All user-facing copy: navigation, section headings, button labels, empty states and help text
 * Lines: 479
 */

import type { PromoRejectionReason } from "@/types/commerce";

import { passwordHintLabel } from "./content-account";
import { countNoun } from "./content-reports";

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
/**
 * Names the cart button from its item count, singular handled. Consumer: `Header.tsx`, which sets the result
 * as the button's `aria-label`.
 *
 * WCAG 2.5.3 (Label in Name) requires a control's accessible name to contain its visible label text, and a
 * badge digit is visible text: with one item in the cart the button reads "Cart 1". The name therefore leads
 * with the same word the button shows (`HEADER_COPY.NAV_CART_LABEL`) and repeats the badge's digit rather
 * than restating the count as "Cart, 1 item". The badge is `aria-hidden`, so the count is announced from
 * here alone, and an empty cart renders no badge — which is why the count-free name still contains "Cart".
 */
export const cartButtonLabel = (itemCount: number): string =>
  itemCount === 0
    ? `${HEADER_COPY.NAV_CART_LABEL}, nothing added yet`
    : `${HEADER_COPY.NAV_CART_LABEL} ${itemCount} ${countNoun(itemCount, "item", "items")}`;

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
  ANY_RATING_LABEL: "Any rating",
  VERIFIED_PURCHASE_LABEL: "Verified purchase",
} as const;
/**
 * Names one tile's quick add from the product it adds, so that no two controls in the same grid share a
 * name. Consumer: `src/components/product/ProductCard.tsx`, which sets the result as the button's
 * `aria-label`.
 *
 * The visible label leads and the product name follows it, because WCAG 2.5.3 (Label in Name) requires a
 * control's accessible name to contain its visible text; the product name is what tells one control from
 * the next, and it is the same string the tile's heading and the cart's line labels use.
 */
export const quickAddLabel = (productName: string): string =>
  `${CATALOG_COPY.QUICK_ADD_LABEL} ${productName}`;
/** Builds the heading of a category listing from the category's name. */
export const categoryPageHeading = (name: string): string => `Products in ${name}`;
/**
 * Counts the products a result set holds, singular and plural handled.
 * Consumer: `src/features/catalog/ProductList.tsx`.
 */
export const productCountLabel = (count: number): string =>
  `${count} ${countNoun(count, "product", "products")}`;
/**
 * Announces a result set in the results live region, or that the filters matched nothing.
 * Consumer: `src/features/catalog/ProductList.tsx`.
 */
export const productCountAnnouncement = (count: number): string =>
  count === 0
    ? "No products match the current filters."
    : `Now showing ${productCountLabel(count)}.`;
/**
 * States how much stock a product has left, from the count still available.
 * Consumer: `src/features/catalog/ProductList.tsx`.
 */
export const lowStockLabel = (count: number): string => `Only ${count} left in stock`;

// Search and filters ----------------------------------------------------------------------------
/** Search copy. Consumers: `src/features/search/*`. */
export const SEARCH_COPY = {
  FIELD_LABEL: "Search products",
  PLACEHOLDER: "Try a product name, a brand, or a category",
  QUERY_NOT_APPLIED_TITLE: "That search was not applied",
  QUERY_NOT_APPLIED_DESCRIPTION: "A search needs at least two letters or digits to match products.",
  SUGGESTIONS_LIST_LABEL: "Search suggestions",
  SUGGESTIONS_PRODUCTS_HEADING: "Products",
  SUGGESTIONS_BRANDS_HEADING: "Brands",
  SUGGESTIONS_CATEGORIES_HEADING: "Categories",
  SUGGESTIONS_EMPTY: "No suggestions",
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
    : `${count} ${countNoun(count, "result", "results")} for "${query}"`;
/**
 * Names the control that clears one facet, from that facet's own label.
 * Consumers: `src/features/search/*`.
 */
export const clearFacetLabel = (facetLabel: string): string => `Clear ${facetLabel}`;
/**
 * Names the control that removes one active filter, from that filter's own label.
 * Consumers: `src/features/search/*`.
 */
export const removeFilterLabel = (filterLabel: string): string => `Remove filter: ${filterLabel}`;
/** A facet whose values are chosen one at a time, and which therefore opens with an "any" choice. */
export type SingleChoiceFacetId = "price" | "rating";
/**
 * The "any" choice the two single-choice facets' groups open with, keyed by the facet it belongs to: the state
 * a group holds when the facet applies nothing, worded as that state and never with the clearing verb, which
 * belongs to the facet's own clear action beside the group. Consumers:
 * `src/features/search/FilterPanel.tsx` and `src/features/catalog/CatalogPage.tsx`, each of which renders the
 * price bands and the rating floors as one radio group. The rating member reads the catalog register's own
 * wording for it rather than repeating the sentence, so "Any rating" is declared once in this file.
 */
export const FACET_ANY_LABELS: Readonly<Record<SingleChoiceFacetId, string>> = {
  price: "Any price",
  rating: CATALOG_COPY.ANY_RATING_LABEL,
};
/**
 * Announces a changed result count in the results live region, reading the count as
 * {@link productCountAnnouncement} does. Consumers: `src/features/search/*`.
 */
export const resultsUpdatedAnnouncement = (count: number): string =>
  productCountAnnouncement(count);
/**
 * Announces which page of the result set is on show, for the paging live region.
 * Consumers: `src/features/search/*`.
 */
export const pageAnnouncement = (page: number, pageCount: number): string =>
  `Page ${page} of ${pageCount}`;

/**
 * Announces how many suggestions a type-ahead list is offering, for the listbox's own live region.
 *
 * @param count - How many suggestions are on show.
 * @returns The sentence the search bar announces.
 */
export const suggestionsUpdatedAnnouncement = (count: number): string =>
  `Now showing ${count} ${countNoun(count, "suggestion", "suggestions")}.`;
/** The collection a paging control counts, so its caption can name orders, reviews or periods. */
export interface PagingNoun {
  /** The noun a count of one takes. */
  readonly singular: string;
  /** The noun every other count takes. */
  readonly plural: string;
}
/** The collections the shared pager counts. Consumers: `src/components/ui/Pagination.tsx` and its callers. */
export const PAGING_NOUNS = {
  PRODUCTS: { singular: "product", plural: "products" },
  ORDERS: { singular: "order", plural: "orders" },
  REVIEWS: { singular: "review", plural: "reviews" },
  PERIODS: { singular: "period", plural: "periods" },
} as const satisfies Record<string, PagingNoun>;
/**
 * States a collection's own noun and its size, so a paging caption counts what it pages over and never
 * presents a collection's total as the rows one page renders. Consumer: `Pagination.tsx`.
 */
export const pagingCountLabel = (count: number, collection: PagingNoun): string =>
  count === 0
    ? `No ${collection.plural} match the current filters.`
    : `${count} ${countNoun(count, collection.singular, collection.plural)} in total.`;
/** Names the page-size selector for what it changes. Consumer: `src/components/ui/Pagination.tsx`. */
export const PAGE_SIZE_LABEL = "Results per page";

// Cart and mini-cart ----------------------------------------------------------------------------
/** Cart copy. Consumers: `src/features/cart/*`. */
export const CART_COPY = {
  PAGE_HEADING: "Your cart",
  PROMO_FIELD_LABEL: "Promo code",
  PROMO_PLACEHOLDER: "Enter a code",
  PROMO_APPLY_LABEL: "Apply code",
  SUMMARY_HEADING: "Order summary",
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
  UNIT_PRICE_LABEL: "Unit price",
  LINE_TOTAL_LABEL: "Line total",
  AVAILABILITY_WARNING: "This product is out of stock. Remove the line or check back later.",
  QUANTITY_CLAMPED_NOTICE: "Your quantity was reduced to what is still in stock.",
} as const;
/**
 * Names the control that removes one cart line, from the product on it.
 * Consumers: `src/features/cart/*` and `MiniCart.tsx`.
 */
export const removeLineLabel = (productName: string): string => `Remove ${productName}`;
/**
 * Labels one line's quantity control, from the product on that line.
 * Consumers: `src/features/cart/*` and `MiniCart.tsx`.
 */
export const quantityLabel = (productName: string): string => `Quantity for ${productName}`;
/**
 * Confirms which promo code the basket carries, from the code itself.
 * Consumers: `src/features/cart/*` and `MiniCart.tsx`.
 */
export const appliedPromoLabel = (code: string): string => `Promo code ${code} applied`;
export const removePromoLabel = (code: string): string => `Remove promo code ${code}`;
/**
 * States how much more the basket needs for free delivery, from a formatted amount.
 * Consumers: `src/features/cart/*` and `MiniCart.tsx`.
 */
export const freeShippingProgressLabel = (formattedRemaining: string): string =>
  `Add ${formattedRemaining} more to unlock free delivery.`;
/**
 * Counts the basket's lines, singular and plural handled.
 * Consumers: `src/features/cart/*` and `MiniCart.tsx`.
 */
export const cartItemCountLabel = (count: number): string =>
  count === 0
    ? "Nothing in your cart yet"
    : `${count} ${countNoun(count, "item", "items")} in your cart`;

// Checkout and confirmation: §0.5.5 split into checkoutCopy.ts ----------------------------------
export * from "./checkoutCopy";

// Accounts: §0.5.5 split into content-account.ts ------------------------------------------------
export * from "./content-account";

// Dashboard and reports: §0.5.5 split into content-reports.ts -----------------------------------
export * from "./content-reports";

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
// The outcome messages, `EMPTY_STATES` and `NOT_FOUND_COPY` are written in
// `src/constants/feedbackCopy.ts` and re-exported below, because that concern carried this file past
// the request's 600-line ceiling, which is never raised. Every consumer's path stays this one. The
// same concern also lives in `src/constants/content-feedback.ts`, star-exported at the foot of this
// file; `FEEDBACK_COPY` itself is taken from there, because that copy is the one carrying the
// review-submitted toast, so a sentence a consumer reads through this path always resolves.

export {
  EMPTY_STATES,
  NOT_FOUND_COPY,
  addedToCartMessage,
  orderPlacedMessage,
  registeredMessage,
  signedInMessage,
  type EmptyStateCopy,
  type EmptyStateKey,
} from "@/constants/feedbackCopy";
export { FEEDBACK_COPY } from "@/constants/content-feedback";

// Accessibility, validation and promo-code messages ---------------------------------------------
/** Words assistive technology reads and sighted visitors do not. Consumers: the landmark owners. */
export const A11Y_COPY = {
  SKIP_TO_CONTENT: "Skip to main content",
  MAIN_NAV_LABEL: "Main",
  MOBILE_NAV_LABEL: "Main menu",
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
/** Names a chart's paired data table's columns: the group, its value and that value's share. */
export const CHART_COLUMN_LABELS = {
  GROUP_LABEL: "Group",
  VALUE_LABEL: "Value",
  SHARE_LABEL: "Share",
} as const;
/** Chart and rating text alternatives, so no value is conveyed by colour or stars alone. */
export const ratingSummaryLabel = (formattedRating: string, count: number): string =>
  `Rated ${formattedRating} from ${count} ${countNoun(count, "review", "reviews")}`;

/** One message per rule, in the field-independent form. Consumers: `src/utils/validation.ts`, and
 * `src/lib/apiRequests.ts` and `src/lib/apiRoutes.ts`, which answer a hand-made request's members
 * with the same sentences a form shows. */
export const VALIDATION_MESSAGES = {
  REQUIRED: "This field is required.",
  OUT_OF_RANGE: "Enter a value inside the range this field accepts.",
  UNSUPPORTED_VALUE: "Choose one of the values this field accepts.",
  EMAIL_FORMAT: "Enter an email address in the form name@example.com.",
  PHONE_FORMAT: "Enter 7 to 15 digits, with spaces, brackets, dots, hyphens or a leading +.",
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
/** States the postal-code rule, naming the country whose format it expects. */
export const postalCodeFormatMessage = (countryLabel: string): string =>
  `Enter the postal code in the format ${countryLabel} uses.`;
/** States the quantity rule against the stock on hand, singular handled. */
export const quantityRangeMessage = (max: number): string =>
  max === 1 ? "Only one is in stock." : `Choose a quantity between 1 and ${max}.`;
/** States the length a review title must fall between, from both bounds. */
export const reviewTitleLengthMessage = (minValue: number, maxValue: number): string =>
  `Use between ${minValue} and ${maxValue} characters for the title.`;
/** States the length a review body must fall between, from both bounds. */
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

/**
 * The sentence the differing-body idempotency conflict is answered with, naming the reused key and
 * disclosing no other account's order, the non-disclosure refusals keeping their own sentence.
 * Consumer: `src/lib/apiOrders.ts`, the `409 idempotency-key-conflict` it answers.
 */
export const IDEMPOTENCY_CONFLICT_MESSAGE =
  "That submission key was already used for a different order.";

// Feedback and empty states: §0.5.5 split into content-feedback.ts ---------------------------------
export * from "./content-feedback";
