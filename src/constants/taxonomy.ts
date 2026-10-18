/**
 * Path: src/constants/taxonomy.ts
 * Purpose: The controlled vocabulary: categories, brands, sort keys, order statuses, facet and report definitions
 * Lines: 552
 */

import { CHECKOUT_COPY } from "@/constants/checkoutCopy";
import type { AddressInput } from "@/types/account";
import type {
  BaselineKind,
  BucketGranularity,
  ReportColumn,
  ReportDefinition,
} from "@/types/analytics";
import type { FacetId, FacetKind, RatingValue, SortKey } from "@/types/catalog";
import type { OrderStatus, PromoKind } from "@/types/commerce";
import type { MinorUnits, SelectOption } from "@/types/common";

// Badge vocabulary --------------------------------------------------------------------------------

/**
 * The badge variants a component may render, and the union the shared `Badge` in
 * `src/components/ui/Card.tsx` accepts, so a status cannot name a variant that does not exist:
 * `src/types` declares no UI vocabulary, so this union lives here beside the statuses that use it.
 *
 * `accent` is the brand register and closes the vocabulary at six, because the seven order statuses
 * have to read as seven different pills and the five semantic registers alone cannot carry them: the
 * three statuses still in flight would otherwise share one register, and a status that is merely under
 * way would have to borrow the success register that means the order arrived or the danger register
 * that means it did not. Its tint pair is `--color-accent-subtle` and `--color-accent-contrast`.
 */
export const BADGE_VARIANTS = [
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
  "accent",
] as const;

/** One badge variant: the ramp from the neutral surface to the negative one, and the brand's own accent. */
export type BadgeVariant = (typeof BADGE_VARIANTS)[number];

// Categories --------------------------------------------------------------------------------------

/**
 * A category as the vocabulary declares it: the slug and name that identify it, and the slug of the
 * parent it hangs under, which is `null` for a parent.
 *
 * `src/data/categories.ts` expands each entry into the `Category` and `CategoryNode` entities of
 * `src/types/catalog.ts`, which add the identifier, the position and the derived product counts; no
 * id and no count is declared here, and every `parentSlug` names a parent in this same array.
 */
export interface CategoryDefinition {
  readonly slug: string;
  readonly name: string;
  readonly parentSlug: string | null;
}

/**
 * The catalogue's 20 categories: the 8 parents in the order the home page's showcase renders them,
 * each followed by its own children, whose 12 slugs are the category facet terms
 * `src/lib/catalogService.ts` offers.
 */
export const CATEGORY_DEFINITIONS = [
  { slug: "electronics", name: "Electronics", parentSlug: null },
  { slug: "audio", name: "Audio", parentSlug: "electronics" },
  { slug: "cameras", name: "Cameras", parentSlug: "electronics" },
  { slug: "laptops", name: "Laptops", parentSlug: "electronics" },
  { slug: "phones-accessories", name: "Phones & Accessories", parentSlug: "electronics" },
  { slug: "home-kitchen", name: "Home & Kitchen", parentSlug: null },
  { slug: "cookware", name: "Cookware", parentSlug: "home-kitchen" },
  { slug: "furniture", name: "Furniture", parentSlug: "home-kitchen" },
  { slug: "sports-outdoors", name: "Sports & Outdoors", parentSlug: null },
  { slug: "fitness", name: "Fitness", parentSlug: "sports-outdoors" },
  { slug: "camping", name: "Camping", parentSlug: "sports-outdoors" },
  { slug: "fashion", name: "Fashion", parentSlug: null },
  { slug: "mens-clothing", name: "Men's Clothing", parentSlug: "fashion" },
  { slug: "womens-clothing", name: "Women's Clothing", parentSlug: "fashion" },
  { slug: "beauty-health", name: "Beauty & Health", parentSlug: null },
  { slug: "skin-care", name: "Skin Care", parentSlug: "beauty-health" },
  { slug: "toys-games", name: "Toys & Games", parentSlug: null },
  { slug: "board-games", name: "Board Games", parentSlug: "toys-games" },
  { slug: "office", name: "Office", parentSlug: null },
  { slug: "automotive", name: "Automotive", parentSlug: null },
] as const satisfies readonly CategoryDefinition[];

// Brands ------------------------------------------------------------------------------------------

/**
 * A brand as the vocabulary declares it: the slug that identifies it and the name it displays.
 * `src/data/products.ts` expands these into `Brand` entities carrying an id and a product count,
 * and `src/lib/catalogService.ts` labels every brand facet term from the expanded name.
 */
