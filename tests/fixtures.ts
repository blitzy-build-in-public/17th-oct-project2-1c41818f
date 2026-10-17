/**
 * Path: tests/fixtures.ts
 * Purpose: Deterministic builders for products, customers, orders, carts and report results used by every test
 * Lines: 600
 */

// The dependencies are imported as namespaces, and only here: each builder needs a different handful
// of their names, so a name used alone, or long enough to wrap a signature, is imported by name.
import type { ProductPerformance, ReportDefinition, ReportResult } from "@/types/analytics";
import type { PaymentSummary, ShippingMethod } from "@/types/commerce";
import type * as Account from "@/types/account";
import type * as Analytics from "@/types/analytics";
import type * as Catalog from "@/types/catalog";
import type * as Commerce from "@/types/commerce";
import type * as Common from "@/types/common";
import * as config from "@/constants/config";
import { FEEDBACK_COPY, VALIDATION_MESSAGES } from "@/constants/content";
import * as taxonomy from "@/constants/taxonomy";
import { priceCartLines } from "@/lib/pricingService";
import { normalisePageSize, pageCountFor, pageFlagsFor } from "@/utils/collections";
import { roundMinorUnits } from "@/utils/format";
import * as strings from "@/utils/strings";
// The harness's single time basis: no builder reads a clock — every timestamp is pinned to FIXED_NOW
// (midday UTC, 15 October 2025) and every identifier derives from the fields a builder was handed. A
// session's expiry is the one value that must track the real clock, so the case needing one passes it.
/** The instant every fixture timestamp defaults to: midday UTC on 15 October 2025. */
export const FIXED_NOW = "2025-10-15T12:00:00.000Z";
export const FIXED_DATE = FIXED_NOW.slice(0, 10);
export const FIXED_EARLIER_DATE = "2025-01-01";
export const FIXED_LATER_DATE = "2025-12-31";
/** The trailing thirty-day range ending on FIXED_DATE, and the expiry a built session carries. */
export const FIXED_DATE_RANGE = { from: "2025-09-16", to: FIXED_DATE };
export const FIXED_SESSION_EXPIRY = new Date(
  Date.parse(FIXED_NOW) + config.SESSION_TTL_MS,
).toISOString();
/** Three products, priced apart so a sort, a subtotal or a ranking has something to order. */
const PRODUCT_SEEDS = [
  { name: "Aurora Desk Lamp", sku: "AUR-DL-001", priceMinor: 4_999 },
  { name: "Cascade Speaker", sku: "CAS-SP-002", priceMinor: 12_900 },
  { name: "Trailhead Kettle", sku: "TRL-KT-003", priceMinor: 3_499 },
] as const;
/** The child category every fixture product sits in, the brand it carries, and their vocabulary. */
const DEFAULT_CATEGORY = taxonomy.CATEGORY_DEFINITIONS[1];
const DEFAULT_BRAND = taxonomy.BRAND_DEFINITIONS[3];
const DEFAULT_REPORT_DEFINITION = taxonomy.REPORT_DEFINITIONS[0];
const DEFAULT_FACET_DEFINITION = taxonomy.FACET_DEFINITIONS[1];
/** The shipment default: the method config waives once a basket reaches the free-shipping floor. */
const DEFAULT_SHIPPING_METHOD: Commerce.ShippingMethod =
  config.SHIPPING_METHODS.find((method) => method.id === config.FREE_SHIPPING_METHOD_ID) ??
  config.SHIPPING_METHODS[0];
/** The demonstration customer every account-shaped fixture is built for. */
const CUSTOMER_FULL_NAME = "Dana Okafor";
const CUSTOMER_PHONE = "+1 503 555 0134";
/** The address book's two labels, which keep the two default addresses' identifiers apart. */
const BILLING_ADDRESS_LABEL = "Billing";
const IMAGE_SIZE_PX = 600;
/** Applies a builder's overrides over its defaults with one shallow spread, this file's policy: a
 * nested member replaced wholesale, `null` beats a default, an explicit `undefined` is skipped. */
