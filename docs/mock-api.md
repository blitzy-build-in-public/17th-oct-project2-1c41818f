<!--
  Path: docs/mock-api.md
  Purpose: The endpoint contract with the demonstration credentials and the latency and failure switches
  Lines: 211
-->

# The SalesPro mock API

Every route of the in-process API: what it takes, what it answers, who may call it, and the switches that make a slow, an empty and a failed request reachable.
The layering this contract sits in is in [`architecture.md`](./architecture.md); this document owns the endpoint contract itself.

## 1. Scope, and the absence of a network

SalesPro exposes no public API and calls no external one. Everything below is the internal contract between the UI and its data: `src/lib/mockServer.ts`
implements it and `src/lib/apiClient.ts` is the only module that reaches it, so no service, component or feature knows the data is seeded.

Every request resolves in-process, so there is no CORS, CSRF, TLS or hosting concern to configure and no `.env` file to create — the application runs
identically without one. No module makes an outbound request: no payment processor, identity provider, search engine, email service, analytics beacon or CDN
sits behind any path below.

## 2. The transport convention

`src/lib/apiClient.ts` exports one function that carries every call, and one wrapper per method:

| Entry point                                      | Signature                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `request`                                        | `request<TValue>(path: string, options?: ApiRequestOptions): Promise<Result<TValue>>` |
| `getJson`, `postJson`, `patchJson`, `deleteJson` | the same function with the method set for the caller                                  |

- `Result<T>` is `{ ok: true; value: T } | { ok: false; error: ApiError }` (`src/types/common.ts`).
- `ApiError` is `{ status: number; code: string; message: string; field?: string }`; `field` names the offending input, so a form attaches the sentence to the
  control that caused it.
- **Errors are values, never exceptions.** Nothing throws across the seam, so no page needs a `try`/`catch` around a data call: a service turns a failed result
  into a field-keyed error or a user-facing message, and a component renders an error state with a retry action.
- Success carries no status: a request that answers with no body — a removal, a sign-out — arrives as `{ ok: true, value: undefined }`, and `status` appears
  only on a failure.
- A request carries a JSON body where its method allows one, a session token in the `x-session-token` header where the caller has one, and paging as `page` and
  `pageSize`.
- Path parameters are prefixed identifiers (`prod_1`, `ord_9`), never positions.

**Response wrappers follow the payload.** A paged endpoint returns `PageResult<T>`; a computed collection carrying its own metadata (`/api/analytics/revenue`,
`/api/analytics/top-products`, `/api/analytics/recent-orders`, `/api/search/suggest`) returns a named key; and a fixed reference collection or a single resource
returns its own type directly — `/api/categories`, `/api/brands`, `/api/facets`, `/api/shipping-methods`, `/api/customers/:id/addresses` and
`/api/reports/definitions` return arrays, and `/api/cart/validate-promo` returns a `PromoCode`.

Payloads are plain JSON-shaped structures typed in `src/types`, with no DTO layer: dates are ISO 8601 strings, money is integer minor units, and identifiers
come from `src/utils/strings.ts` (`prod_`, `cat_`, `brd_`, `cus_`, `adr_`, `ord_`, `line_`, `rev_`, `prom_`, `ses_`). Every path is declared once in `API_PATHS`
(`src/lib/apiContract.ts`) and filled with `fillApiPath`.

## 3. The endpoints

`src/lib/apiRoutes.ts` routes exactly these and nothing else; a path matching no route answers `404` with the code `route-not-found`.

