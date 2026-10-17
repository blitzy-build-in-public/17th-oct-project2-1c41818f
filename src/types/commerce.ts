/**
 * Path: src/types/commerce.ts
 * Purpose: Commerce shapes: cart, line, promo code, shipping method, priced cart, order, payment and status
 * Lines: 455
 */

import type { Address } from "@/types/account";
import type {
  CategoryId,
  CurrencyCode,
  CustomerId,
  IsoDateString,
  IsoDateTimeString,
  LineId,
  MinorUnits,
  OrderId,
  ProductId,
} from "@/types/common";

// Cart -----------------------------------------------------------------------------------------

/**
 * One line of the cart: a product the shopper added, the price it carried at that moment and the
 * ceiling its quantity may reach.
 *
 * Stock: `maxQuantity` is copied from the product's stock when the line is created and is the
 * ceiling `src/state/cartReducer.ts` clamps every quantity change against. When a product goes out
 * of stock afterwards, the reducer clamps the stored quantity down to what is still purchasable and
 * the cart shows an availability warning, rather than keeping a quantity that cannot be bought.
 *
 * Money: `unitPriceMinor` is the line's own price in minor units, before any line or order discount.
 * The totals a shopper reads come from the `PricedCart` that `src/lib/pricingService.ts` returns,
 * never from arithmetic on this shape, which is why the line carries no computed total.
 *
 * The line copies the name, the sku and the image so the cart and the mini-cart render without a
 * request per line, and `addedAt` keeps the cart in the order the shopper built it. `imageUrl` is a
 * deterministic inline SVG data URI, so no image is ever fetched.
 */
export interface CartLine {
  readonly id: LineId;
  readonly productId: ProductId;
  readonly sku: string;
  readonly name: string;
  readonly unitPriceMinor: MinorUnits;
  readonly quantity: number;
  readonly maxQuantity: number;
  readonly imageUrl: string;
  readonly addedAt: IsoDateTimeString;
}

/**
 * The shopper's cart: its lines, the promo code they applied and the currency every amount is in.
 *
 * It is persisted verbatim through `src/utils/storage.ts` under the key in `src/constants/config.ts`
 * and restored from there on load, which is why it is a plain serialisable shape and why `version`
 * exists: it records the cart shape the stored copy was written against and is bumped when that
 * shape changes, so a copy left by an older build is discarded rather than read as the current one.
 *
 * The cart is held in the browser rather than on a server, because the product has no server to hold
 * it on. `currency` travels with it so every amount on its lines has its currency alongside it, and
 * `updatedAt` advances on every change.
 */
export interface Cart {
  readonly version: number;
  readonly lines: readonly CartLine[];
  readonly promoCode: string | null;
  readonly currency: CurrencyCode;
  readonly updatedAt: IsoDateTimeString;
}

// Promotions -----------------------------------------------------------------------------------

/**
 * How a promo code reduces an order.
 *
 * `percent` takes a percentage off the eligible amount, `fixed` takes a flat number of minor units
 * off it and `free_shipping` waives the delivery charge without touching the goods total. Which one
 * is in play decides how `PromoCode.value` is read and in what order `src/lib/pricingService.ts`
 * applies the reduction.
 */
export type PromoKind = "percent" | "fixed" | "free_shipping";

/**
 * What a promo code is allowed to discount: the whole basket for `order`, or only the lines whose
 * products sit in `PromoCode.categoryIds` for `category`. A code whose categories no line belongs to
 * is rejected as ineligible rather than silently discounting nothing.
 */
export type PromoScope = "order" | "category";

/**
 * A discount the shopper applies to the cart by code, with the window and the limits that decide
 * whether it may be applied at all.
 *
 * The seeded set belongs to `src/data` and `src/lib/pricingService.ts` is the only module that
 * decides whether a code applies; the cart and the checkout render its outcome, and a code that
 * cannot apply is answered with a `PromoRejectionReason` rather than a generic failure. The
 * conditions the product enforces live here as data rather than as behaviour: `active`, the window
 * between `startsAt` and `endsAt`, the floor `minSubtotalMinor`, and the room left under
 * `usageLimit`.
 *
 * Value semantics: `value` is a percentage between 0 and 100 for `percent` and a number of minor
 * units for `fixed`, while a `free_shipping` code never reads it. `code` is matched
 * case-insensitively, so the spelling a shopper types is not significant.
 */
