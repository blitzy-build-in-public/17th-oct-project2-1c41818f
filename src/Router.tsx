/**
 * Path: src/Router.tsx
 * Purpose: The route table with lazy slices, role guards, the suspension boundary and the not-found view
 * Lines: 545
 */

import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";

import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";

import { Button, ButtonGroup } from "@/components/ui/Button";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { NotFoundView } from "@/components/ui/NotFoundView";
import {
  A11Y_COPY,
  ACCOUNT_ACCESS_COPY,
  COMMON_ACTIONS,
  PAGE_TITLES,
  documentTitle,
} from "@/constants/content";
import { ROUTES, SECTION_ROLES, loginPath } from "@/constants/routes";
import { isSessionRefusal } from "@/lib/apiContract";
import { useAuth, useAuthDispatch } from "@/state/AuthContext";
import { useDocumentTitle } from "@/state/hooks";
import type { Role } from "@/types/account";
import type { ApiError } from "@/types/common";

/*
 * What this file owns, and what it deliberately leaves out.
 *
 * It owns the route table: one `Route` per destination, each element bound lazily to the feature slice that
 * renders that screen; the two guarded sections — `/account/*` admits a customer or an administrator, and
 * `/admin/*` admits an administrator alone, each list read from `SECTION_ROLES` in
 * `src/constants/routes.ts`, which is where the role-to-section policy has its one home; and the catch-all,
 * which renders the not-found view the shared `src/components/ui/NotFoundView.tsx` owns and names itself in
 * the tab through `useDocumentTitle`. Every path here comes from the same module, so a route string is
 * written once in the product and this table, the navigation and the path builders cannot drift apart.
 *
 * No router is rendered here. `src/main.tsx` owns the application's `BrowserRouter` and
 * `tests/testUtils.tsx` supplies a `MemoryRouter` to the tests that render a routed screen, so this module
 * declares routes for whichever router sits above it and works under both; rendering one here would throw
 * inside the other and would also stop a test from choosing its own starting location. The page shell is
 * not rendered here either: `src/App.tsx` composes the providers, the error boundary and
 * `src/components/layout/AppLayout.tsx` around `AppRoutes`, which is what keeps this file a route table
 * rather than a second composition root.
 *
 * Nothing is fetched here, and no feature is reached from another feature. A page reads its own route
 * parameters — `CatalogPage` serves both `/catalog` and `/category/:slug`, `ProductDetailPage` resolves its
 * own slug, `OrderHistoryPage` renders the history or the single order its path names, and
 * `OrderConfirmation` resolves its order from the id in the path so the confirmation survives a reload —
 * and anything two slices share is a module below them, never a route through this table.
 *
 * The guard below is convenience, not access control. It keeps a visitor out of a screen their session
 * cannot serve, in whichever of two ways that session calls for: a visitor with no usable session is sent to
 * the sign-in route with the path they were after in that link's `returnTo` query, while a session in force
 * whose role the section does not admit is refused where it stands, so the address bar names the screen it
 * rendered and a reload of it, or a link copied out of it, opens that same refusal. It also offers the
 * section's own error state with a retry when the session could not be read; whether a request is allowed is
 * decided in `src/lib/mockServer.ts`, which re-checks the session on every privileged endpoint, because
 * hiding a control is not a permission check.
 *
 * Class contract. No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` —
 * so every class rendered below is consumed by name. `src/styles/layout.css` owns the page geometry the route
 * placeholder wears — `sp-container`, `sp-page` and the `sp-grid` its band of tiles takes — and
 * `.sp-visually-hidden` is the global utility of `src/styles/base.css`, which is where the placeholder's
 * announcement lives. The not-found view renders its own classes inside `src/components/ui/NotFoundView.tsx`,
 * which states that contract; no colour, length, radius, shadow or breakpoint of this file's own appears below.
 */

// Route-level code splitting ----------------------------------------------------------------------

