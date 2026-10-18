/**
 * Path: src/Router.tsx
 * Purpose: The route table with lazy slices, role guards, the suspension boundary and the not-found view
 * Lines: 455
 */

import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";

import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";

import { ButtonGroup } from "@/components/ui/Button";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { A11Y_COPY, COMMON_ACTIONS, HEADER_COPY, NOT_FOUND_COPY } from "@/constants/content";
import { ROUTES, SECTION_ROLES, loginPath } from "@/constants/routes";
import { isSessionRefusal } from "@/lib/apiContract";
import { useAuth, useAuthDispatch } from "@/state/AuthContext";
import type { Role } from "@/types/account";
import type { ApiError } from "@/types/common";

/*
 * What this file owns, and what it deliberately leaves out.
 *
 * It owns the route table: one `Route` per destination, each element bound lazily to the feature slice that
 * renders that screen; the two guarded sections — `/account/*` admits a customer or an administrator, and
 * `/admin/*` admits an administrator alone, each list read from `SECTION_ROLES` in
 * `src/constants/routes.ts`, which is where the role-to-section policy has its one home; and the catch-all
 * that renders the not-found view composed below. Every path here comes from the same module, so a route
 * string is written once in the product and this table, the navigation and the path builders cannot drift
 * apart.
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
 * cannot serve, offers the section's own error state with a retry when the session could not be read, and
 * preserves the path they were after in the sign-in link's `returnTo` query; whether a request is allowed is
 * decided in `src/lib/mockServer.ts`, which re-checks the session on every privileged endpoint, because
 * hiding a control is not a permission check.
 *
 * Class contract. No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` —
 * so every class rendered below is consumed by name. `src/styles/layout.css` owns the page geometry the
 * not-found view and the route placeholder wear (`sp-container`, `sp-page`); `src/styles/controls.css` owns
 * the button family the recovery links take, as `sp-btn` with its `--primary` and `--secondary` modifiers,
 * and the `sp-btn-group--align-center` rule that widens the group and packs its controls to the middle; and
 * the empty state's own parts (`sp-empty`, `sp-empty__title`, `sp-empty__body`) arrive with `EmptyState`.
 * No colour, length, radius, shadow or breakpoint of this file's own appears below.
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
   * declares. A session holding any other role is sent to sign-in with the path it asked for.
   */
  readonly allow: readonly Role[];
}

/**
 * The guard over a whole section, rendered as a layout route so one check covers every path beneath it.
 *
 * It is deliberately thin: it admits a session whose role the section allows, waits where the session's
 * first answer has not arrived, and otherwise turns the visitor away to sign-in carrying the path they
 * wanted in `returnTo` — the query key `LoginPage` and `RegisterPage` read to continue to it once the
 * session is established. A role that is insufficient is treated exactly like a missing session, because
 * the two ask the visitor for the same thing and a screen of the guard's own would duplicate the sign-in
 * route's. What the two cases then get differs, and `LoginPage` is where they part: a visitor with no
 * session arrives at the form and is sent on to the preserved path once they sign in, while one who is
 * already signed in as a customer is told that their role is what refuses them — the question that screen
 * asks of the preserved path is `canReachPath` in `src/constants/routes.ts` — and is offered the account
 * and the sign-out that can answer it.
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
 *   for a read that failed, or a redirect to sign-in.
 */
function RequireRole({ allow }: RequireRoleProps): ReactElement {
  const { error, isAuthenticated, role, status } = useAuth();
  const { restoreSession } = useAuthDispatch();
  const { pathname, search } = useLocation();
  const isSessionSettled = useSessionSettled();

  // A field-shaped callback rather than the action itself: the alert takes a `() => void`, and the guard
  // has nothing to wait for — the revalidation's outcome arrives through the state it already reads.
  const retrySession = useCallback((): void => {
    void restoreSession();
  }, [restoreSession]);

  if (isAuthenticated) {
    if (allow.includes(role)) {
      return <Outlet />;
    }
    return <Navigate replace to={loginPath(`${pathname}${search}`)} />;
  }

  // Nothing is in force yet, and that is not yet an answer: the session may be about to arrive from the
  // stored token, so the screen's own placeholder is shown instead of a sign-in form that would flash.
  if (status === "loading" || !isSessionSettled) {
    return <RouteFallback />;
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

// Placeholder and not-found -----------------------------------------------------------------------

/**
 * The placeholder a suspending route renders behind, and the one the guard shows while it waits for the
 * session's first answer.
 *
 * It is shaped like a page — the container and rhythm every route uses, a heading line and a block beneath
 * it — so the screen that replaces it does not move the content around it, and it is wrapped in the same
 * page geometry the destination will use. The skeleton is decorative and announces nothing, so the region
 * carries `aria-busy` and one visually hidden live region speaks the load once, which is the contract
 * `Skeleton` documents: no second announcement, and no spinner turning beside a placeholder that already
 * stands for the content.
 *
 * @returns The route-level loading placeholder.
 */
function RouteFallback(): ReactElement {
  return (
    <div className="sp-container" aria-busy="true">
      <div className="sp-page">
        <Skeleton variant="heading" width="18ch" />
        <Skeleton />
      </div>
      <span className="sp-visually-hidden" role="status">
        {A11Y_COPY.LOADING_ANNOUNCEMENT}
      </span>
    </div>
  );
}

/**
 * The view the catch-all route renders for an address that matches nothing.
 *
 * It is composed here rather than in a page file of its own: it is not a module the product sells with, and
 * it renders nothing a shared primitive does not already provide. The wording is the content library's three
 * strings, so the explanation is not written twice for two surfaces, and the two ways out are one control
 * group — the catalogue, which is the action the wording names, and the home page — rather than a pair of
 * links left loose in the page's column. Both are router links and neither reloads the document; the group
 * is what gives them the button family's skin and packs them to the middle of the page.
 *
 * @returns The not-found view.
 */
function NotFoundPage(): ReactElement {
  return (
    <div className="sp-container">
      <div className="sp-page">
        <EmptyState
          headingLevel={1}
          title={NOT_FOUND_COPY.TITLE}
          description={NOT_FOUND_COPY.BODY}
        />
        <ButtonGroup align="center">
          <Link className="sp-btn sp-btn--primary" to={ROUTES.CATALOG}>
            {NOT_FOUND_COPY.ACTION_LABEL}
          </Link>
          <Link className="sp-btn sp-btn--secondary" to={ROUTES.HOME}>
            {HEADER_COPY.NAV_HOME_LABEL}
          </Link>
        </ButtonGroup>
      </div>
    </div>
  );
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