export interface PromoCode {
  readonly code: string;
  readonly kind: PromoKind;
  readonly value: number;
  readonly minSubtotalMinor: MinorUnits;
  readonly appliesTo: PromoScope;
  readonly categoryIds: readonly CategoryId[];
  readonly startsAt: IsoDateString;
  readonly endsAt: IsoDateString;
  readonly usageLimit: number;
  readonly usageCount: number;
  readonly active: boolean;
}

/**
 * Why a promo code could not be applied, stated as a reason rather than as a failure.
 *
 * The reason travels as the `code` of the `ApiError` inside the failing `Result<PromoCode>` that
 * validation answers with, so the cart names the cause — unknown, withdrawn, not yet started,
 * expired, below the basket floor, out of uses, already applied, or aimed at categories the basket
 * does not hold — instead of reporting one message for all eight. `unknown` covers a code that was
 * never issued and `inactive` one that was withdrawn while remaining in the catalogue. The wording a
 * shopper reads comes from `src/constants`, not from this file.
 */
export type PromoRejectionReason =
  | "unknown"
  | "inactive"
  | "not-started"
  | "expired"
  | "below-minimum"
  | "usage-limit"
  | "already-applied"
  | "ineligible-category";

// Shipping -------------------------------------------------------------------------------------

/**
 * A way of delivering an order, with what it costs and how long it takes.
 *
 * The seeded methods belong to `src/data` and each `id` is a short slug that the checkout stores on
 * the order and the summary panel names the method from. `priceMinor` is the method's own charge and
 * is overridden to zero once the basket reaches the free-shipping threshold in
 * `src/constants/config.ts`; that override happens in `src/lib/pricingService.ts`, so the stored
 * price and the charged price are two different numbers and this shape carries the stored one.
 *
 * `minDays` and `maxDays` bound the delivery estimate the confirmation renders; nothing promises a
 * date outside that span.
 */
export interface ShippingMethod {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly priceMinor: MinorUnits;
  readonly minDays: number;
  readonly maxDays: number;
}

// Pricing --------------------------------------------------------------------------------------

/**
 * A promo code that has reduced an order, with the amount it took off.
 *
 * `label` is the description the summary panel and the order detail render beside the amount; the
 * wording belongs to `src/constants`, and keeping the label on the applied promo means no surface
 * has to rebuild it from the code and the kind.
 */
export interface AppliedPromo {
  readonly code: string;
  readonly kind: PromoKind;
  readonly label: string;
  readonly amountMinor: MinorUnits;
}

/**
 * A cart line as the pricing service priced it: the line itself plus the three amounts computed for
 * it, and nothing else.
 *
 * `lineSubtotalMinor` is the unit price times the quantity, `discountMinor` is this line's share of
 * every applied discount — including the part of a category-scoped code that reaches it — and
 * `lineTotalMinor` is the difference between the two. Only `src/lib/pricingService.ts` computes
 * them, so a surface that needs a line total reads it here instead of multiplying anything itself.
 */
export type PricedCartLine = CartLine & {
  readonly lineSubtotalMinor: MinorUnits;
  readonly discountMinor: MinorUnits;
  readonly lineTotalMinor: MinorUnits;
};

/**
 * The priced cart: every amount a shopper reads on the cart, the checkout, the confirmation, the
 * account's order detail and the reports.
 *
 * This is the only shape any screen displays as a total, and every number in it is produced by
 * `src/lib/pricingService.ts`. No component adds a subtotal, applies a percentage or rounds a tax
 * amount of its own, because a second implementation of that arithmetic is how two screens come to
 * disagree about what an order costs. `grandTotalMinor` is always present rather than derived on
 * demand, which is what lets a placed order keep the total it was placed with even after a price, a
 * tax rate or a shipping charge changes.
 *
 * The order of operations the numbers reflect is the pricing service's: line subtotals, then
 * discounts, then shipping — waived once the basket reaches the free-shipping threshold — then tax
 * on the discounted goods. `freeShippingRemainingMinor` is what the cart's progress indicator
 * reports: zero once the threshold is met, and the shortfall until then.
 *
 * `currency` is carried because the formatter needs it to render each amount, and
 * `shippingMethodId` echoes the method that was chosen so the summary panel can name it; it is
 * `null` before one is chosen.
 */
