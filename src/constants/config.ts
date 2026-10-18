/**
 * Path: src/constants/config.ts
 * Purpose: Configuration and keys: storage keys, tax rate, shipping thresholds, page sizes, breakpoints and latency default
 * Lines: 433
 */

import type { CurrencyCode, ToastKind } from "@/types/common";
import type { ShippingMethod } from "@/types/commerce";

// Persistence ----------------------------------------------------------------------------------

/**
 * Namespace every storage key is built from, so a value SalesPro writes cannot collide with a key
 * another application on the same origin writes.
 *
 * Consumer: the `STORAGE_KEYS` set below, which derives each of its entries from it.
 */
export const STORAGE_KEY_PREFIX = "salespro";

/**
 * The keys of the six pieces of durable state the product keeps — the cart, the session token, the
 * demonstration account store's session table, this browser's own writes to the seeded collections, the
 * placement credential of each order it placed without an account and the last-used report range — and of
 * nothing else. Search history stays in memory in `src/features/search/SearchBar.tsx`, and the catalogue is
 * never persisted.
 *
 * Three of the six exist because the collections themselves are rebuilt from the frozen seed on every
 * document load: `SESSIONS` keeps each issued session's own issue instant and expiry, `CLIENT_WRITES` holds
 * what this browser placed, registered or edited, which `src/data/clientWrites.ts` replays onto that seed,
 * and `ORDER_TOKENS` holds the read credential a session-less buyer's own confirmation is reopened with.
 *
 * Consumer: `src/utils/storage.ts`, the only module in the product that touches `localStorage`. It
 * reads every key from here so no caller invents one, and stamps each payload with
 * `STORAGE_VERSION` so a shape written by an older build is discarded rather than migrated.
 */
export const STORAGE_KEYS = {
  /** The persisted cart: its lines, its promo code and when it last changed. */
  CART: `${STORAGE_KEY_PREFIX}.cart`,
  /** The persisted session token, restored and revalidated on the next page load. */
  SESSION: `${STORAGE_KEY_PREFIX}.session`,
  /**
   * The demonstration account store's session table: every session the store has issued, keyed by
   * its token, so a persisted token keeps its own issue instant and expiry across a reload. That is
   * what makes the seven-day window a fixed window rather than one that restarts whenever a token
   * is presented (§0.12.2), and it is what lets a live session survive a reload (§0.1.1).
   */
  SESSIONS: `${STORAGE_KEY_PREFIX}.sessions`,
  /** The last report range an administrator chose, so the dashboard reopens where it was left. */
  REPORT_RANGE: `${STORAGE_KEY_PREFIX}.report-range`,
  /** The read credential of each order this browser placed without an account, so the buyer's own
   * confirmation can be reopened after a reload. It holds order identifiers and their placement
   * credentials only: no personal data, no payment data and no credential of any account. */
  ORDER_TOKENS: `${STORAGE_KEY_PREFIX}.order-tokens`,
  /** This browser's own writes to the seeded collections — the orders it placed, the accounts it
   * registered together with the digests that verify them, the profiles it edited and the address
   * books it wrote, alongside the marks its order minting has reached — replayed onto the seed by
   * `src/data/clientWrites.ts` when a data source is built. */
  CLIENT_WRITES: `${STORAGE_KEY_PREFIX}.writes`,
} as const;

/**
 * The shape version stamped into every stored payload.
 *
 * Consumer: `src/utils/storage.ts`, which compares it against the version it reads back and treats
 * a mismatch as an absent value — a cart written by an older build is discarded rather than
 * migrated into a shape `src/state/cartReducer.ts` cannot read. Raise it whenever a stored shape
 * changes incompatibly.
 */
export const STORAGE_VERSION = 1;

// Money and tax --------------------------------------------------------------------------------

/**
 * The one currency every amount in the product is expressed in.
 *
 * Consumer: `src/lib/pricingService.ts` copies it onto every `PricedCart` it returns, and
 * `src/utils/format.ts` renders the code. Multi-currency pricing is out of scope, so this is a
 * literal rather than a configurable value.
 */
export const DEFAULT_CURRENCY: CurrencyCode = "USD";

/**
 * Sales tax as a decimal rate, applied by `src/lib/pricingService.ts` to the subtotal remaining
 * after every discount, and to nothing else.
 *
 * Money is integer minor units end to end: the amount is computed once and rounded once through the
 * single minor-unit rounding rule in `src/utils/format.ts`, so no displayed total is ever the
 * product of decimal arithmetic. This is the rate's only home — the cart, the checkout, the
 * confirmation and the order detail all read the amount `pricingService` computed from it rather
 * than recomputing one of their own.
 */
export const TAX_RATE = 0.0825;