function withDefaults<T extends object>(defaults: T, overrides?: Partial<T>): T {
  if (overrides === undefined) return defaults;
  const defined: Partial<T> = {};
  for (const key of Object.keys(overrides) as (keyof T)[]) {
    if (overrides[key] !== undefined) defined[key] = overrides[key];
  }
  return Object.assign({}, defaults, defined);
}
/** The generated inline SVG url an image carries: deterministic in its product and its position. */
function imageUrlFor(product: string, position: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(IMAGE_SIZE_PX)}" height="${String(IMAGE_SIZE_PX)}" role="img"><rect width="100%" height="100%" fill="#eef1f5"/><text x="50%" y="50%" text-anchor="middle" font-size="28">${product} ${String(position)}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
/** The order line a priced cart line becomes, so an order's lines always match its own snapshot. */
function orderLineFrom(line: Commerce.PricedCartLine): Commerce.OrderLine {
  const { id, productId, sku, unitPriceMinor, quantity, lineTotalMinor, imageUrl } = line;
  const productName = line.name;
  return { id, productId, productName, sku, unitPriceMinor, quantity, lineTotalMinor, imageUrl };
}
/** The slug the taxonomy declares for a name, or the name's own slug when it declares none. */
function slugForName(name: string): string {
  const declared = [...taxonomy.CATEGORY_DEFINITIONS, ...taxonomy.BRAND_DEFINITIONS];
  return declared.find((candidate) => candidate.name === name)?.slug ?? strings.slugify(name);
}
/** Builds a product image: the first seed product, position 0, 600×600, a generated SVG url. */
export function makeProductImage(overrides?: Partial<Catalog.ProductImage>): Catalog.ProductImage {
  const product = overrides?.productId ?? strings.productId(PRODUCT_SEEDS[0].name);
  const position = overrides?.position ?? 0;
  const defaults: Catalog.ProductImage = {
    id: `${product}-image-${String(position)}`,
    productId: product,
    url: imageUrlFor(product, position),
    alt: overrides?.alt ?? `${PRODUCT_SEEDS[0].name}, view ${String(position + 1)}`,
    width: IMAGE_SIZE_PX,
    height: IMAGE_SIZE_PX,
    position,
  };
  return withDefaults(defaults, overrides);
}
/** Builds a product: the first seed in stock and discounted, with features, specs and one image;
 * override `stockOnHand`, `status`, `name`, or `priceMinor` with `listPriceMinor`. */