export interface PricedCart {
  readonly lines: readonly PricedCartLine[];
  readonly subtotalMinor: MinorUnits;
  readonly discountTotalMinor: MinorUnits;
  readonly shippingMinor: MinorUnits;
  readonly taxMinor: MinorUnits;
  readonly grandTotalMinor: MinorUnits;
  readonly appliedPromos: readonly AppliedPromo[];
  readonly freeShippingRemainingMinor: MinorUnits;
  readonly currency: CurrencyCode;
  readonly shippingMethodId: string | null;
}

// Orders and payment ---------------------------------------------------------------------------

/**
 * Where an order stands in its life.
 *
 * The transitions between the seven values are defined once in `src/lib/orderService.ts`'s
 * `nextStatus`, and the labels the shopper reads and the badge variants that render them come from
 * `src/constants/taxonomy.ts`, so this union carries the domain and neither the wording nor the
 * styling.
 *
 * `refunded` is carried as data and as a label only: no refund workflow is in scope, so nothing in
 * the product moves an order into it.
 */
export type OrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

/**
 * One entry in an order's status history: the status it reached, when it reached it and, for a step
 * worth explaining, a short note.
 *
 * The history is append-only — `src/lib/orderService.ts` appends an entry each time it moves an order
 * on — and the order detail renders it as the order's timeline.
 */
export interface OrderStatusHistoryEntry {
  readonly status: OrderStatus;
  readonly at: IsoDateTimeString;
  readonly note?: string;
}

/**
 * One line of a placed order: an immutable snapshot of what was bought and what it cost at the
 * moment of purchase.
 *
 * The snapshot is the point of the shape. A line keeps the product name, the sku and the unit price
 * it had when the order was placed, so a later catalogue edit — a rename, a price change, a product
 * withdrawn — cannot alter what a placed order says it was or what it cost.
 *
 * The line keeps its `productId` as well, which is what makes product performance computable from
 * the order collection: every line names the product it sold, whereas the sales fact rows are keyed
 * by category and channel and carry no product at all. `quantity` is what was bought, and
 * `lineTotalMinor` is what it cost at purchase time.
 */
export interface OrderLine {
  readonly id: LineId;
  readonly productId: ProductId;
  readonly productName: string;
  readonly sku: string;
  readonly unitPriceMinor: MinorUnits;
  readonly quantity: number;
  readonly lineTotalMinor: MinorUnits;
  readonly imageUrl: string;
}

/**
 * How an order is paid for: `card` through the demonstration card path, whose outcome
 * `src/lib/mockServer.ts` decides deterministically from the submitted number, or `invoice`, which is
 * recorded without a card.
 */
export type PaymentMethod = "card" | "invoice";

/**
 * What became of the payment: `authorised` for a card the demonstration accepted, `declined` for one
 * it rejected, `captured` for a payment taken in full, and `refunded` as data only, because no refund
 * workflow is in scope.
 */
export type PaymentStatus = "authorised" | "declined" | "captured" | "refunded";

/**
 * What an order records about how it was paid: the method, the outcome and the last four digits.
 *
 * Demonstration only, and this shape is where that boundary is visible: the card number is never
 * stored anywhere, only its last four digits and the decision that was reached, so no member here can
 * be used to charge a card again. `brand` and `last4` are `null` for an invoice, which carries no
 * card, and `authorisedAt` is `null` for a payment that was never authorised.
 */
export interface PaymentSummary {
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly brand: string | null;
  readonly last4: string | null;
  readonly authorisedAt: IsoDateTimeString | null;
}

/**
 * A placed order: the snapshot of what was bought, where it goes and what it cost.
 *
 * An order is built from the priced cart the buyer reviewed and keeps that cart entire, which is the
 * rule that keeps a placed order stable: its amounts were computed once, at the moment it was
 * placed, so a later change to a price, a tax rate or a shipping charge cannot move them.
 * `orderNumber` is the reference the confirmation and the order history show a shopper, deliberately
 * separate from `id`, the machine identifier the routes use.
 *
 * Identity: `customerId` is `null` for a guest checkout, so an order placed without signing in is a
 * first-class order rather than an anonymous one, and `email` is snapshotted so a later profile edit
 * cannot change where an order confirms to. `idempotencyKey` is the key the order was created with: a
 * repeat of that key returns this same order instead of placing a second, which is what makes a
 * double submission harmless. The two addresses are snapshots too, taken from the submission rather
 * than re-read from the address book, so editing or removing an address never rewrites a placed
 * order.
 */