/*
 * One lazy binding per screen, declared at module top level on purpose: a `lazy` call made during a render
 * allocates a component type the reconciler has never seen, so the screen it stands for would unmount and
 * lose its state on every pass. Every slice exports its page by name, and each loader below mirrors that
 * named export into the `default` shape `React.lazy` requires, so a slice keeps exporting `HomePage` and
 * the router still gets a component to render. The bindings are what keep a screen's code out of the first
 * bundle: each one becomes its own chunk, fetched the first time its route is visited.
 */

/** Landing page of the storefront. */
const HomePage = lazy(async () => ({
  default: (await import("@/features/home/HomePage")).HomePage,
}));

/** Catalogue listing, for all products and for one category. */
const CatalogPage = lazy(async () => ({
  default: (await import("@/features/catalog/CatalogPage")).CatalogPage,
}));

/** Product detail with its gallery, specifications and reviews. */
const ProductDetailPage = lazy(async () => ({
  default: (await import("@/features/catalog/ProductDetailPage")).ProductDetailPage,
}));

/** Search results with facets, sorting and active filters. */
const SearchPage = lazy(async () => ({
  default: (await import("@/features/search/SearchPage")).SearchPage,
}));

/** The cart, with its line rows and order summary. */
const CartPage = lazy(async () => ({
  default: (await import("@/features/cart/CartPage")).CartPage,
}));

/** The three-step checkout. */
const CheckoutPage = lazy(async () => ({
  default: (await import("@/features/checkout/CheckoutPage")).CheckoutPage,
}));

/** The order confirmation, resolved from the order id in the path. */
const OrderConfirmation = lazy(async () => ({
  default: (await import("@/features/checkout/OrderConfirmation")).OrderConfirmation,
}));

/** Sign-in. */
const LoginPage = lazy(async () => ({
  default: (await import("@/features/account/LoginPage")).LoginPage,
}));

/** Registration. */
const RegisterPage = lazy(async () => ({
  default: (await import("@/features/account/RegisterPage")).RegisterPage,
}));

/** The account shell the three account views render inside. */
const AccountLayout = lazy(async () => ({
  default: (await import("@/features/account/AccountLayout")).AccountLayout,
}));

/** The account's profile view. */
const ProfilePage = lazy(async () => ({
  default: (await import("@/features/account/ProfilePage")).ProfilePage,
}));

/** The order history, and the single order a deeper path names. */
const OrderHistoryPage = lazy(async () => ({
  default: (await import("@/features/account/OrderHistoryPage")).OrderHistoryPage,
}));

/** The address book. */
const AddressBookPage = lazy(async () => ({
  default: (await import("@/features/account/AddressBookPage")).AddressBookPage,
}));

/** The administrator's sales dashboard. */
const AdminDashboardPage = lazy(async () => ({
  default: (await import("@/features/admin/AdminDashboardPage")).AdminDashboardPage,
}));

/** The administrator's reports. */
const ReportsPage = lazy(async () => ({
  default: (await import("@/features/reports/ReportsPage")).ReportsPage,
}));

// Guarded sections and the paths nested under them ------------------------------------------------

/**
 * The part of a route's path below its section root, which is the relative form a nested `Route` declares.
 *
 * Derived from `src/constants/routes.ts` rather than written out, so a path exists once in the product:
 * `ROUTES.ACCOUNT_ORDERS` is `/account/orders`, and the child path a nested route declares is `orders`.
 * A path that does not sit under the section root is returned unchanged, so a mis-derived call adds a
 * route this table does not expect rather than a silently truncated one.
 *
 * @param sectionRoot - The path of the parent route, from `ROUTES`.
 * @param path - The full path of the child route, from `ROUTES`.
 * @returns The path relative to `sectionRoot`.
 */