export function makeProduct(overrides?: Partial<Catalog.Product>): Catalog.Product {
  const name = overrides?.name ?? PRODUCT_SEEDS[0].name;
  const id = overrides?.id ?? strings.productId(name);
  const priceMinor = overrides?.priceMinor ?? PRODUCT_SEEDS[0].priceMinor;
  const defaults: Catalog.Product = {
    id,
    sku: overrides?.sku ?? PRODUCT_SEEDS[0].sku,
    slug: overrides?.slug ?? strings.slugify(name),
    name,
    brandId: overrides?.brandId ?? strings.brandId(DEFAULT_BRAND.slug),
    categoryId: overrides?.categoryId ?? strings.categoryId(DEFAULT_CATEGORY.slug),
    summary: "A warm, dimmable desk lamp with a weighted base.",
    description: "Three brightness steps and a weighted base, for a desk that stays lit.",
    features: ["Dimmable in three steps", "Weighted anti-slip base", "Replaceable warm-white bulb"],
    specs: [{ label: "Finish", value: "Brushed brass" }],
    priceMinor,
    listPriceMinor: overrides?.listPriceMinor ?? priceMinor + 1_000,
    currency: config.DEFAULT_CURRENCY,
    ratingAverage: 4.5,
    ratingCount: 12,
    stockOnHand: 25,
    lowStockThreshold: 5,
    images: [makeProductImage({ productId: id })],
    tags: ["lighting", "desk"],
    status: "active",
    createdAt: FIXED_NOW,
  };
  return withDefaults(defaults, overrides);
}
/** Builds a category: the default child under its parent; override `parentId` for another node. */
export function makeCategory(overrides?: Partial<Catalog.Category>): Catalog.Category {
  const name = overrides?.name ?? DEFAULT_CATEGORY.name;
  const defaults: Catalog.Category = {
    id: overrides?.id ?? strings.categoryId(overrides?.slug ?? slugForName(name)),
    slug: overrides?.slug ?? slugForName(name),
    name,
    parentId: overrides?.parentId ?? strings.categoryId(taxonomy.CATEGORY_DEFINITIONS[0].slug),
    description: "Speakers, headphones and the cables that connect them.",
    position: 0,
  };
  return withDefaults(defaults, overrides);
}
/** Builds a brand: the default brand counting three products; override `name` or `productCount`. */
export function makeBrand(overrides?: Partial<Catalog.Brand>): Catalog.Brand {
  const name = overrides?.name ?? DEFAULT_BRAND.name;
  const defaults: Catalog.Brand = {
    id: overrides?.id ?? strings.brandId(overrides?.slug ?? slugForName(name)),
    slug: overrides?.slug ?? slugForName(name),
    name,
    description: "Studio-grade audio built for small rooms.",
    productCount: 3,
  };
  return withDefaults(defaults, overrides);
}
/** Builds a review: five stars, verified, one helpful vote; override `rating` or `customerName`. */
export function makeReview(overrides?: Partial<Catalog.Review>): Catalog.Review {
  const product = overrides?.productId ?? strings.productId(PRODUCT_SEEDS[0].name);
  const reviewer = overrides?.customerId ?? strings.customerId(config.DEMO_ACCOUNTS.CUSTOMER_EMAIL);
  const defaults: Catalog.Review = {
    id: overrides?.id ?? strings.reviewId(`${product} ${reviewer}`),
    productId: product,
    customerId: reviewer,
    customerName: CUSTOMER_FULL_NAME,
    rating: 5,
    title: "Warm light, solid base",
    body: "Arrived quickly and the dimmer moves smoothly. It has become the light I leave on.",
    createdAt: FIXED_NOW,
    helpfulCount: 1,
    verifiedPurchase: true,
  };
  return withDefaults(defaults, overrides);
}
/** Builds a facet value: the default brand term counted three times; override `count` or `selected`. */
export function makeFacetValue(overrides?: Partial<Catalog.FacetValue>): Catalog.FacetValue {
  const defaults: Catalog.FacetValue = {
    value: strings.brandId(DEFAULT_BRAND.slug),
    label: DEFAULT_BRAND.name,
    count: 3,
    selected: false,
  };
  return withDefaults(defaults, overrides);
}
/** Builds a facet: the brand terms facet holding one value; override `values`, `id` or `kind`. */
export function makeFacet(overrides?: Partial<Catalog.Facet>): Catalog.Facet {
  const defaults: Catalog.Facet = {
    id: DEFAULT_FACET_DEFINITION.id,
    label: DEFAULT_FACET_DEFINITION.label,
    kind: DEFAULT_FACET_DEFINITION.kind,
    values: [makeFacetValue()],
  };
  return withDefaults(defaults, overrides);
}
/** Builds an unfiltered first page sorted newest first; override `q`, a facet field or `page`. */
export function makeFilterState(overrides?: Partial<Catalog.FilterState>): Catalog.FilterState {
  const defaults: Catalog.FilterState = {
    q: "",
    categoryIds: [],
    brandIds: [],
    minPriceMinor: null,
    maxPriceMinor: null,
    minRating: null,
    inStockOnly: false,
    tags: [],
    sort: "newest",
    page: 1,
    pageSize: config.DEFAULT_PAGE_SIZE,
  };
  return withDefaults(defaults, overrides);
}
/** Builds a cart line: the first seed product, quantity one, capped at ten; override `quantity`. */
export function makeCartLine(overrides?: Partial<Commerce.CartLine>): Commerce.CartLine {
  const name = overrides?.name ?? PRODUCT_SEEDS[0].name;
  const seed = PRODUCT_SEEDS.find((entry) => entry.name === name) ?? PRODUCT_SEEDS[0];
  const product = overrides?.productId ?? strings.productId(name);
  const defaults: Commerce.CartLine = {
    id: overrides?.id ?? strings.cartLineId(name),
    productId: product,
    sku: overrides?.sku ?? seed.sku,
    name,
    unitPriceMinor: overrides?.unitPriceMinor ?? seed.priceMinor,
    quantity: 1,
    maxQuantity: 10,
    imageUrl: imageUrlFor(product, 0),
    addedAt: FIXED_NOW,
  };
  return withDefaults(defaults, overrides);
}
/** Builds a cart: one line and no promo code; override `lines`, `promoCode`, or `lines: []` empty. */
export function makeCart(overrides?: Partial<Commerce.Cart>): Commerce.Cart {
  const defaults: Commerce.Cart = {
    version: config.STORAGE_VERSION,
    lines: [makeCartLine()],
    promoCode: null,
    currency: config.DEFAULT_CURRENCY,
    updatedAt: FIXED_NOW,
  };
  return withDefaults(defaults, overrides);
}
/** Builds a promo code: 10% off an order basket, in the pinned 2025 window FIXED_EARLIER_DATE to
 * FIXED_LATER_DATE, so the default suits the pure `decidePromo` and row paths; a real-clock case
 * passes its own `startsAt`/`endsAt`. Override `kind` or `active`. */