| Method and path                                        | Purpose                                                                                            | Request                                                                                                            | Response and errors                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/products`                                    | Catalogue listing, search and filtering in one endpoint                                            | `q`, `categoryIds`, `brandIds`, `minPrice`, `maxPrice`, `minRating`, `inStock`, `tags`, `sort`, `page`, `pageSize` | `PageResult<Product>`; `422` with `field` for a malformed filter                                                                                                                                                                                                                                                                                |
| `GET /api/products/:id`                                | Product detail                                                                                     | —                                                                                                                  | `Product`; `404` when unknown                                                                                                                                                                                                                                                                                                                   |
| `GET /api/products/:id/related`                        | Same-category suggestions, price-nearest first                                                     | `limit` (default 4)                                                                                                | `{ items: Product[] }`                                                                                                                                                                                                                                                                                                                          |
| `GET /api/products/:id/reviews`                        | Paged reviews, newest first                                                                        | `page`, `pageSize`, `rating`                                                                                       | `PageResult<Review>`; `404 product-not-found` for an identifier the catalogue does not hold, `422` naming `rating` for a rating outside 1–5                                                                                                                                                                                                     |
| `POST /api/products/:id/reviews`                       | Submit a review                                                                                    | `rating`, `title`, `body`                                                                                          | `Review`; `401` without a customer session, `404 product-not-found`, `422` on validation                                                                                                                                                                                                                                                        |
| `GET /api/facets`                                      | Facet values and counts for the current filter, each facet counted with its own selection excluded | the same filter parameters as `/api/products`                                                                      | `Facet[]`                                                                                                                                                                                                                                                                                                                                       |
| `GET /api/search/suggest`                              | Type-ahead suggestions from product names, brands and categories                                   | `q`, `limit` (default 8)                                                                                           | `{ suggestions: { text, kind, target }[] }`                                                                                                                                                                                                                                                                                                     |
| `GET /api/categories`                                  | Category tree with product counts                                                                  | —                                                                                                                  | `CategoryNode[]`, each node carrying its `children` and its `productCount`                                                                                                                                                                                                                                                                      |
| `GET /api/brands`                                      | Brands with product counts                                                                         | —                                                                                                                  | `Brand[]`                                                                                                                                                                                                                                                                                                                                       |
| `POST /api/cart/price`                                 | Price a basket: line totals, discounts, shipping, tax, grand total                                 | `lines`, `promoCode`, `shippingMethodId`                                                                           | `PricedCart`; `409` with the rejection reason as its code when the promo no longer applies, `422` when a line cannot be priced                                                                                                                                                                                                                  |
| `POST /api/cart/validate-promo`                        | Validate a code before applying it                                                                 | `code`, `lines`                                                                                                    | `PromoCode`; `409` with `field: "promoCode"` and the reason as its code (`unknown`, `inactive`, `not-started`, `expired`, `below-minimum`, `usage-limit`, `already-applied`, `ineligible-category`); `422` with `field: "promoCode"` when the code's shape is not 4–16 upper-case alphanumerics                                                 |
| `GET /api/shipping-methods`                            | The delivery methods and their prices                                                              | —                                                                                                                  | `ShippingMethod[]`                                                                                                                                                                                                                                                                                                                              |
| `POST /api/orders`                                     | Create an order from a basket snapshot; a guest may submit one                                     | `snapshot`, `email`, `shippingAddress`, `billingAddress`, `shippingMethodId`, `payment`, `idempotencyKey`          | `Order`; `402` on a declined card, `409` when the key arrives with a differing body, `422` on validation                                                                                                                                                                                                                                        |
| `GET /api/orders`                                      | The signed-in customer's own order history — scoped to the session, so it takes **no customer id** | `page`, `pageSize`, `status`, `from`, `to`                                                                         | `PageResult<Order>`; `401` without a session                                                                                                                                                                                                                                                                                                    |
| `GET /api/orders/:id`                                  | Order detail                                                                                       | —                                                                                                                  | `Order`; `401` when the order belongs to an account and no session was sent, `404` for an unknown id or another account's order — a foreign id is never `403` — an account-less order is answered to the caller presenting the `x-order-token` credential minted when it was placed and to nobody else, and an administrator may read any order |
| `POST /api/auth/register`                              | Create an account and open a session with it                                                       | `email`, `password`, `firstName`, `lastName`, `marketingOptIn`                                                     | `{ customer: Customer, session: Session }`; `409` duplicate email, `422` validation                                                                                                                                                                                                                                                             |
| `POST /api/auth/login`                                 | Sign in                                                                                            | `email`, `password`                                                                                                | `Session`; `401` with one generic sentence that does not reveal which member was wrong                                                                                                                                                                                                                                                          |
| `POST /api/auth/logout`                                | End the session a token names                                                                      | —                                                                                                                  | an empty payload                                                                                                                                                                                                                                                                                                                                |
| `GET /api/auth/session`                                | Restore the session a stored token still names                                                     | —                                                                                                                  | `Session`; `401` (`session-unknown` or `session-expired`)                                                                                                                                                                                                                                                                                       |
| `GET /api/customers/:id`                               | Profile                                                                                            | —                                                                                                                  | `Customer`; `401`, `403` unless the session owns the id or is an administrator                                                                                                                                                                                                                                                                  |
| `PATCH /api/customers/:id`                             | Update profile fields                                                                              | `firstName`, `lastName`, `phone`, `marketingOptIn`                                                                 | `Customer`; `401`, `403`, `422`                                                                                                                                                                                                                                                                                                                 |
| `GET /api/customers/:id/addresses`                     | Address book                                                                                       | —                                                                                                                  | `Address[]`; `401`, `403`                                                                                                                                                                                                                                                                                                                       |
| `POST /api/customers/:id/addresses`                    | Add an address                                                                                     | address fields                                                                                                     | `Address`; `401`, `403`, `422`                                                                                                                                                                                                                                                                                                                  |
| `PATCH /api/customers/:id/addresses/:addressId`        | Edit an address                                                                                    | address fields                                                                                                     | `Address`; `401`, `403`, `404`, `422`                                                                                                                                                                                                                                                                                                           |
| `DELETE /api/customers/:id/addresses/:addressId`       | Remove an address; the default flags fall to the most recently added remaining one                 | —                                                                                                                  | an empty payload; `401`, `403`, `404`                                                                                                                                                                                                                                                                                                           |
| `POST /api/customers/:id/addresses/:addressId/default` | Set the default shipping or billing address                                                        | `kind` (`shipping` \| `billing`)                                                                                   | `Address`; `401`, `403`, `404`, `422` for an unknown kind                                                                                                                                                                                                                                                                                       |
| `GET /api/analytics/kpis`                              | KPI summary for a period with a **named** comparison baseline                                      | `from`, `to`, `bucket`, `baseline` (`previous-period` \| `previous-year`)                                          | `KpiSummary`; `403` unless administrator, `422` invalid range                                                                                                                                                                                                                                                                                   |
| `GET /api/analytics/revenue`                           | Revenue time series, optionally split                                                              | `from`, `to`, `bucket`, `groupBy` (`category` \| `channel`)                                                        | `{ series: ChartSeries[] }`; `403`, `422`                                                                                                                                                                                                                                                                                                       |
| `GET /api/analytics/top-products`                      | Best-performing products in a period                                                               | `from`, `to`, `limit`, `metric` (`revenue` \| `units`)                                                             | `{ items: ProductPerformance[] }`; `403`, `422`                                                                                                                                                                                                                                                                                                 |
| `GET /api/analytics/recent-orders`                     | Most recent orders, newest first                                                                   | `limit` (default 8)                                                                                                | `{ items: Order[] }`; `403`                                                                                                                                                                                                                                                                                                                     |
| `GET /api/reports/definitions`                         | The report catalogue and the columns each report is built from                                     | —                                                                                                                  | `ReportDefinition[]`; `403`                                                                                                                                                                                                                                                                                                                     |
| `GET /api/reports/:kind`                               | Run a report (`sales` \| `products` \| `customers`)                                                | `from`, `to`, `bucket`                                                                                             | `ReportResult`; `403`, `404` unknown kind, `422` invalid range                                                                                                                                                                                                                                                                                  |

## 4. Authorisation, enforced in the transport

| Level           | Who may call it              | What it covers                                                                                                                                                                         | When it is not met                                                                         |
| --------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `anonymous`     | Any caller, signed in or not | the catalogue, facets, suggestions, categories, brands, pricing, promo validation, shipping methods, registration, sign-in, sign-out, session restore, order creation and order detail | never refused for want of a session                                                        |
| `customer`      | A signed-in shopper          | listing one's own orders, submitting a review, one's own profile and address book                                                                                                      | `401` for a missing, unknown or expired session; `403` when the path names another account |
| `administrator` | The `admin` role             | every analytics endpoint, every report endpoint, and any customer record                                                                                                               | `401` without a session, `403` for a session without the role                              |

Order detail is registered `anonymous` because a guest's confirmation carries no session, yet an order that names no account is answered only to the caller
presenting the `x-order-token` credential minted at its placement — a caller presenting neither a session nor that credential meets the `401` the session lookup
already answers, and one presenting another session meets the same `404` a foreign order answers.

The three checks run in that order: no token sent to a protected endpoint is `401`, a valid token without the required role is `403`, and ownership is compared
against the session's `customerId`, so changing an id in a URL cannot reach another account's data. All three are enforced in the seam and its route handlers,
**never in the UI**: `src/Router.tsx` guards the account and administrator routes and the navigation hides what a visitor cannot use, but the guard is
convenience and the service check is the control.

Sessions are opaque tokens carrying a role claim and an expiry, and a password is checked against a salted digest built and verified by the single helper in
`src/utils/strings.ts`. This is a **demonstration boundary, not a production one**: a real deployment would move session issue and verification behind the
server `src/lib/apiClient.ts` is designed to be repointed at.

## 5. The data-source binding, and the unbound path

`src/lib/apiContract.ts` declares `SalesProDataSource`, the interface the seam asks its data for; `src/data/repositories.ts` implements it over the seeded
collections; and `registerDataSource(source)` in `src/lib/mockServer.ts` binds the two. The binding is made twice — in `src/main.tsx`, at module scope before
the first render, and in `tests/testUtils.tsx` for the suite — and it is a **binding, never an import**, which is why the transport carries no compile-time
dependency on `src/data`.

A request that arrives before a source is bound answers `503` with the code `data-source-unavailable`, which `tests/unit/lib/mockServer.test.ts` asserts.

## 6. Latency and failure simulation

Every response waits the configured latency out: `VITE_API_LATENCY_MS`, defaulting to `DEFAULT_API_LATENCY_MS` (**120 ms**) in `src/constants/config.ts`. The
wait is applied once in `src/lib/apiClient.ts`, before the seam is asked for an answer, and the variable is read defensively — a value that cannot be applied
falls back to the default, and is reported once per distinct value on the console in development — a build shipped to visitors reports nothing. `tests/setup.ts` pins it to `0` for the suite, so no test waits.

The second switch is failure injection: `failNext(matcher?)` arms the next matching request to fail instead of being answered, and that one request consumes the
arm, so a suite fails exactly one call. `tests/testUtils.tsx` exposes it as the harness's single lever over what the product is answered, and each of the four
integration test files uses it at least once. Both switches are development affordances; neither is configuration for a deployment.

## 7. Idempotency on order creation

`POST /api/orders` carries an `idempotencyKey`. The seam stores the first answer for a key, scoped to the session that submitted it, and **replays it** on an
identical repeat, so a double submission cannot create a second order. The same key arriving with a body that differs from the first answers `409` with the code
`idempotency-key-conflict`. The client holds a submitting state that disables the control as well, because a front-end-only guard is not sufficient on its own —
and a successful call is a created order, not proof of payment. The store and the card decision live in `src/lib/apiOrders.ts`.

The same submission also leaves the seam holding the **placement credential** of an account-less order: the idempotency key that created it is remembered against
the order it created, and `GET /api/orders/:id` answers such an order to the caller that presents that value in the `x-order-token` header. The client keeps the
same pair in the storage entry `salespro.order-tokens` (`STORAGE_KEYS.ORDER_TOKENS`), so the buyer's own confirmation can be reopened after a reload by the
browser that placed the order, and a shared link opens nothing. This is a **demonstration-grade capability, not a production credential**: a real deployment would
return an unguessable confirmation reference from its server rather than have the client present the key it minted.

## 8. Protections that stand in for rate limiting

There is no server, so there is no request quota to enforce and none is simulated. The protections that stand in for one are client-side, listed here so the
absence is not mistaken for a gap: search suggestions are debounced by `SEARCH_SUGGESTION_DEBOUNCE_MS` (250 ms) and capped at `SEARCH_SUGGESTION_LIMIT` (8); a
type-ahead request is cancelled when a newer keystroke arrives, through the abort signal on `apiClient`, which answers the superseded call with the code
`request-aborted` (`499`) rather than an error a page renders; a view keeps at most one request of its own in flight — the bound `MAX_IN_FLIGHT_REQUESTS_PER_VIEW` (1) in `src/constants/config.ts` states — because starting a newer request aborts the one it supersedes; an
idempotency key is retained for the session; and CSV export is capped at `CSV_MAX_ROWS` (10,000 rows) with every cell clipped to `CSV_MAX_CELL_LENGTH` (32,000
characters). All five limits live in `src/constants/config.ts`; `src/utils/csv.ts` enforces the export caps, reached through the CSV matrix
`src/lib/reportService.ts` builds. **CSV is the only export format — there is no PDF export and no print stylesheet.**

## 9. Errors a caller must handle, and the validation behind them

| Status              | Code(s)                                                                        | When it appears                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `401`               | `unauthenticated`, `session-expired`, `session-unknown`, `invalid-credentials` | no session was sent, the session has expired or is unknown, or a sign-in did not match an account                        |
| `402`               | `payment-declined`                                                             | the demonstration declined the submitted card                                                                            |
| `403`               | `forbidden`                                                                    | a valid session without the role or the ownership the endpoint requires                                                  |
| `404`               | `route-not-found`, `product-not-found`, `order-not-found`, `address-not-found` | an unknown path, product, order, address or report kind                                                                  |
| `409`               | `duplicate-email`, `idempotency-key-conflict`, a promo rejection reason        | an email that already has an account, a key reused with a different body, or a code that cannot be applied               |
| `422`               | `validation-failed`, `insufficient-stock`                                      | a body broke a field rule, naming the control in `field`, or a line asked for more units than it can buy                 |
| `499`, `400`, `500` | `request-aborted`, `invalid-request-path`, `unexpected-error`                  | the transport's own failures: a superseded request, a target that is not a path, and anything that never became a result |
| `503`               | `data-source-unavailable`                                                      | a request arrived before a data source was bound                                                                         |

The field rules a `422` comes from, and where each is enforced:

| Input         | Rule                                                                                                                                                       | Enforced in                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Email         | non-empty, one `@`, a valid domain shape, at most 254 characters; unique across accounts                                                                   | `src/utils/validation.ts`; a duplicate is refused by the seam with `409`          |
| Password      | at least 8 characters with one letter and one digit, per `PASSWORD_POLICY`; never stored in clear                                                          | `src/utils/validation.ts`, digested in `src/utils/strings.ts`                     |
| Quantity      | an integer from 1 to the line's stock ceiling                                                                                                              | `src/state/cartReducer.ts` clamps; `src/utils/validation.ts` judges the stepper   |
| Card          | 13–19 digits passing the Luhn check, a future expiry and a 3–4 digit CVC                                                                                   | `src/utils/validation.ts`; the approve-or-decline decision belongs to the seam    |
| Address       | full name, line 1, city, region, postal code and country required; the postal code matches its country's pattern; the country is one this product supports | `src/utils/validation.ts`, reused unchanged by checkout and the address book      |
| Promo code    | 4–16 upper-case alphanumeric characters, then active, in date, above its minimum subtotal, under its usage limit and not already applied                   | `src/utils/validation.ts` for the shape, `src/lib/pricingService.ts` for the rest |
| Review        | an integer rating from 1 to 5, a title of 3–80 characters and a body of 10–1,200                                                                           | `src/utils/validation.ts`                                                         |
| Price range   | both bounds inside the catalogue's bounds; **an inverted range is swapped, not rejected**                                                                  | `src/utils/queryParams.ts`                                                        |
| Rating filter | an integer from 1 to 5, or absent                                                                                                                          | `src/utils/queryParams.ts`                                                        |
| Paging        | page ≥ 1, clamped to the page count; page size from `PAGE_SIZE_OPTIONS`, `{12, 24, 48}`                                                                    | `src/utils/collections.ts` and `src/lib/catalogService.ts`                        |
| Date range    | not inverted, not in the future, and no longer than `MAX_REPORT_RANGE_DAYS` (366) days; defaulted to the trailing 30                                       | `src/utils/dates.ts`, applied by the report range control                         |

## 10. The demonstration store and the seeded data

Sign-in works from a fresh clone because every seeded account carries a digest produced by `src/utils/strings.ts` at seed time. `DEMO_ACCOUNTS` in
`src/constants/config.ts` owns the values:

| Role          | Email                   | Password      |
| ------------- | ----------------------- | ------------- |
| Administrator | `admin@salespro.test`   | `Shopper1234` |
| Customer      | `shopper@salespro.test` | `Shopper1234` |

The dataset a caller is querying is generated deterministically by one seeded generator, so the same build produces the same data: **20 categories** (8 parents
and 12 children, and only the children hold products), **12 brands**, **140 products**, **40 customers** of whom 2 are administrators, about **1,155 orders**
across the trailing 365 days of which **60 belong to the seeded accounts**, about **420 reviews**, **8 promo codes** and **5 shipping methods**, plus the daily
sales fact rows derived from those same generated orders across the **12 leaf categories** — only the children hold products, so no order line can file under a
parent — and 3 channels (`web`, `mobile`, `store`). The volumes are approximate:
`tests/unit/lib/mockServer.test.ts` asserts the relational invariants and that two bootstrap passes agree, not the literal figures.

A card number is **never stored**: the seam reads it, validates it and records only its brand, its last four digits and a decision. `DEMO_CARD_NUMBERS` in
`src/constants/config.ts` gives the two outcomes — `4242424242424242` is authorised and `4000000000000002` answers `402` — and both pass the Luhn check, so the
decline is the demonstration's decision rather than a broken number.

## 11. Replacing the transport with real HTTP

The mock transport lives entirely inside `src/lib/apiClient.ts` over `src/lib/mockServer.ts`; pointing it at a real server is a change to those modules, leaving
every service, feature and test untouched. Nothing outside them knows the data source is a mock, so the shapes documented here are the contract both sides are
written against.

## 12. Exercising the contract by hand

`npm install`, then `npm run dev`, and sign in with the credentials above. Set `VITE_API_LATENCY_MS` in a local `.env` to make the loading states visible, or to
`0` to remove the delay entirely; `.env.example` documents both `VITE_` variables, and **no `.env` file is needed for the application to run**.
