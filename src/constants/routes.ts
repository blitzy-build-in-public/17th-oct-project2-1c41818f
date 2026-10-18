/**
 * Path: src/constants/routes.ts
 * Purpose: Every route path and its builder, so no route string is written twice
 * Lines: 296
 */

import type { Role } from "@/types/account";

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
 * Consumers: `Header.tsx`, `AccountLayout.tsx` and `AdminSidebar.tsx` pass them to
 * {@link isActivePath} to mark the section the visitor is in, and {@link SECTION_ROLES} keys the policy
 * below by them.
 */
export const ROUTE_PREFIXES = {
  ACCOUNT: ROUTES.ACCOUNT,
  ADMIN: ROUTES.ADMIN,
} as const;

/**
 * The roles each guarded section admits, so the role-to-section rule has one home rather than one per
 * reader.
 *
 * `/account/*` is the customer's own area, which an administrator may also read — the account navigation
 * adds the administrator's entries for exactly that reason — while `/admin/*` is the administrator's
 * alone, because the dashboard and the reports read every customer's orders.
 *
 * Consumers: `src/Router.tsx`, whose `RequireRole` guards one section with each list, and
 * {@link canReachPath}, which answers the same question about a single path.
 */
export const SECTION_ROLES: Readonly<Record<keyof typeof ROUTE_PREFIXES, readonly Role[]>> = {
  ACCOUNT: ["customer", "admin"],
  ADMIN: ["admin"],
};

/** Where a location's path ends and its query string or fragment begins. */
const LOCATION_SUFFIX_START = /[?#]/;

/** The path portion of a location, cut before any query string or fragment so a path is matched by its
 * route alone: `src/Router.tsx` preserves the search as well as the pathname it turned a visitor away
 * from, and `/admin?range=30` is inside `/admin`. */
function pathnameOf(path: string): string {
  const start = path.search(LOCATION_SUFFIX_START);
  return start === -1 ? path : path.slice(0, start);
}

/**
 * Whether a role can reach a path: false for a path inside a guarded section that role is not admitted
 * to, and true for every open route and for a guarded section the role may read.
 *
 * The section match is {@link isActivePath}'s, so a path counts as inside a section here exactly when the
 * navigation marks it as inside one. This decides a screen and not an access: what a request is allowed
 * to read is settled in `src/lib/mockServer.ts`, which re-checks the session on every privileged
 * endpoint.
 *
 * Consumer: `src/features/account/LoginPage.tsx`, which refuses a preserved return path the visitor's role
 * cannot reach rather than offering to continue into a second refusal, and honours one it can.
 *
 * @param path - The path to judge, with or without a query string or fragment.
 * @param role - The role of the session that would reach it.
 * @returns Whether that role can open the path.
 */
export function canReachPath(path: string, role: Role): boolean {
  const pathname = pathnameOf(path);
  if (isActivePath(pathname, ROUTE_PREFIXES.ACCOUNT)) {
    return SECTION_ROLES.ACCOUNT.includes(role);
  }
  if (isActivePath(pathname, ROUTE_PREFIXES.ADMIN)) {
    return SECTION_ROLES.ADMIN.includes(role);
  }
  return true;
}

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

/**
 * Derives the section a route pattern sits in by dropping its trailing segment, so `/category/:slug`
 * reads as `/category`.
 *
 * Private to this module, and the reason it exists is the constant below: a parameterised pattern's
 * own section is derived from {@link ROUTES} rather than typed out as a second literal, so the path
 * the pattern declares and the section built from it cannot drift. A pattern with no separator to
 * drop is returned unchanged.
 */
function sectionPath(pattern: string): string {
  const separatorIndex = pattern.lastIndexOf(PATH_SEPARATOR);
  return separatorIndex === -1 ? pattern : pattern.slice(0, separatorIndex);
}

/**
 * The catalogue's own section, shared by the catalogue listing and every category listing.
 *
 * Consumer: `src/components/layout/Header.tsx` marks the catalogue destination current on this path
 * as well as on `ROUTES.CATALOG`, because the catalogue listing and each category listing are one
 * section of the storefront — `CatalogPage` serves both `/catalog` and `/category/:slug` — so a
 * visitor who arrives at a category sees the navigation say where they are.
 */
export const CATEGORY_SECTION_PATH = sectionPath(ROUTES.CATEGORY);

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

/**
 * A navigation destination as {@link isDestinationCurrent} reads it: the route the destination links to,
 * whether it is current only where the two paths are equal, and any further sections the same destination
 * also covers.
 *
 * Consumer: `src/components/layout/Header.tsx`, whose primary navigation declares one entry per
 * destination. The shape is structural, so a consumer's own destination type satisfies it as it stands.
 */
export interface ActiveDestination {
  /** The route the destination links to, taken from {@link ROUTES}. */
  readonly to: string;
  /** Match only where the two paths are equal, instead of matching the route's whole section. */
  readonly end?: boolean;
  /** Sections the same destination also covers, each one matched as a section of its own. */
  readonly sections?: readonly string[];
}

/**
 * Reports whether the current location sits in a navigation destination, which is the rule a navigation
 * marks its current entry by: the destination's own route through {@link isActivePath}, matched exactly
 * where the destination asks for that, and then each section the destination also covers.
 *
 * It exists for the one destination that two routes reach — the catalogue listing and every category
 * listing are one section of the storefront, so the catalogue's entry covers
 * {@link CATEGORY_SECTION_PATH} — and it composes {@link isActivePath} rather than repeating it, so the
 * comparison keeps one home. Both a destination's route and its sections come from this module, so no
 * consumer writes a path.
 *
 * @param pathname - The current location's pathname.
 * @param destination - The destination to test; see {@link ActiveDestination}.
 * @returns True when the location is inside that destination.
 */
export function isDestinationCurrent(pathname: string, destination: ActiveDestination): boolean {
  if (isActivePath(pathname, destination.to, { exact: destination.end === true })) return true;
  const sections = destination.sections ?? [];
  return sections.some((path) => isActivePath(pathname, path));
}