export interface BrandDefinition {
  readonly slug: string;
  readonly name: string;
}

/**
 * The twelve brands the seeded catalogue's 140 products are distributed across, each one plausible
 * in at least one of the categories above.
 */
export const BRAND_DEFINITIONS = [
  { slug: "aurelia-audio", name: "Aurelia Audio" },
  { slug: "northcrest", name: "Northcrest" },
  { slug: "kestrel-optics", name: "Kestrel Optics" },
  { slug: "lumen-labs", name: "Lumen Labs" },
  { slug: "tidewell", name: "Tidewell" },
  { slug: "emberlane-home", name: "Emberlane Home" },
  { slug: "vantage-sports", name: "Vantage Sports" },
  { slug: "summit-gear", name: "Summit Gear" },
  { slug: "meridian", name: "Meridian" },
  { slug: "boreal-outdoors", name: "Boreal Outdoors" },
  { slug: "cobalt-works", name: "Cobalt Works" },
  { slug: "pinnacle-play", name: "Pinnacle Play" },
] as const satisfies readonly BrandDefinition[];

// Sorting -----------------------------------------------------------------------------------------

/**
 * One sort choice: the `SortKey` the URL carries and the wording the sort control shows for it,
 * aliased to the shared `SelectOption` so every option list in the product shares one shape.
 */
export type SortOption = SelectOption<SortKey>;

/**
 * The six orders a listing or a set of search results can be put in, read by
 * `src/features/search/SortControl.tsx` for its options and by `src/lib/catalogService.ts`'s
 * `compareBy` for its comparators; `relevance` is the default while a query term is present, and the
 * other five are absolute orders that need none.
 */
export const SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "rating-desc", label: "Highest rated" },
  { value: "newest", label: "Newest" },
  { value: "popularity", label: "Most popular" },
] as const satisfies readonly SortOption[];

// Order statuses ----------------------------------------------------------------------------------

/**
 * One order status with the words and the badge it renders as: the status from
 * `src/types/commerce.ts`, the label a shopper reads, the variant that colours it and whether that
 * variant is drawn as an outline rather than as a tinted pill.
 *
 * The pair `(badgeVariant, isOutline)` is the status's whole treatment, and the seven statuses below
 * hold seven different pairs. Two channels rather than one is what makes that possible and what keeps
 * the distinction alive where colour is not: the outline pill is a border and the tinted one is not, so
 * the two differ in forced-colours mode, where every tinted background is overridden.
 */
export interface OrderStatusOption extends SelectOption<OrderStatus> {
  readonly badgeVariant: BadgeVariant;
  /** Draws `badgeVariant` as the outline treatment of `src/styles/data-display.css`, false by default. */
  readonly isOutline?: boolean;
}

/**
 * The seven statuses an order can hold, in filter order, and the single lookup every surface reads:
 * the order history's status column and filter, the order detail's timeline, the dashboard's
 * recent-orders table and `src/lib/orderService.ts`'s transitions, none of which writes its own
 * switch over statuses. `refunded` is labelled and never reached: no refund workflow is in scope.
 *
 * Each status's treatment is chosen here once, so that no two statuses read alike wherever they appear:
 * `pending` is the neutral pill of an order nothing has been done with, `confirmed` the info pill that
 * says the order was accepted, `processing` the same register in the outline treatment that says the
 * work is under way rather than settled, `shipped` the accent pill of an order on its way, `delivered`
 * the success pill of an order that arrived, `cancelled` the danger pill of one that will not, and
 * `refunded` the warning pill of one that was undone.
 */
export const ORDER_STATUS_OPTIONS = [
  { value: "pending", label: "Pending", badgeVariant: "neutral" },
  { value: "confirmed", label: "Confirmed", badgeVariant: "info" },
  { value: "processing", label: "Processing", badgeVariant: "info", isOutline: true },
  { value: "shipped", label: "Shipped", badgeVariant: "accent" },
  { value: "delivered", label: "Delivered", badgeVariant: "success" },
  { value: "cancelled", label: "Cancelled", badgeVariant: "danger" },
  { value: "refunded", label: "Refunded", badgeVariant: "warning" },
] as const satisfies readonly OrderStatusOption[];

// Facets ------------------------------------------------------------------------------------------