export function makePromoCode(overrides?: Partial<Commerce.PromoCode>): Commerce.PromoCode {
  const defaults: Commerce.PromoCode = {
    code: "SAVE10",
    kind: "percent",
    value: 10,
    minSubtotalMinor: 2_500,
    appliesTo: "order",
    categoryIds: [],
    startsAt: FIXED_EARLIER_DATE,
    endsAt: FIXED_LATER_DATE,
    usageLimit: 100,
    usageCount: 0,
    active: true,
  };
  return withDefaults(defaults, overrides);
}
/** Builds a shipping method: the configured standard service, the one waived at the threshold. */
export function makeShippingMethod(overrides?: Partial<ShippingMethod>): ShippingMethod {
  return withDefaults({ ...DEFAULT_SHIPPING_METHOD }, overrides);
}
/** What a priced cart is built from — basket, code, method, currency — never a computed total. */
export interface PricedCartInput {
  readonly lines?: readonly Commerce.CartLine[];
  readonly promo?: Commerce.PromoCode;
  readonly shippingMethodId?: string | null;
  readonly currency?: Common.CurrencyCode;
}
/** Builds a priced cart through `priceCartLines`, the product's single pricing home: it subtracts the
 * discount, resolves the delivery charge from the discounted subtotal and taxes those goods, so
 * `subtotal - discount + shipping + tax` is the grand total; an absent `shippingMethodId` means the
 * method the threshold waives, and an explicit `null` the product's no-method-chosen state. */