export interface Order {
  readonly id: OrderId;
  readonly orderNumber: string;
  readonly customerId: CustomerId | null;
  readonly email: string;
  readonly status: OrderStatus;
  readonly lines: readonly OrderLine[];
  readonly shippingAddress: Address;
  readonly billingAddress: Address;
  readonly shippingMethodId: string;
  readonly payment: PaymentSummary;
  readonly pricedCart: PricedCart;
  readonly placedAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
  readonly statusHistory: readonly OrderStatusHistoryEntry[];
  readonly idempotencyKey: string;
}

/**
 * The priced cart an order is built from, named for the role it plays at that moment.
 *
 * The alias exists so the rule travels with the signature: an order is created from a snapshot and
 * keeps every amount the snapshot carried, so nothing about a placed order is recomputed afterwards.
 * It is the whole `PricedCart` rather than a narrower shape on purpose — an order records the
 * shipping method, the applied promos and the free-shipping position exactly as the buyer saw them.
 */
export type OrderSnapshot = PricedCart;

/**
 * The filters and the paging of a customer's own order history.
 *
 * The query carries no customer id: the history is scoped to the session's customer, so ownership is
 * decided by the token a request carries rather than by a parameter a caller could change. The three
 * optional members narrow the list — one status, and an inclusive window on when the order was
 * placed — and leaving them out lists everything the customer has ordered.
 */
export interface OrderHistoryQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly status?: OrderStatus;
  readonly from?: IsoDateString;
  readonly to?: IsoDateString;
}

// Checkout requests ----------------------------------------------------------------------------

/**
 * The body of the cart-pricing request: the lines to price, the promo code to apply and the chosen
 * shipping method.
 *
 * It carries the lines rather than a cart reference because the cart lives in the browser, and it
 * carries the promo code and the shipping method because either of them changes the answer it is
 * answered with.
 */
export interface CartPricingRequest {
  readonly lines: readonly CartLine[];
  readonly promoCode: string | null;
  readonly shippingMethodId: string | null;
}

/**
 * The body of the promo-code validation request: a code checked against the basket it is about to
 * discount, because a code's eligibility depends on those lines — a floor has to be met, and a
 * category-scoped code has to find a line in one of its categories.
 */
export interface PromoValidationRequest {
  readonly code: string;
  readonly lines: readonly CartLine[];
}

/**
 * The card a buyer enters at the payment step, in the shape the payment form holds it.
 *
 * It exists only for the length of the submission: the number is validated, reduced to its last four
 * digits and discarded, so nothing in the product stores it and nothing outside the in-process
 * request seam ever sees it. `expiryMonth` is 1 to 12 and `expiryYear` a four-digit year.
 *
 * The rules belong to `src/utils/validation.ts` — a 13-to-19 digit number that passes the Luhn
 * check, an expiry in the future, a three-to-four digit security code — and it returns a
 * `FieldErrors` map keyed by exactly these member names, which is how the payment form knows which
 * control to mark.
 */
export interface CardInput {
  readonly number: string;
  readonly nameOnCard: string;
  readonly expiryMonth: number;
  readonly expiryYear: number;
  readonly cvc: string;
}

/**
 * The payment a buyer submits, as distinct from the `PaymentSummary` an order records afterwards.
 *
 * This is the input side of the transaction — the method and, for a card, the card itself — and
 * nothing in it survives the request that carries it, against the outcome, brand and last four
 * digits an order keeps. Holding the two apart is what stops an entered card number from reaching an
 * order, a payload or a stored record. `card` is present exactly when `method` is `card`; an invoice
 * is submitted without one.
 */
export interface PaymentInput {
  readonly method: PaymentMethod;
  readonly card?: CardInput;
}

/**
 * The body of the order-creation request: everything an order needs, field for field with the
 * endpoint that creates it.
 *
 * The two addresses are taken as snapshots rather than looked up from the address book, so an order
 * keeps the address it was placed with even if the book is edited afterwards. `snapshot` is the
 * priced cart the buyer reviewed, and `idempotencyKey` is required rather than optional: a repeated
 * submission with the same key returns the order the first one created instead of placing another,
 * and the submitting state the client holds only shortens the window in which a repeat can be
 * attempted.
 */
export interface CreateOrderRequest {
  readonly snapshot: OrderSnapshot;
  readonly email: string;
  readonly shippingAddress: Address;
  readonly billingAddress: Address;
  readonly shippingMethodId: string;
  readonly payment: PaymentInput;
  readonly idempotencyKey: string;
}