/**
 * One selectable value of a facet as the vocabulary declares it: the stable key the URL carries,
 * the shopper's wording for it, and either the minor-unit bounds of a price band, inclusive at both
 * ends, or the rating floor an "and up" value filters on.
 */
export interface FacetDefinitionOption extends SelectOption {
  readonly minMinor?: MinorUnits;
  readonly maxMinor?: MinorUnits;
  readonly minRating?: RatingValue;
}

/**
 * One facet of the filter panel: its identity, its heading, the kind of control it needs and, where
 * its values are fixed, the values themselves. `category` and `brand` declare none, because
 * `src/lib/catalogService.ts` supplies their terms from the catalogue the endpoint serves, counting each
 * facet with that facet's own selection excluded so no selection empties the other values.
 */
export interface FacetDefinition {
  readonly id: FacetId;
  readonly label: string;
  readonly kind: FacetKind;
  readonly options?: readonly FacetDefinitionOption[];
}

/**
 * The five facets the filter panel renders, in the order it renders them, and the headings and value
 * labels `src/features/search/FilterPanel.tsx` and `ActiveFilters.tsx` iterate rather than write.
 * The price bands are contiguous with the top band open-ended, and a rating value is its digit.
 */
export const FACET_DEFINITIONS = [
  { id: "category", label: "Category", kind: "terms" },
  { id: "brand", label: "Brand", kind: "terms" },
  {
    id: "price",
    label: "Price",
    kind: "range",
    options: [
      { value: "under-25", label: "Under $25", maxMinor: 2499 },
      { value: "25-50", label: "$25 to $50", minMinor: 2500, maxMinor: 4999 },
      { value: "50-100", label: "$50 to $100", minMinor: 5000, maxMinor: 9999 },
      { value: "100-200", label: "$100 to $200", minMinor: 10000, maxMinor: 19999 },
      { value: "200-plus", label: "$200 and up", minMinor: 20000 },
    ],
  },
  {
    id: "rating",
    label: "Customer rating",
    kind: "terms",
    options: [
      { value: "4", label: "4 stars & up", minRating: 4 },
      { value: "3", label: "3 stars & up", minRating: 3 },
      { value: "2", label: "2 stars & up", minRating: 2 },
    ],
  },
  {
    id: "availability",
    label: "Availability",
    kind: "boolean",
    options: [{ value: "in-stock", label: "In stock only" }],
  },
] as const satisfies readonly FacetDefinition[];

// Reports -----------------------------------------------------------------------------------------

/**
 * The sales report's columns: a period, its orders and units, and the money it brought in, the
 * period cell holding the bucket's ISO start date. The table, the CSV export and the chart beside
 * them all read this one list.
 */
const SALES_REPORT_COLUMNS = [
  { key: "period", label: "Period", format: "date", align: "start", sortable: true },
  { key: "orders", label: "Orders", format: "integer", align: "end", sortable: true },
  { key: "units", label: "Units", format: "integer", align: "end", sortable: true },
  { key: "grossRevenue", label: "Gross revenue", format: "money", align: "end", sortable: true },
  { key: "discounts", label: "Discounts", format: "money", align: "end", sortable: true },
  { key: "refunds", label: "Refunds", format: "money", align: "end", sortable: true },
  {
    key: "netRevenue",
    label: "Net revenue",
    format: "money",
    align: "end",
    sortable: true,
    isTotal: true,
  },
] as const satisfies readonly ReportColumn[];

/**
 * The product-performance report's columns: the product, the units it sold, the revenue it brought,
 * its share of the range's revenue and the average price a unit went for.
 */
const PRODUCT_REPORT_COLUMNS = [
  { key: "product", label: "Product", format: "text", align: "start", sortable: true },
  { key: "unitsSold", label: "Units sold", format: "integer", align: "end", sortable: true },
  {
    key: "revenue",
    label: "Revenue",
    format: "money",
    align: "end",
    sortable: true,
    isTotal: true,
  },
  {
    key: "revenueShare",
    label: "Share of revenue",
    format: "percent",
    align: "end",
    sortable: true,
  },
  {
    key: "averageUnitPrice",
    label: "Average unit price",
    format: "money",
    align: "end",
    sortable: true,
  },
] as const satisfies readonly ReportColumn[];

/**
 * The customer report's columns: a period, the customers it won and kept, their orders and what
 * those orders were worth, the period cell holding the bucket's ISO start date.
 */