export function makePricedCart(overrides?: PricedCartInput): Commerce.PricedCart {
  const { shippingMethodId = config.FREE_SHIPPING_METHOD_ID } = overrides ?? {};
  const priced = priceCartLines({
    lines: overrides?.lines ?? [makeCartLine()],
    promo: overrides?.promo,
    shippingMethodId,
  });
  return overrides?.currency === undefined ? priced : { ...priced, currency: overrides.currency };
}
/** Builds an order line: one unit at the seed price; override `quantity` and `unitPriceMinor`. */
export function makeOrderLine(overrides?: Partial<Commerce.OrderLine>): Commerce.OrderLine {
  const productName = overrides?.productName ?? PRODUCT_SEEDS[0].name;
  const seed = PRODUCT_SEEDS.find((entry) => entry.name === productName) ?? PRODUCT_SEEDS[0];
  const quantity = overrides?.quantity ?? 1;
  const unitPriceMinor = overrides?.unitPriceMinor ?? seed.priceMinor;
  const defaults: Commerce.OrderLine = {
    id: overrides?.id ?? strings.cartLineId(productName),
    productId: overrides?.productId ?? strings.productId(productName),
    productName,
    sku: overrides?.sku ?? seed.sku,
    unitPriceMinor,
    quantity,
    lineTotalMinor: unitPriceMinor * quantity,
    imageUrl: imageUrlFor(overrides?.productId ?? strings.productId(productName), 0),
  };
  return withDefaults(defaults, overrides);
}
/** Builds a payment summary: an authorised Visa ending 4242; override `status` or `method`. */
export function makePaymentSummary(overrides?: Partial<PaymentSummary>): PaymentSummary {
  const defaults: PaymentSummary = {
    method: "card",
    status: "authorised",
    brand: "Visa",
    last4: config.DEMO_CARD_NUMBERS.APPROVED.slice(-4),
    authorisedAt: FIXED_NOW,
  };
  return withDefaults(defaults, overrides);
}
/** Builds an order from a priced cart, the snapshot's lines becoming the order's lines so the two
 * reconcile; override `pricedCart`, `status`, or `customerId: null` for a guest order. */
export function makeOrder(overrides?: Partial<Commerce.Order>): Commerce.Order {
  const orderNumber = overrides?.orderNumber ?? "SP-100001";
  const snapshot = overrides?.pricedCart ?? makePricedCart();
  const defaults: Commerce.Order = {
    id: overrides?.id ?? strings.orderId(orderNumber),
    orderNumber,
    customerId: strings.customerId(config.DEMO_ACCOUNTS.CUSTOMER_EMAIL),
    email: config.DEMO_ACCOUNTS.CUSTOMER_EMAIL,
    status: "confirmed",
    lines: snapshot.lines.map(orderLineFrom),
    shippingAddress: makeAddress(),
    billingAddress: makeAddress({ label: BILLING_ADDRESS_LABEL, isDefaultBilling: true }),
    shippingMethodId: snapshot.shippingMethodId ?? config.FREE_SHIPPING_METHOD_ID,
    payment: makePaymentSummary(),
    pricedCart: snapshot,
    placedAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    statusHistory: [{ status: "confirmed", at: FIXED_NOW, note: "Payment authorised." }],
    idempotencyKey: `order-${orderNumber}`,
  };
  return withDefaults(defaults, overrides);
}
/** Builds the customer's default shipping address; override `label` for another in the same book. */
export function makeAddress(overrides?: Partial<Account.Address>): Account.Address {
  const label = overrides?.label ?? "Home";
  const defaults: Account.Address = {
    id: overrides?.id ?? strings.addressId(`${config.DEMO_ACCOUNTS.CUSTOMER_EMAIL} ${label}`),
    label,
    fullName: CUSTOMER_FULL_NAME,
    line1: "12 Beacon Street",
    line2: "",
    city: "Portland",
    region: "OR",
    postalCode: "97205",
    country: taxonomy.SUPPORTED_COUNTRIES[0].code,
    phone: CUSTOMER_PHONE,
    isDefaultShipping: true,
    isDefaultBilling: false,
  };
  return withDefaults(defaults, overrides);
}
/** Builds the demonstration customer: silver tier, signed in; override `role: "admin"`. */
export function makeCustomer(overrides?: Partial<Account.Customer>): Account.Customer {
  const email = overrides?.email ?? config.DEMO_ACCOUNTS.CUSTOMER_EMAIL;
  const defaults: Account.Customer = {
    id: overrides?.id ?? strings.customerId(email),
    email,
    firstName: "Dana",
    lastName: "Okafor",
    phone: CUSTOMER_PHONE,
    role: "customer",
    createdAt: `${FIXED_EARLIER_DATE}T09:00:00.000Z`,
    lastLoginAt: FIXED_NOW,
    loyaltyTier: "silver",
    marketingOptIn: false,
    addressIds: [],
  };
  return withDefaults(defaults, overrides);
}
/** Builds an active session issued at FIXED_NOW, expiring one TTL later; override `role` or `expiresAt` —
 * a fresh future instant for a session the seam, which judges expiry against the real clock, accepts. */