/**
 * The highest price the seeded catalogue carries, in minor units: the ceiling every price-range bound
 * is confined to.
 *
 * Consumers: `src/utils/queryParams.ts`, whose price normalisation clamps both bounds to it, so the
 * filter cannot express a range the catalogue cannot fill and an absurd bound and the catalogue's own
 * top price write one canonical URL. It is the dearest price the seeded catalogue reaches
 * (`src/data/products.ts`), so clamping to it excludes no product.
 */
export const CATALOGUE_PRICE_CEILING_MINOR = 189_999;

// Shipping -------------------------------------------------------------------------------------

/**
 * The five delivery methods a checkout may offer, with what each costs and how long it takes.
 *
 * These are immutable, plan-priced configuration rather than seeded records — the plan defines no
 * data file for them, and their prices must stay coherent with `FREE_SHIPPING_THRESHOLD_MINOR` and
 * `FREE_SHIPPING_METHOD_ID` below — so this list is their single home. `src/data/repositories.ts`
 * imports `SHIPPING_METHODS` and returns it from the data source that answers
 * `GET /api/shipping-methods`, rather than declaring a second list.
 *
 * `priceMinor` is the method's own charge in integer cents; `src/lib/pricingService.ts` overrides it
 * to zero at or above the free-shipping threshold, and the checkout renders `name` and
 * `description`. Promo codes deliberately do not live here: a code's `usageCount` mutates as it is
 * used, so codes are seeded runtime data owned by the data layer, with their application rules in
 * `src/lib/pricingService.ts`.
 */
export const SHIPPING_METHODS = [
  {
    id: "ship_pickup",
    name: "Store pickup",
    description: "Collect the order from the store counter the same day, at no charge.",
    priceMinor: 0,
    minDays: 0,
    maxDays: 0,
  },
  {
    id: "ship_economy",
    name: "Economy",
    description: "The lowest-cost service, dispatched by ground and arriving within a week.",
    priceMinor: 599,
    minDays: 5,
    maxDays: 8,
  },
  {
    id: "ship_standard",
    name: "Standard",
    description: "Everyday tracked delivery by ground, free once the order reaches the threshold.",
    priceMinor: 899,
    minDays: 3,
    maxDays: 5,
  },
  {
    id: "ship_expedited",
    name: "Expedited",
    description: "A faster ground service that shortens the delivery window to a couple of days.",
    priceMinor: 1499,
    minDays: 2,
    maxDays: 3,
  },
  {
    id: "ship_express",
    name: "Express",
    description: "Next-day delivery for orders placed before the daily cut-off.",
    priceMinor: 2499,
    minDays: 1,
    maxDays: 1,
  },
] as const satisfies readonly ShippingMethod[];

/**
 * The order subtotal, in minor units, at or above which shipping is free.
 *
 * Consumers: `src/lib/pricingService.ts` (`freeShippingProgress` and the shipping charge it
 * computes) and `src/features/cart/CartSummary.tsx`, which renders the progress bar against it.
 * Written once so the threshold the cart advertises and the threshold pricing applies are the same
 * number.
 */
export const FREE_SHIPPING_THRESHOLD_MINOR = 7500;

/**
 * The method that becomes free at or above `FREE_SHIPPING_THRESHOLD_MINOR`.
 *
 * Consumer: `src/lib/pricingService.ts`, which reads it instead of hard-coding a method id, so
 * changing which service is discounted is a change to this value alone.
 */
export const FREE_SHIPPING_METHOD_ID = "ship_standard";

// Paging ---------------------------------------------------------------------------------------

/**
 * The page sizes a listing may be read at.
 *
 * Consumers: `src/utils/queryParams.ts` validates the `pageSize` parameter against it,
 * `src/components/ui/Pagination.tsx` renders one choice per entry, and the catalogue, the order
 * history, the dashboard tables and the report tables all page with one of these three sizes. A
 * `pageSize` outside the set is normalised back to `DEFAULT_PAGE_SIZE` before it reaches a service.
 */
export const PAGE_SIZE_OPTIONS = [12, 24, 48] as const;

/** One of the configured page sizes, as the paging controls and the URL state carry it. */
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

/**
 * The page size a listing starts from when the URL names none.
 *
 * Consumers: `src/utils/queryParams.ts` (the default it omits and writes back) and
 * `src/components/ui/Table.tsx` (the size its pagination control opens on). The smallest option, so
 * a first page renders quickly and the reader opts into more per page.
 */
export const DEFAULT_PAGE_SIZE = 12;

// Simulated transport --------------------------------------------------------------------------

