/**
 * Path: src/constants/content-account.ts
 * Purpose: The account register of the user-facing copy: signing in and registering, the profile, the loyalty labels, the order history and the address book, split out of src/constants/content.ts, which re-exports them
 * Lines: 105
 */

import type { LoyaltyTier } from "@/types/account";
import type { PaymentMethod } from "@/types/commerce";

/*
 * The account register, kept beside `src/constants/content.ts` rather than inside it, is one concern: the
 * copy the sign-in page, the registration page, the account shell and its profile, orders and addresses
 * pages render. The account copy grew past the 600 lines one file may hold, so the register is split by
 * surface rather than the ceiling raised: this file owns the account sections and `src/constants/content.ts`
 * re-exports it, so no consumer's import path changes and no exported name changes. The dependency
 * runs one way — this file imports nothing from content.ts, so the account copy has one home.
 */

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
  PROFILE_EMAIL_HINT: "This address identifies your account and cannot be changed here.",
  PROFILE_TIER_LABEL: "Loyalty tier",
  PROFILE_MEMBER_SINCE_LABEL: "Member since",
  ORDERS_HEADING: "Order history",
  ORDERS_STATUS_FILTER_LABEL: "Filter by status",
  ORDERS_STATUS_ANY_LABEL: "All statuses",
  ORDERS_DATE_FILTER_LABEL: "Filter by the date the order was placed",
  ORDERS_NO_MATCH_TITLE: "No orders match these filters",
  ORDERS_NO_MATCH_DESCRIPTION: "Widen the period or choose another status.",
  ORDERS_COLUMN_ORDER: "Order",
  ORDERS_COLUMN_PLACED: "Placed",
  ORDERS_COLUMN_STATUS: "Status",
  ORDERS_COLUMN_ITEMS: "Items",
  ORDERS_COLUMN_TOTAL: "Total",
  ORDER_DETAIL_BACK_LABEL: "Back to your orders",
  ORDER_DETAIL_ITEMS_HEADING: "Items",
  ORDER_DETAIL_TOTALS_HEADING: "Totals",
  ORDER_DETAIL_ADDRESS_HEADING: "Shipping address",
  ORDER_DETAIL_BILLING_ADDRESS_HEADING: "Billing address",
  ORDER_DETAIL_PAYMENT_HEADING: "Payment",
  ORDER_DETAIL_HISTORY_HEADING: "Status history",
  ORDER_DETAIL_UPDATED_LABEL: "Last updated",
  ADDRESS_BOOK_HEADING: "Address book",
  ADD_ADDRESS_LABEL: "Add an address",
  // The address book's own field, and this register's only word for one: `AddressInput.label` names a saved
  // address rather than a body member the checkout's shipping values carry.
  ADDRESS_LABEL_FIELD_LABEL: "Label",
  ADDRESS_LABEL_FIELD_HINT: "Your own name for this address, such as Home or Work",
  DEFAULT_SHIPPING_BADGE: "Default shipping",
  DEFAULT_BILLING_BADGE: "Default billing",
  SET_DEFAULT_SHIPPING_LABEL: "Make this the default shipping address",
  SET_DEFAULT_BILLING_LABEL: "Make this the default billing address",
  REMOVE_ADDRESS_DIALOG_TITLE: "Remove this address?",
  REMOVE_ADDRESS_DIALOG_BODY: "Orders already placed keep the address they were sent to.",
  CONFIRM_REMOVE_ADDRESS_LABEL: "Remove address",
} as const;
/**
 * What each seeded loyalty label reads as beside its heading on the profile.
 *
 * A label and nothing more: loyalty point accounting is out of scope, so no balance, earning rate or
 * redemption is stated or computed anywhere, and `src/data/customers.ts` assigns the tier once when it
 * seeds an account. Consumer: `src/features/account/ProfilePage.tsx`.
 */
export const LOYALTY_TIER_LABELS: Readonly<Record<LoyaltyTier, string>> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};
/** Describes the password rule from the minimum length `src/constants/config.ts` owns. */
export const passwordHintLabel = (minLength: number): string =>
  `At least ${minLength} characters, with one letter and one digit.`;
/** Names the control that deletes one address, using that address's own label. */
export const removeAddressLabel = (addressLabel: string): string => `Remove ${addressLabel}`;
/** Lists the seeded demonstration accounts and the password they share. */
export const demoSignInHint = (adminEmail: string, userEmail: string, password: string): string =>
  `Seeded accounts: ${adminEmail} for the dashboard and ${userEmail} for a customer account, both with the password ${password}.`;
/** What each payment method reads as when the order carries no card to name. */
export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  card: "Card",
  invoice: "Invoice",
};