export function makeSession(overrides?: Partial<Account.Session>): Account.Session {
  const accountId =
    overrides?.customerId ?? strings.customerId(config.DEMO_ACCOUNTS.CUSTOMER_EMAIL);
  const role = overrides?.role ?? "customer";
  const defaults: Account.Session = {
    token: overrides?.token ?? strings.sessionToken(`${accountId} ${role} ${FIXED_NOW}`),
    customerId: accountId,
    role,
    issuedAt: FIXED_NOW,
    expiresAt: FIXED_SESSION_EXPIRY,
  };
  return withDefaults(defaults, overrides);
}
/** The sales-report row for one daily fact, its net revenue computed from its own gross and cuts. */
function salesRow(fact: Analytics.SalesRecord): Analytics.ReportRow {
  const cells = {
    period: fact.date,
    orders: fact.orders,
    units: fact.units,
    grossRevenue: fact.grossRevenueMinor,
    discounts: fact.discountMinor,
    refunds: fact.refundMinor,
    netRevenue: fact.netRevenueMinor,
  };
  return { id: fact.date, cells };
}
/** The number a report cell holds, or zero for a cell that is absent or does not hold a number. */
function numericCell(row: Analytics.ReportRow, key: string): number {
  const value = row.cells[key];
  return typeof value === "number" ? value : 0;
}
/** Summarises sales rows: every figure totalled from the rows it is displayed above. */
function summariseSalesRows(rows: readonly Analytics.ReportRow[]): Analytics.ReportSummary {
  const orders = rows.reduce((sum, row) => sum + numericCell(row, "orders"), 0);
  const netRevenue = rows.reduce((sum, row) => sum + numericCell(row, "netRevenue"), 0);
  const average = orders === 0 ? 0 : roundMinorUnits(netRevenue / orders);
  return {
    items: [
      { key: "netRevenue", label: "Net revenue", value: netRevenue, format: "money" },
      { key: "averageOrderValue", label: "Average order value", value: average, format: "money" },
    ],
  };
}
/** Builds a daily sales fact: web channel, net revenue computed; override `date` or the money. */
export function makeSalesRecord(overrides?: Partial<Analytics.SalesRecord>): Analytics.SalesRecord {
  const grossRevenueMinor = overrides?.grossRevenueMinor ?? 45_990;
  const discountMinor = overrides?.discountMinor ?? 2_500;
  const refundMinor = overrides?.refundMinor ?? 0;
  const defaults: Analytics.SalesRecord = {
    date: FIXED_DATE,
    categoryId: strings.categoryId(DEFAULT_CATEGORY.slug),
    channel: "web",
    orders: 8,
    units: 11,
    grossRevenueMinor,
    discountMinor,
    refundMinor,
    netRevenueMinor: grossRevenueMinor - discountMinor - refundMinor,
  };
  return withDefaults(defaults, overrides);
}
/** Builds a product's performance, ranked first; override `units`, `productName` or `rank`. */
export function makeProductPerformance(overrides?: Partial<ProductPerformance>) {
  const seed = PRODUCT_SEEDS[0];
  const productName = overrides?.productName ?? seed.name;
  const units = overrides?.units ?? 12;
  const grossRevenueMinor = overrides?.grossRevenueMinor ?? units * seed.priceMinor;
  const discountMinor = overrides?.discountMinor ?? 1_200;
  const defaults: ProductPerformance = {
    productId: overrides?.productId ?? strings.productId(productName),
    productName,
    sku: overrides?.sku ?? seed.sku,
    categoryId: strings.categoryId(DEFAULT_CATEGORY.slug),
    units,
    orders: 9,
    grossRevenueMinor,
    discountMinor,
    netRevenueMinor: grossRevenueMinor - discountMinor,
    rank: 1,
    sharePercent: 18.4,
  };
  return withDefaults(defaults, overrides);
}
/** Builds the previous-period baseline before FIXED_DATE_RANGE; override `kind` and its dates. */
export function makeKpiBaseline(overrides?: Partial<Analytics.KpiBaseline>): Analytics.KpiBaseline {
  const defaults: Analytics.KpiBaseline = {
    kind: "previous-period",
    from: "2025-08-17",
    to: "2025-09-15",
    revenueChangePercent: 6.4,
    ordersChangePercent: 3.1,
    unitsChangePercent: 4.8,
    averageOrderValueChangePercent: 1.2,
  };
  return withDefaults(defaults, overrides);
}
/** Builds a KPI summary over FIXED_DATE_RANGE; override its money fields, or `orders: 0` empty. */
export function makeKpiSummary(overrides?: Partial<Analytics.KpiSummary>): Analytics.KpiSummary {
  const revenueMinor = overrides?.revenueMinor ?? 1_284_500;
  const orders = overrides?.orders ?? 96;
  const defaults: Analytics.KpiSummary = {
    from: FIXED_DATE_RANGE.from,
    to: FIXED_DATE_RANGE.to,
    revenueMinor,
    orders,
    units: 268,
    averageOrderValueMinor: orders === 0 ? 0 : roundMinorUnits(revenueMinor / orders),
    newCustomers: 14,
    conversionRate: 0.032,
    baseline: makeKpiBaseline(),
  };
  return withDefaults(defaults, overrides);
}
/** Builds a plotted point: FIXED_DATE and its revenue; override `x`, `y` or `label`. */
export function makeChartPoint(overrides?: Partial<Analytics.ChartPoint>): Analytics.ChartPoint {
  return withDefaults({ x: FIXED_DATE, y: 45_990, label: FIXED_DATE }, overrides);
}
/** Builds a two-point net-revenue series; override `points`, or `label` for a second series. */
export function makeChartSeries(overrides?: Partial<Analytics.ChartSeries>): Analytics.ChartSeries {
  const defaults: Analytics.ChartSeries = {
    id: "revenue",
    label: "Net revenue",
    color: config.CHART_SERIES_TOKEN_REFERENCES[0],
    points: [makeChartPoint(), makeChartPoint({ x: "2025-10-16", y: 52_400 })],
  };
  return withDefaults(defaults, overrides);
}
/** The chart series: one point per row at its own period, so no bucket plots outside the range. */
function seriesFromRows(rows: readonly Analytics.ReportRow[]): Analytics.ChartSeries {
  const points = rows.map((row) => {
    const period: string = String(row.cells.period ?? "");
    return { x: period, y: numericCell(row, "netRevenue"), label: period };
  });
  return makeChartSeries({ points });
}
/** Builds the sales report definition with its own columns; override `kind` and `columns`. */
export function makeReportDefinition(overrides?: Partial<ReportDefinition>): ReportDefinition {
  const defaults: ReportDefinition = {
    ...DEFAULT_REPORT_DEFINITION,
    columns: [...DEFAULT_REPORT_DEFINITION.columns],
  };
  return withDefaults(defaults, overrides);
}
/** Builds a run sales report whose summary and chart derive from its own rows; override `rows`. */
export function makeReportResult(overrides?: Partial<ReportResult>): ReportResult {
  const rows = overrides?.rows ?? [
    salesRow(makeSalesRecord({ date: "2025-09-16", orders: 84, units: 231 })),
    salesRow(makeSalesRecord({ date: "2025-09-17", orders: 91, units: 248 })),
  ];
  const defaults: ReportResult = {
    definitionId: DEFAULT_REPORT_DEFINITION.id,
    kind: DEFAULT_REPORT_DEFINITION.kind,
    from: FIXED_DATE_RANGE.from,
    to: FIXED_DATE_RANGE.to,
    granularity: DEFAULT_REPORT_DEFINITION.granularity,
    rows,
    summary: summariseSalesRows(rows),
    series: [seriesFromRows(rows)],
    generatedAt: FIXED_NOW,
  };
  return withDefaults(defaults, overrides);
}
/** Wraps items in a page whose paging rule is `utils/collections`: an out-of-set size reads as the
 * default and a non-finite total is one page; count and flags are derived, not overridable. */