const CUSTOMER_REPORT_COLUMNS = [
  { key: "period", label: "Period", format: "date", align: "start", sortable: true },
  { key: "newCustomers", label: "New customers", format: "integer", align: "end", sortable: true },
  {
    key: "returningCustomers",
    label: "Returning customers",
    format: "integer",
    align: "end",
    sortable: true,
  },
  { key: "orders", label: "Orders", format: "integer", align: "end", sortable: true },
  {
    key: "revenue",
    label: "Revenue",
    format: "money",
    align: "end",
    sortable: true,
    isTotal: true,
  },
  {
    key: "averageOrderValue",
    label: "Average order value",
    format: "money",
    align: "end",
    sortable: true,
  },
] as const satisfies readonly ReportColumn[];

/**
 * The three reports the reports route offers, each naming what it answers, the columns its table and
 * its export share, the cut used when the query asks for no other, and whether a range must be
 * resolved before it runs.
 *
 * Consumers: `src/lib/reportService.ts` (`listReportDefinitions`, `buildRows`, `toCsvMatrix`) and
 * `src/features/reports/ReportsPage.tsx` with its three views and `ReportTable.tsx`, which renders
 * the same `columns` list the CSV export writes, so a download matches the rows on screen.
 */
export const REPORT_DEFINITIONS = [
  {
    id: "report-sales",
    kind: "sales",
    name: "Sales",
    description: "Orders, units and net revenue for each period in the range.",
    columns: SALES_REPORT_COLUMNS,
    granularity: "day",
    requiresRange: true,
  },
  {
    id: "report-products",
    kind: "products",
    name: "Product performance",
    description: "What sold in the range, in what quantity and for what share of its revenue.",
    columns: PRODUCT_REPORT_COLUMNS,
    granularity: "month",
    requiresRange: true,
  },
  {
    id: "report-customers",
    kind: "customers",
    name: "Customers",
    description:
      "New against returning customers, their orders and the value those orders carried.",
    columns: CUSTOMER_REPORT_COLUMNS,
    granularity: "month",
    requiresRange: true,
  },
] as const satisfies readonly ReportDefinition[];

// Periods -----------------------------------------------------------------------------------------

/** The three cuts a revenue series can be bucketed by, for the bucket control to render. */
export const GRANULARITY_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const satisfies readonly SelectOption<BucketGranularity>[];

/**
 * What a change percentage is measured against, for the baseline control to render. The control
 * exists because a comparison must name its baseline rather than imply one: week-over-week and
 * year-over-year are different claims, and the KPI card states which one it makes.
 */
export const BASELINE_OPTIONS = [
  { value: "previous-period", label: "Previous period" },
  { value: "previous-year", label: "Previous year" },
] as const satisfies readonly SelectOption<BaselineKind>[];

// Promotions --------------------------------------------------------------------------------------

/**
 * The wording for each way a promo code can discount, read by the applied-promo line in
 * `src/features/cart/CartSummary.tsx`. A code that cannot be applied is answered with a message from
 * `src/constants/content.ts`; only the kind labels are vocabulary and live here.
 */
export const PROMO_KIND_LABELS: Readonly<Record<PromoKind, string>> = {
  percent: "Percentage discount",
  fixed: "Fixed amount off",
  free_shipping: "Free shipping",
};

// Countries ---------------------------------------------------------------------------------------

/**
 * One country an address may name: its ISO code, the label a shopper reads and the pattern its
 * postal code must match. `postalCodePattern` is a regular-expression source string — no delimiters,
 * no flags — that `src/utils/validation.ts` compiles without the global flag, because a `/g` pattern
 * carries `lastIndex` state and would make a postal code pass and then fail on the same value.
 */
export interface CountryOption {
  readonly code: string;
  readonly label: string;
  readonly postalCodePattern: string;
}

/**
 * The countries an address may be entered in, iterated for their country select by
 * `src/features/checkout/ShippingForm.tsx` and `src/features/account/AddressBookPage.tsx`; the first
 * entry is the default.
 */
export const SUPPORTED_COUNTRIES = [
  { code: "US", label: "United States", postalCodePattern: "^\\d{5}(-\\d{4})?$" },
  { code: "CA", label: "Canada", postalCodePattern: "^[A-Za-z]\\d[A-Za-z][ -]?\\d[A-Za-z]\\d$" },
  {
    code: "GB",
    label: "United Kingdom",
    postalCodePattern: "^[A-Za-z]{1,2}\\d[A-Za-z\\d]?\\s?\\d[A-Za-z]{2}$",
  },
  { code: "AU", label: "Australia", postalCodePattern: "^\\d{4}$" },
  { code: "DE", label: "Germany", postalCodePattern: "^\\d{5}$" },
] as const satisfies readonly CountryOption[];

