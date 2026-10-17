/**
 * Path: src/constants/routes.ts
 * Purpose: Every route path and its builder, so no route string is written twice
 * Lines: 177
 */

/**
 * Dynamic route segment keys, read through `useParams` by the feature routes that own them.
 *
 * Consumers: `ProductDetailPage`, `CatalogPage` and the order screens, so no feature file repeats
 * the segment name that `src/Router.tsx` declares inside its path patterns.
 */
export const ROUTE_PARAMS = {
  /** Product detail segment, declared by `ROUTES.PRODUCT`. */
  PRODUCT_SLUG: "slug",
  /** Category listing segment, declared by `ROUTES.CATEGORY`. */
  CATEGORY_SLUG: "slug",
  /** Order segment, declared by `ROUTES.ORDER_CONFIRMATION` and `ROUTES.ACCOUNT_ORDER_DETAIL`. */
  ORDER_ID: "orderId",
} as const;

/**
 * Every route pattern the product navigates to, in one place.
 *
 * Consumer: `src/Router.tsx` declares one `Route` per entry, the navigation components link to
 * them, the builders below derive from them and {@link isActivePath} compares against them. No
 * other file may contain a route string.
 */
export const ROUTES = {
  /** Landing page — `HomePage`. */
  HOME: "/",
  /** Full catalogue listing — `CatalogPage`. */
  CATALOG: "/catalog",
  /** Catalogue scoped to one category — `CatalogPage`. */
  CATEGORY: "/category/:slug",
  /** Search results with facets — `SearchPage`. */
  SEARCH: "/search",
  /** Product detail — `ProductDetailPage`. */
  PRODUCT: "/product/:slug",
  /** Shopping cart — `CartPage`. */
  CART: "/cart",
  /** Checkout flow — `CheckoutPage`. */
  CHECKOUT: "/checkout",
  /** Order confirmation, reload-safe — `OrderConfirmation`. */
  ORDER_CONFIRMATION: "/order-confirmation/:orderId",
  /** Sign-in — `LoginPage`. */
  LOGIN: "/login",
  /** Registration — `RegisterPage`. */
  REGISTER: "/register",
  /** Account shell and profile — `AccountLayout` wrapping `ProfilePage`. */
  ACCOUNT: "/account",
  /** Order history — `OrderHistoryPage`. */
  ACCOUNT_ORDERS: "/account/orders",
  /** One order inside the account shell — the order detail of `OrderHistoryPage`. */
  ACCOUNT_ORDER_DETAIL: "/account/orders/:orderId",
  /** Address book — `AddressBookPage`. */
  ACCOUNT_ADDRESSES: "/account/addresses",
  /** Sales dashboard — `AdminDashboardPage`. */
  ADMIN: "/admin",
  /** Reports — `ReportsPage`. */
  ADMIN_REPORTS: "/admin/reports",
  /** Catch-all pattern for the not-found view composed inside `src/Router.tsx`. */
  NOT_FOUND: "*",
} as const;

/** Union of every route pattern in {@link ROUTES}. */
export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/**
 * The two guarded sections: `/account/*` requires a session and `/admin/*` requires an
 * administrator.
 *
 * Consumers: `src/Router.tsx` guards on these prefixes, and `Header.tsx`, `AccountLayout.tsx` and
 * `AdminSidebar.tsx` pass them to {@link isActivePath} to mark the section the visitor is in.
 */
export const ROUTE_PREFIXES = {
  ACCOUNT: ROUTES.ACCOUNT,
  ADMIN: ROUTES.ADMIN,
} as const;

/**
 * Query-string key carrying the path a visitor intended to reach through the sign-in screen.
 *
 * Consumers: `LoginPage` and `RegisterPage` read it to send the visitor on to the page that sent
 * them, and the guarded routes in `src/Router.tsx` write it into their redirect.
 */
export const RETURN_TO_QUERY_KEY = "returnTo";

/** Separator between the segments of a route path. */
const PATH_SEPARATOR = "/";

/** Any run of trailing separators, stripped before two paths are compared. */
const TRAILING_SEPARATORS = new RegExp(`${PATH_SEPARATOR}+$`);

/**
 * Substitutes the trailing dynamic segment of a route pattern with an encoded value.
 *
 * The pattern always comes from {@link ROUTES}, so a builder and its constant cannot drift.
 */
function withTrailingSegment(pattern: string, value: string): string {
  const head = pattern.slice(0, pattern.lastIndexOf(PATH_SEPARATOR) + 1);
  return `${head}${encodeURIComponent(value)}`;
}

/** Builds the product detail path for a product slug. */
export function productPath(slug: string): string {
  return withTrailingSegment(ROUTES.PRODUCT, slug);
}

/** Builds the category listing path for a category slug. */
export function categoryPath(slug: string): string {
  return withTrailingSegment(ROUTES.CATEGORY, slug);
}

/** Builds the reload-safe order confirmation path for an order identifier. */
export function orderConfirmationPath(orderId: string): string {
  return withTrailingSegment(ROUTES.ORDER_CONFIRMATION, orderId);
}

/** Builds the account order detail path for an order identifier. */
export function accountOrderPath(orderId: string): string {
  return withTrailingSegment(ROUTES.ACCOUNT_ORDER_DETAIL, orderId);
}

/**
 * Appends the return path to an account route as a query string.
 *
 * An absent or empty return path leaves the route bare, so a plain link to the screen stays
 * shareable.
 */
function withReturnTo(path: string, returnTo?: string): string {
  if (returnTo === undefined || returnTo === "") {
    return path;
  }
  return `${path}?${RETURN_TO_QUERY_KEY}=${encodeURIComponent(returnTo)}`;
}

/** Builds a sign-in path, carrying the intended destination when one is supplied. */
export function loginPath(returnTo?: string): string {
  return withReturnTo(ROUTES.LOGIN, returnTo);
}

/** Builds a registration path, carrying the intended destination when one is supplied. */
export function registerPath(returnTo?: string): string {
  return withReturnTo(ROUTES.REGISTER, returnTo);
}

/** Options accepted by {@link isActivePath}. */
export interface ActivePathOptions {
  /** Match only when the two paths are equal, instead of matching the path's whole section. */
  readonly exact?: boolean;
}

/** Strips trailing separators so `/catalog/` and `/catalog` compare equal, keeping `/` itself. */
function normalisePath(path: string): string {
  const trimmed = path.replace(TRAILING_SEPARATORS, "");
  return trimmed === "" ? ROUTES.HOME : trimmed;
}

/**
 * Reports whether the current location is inside a route, which is how the navigation marks the
 * section the visitor is in.
 *
 * This is the single home of active-link logic, so `Header.tsx`, `AccountLayout.tsx` and
 * `AdminSidebar.tsx` do not each grow their own comparison. A trailing slash is normalised on both
 * sides. Without `exact`, a deeper path counts as inside its section — `/account/orders` is inside
 * `/account` — while `exact: true` requires the two to be equal, which is how `ROUTES.HOME` is
 * matched so that no other route is ever treated as inside `/`.
 */
export function isActivePath(pathname: string, path: string, options?: ActivePathOptions): boolean {
  const current = normalisePath(pathname);
  const target = normalisePath(path);
  if (options?.exact === true) {
    return current === target;
  }
  return current === target || current.startsWith(`${target}${PATH_SEPARATOR}`);
}