export function makePageResult<TItem>(
  items: readonly TItem[],
  overrides?: Omit<Partial<Common.PageResult<TItem>>, "pageCount" | "hasNext" | "hasPrevious">,
): Common.PageResult<TItem> {
  const page = overrides?.page ?? 1;
  const pageSize = normalisePageSize(overrides?.pageSize ?? config.DEFAULT_PAGE_SIZE);
  const total = overrides?.total ?? items.length;
  const pageCount = pageCountFor(total, pageSize);
  const defaults: Common.PageResult<TItem> = {
    items: [...items],
    total,
    page,
    pageSize,
    pageCount,
    ...pageFlagsFor(page, pageCount),
  };
  return withDefaults(defaults, { ...overrides, pageSize });
}
/** Wraps a value in a successful result, the shape every service returns instead of throwing. */
export function makeResult<TValue>(value: TValue): Common.Result<TValue> {
  return { ok: true, value };
}
/** Wraps an error in a failed result, as the seam answers when a request cannot be completed. */
export function makeFailureResult<TValue = never>(error: Common.ApiError): Common.Result<TValue> {
  return { ok: false, error };
}
/** Builds the transport's own 500 error; override `status`, `code`, `message` or `field`. */
export function makeApiError(overrides?: Partial<Common.ApiError>): Common.ApiError {
  const defaults: Common.ApiError = {
    status: 500,
    code: "unexpected-error", // the transport's own code: src/lib/apiClient.ts, src/state/hooks.ts
    message: FEEDBACK_COPY.ERROR_STATE_BODY,
  };
  return withDefaults(defaults, overrides);
}
/** Builds a field-keyed error map holding one email error; override the keys or pass `{}`. */
export function makeFieldErrors(overrides?: Common.FieldErrors): Common.FieldErrors {
  return { email: VALIDATION_MESSAGES.EMAIL_FORMAT, ...overrides };
}
/** Builds the customer with its address book: one default shipping and one default billing address. */
export function makeCustomerWithAddresses(overrides?: Partial<Account.Customer>): {
  readonly customer: Account.Customer;
  readonly addresses: readonly Account.Address[];
} {
  const shipping = makeAddress();
  const billing = makeAddress({
    label: BILLING_ADDRESS_LABEL,
    isDefaultShipping: false,
    isDefaultBilling: true,
  });
  const addressIds = overrides?.addressIds ?? [shipping.id, billing.id];
  return {
    customer: makeCustomer({ ...overrides, addressIds }),
    addresses: [shipping, billing],
  };
}
/** Builds a cart of one line per seed product, up to three, at quantities one to three: a cart holds
 * one line per product, so a longer basket passes its own `lines` override. */
export function makeCartWithLines(count = 3, overrides?: Partial<Commerce.Cart>): Commerce.Cart {
  const lines = PRODUCT_SEEDS.slice(0, Math.max(0, Math.min(count, PRODUCT_SEEDS.length))).map(
    (seed, index) => makeCartLine({ name: seed.name, quantity: index + 1 }),
  );
  return makeCart({ ...overrides, lines: overrides?.lines ?? lines });
}