/**
 * How long `src/lib/mockServer.ts` delays a response when nothing overrides it, in milliseconds.
 *
 * The delay is what keeps every page's loading skeleton observable in the browser. The mock server
 * reads `import.meta.env.VITE_API_LATENCY_MS` and uses that value in this one's place when the
 * variable is set — including `0`, which is how the test suite runs without waiting. This module
 * reads no environment variable itself and holds no `import.meta.env` reference, because the
 * override belongs at the seam that applies it.
 */
export const DEFAULT_API_LATENCY_MS = 120;

// Responsive breakpoints -----------------------------------------------------------------------

/**
 * The four viewport widths, in pixels, that the layout rules switch at, in ascending order.
 *
 * This module is the authority for the numbers. `src/styles/tokens.css` repeats them as media-query
 * literals and names this file as their owner, because CSS cannot evaluate a custom property inside
 * a media query; the two must be changed together.
 *
 * The rules that use them: the facet panel becomes a drawer below `XLARGE`; the product grid runs
 * two columns at `SMALL`, three at `MEDIUM` and four at `LARGE`; the header navigation collapses
 * behind a menu below `SMALL`; and the administrator sidebar is a compact icon rail below `LARGE`.
 */
export const BREAKPOINTS = {
  SMALL: 480,
  MEDIUM: 768,
  LARGE: 1024,
  XLARGE: 1280,
} as const;

/** The name of one of the four layout stops, as the media-query hook in `src/components/ui/hooks.ts` takes it. */
export type Breakpoint = keyof typeof BREAKPOINTS;

// Client-side protections ----------------------------------------------------------------------

/**
 * How many listing requests a single view keeps in flight at once.
 *
 * Consumers: `src/state/CatalogContext.tsx` and the report views under `src/features/reports/`,
 * which let a newer query supersede an in-flight one rather than queueing behind it. The product
 * makes no network request and enforces no server-side quota, so this value and the three limits
 * below are what stand in for one.
 */
export const MAX_IN_FLIGHT_REQUESTS_PER_VIEW = 1;

/**
 * How long type-ahead input settles before a suggestion request is issued, in milliseconds.
 *
 * Consumer: `src/features/search/SearchBar.tsx`, through the debounce in `src/utils/async.ts`, so a
 * burst of keystrokes produces one request rather than one per character.
 */
export const SEARCH_SUGGESTION_DEBOUNCE_MS = 250;

/**
 * The most suggestions a type-ahead response may carry.
 *
 * Consumers: `src/lib/searchService.ts` (`suggest`) and `src/features/search/SearchSuggestions.tsx`,
 * which renders the list. Keeping the cap here means the service and the list cannot disagree about
 * the longest list the shopper can arrow through.
 */
export const SEARCH_SUGGESTION_LIMIT = 8;

/**
 * How many related products a product detail page asks for by default.
 *
 * Consumers: `src/lib/catalogService.ts` (`getRelated`) and
 * `src/features/catalog/ProductDetailPage.tsx`, which renders a strip of this length.
 */
export const RELATED_PRODUCTS_LIMIT = 4;

/**
 * How long an issued session stays valid, in milliseconds: seven days.
 *
 * Consumers: `src/utils/accountRules.ts` and `src/lib/mockServer.ts`, which stamp a session's
 * `expiresAt` from it. A session past this point fails to restore, and the visitor is signed out
 * rather than left in a half-authenticated state.
 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Report and export limits ---------------------------------------------------------------------

/**
 * How many days the dashboard and the reports cover when no range has been chosen: the trailing
 * thirty days.
 *
 * Consumers: `src/features/reports/DateRangePicker.tsx` (its default and its "last 30 days"
 * preset), `src/lib/reportService.ts` and `src/lib/analyticsService.ts`.
 */
export const DEFAULT_REPORT_RANGE_DAYS = 30;

/**
 * The longest report range the product accepts, in days: one leap year.
 *
 * Enforced by `src/utils/dates.ts` when a range is validated and surfaced as an inline message by
 * `src/features/reports/DateRangePicker.tsx`, so an unbounded range cannot reach a report query.
 */
export const MAX_REPORT_RANGE_DAYS = 366;

/**
 * The most data rows a CSV export may contain.
 *
 * Consumer: `src/utils/csv.ts`, which truncates to this many rows so an export stays loadable in a
 * spreadsheet. The export is a snapshot of the report on screen, and the tables page, so nothing the
 * reader can see is dropped without the export saying so.
 */
export const CSV_MAX_ROWS = 10000;

/**
 * The longest cell text a CSV export may contain, in characters.
 *
 * Consumer: `src/utils/csv.ts`, which clips a longer value to this length before escaping it. Held
 * below the spreadsheet cell limit so an escaped value cannot exceed what a reader can open.
 */
export const CSV_MAX_CELL_LENGTH = 32000;

// Credential policy ----------------------------------------------------------------------------