function childPath(sectionRoot: string, path: string): string {
  const prefix = `${sectionRoot}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * The three views nested inside the account shell, named by the route constants they derive from — the
 * paths `/account` owns and nothing else this table places beneath it.
 */
const ACCOUNT_SECTIONS = {
  /** The customer's order history. */
  ORDERS: childPath(ROUTES.ACCOUNT, ROUTES.ACCOUNT_ORDERS),
  /** One order, inside the same shell. */
  ORDER_DETAIL: childPath(ROUTES.ACCOUNT, ROUTES.ACCOUNT_ORDER_DETAIL),
  /** The address book. */
  ADDRESSES: childPath(ROUTES.ACCOUNT, ROUTES.ACCOUNT_ADDRESSES),
} as const;

// Waiting for the session's first answer ----------------------------------------------------------

/**
 * Whether a guard may read the absence of a session as a decision rather than as a wait.
 *
 * The session context reads the persisted token during its own first render but starts the lookup that
 * validates it only after that render, so in the render that mounts a guard a visitor holding a session and
 * a visitor holding none are indistinguishable: both report the `guest` role and no identity, and the
 * context reports `idle` for both. Redirecting on that first read would turn a signed-in visitor away from
 * `/account` on a deep reload — the one case where the session is in storage and nowhere else — so the
 * guard waits for one more turn before it decides. It is a microtask and not a timer because the context
 * begins its lookup from a microtask too, which puts this wait in the same turn as the answer it is waiting
 * for; a timer would add a frame of its own and, under a test that fakes the clock, might never fire.
 *
 * The flag only ever moves one way, and the hook never re-subscribes, so a signed-out visitor is not asked
 * to wait twice for the same answer.
 *
 * @returns `false` for the first render of the caller and `true` from the following turn on.
 */
function useSessionSettled(): boolean {
  const [isSettled, setIsSettled] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    queueMicrotask(() => {
      if (!isCancelled) {
        setIsSettled(true);
      }
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  return isSettled;
}

/** Everything {@link RequireRole} accepts. */
interface RequireRoleProps {
  /**
   * The roles the section admits, as one of the two lists `SECTION_ROLES` in `src/constants/routes.ts`
   * declares. A session holding any other role is refused at the path it asked for.
   */
  readonly allow: readonly Role[];
}

/**
 * The guard over a whole section, rendered as a layout route so one check covers every path beneath it.
 *
 * It is deliberately thin: it admits a session whose role the section allows, waits where the session's
 * first answer has not arrived, and turns every other visitor away in the way their own session calls for. A
 * visitor with no usable session is sent to sign-in carrying the path they wanted in `returnTo` — the query
 * key `LoginPage` and `RegisterPage` read to continue to it once the session is established. A session in
 * force whose role the section does not admit is refused where it stands, by {@link SectionRefusal}, because
 * the two visitors are asking different things: the first has no session to act with, and a form is what
 * answers that, while the second has signed in as a role that is not this section's, which no form answers.
 * Sending the second one to sign-in is what would draw a refusal at a sign-in route's address, leaving the
 * bar naming a screen the visitor is not reading.
 *
 * A session in force is judged on its role alone and renders its subtree whatever the context's status is,
 * so an action in flight — a profile save, a sign-out elsewhere — cannot blank a screen the visitor is
 * reading. Nothing is fetched and no request is made to decide any of this: the session is already in the
 * context, and the check that decides whether a request for privileged data succeeds is the mock server's.
 *
 * A failure the session's read settled with is told from a refusal, because the two ask the visitor for
 * different things. A refusal is the store saying the credential is no longer accepted, which the
 * revalidation has already turned into a cleared session and an announcement, so the visitor is sent to
 * sign-in with the path preserved. Any other failure is a store that could not answer, which says nothing
 * about the stored token, so the visitor keeps it and the section's error state offers the standard retry.
 * Both readings come from the classification in `src/lib/apiContract.ts`, the same one the transport and
 * the state layer use, so none of the three can disagree about which happened.
 *
 * @param props - The roles this section admits; see {@link RequireRoleProps}.
 * @returns The section's matched child, a placeholder while the session resolves, the section's error state
 *   for a read that failed, the refusal for a role the section does not admit, or a redirect to sign-in.
 */
function RequireRole({ allow }: RequireRoleProps): ReactElement {
  const { error, isAuthenticated, role, status } = useAuth();
  const { restoreSession, signOut } = useAuthDispatch();
  const { pathname, search } = useLocation();
  const isSessionSettled = useSessionSettled();

  // A field-shaped callback rather than the action itself: the alert takes a `() => void`, and the guard
  // has nothing to wait for — the revalidation's outcome arrives through the state it already reads.
  const retrySession = useCallback((): void => {
    void restoreSession();
  }, [restoreSession]);

  // The same shape for the refusal's sign-out: the control calls it and nobody here waits on the request,
  // because the session leaves the context as soon as the action runs.
  const leaveSession = useCallback((): void => {
    void signOut();
  }, [signOut]);

  if (isAuthenticated) {
    if (allow.includes(role)) {
      return <Outlet />;
    }
    // The refusal is rendered at the address that was asked for, so the location describes the screen the
    // visitor is reading and a reload, or a link copied from the bar, opens this same refusal. The sign-in
    // route is reserved for the visitor with no usable session, the one a form can help; a `role` this
    // section refuses is what this screen answers, and the sign-out it offers is how another account arrives.
    return <SectionRefusal onSignOut={leaveSession} />;
  }

  // Nothing is in force yet, and that is not yet an answer: the session may be about to arrive from the
  // stored token, so the screen's own placeholder is shown instead of a sign-in form that would flash. It is
  // shown silently: the suspension boundary above has already announced this route's load and this wait
  // belongs to the same route change, so a live region here would read the sentence out a second time.
  if (status === "loading" || !isSessionSettled) {
    return <RouteFallback announce={false} />;
  }

  // The session could not be read while the visitor still holds the token, so the answer is the standard
  // retry: only a refusal — which the revalidation has already turned into a sign-out — sends them to
  // sign-in, because a sign-in screen would not help a store that could not answer.
  if (error !== null && !isSessionRefusal(error)) {
    return <SessionFailure error={error} onRetry={retrySession} />;
  }

  return <Navigate replace to={loginPath(`${pathname}${search}`)} />;
}

/** Everything {@link SessionFailure} accepts. */
interface SessionFailureProps {
  /** The failure the session's read settled with, rendered as the alert's text. */
  readonly error: ApiError;

  /** Starts the session's read again; the alert's action calls it. */
  readonly onRetry: () => void;
}

/**
 * The error state a guard shows when the session could not be read.
 *
 * A failure that is not a refusal says nothing about the stored token — a store that could not answer is
 * not a store that said no — so the visitor keeps the token and is offered the standard retry rather than
 * the redirect a refusal gets: turning someone away over a request that failed would give up a session
 * that is still good. It is composed here the way {@link NotFoundPage} composes its view, from the page
 * geometry and the alert primitive, so this file introduces no class and no stylesheet.
 *
 * @param props.error - The failure to report; see {@link SessionFailureProps}.
 * @param props.onRetry - Starts the session's revalidation again.
 * @returns The error state: the register, the sentence and the retry control.
 */
function SessionFailure({ error, onRetry }: SessionFailureProps): ReactElement {
  return (
    <div className="sp-container">
      <div className="sp-page">
        <Alert tone="danger" error={error} actionLabel={COMMON_ACTIONS.RETRY} onAction={onRetry} />
      </div>
    </div>
  );
}

/** Everything {@link SectionRefusal} accepts. */
interface SectionRefusalProps {
  /** Ends the session the refusal was raised against, so an account the section admits can arrive. */
  readonly onSignOut: () => void;
}

/**
 * The refusal a guard renders for a session in force whose role the section it asked for does not admit.
 *
 * It is drawn at the path the visitor asked for, and that is what it is for: the address bar names the screen
 * that is rendered, so a reload of it, and a link copied out of it, re-open this refusal rather than a
 * sign-in screen the visitor has no use for. The sign-in route is left to the visitor holding no usable
 * session, which is the one visitor a form can help.
 *
 * Its wording and both its ways on are the libraries'. The heading and the body are the refusal copy of
 * `src/constants/content-reports.ts`, so no sentence is written here; the account this role does hold is the
 * route constant, and the sign-out is the shared verb, which drops the session so another account can arrive
 * and open the refused section. Neither control leads back to the path that was refused, so the two screens
 * cannot be walked in a circle. It titles itself, rather than being titled by the guard, because a hook
 * cannot be called after the guard's early return — and the name it sets is the refusal's own heading, so the
 * tab describes this screen instead of the section it stands in.
 *
 * The page geometry is `sp-page` alone, and that is deliberate. The refused section is the administrator's,
 * and `src/components/layout/AppLayout.tsx` together with `src/styles/layout.css` already give the
 * administrator frame's main region the measure and the inline gutter every other route takes from
 * `sp-container` — which is why no administrator page wraps itself in one. A container here would apply that
 * gutter a second time and inset this screen further than the section it is refusing.
 *
 * @param props.onSignOut - Ends the session the refusal was raised against; see {@link SectionRefusalProps}.
 * @returns The refusal: the empty state that states it and the two controls that answer it.
 */
function SectionRefusal({ onSignOut }: SectionRefusalProps): ReactElement {
  useDocumentTitle(documentTitle(ACCOUNT_ACCESS_COPY.HEADING));

  return (
    <div className="sp-page">
      <EmptyState
        headingLevel={1}
        title={ACCOUNT_ACCESS_COPY.HEADING}
        description={ACCOUNT_ACCESS_COPY.BODY}
      />
      <ButtonGroup align="center">
        <Link className="sp-btn sp-btn--primary" to={ROUTES.ACCOUNT}>
          {ACCOUNT_ACCESS_COPY.CONTINUE_LABEL}
        </Link>
        <Button variant="secondary" onClick={onSignOut}>
          {COMMON_ACTIONS.SIGN_OUT}
        </Button>
      </ButtonGroup>
    </div>
  );
}

// Placeholder and not-found -----------------------------------------------------------------------

/**
 * The counts the route placeholder stands a page's two content bands in with: one row of tiles for a band of
 * cards, and a short table's worth of rows beneath them.
 */
const ROUTE_FALLBACK_TILE_COUNT = 4;
const ROUTE_FALLBACK_ROW_COUNT = 3;

/** Everything {@link RouteFallback} accepts. */
interface RouteFallbackProps {
  /**
   * Whether the placeholder speaks the load through its own live region. Defaults to `true`, which is what
   * the suspension boundary wants, because that boundary owns the single announcement a route change makes.
   */
  readonly announce?: boolean;
}

/**
 * The placeholder a suspending route renders behind, and the one the guard shows while it waits for the
 * session's first answer.
 *
 * It is shaped like a page rather than like one line of one — the container and rhythm every route uses, the
 * heading and description line a `PageHeader` opens with, a band of tiles and a stack of table rows beneath
 * them — and every part of it is a shape `Skeleton` already provides, so it is the primitive the pages' own
 * loading states are built from and not a second placeholder of this file's own. It stands inside the
 * block-size floor `src/styles/layout.css` gives the routed region, so the page already occupies the height
 * the destination will need and the shell's footer stays below the fold while the route and its first read
 * resolve.
 *
 * The skeleton is decorative and announces nothing, so this placeholder renders at most one visually hidden
 * live region, and `announce` decides whether it does: the suspension boundary leaves the default in place,
 * and the guard passes `false`, because its wait follows that boundary's announcement within one route
 * change, where a second region would repeat the sentence. The container carries `aria-busy` either way,
 * which is the state the placeholder stands for.
 *
 * @param props - Whether this placeholder speaks the load itself; see {@link RouteFallbackProps}.
 * @returns The route-level loading placeholder.
 */
function RouteFallback({ announce = true }: RouteFallbackProps): ReactElement {
  return (
    <div className="sp-container" aria-busy="true">
      <div className="sp-page">
        <Skeleton variant="heading" width="18ch" />
        <Skeleton variant="text" lines={2} />
        {/* The two bands a data-backed page settles into. The keys are positional on purpose: every
            placeholder inside a band is the same decorative box, with no identity for a key to preserve. */}
        <div className="sp-grid">
          {Array.from({ length: ROUTE_FALLBACK_TILE_COUNT }, (_tile, index) => (
            <Skeleton key={`route-placeholder-tile-${String(index)}`} variant="card" />
          ))}
        </div>
        {Array.from({ length: ROUTE_FALLBACK_ROW_COUNT }, (_row, index) => (
          <Skeleton key={`route-placeholder-row-${String(index)}`} variant="row" />
        ))}
      </div>
      {announce ? (
        <span className="sp-visually-hidden" role="status">
          {A11Y_COPY.LOADING_ANNOUNCEMENT}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The view the catch-all route renders for an address that matches nothing.
 *
 * It renders the shared `src/components/ui/NotFoundView.tsx`, so the catch-all, a category route naming no
 * category and a product route naming no product are one composition rather than three, and the state reads
 * the same way wherever it is reached. What this page adds is the name of its own address: the title is set
 * here through the same hook every other page sets its title through, so a cold load of an unmatched address
 * sets the not-found title, and an in-app arrival replaces the previous screen's title, because the tab is
 * meant to name the screen in front of the visitor.
 *
 * @returns The not-found view.
 */
function NotFoundPage(): ReactElement {
  useDocumentTitle(documentTitle(PAGE_TITLES.NOT_FOUND));

  return <NotFoundView />;
}

// The route table ---------------------------------------------------------------------------------

/**
 * Every route in the product, in one table.
 *
 * It is exported as `AppRoutes` and rendered inside whichever router is above it, so the application and the
 * tests share one definition of what this product's addresses are. One `Suspense` boundary wraps the whole
 * table rather than one per route: the fallback is a page-shaped placeholder, and a boundary per route would
 * render it for the screen already on the page while a neighbouring chunk loaded.
 *
 * The order below is the order of the route inventory, and the two guarded sections are declared as layout
 * routes with no path of their own, so the check runs once for a whole subtree instead of once per screen.
 * The pathless wrapper changes no path: a route's path is resolved against its nearest ancestor that has
 * one, so `orders` inside the wrapper is still `/account/orders`.
 *
 * No document title is set here: each page sets its own through `useDocumentTitle`, which would otherwise
 * race a title written at this level.
 *
 * @returns The routed content of the application.
 */
export function AppRoutes(): ReactElement {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Storefront: open to everyone, and the only routes a visitor needs before signing in. */}
        <Route path={ROUTES.HOME} element={<HomePage />} />
        <Route path={ROUTES.CATALOG} element={<CatalogPage />} />
        <Route path={ROUTES.CATEGORY} element={<CatalogPage />} />
        <Route path={ROUTES.SEARCH} element={<SearchPage />} />
        <Route path={ROUTES.PRODUCT} element={<ProductDetailPage />} />

        {/* Buying: the cart and the checkout are open too, because a guest may complete an order without
            an account, and the confirmation has to stay reachable after the flow has finished. */}
        <Route path={ROUTES.CART} element={<CartPage />} />
        <Route path={ROUTES.CHECKOUT} element={<CheckoutPage />} />
        <Route path={ROUTES.ORDER_CONFIRMATION} element={<OrderConfirmation />} />

        {/* Account entry: unguarded, because they are where a guard sends a visitor who has no session,
            and each of them serves a signed-in visitor with the account it can continue to. */}
        <Route path={ROUTES.LOGIN} element={<LoginPage />} />
        <Route path={ROUTES.REGISTER} element={<RegisterPage />} />

        {/* The customer's own area: one guard and one shell, with the three views nested inside it so the
            shell survives a move between them. */}
        <Route element={<RequireRole allow={SECTION_ROLES.ACCOUNT} />}>
          <Route path={ROUTES.ACCOUNT} element={<AccountLayout />}>
            <Route index element={<ProfilePage />} />
            <Route path={ACCOUNT_SECTIONS.ORDERS} element={<OrderHistoryPage />} />
            <Route path={ACCOUNT_SECTIONS.ORDER_DETAIL} element={<OrderHistoryPage />} />
            <Route path={ACCOUNT_SECTIONS.ADDRESSES} element={<AddressBookPage />} />
          </Route>
        </Route>

        {/* The administrator's area: its own guard, because reports and analytics read every customer's
            orders rather than the session's own. */}
        <Route element={<RequireRole allow={SECTION_ROLES.ADMIN} />}>
          <Route path={ROUTES.ADMIN} element={<AdminDashboardPage />} />
          <Route path={ROUTES.ADMIN_REPORTS} element={<ReportsPage />} />
        </Route>

        {/* Everything else, including an address that was mistyped or a link that outlived its route. */}
        <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