/**
 * The display name a stored country code reads as, so one address renders the same way wherever the product
 * shows it: the order confirmation's and the order detail's address blocks resolve their codes through here.
 *
 * The code is matched against the configured set ignoring surrounding space and case, because the code reaches
 * this vocabulary from a stored address rather than from the select that wrote it. A code the set does not
 * carry reads as itself rather than as nothing, so an address entered before a country left the list still
 * names the country it was entered in.
 *
 * @param code - The country code a stored address carries.
 * @returns The label the configured entry declares, or the code as given when no entry carries it.
 */
export function countryLabel(code: string): string {
  const wanted = code.trim().toUpperCase();
  return SUPPORTED_COUNTRIES.find((country) => country.code === wanted)?.label ?? code;
}

// Address fields ----------------------------------------------------------------------------------

/**
 * One member of the address body a form field writes: `AddressInput`'s members bar `label`, which names
 * an address-book entry rather than a control.
 */
export type AddressFieldMember = Exclude<keyof AddressInput, "label">;

/** The country field's choices, mapped once from the set above, which owns the codes and the labels. */
const COUNTRY_CHOICES: readonly SelectOption[] = SUPPORTED_COUNTRIES.map((country) => ({
  value: country.code,
  label: country.label,
}));

/**
 * One field of an address form: the body member its control writes, the words it is labelled with,
 * whether the address rule requires it, and what the control carries besides its value — a supporting
 * line, the input type, or the choices of a field that is picked rather than typed.
 */
export interface AddressFieldSpec {
  /** The body member the control writes, which is also the `name` its error is filed under. */
  readonly member: AddressFieldMember;
  /** The control's label, read from the copy the checkout step and the address book share. */
  readonly label: string;
  /** What the browser's own autofill is told this field is, so an address it already holds can be
   * filled in: the standard HTML autofill field names, which the browser resolves itself, with no
   * service and no request behind them. */
  readonly autoComplete: string;
  /** Whether the address rule requires the member, which the control passes on as its own requirement. */
  readonly required: boolean;
  /** A supporting line under the control, where the copy library words one for it. */
  readonly hint?: string;
  /** The input type: `tel` for the one field a numeric keypad suits, text for the rest. */
  readonly type?: "text" | "tel";
  /** The choices of a field that is picked rather than typed, which the country field carries. */
  readonly options?: readonly SelectOption[];
}

/**
 * The address body's fields, in the order both forms render them, iterated by
 * `src/features/checkout/ShippingForm.tsx` for the delivery address and by
 * `src/features/account/AddressBookPage.tsx` for an address-book entry: the field set, its labels, its
 * requirements and its autofill tokens are stated once here, so the delivery address and the address
 * book cannot drift apart on any of them.
 */
export const ADDRESS_FIELDS: readonly AddressFieldSpec[] = [
  {
    member: "fullName",
    label: CHECKOUT_COPY.FULL_NAME_LABEL,
    autoComplete: "name",
    required: true,
  },
  {
    member: "line1",
    label: CHECKOUT_COPY.ADDRESS_LINE_1_LABEL,
    autoComplete: "address-line1",
    required: true,
  },
  {
    member: "line2",
    label: CHECKOUT_COPY.ADDRESS_LINE_2_LABEL,
    hint: CHECKOUT_COPY.ADDRESS_LINE_2_HINT,
    autoComplete: "address-line2",
    required: false,
  },
  {
    member: "city",
    label: CHECKOUT_COPY.CITY_LABEL,
    autoComplete: "address-level2",
    required: true,
  },
  {
    member: "region",
    label: CHECKOUT_COPY.REGION_LABEL,
    autoComplete: "address-level1",
    required: true,
  },
  {
    member: "postalCode",
    label: CHECKOUT_COPY.POSTAL_CODE_LABEL,
    autoComplete: "postal-code",
    required: true,
  },
  {
    member: "country",
    label: CHECKOUT_COPY.COUNTRY_LABEL,
    autoComplete: "country",
    required: true,
    options: COUNTRY_CHOICES,
  },
  {
    member: "phone",
    label: CHECKOUT_COPY.PHONE_LABEL,
    hint: CHECKOUT_COPY.PHONE_HINT,
    autoComplete: "tel",
    required: false,
    type: "tel",
  },
];