/**
 * The password rule `src/utils/validation.ts` enforces on registration and on a password change.
 *
 * Kept here so the rule and the hint `src/constants/content.ts` shows the visitor cannot disagree:
 * the hint phrases these numbers rather than restating them. `DEMO_ACCOUNTS.PASSWORD` satisfies it.
 */
export const PASSWORD_POLICY = {
  /** Fewest characters an accepted password may have. */
  MIN_LENGTH: 8,
  /** Whether an accepted password must contain at least one letter. */
  REQUIRE_LETTER: true,
  /** Whether an accepted password must contain at least one digit. */
  REQUIRE_DIGIT: true,
} as const;

// Chart series ---------------------------------------------------------------------------------

/**
 * The token references the chart series are coloured with, in assignment order.
 *
 * These are references, not colours: `src/styles/tokens.css` declares the twelve `--chart-series-N`
 * values and holds the colour literals alone, so no TypeScript module carries one.
 * `src/lib/analyticsService.ts` assigns a reference to each `ChartSeries.color` by index, and
 * `src/styles/chart-series.css` maps the same references onto its series classes. The product's
 * twelve revenue categories — the widest split any chart of this product draws — each carry their
 * own reference, so no wrap occurs; a series index past the twelfth wraps back to the first.
 */
export const CHART_SERIES_TOKEN_REFERENCES = [
  "var(--chart-series-1)",
  "var(--chart-series-2)",
  "var(--chart-series-3)",
  "var(--chart-series-4)",
  "var(--chart-series-5)",
  "var(--chart-series-6)",
  "var(--chart-series-7)",
  "var(--chart-series-8)",
  "var(--chart-series-9)",
  "var(--chart-series-10)",
  "var(--chart-series-11)",
  "var(--chart-series-12)",
] as const;

// Demonstration surface ------------------------------------------------------------------------

/**
 * The accounts the demonstration credential store is documented to hold.
 *
 * This is a demonstration-only in-browser store, not a security boundary: no real credential exists
 * behind it, and a real deployment would move session issue and verification behind the server
 * `src/lib/apiClient.ts` is built to be repointed at. What is stored is a salted digest produced by
 * `src/utils/strings.ts`, never the password itself.
 *
 * Consumers: `src/data/customers.ts`, which seeds the two administrators and the thirty-eight
 * customers and digests this password; `src/lib/mockServer.ts`, which answers sign-in;
 * `tests/fixtures.ts`; and the two integration tests that sign in,
 * `tests/integration/accountFlow.test.tsx` and `tests/integration/adminReportsFlow.test.tsx`.
 * `README.md` and `docs/mock-api.md` restate the pair in prose.
 */
export const DEMO_ACCOUNTS = {
  /** Email of the seeded administrator, the only role that reaches the dashboard and reports. */
  ADMIN_EMAIL: "admin@salespro.test",
  /** Email of the seeded customer, used by the shopping, checkout and account flows. */
  CUSTOMER_EMAIL: "shopper@salespro.test",
  /** The password every seeded account shares, digested by `src/utils/strings.ts`. */
  PASSWORD: "Shopper1234",
} as const;

/**
 * The two card numbers that decide a demonstration payment's outcome.
 *
 * `APPROVED` authorises and is captured; `DECLINED` answers `402`. Both pass the Luhn check
 * `src/utils/validation.ts` applies, so a decline is the mock server's decision rather than a
 * validation failure the checkout form would catch first. The number is never stored — only its
 * last four digits and the decision are recorded on the order.
 *
 * Consumers: `src/lib/mockServer.ts` and `tests/integration/checkoutFlow.test.tsx`, so one pair
 * covers both sides of the demonstration.
 */
export const DEMO_CARD_NUMBERS = {
  /** Authorises the order and is captured. */
  APPROVED: "4242424242424242",
  /** Answers `402`, giving the declined path a deterministic trigger. */
  DECLINED: "4000000000000002",
} as const;

// Notifications --------------------------------------------------------------------------------

/**
 * The single home of the queue's duration policy: how long a message of each kind
 * stays on screen unless the caller overrides it through `ToastInput.durationMs`.
 *
 * A failure needs longer to read than a confirmation, which is why an error
 * outlasts a success or an info note. The viewport reads the resolved value from
 * the message it renders, so it carries no copy of these numbers.
 */
export const TOAST_DURATION_MS: Readonly<Record<ToastKind, number>> = {
  success: 5000,
  error: 8000,
  info: 5000,
};

/**
 * How many notifications a burst may leave on screen. A burst longer than this
 * keeps the newest and lets the oldest go, so an action that reports twice cannot
 * stack a column of notices over the page it is reporting on.
 */
export const TOAST_MAX_VISIBLE = 4;
