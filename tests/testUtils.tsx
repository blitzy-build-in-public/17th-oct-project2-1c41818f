/**
 * Path: tests/testUtils.tsx
 * Purpose: The render helper wrapping a component in all providers and a MemoryRouter, plus the failNext seam helper
 * Lines: 323
 */

import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

import { App } from "@/App";
import { ROUTES } from "@/constants/routes";
import { salesProDataSource } from "@/data/repositories";
import {
  clearInjectedFailures,
  failNext as armSeamFailure,
  type RequestFailureMatcher,
} from "@/lib/apiClient";
import { isDataSourceRegistered, registerDataSource, resetMockServerState } from "@/lib/mockServer";
import { AuthProvider } from "@/state/AuthContext";
import { CartProvider } from "@/state/CartContext";
import { CatalogProvider } from "@/state/CatalogContext";
import { CheckoutProvider } from "@/state/CheckoutContext";
import { ToastProvider } from "@/state/ToastContext";

export { screen, waitFor, within } from "@testing-library/react";
export type { RenderResult };
export type { UserEvent };

/*
 * What this file owns, and what it deliberately leaves out.
 *
 * It owns two things and no third. The first is the render harness: `renderWithProviders` mounts one element
 * inside the five real providers — toast, authentication, catalogue, cart and checkout, in `src/App.tsx`'s own
 * order — under a `MemoryRouter`, and `renderApp` mounts the real application under a `MemoryRouter` alone,
 * because `App` composes the providers itself. Exactly one router exists in either tree, and it is the
 * `MemoryRouter` supplied here: neither `src/App.tsx` nor `src/Router.tsx` renders one, so a case picks its own
 * starting location and no router ever nests inside another. The router sits outermost because
 * `src/state/CatalogContext.tsx` reads the query string through `useSearchParams`, which is the query store the
 * whole catalogue is filtered by.
 *
 * The second is the API seam. The transport is joined to its data by a binding rather than an import —
 * `registerDataSource` in `src/lib/mockServer.ts` — which `src/main.tsx` performs for the application and this
 * file performs for the suite, with the real seeded `salesProDataSource`. The seam's failure switch is
 * therefore the single lever a case has over what the product is answered: `failNext` arms one request to fail.
 * Nothing here stands in for a service, a reducer, a context or a data module. An error state is reached by
 * arming a failure at the seam; an empty state by a query that legitimately returns nothing — a search term
 * that matches no product, a customer with no orders, a date range with no sales. Neither is reached by
 * replacing the product's internals, which is what keeps a case proving the real screen.
 *
 * Timers. The suite runs on real timers with the simulator latency at zero (`tests/setup.ts` stubs
 * `VITE_API_LATENCY_MS` at module scope), so a flow is awaited with an async query rather than advanced. Only a
 * debounce or an auto-dismiss needs fake timers, and a case that arms them uses
 * `vi.useFakeTimers({ shouldAdvanceTime: true })` so the async queries still settle; `setupUser`'s
 * `advanceTimers` is what lets the interaction driver move that clock. `tests/setup.ts` returns to real timers
 * after every case, so a case that armed them needs no teardown of its own.
 *
 * Settling. Mounting the providers starts the requests they issue on mount — the catalogue's page and its
 * facets, the checkout's basket snapshot. A case therefore awaits its first expectation after a render
 * (`await screen.findBy…`) instead of asserting on the first frame: the awaited query is what keeps that
 * settle inside the testing library's `act` window, and a synchronous assertion before it leaves React
 * reporting a state update it could not attribute. No case needs an `act` call of its own for this, and none
 * needs to wait longer than the query it was going to make anyway.
 *
 * Which project imports it. This module renders, so it belongs to the jsdom project (`tests/components/**`
 * and `tests/integration/**`). A unit test in the node project drives the seam directly through
 * `src/lib/apiClient.ts` and `registerDataSource` instead of importing from here, because there is no
 * document to render into.
 */

// The suite's data source -------------------------------------------------------------------------

/**
 * Binds the seeded data source the suite is answered from, before any render.
 *
 * The binding is checked first and is therefore safe to repeat and cheap to call: `resetMockServer` forgets the
 * bound source along with the seam's per-case state, so a case that reset the seam would otherwise leave every
 * later request — its own included — answering `503 data-source-unavailable`. The call is also made once at
 * module scope, below, so a case that drives a service without rendering, as an integration case seeding a cart
 * does, is served data rather than a refusal.
 */
function ensureDataSourceBound(): void {
  if (!isDataSourceRegistered()) registerDataSource(salesProDataSource);
}

ensureDataSourceBound();

// The render harness ------------------------------------------------------------------------------

/**
 * What both render helpers accept: where the rendered tree starts, and what history sits behind it.
 */
export interface RenderHarnessOptions {
  /**
   * The location the rendered tree starts at, as a path with an optional query string — `/catalog`,
   * `/search?q=lamp`, `/product/aurora-desk-lamp`. Defaults to the landing route.
   */
  readonly route?: string;
  /**
   * The locations placed behind {@link RenderHarnessOptions.route}, oldest first, so a case can leave the
   * screen it started on and navigate back into it. The starting location is always `route`, whichever entries
   * are supplied.
   */
  readonly entries?: readonly string[];
}

/** What both render helpers return: everything `render` returns, plus the interaction driver. */
export type RenderHarness = RenderResult & { readonly user: UserEvent };

/** A harness's starting history: the location it starts at, and the entries behind that location. */
interface HarnessHistory {
  readonly entries: readonly string[];
  readonly index: number;
}

/**
 * The history a harness starts at: the entries behind the starting location, with the starting location last.
 *
 * `MemoryRouter` begins at the last entry of `initialEntries` unless it is told which one to begin at, and the
 * index is passed explicitly so the rule this helper states — a harness starts at `route` — holds whatever that
 * default is. The application's lazy route chunks and the session's mount revalidation both settle
 * asynchronously, so a case awaits its first expectation rather than asserting on the first frame.
 */
function historyFor(options: RenderHarnessOptions): HarnessHistory {
  const behind = options.entries ?? [];
  return { entries: [...behind, options.route ?? ROUTES.HOME], index: behind.length };
}

/** What the two harness wrappers take: a starting history, and the subtree to render inside it. */
interface HarnessProps {
  readonly history: HarnessHistory;
  readonly children: ReactNode;
}

/**
 * The harness's router: an in-memory history that begins at the location the helper computed.
 *
 * It is the only router in either tree, which is the invariant a case depends on — a second one would ignore
 * the first's location and throw on every hook that reads it — and it is why a route-dependent case always
 * starts from an explicit entry rather than from the document's URL, which jsdom shares across the files of one
 * run.
 */
function RouterHarness({ history, children }: HarnessProps): ReactElement {
  return (
    <MemoryRouter initialEntries={[...history.entries]} initialIndex={history.index}>
      {children}
    </MemoryRouter>
  );
}

/**
 * The application's providers wrapped around a subtree, inside the harness's router.
 *
 * The five providers are the real ones, nested in `src/App.tsx`'s order: toast outermost, because every
 * provider and every page may raise a notification, and catalogue, cart and checkout inside the authentication
 * provider, because each of them reads the session it owns. Their values are memoised and their callbacks
 * stable, so one mount per case re-renders nothing on its own. `App` is not mounted here — it composes these
 * same providers, so `renderApp` uses {@link RouterHarness} directly — and neither is the toast viewport,
 * which belongs to the application and is mounted there: a component case asserts its component, not the
 * application's notification surface.
 */
function ProviderHarness({ history, children }: HarnessProps): ReactElement {
  return (
    <RouterHarness history={history}>
      <ToastProvider>
        <AuthProvider>
          <CatalogProvider>
            <CartProvider>
              <CheckoutProvider>{children}</CheckoutProvider>
            </CartProvider>
          </CatalogProvider>
        </AuthProvider>
      </ToastProvider>
    </RouterHarness>
  );
}

/**
 * Creates the interaction driver every case types, clicks and tabs through.
 *
 * `advanceTimers` is supplied only while fake timers are armed, and the driver is created after them: the
 * driver calls it on every API that waits between events — `tab`, `type`, `keyboard` — and Vitest's own
 * `advanceTimersByTime` throws when the timers are real, so passing it unconditionally would break every
 * interaction with a delay in a suite that runs on real timers, which this one does by default. A case that
 * arms fake timers arms them before it renders (`vi.useFakeTimers({ shouldAdvanceTime: true })`), so the
 * driver created here sees them and can move the clock; a case that arms them afterwards leaves
 * `shouldAdvanceTime` to settle the waits, which is the mode it was armed in for. Dispatching a single event
 * is not the interaction mechanism here — it does not reproduce the focus, keyboard or pointer behaviour a
 * control depends on — so the driver is the way in and a `fireEvent` call is the exception a case states a
 * reason for.
 *
 * @returns A `user-event` instance that shares one device state across every call made through it.
 */
export function setupUser(): UserEvent {
  if (!vi.isFakeTimers()) return userEvent.setup();
  return userEvent.setup({
    advanceTimers: (delayMs: number): void => {
      vi.advanceTimersByTime(delayMs);
    },
  });
}

/**
 * Renders one element inside every provider the product has, under the harness's router.
 *
 * This is the entry point for a component case — a primitive, the shared table, a chart — because the element is
 * mounted with the real providers rather than with stand-ins, so nothing it reads is faked. The interaction
 * driver is always returned beside the render result, so a case that does not interact ignores it instead of
 * opting in to it.
 *
 * @param ui - The element to render; a whole screen is better served by {@link renderApp}.
 * @param options - The starting location and the entries behind it; see {@link RenderHarnessOptions}.
 * @returns The render result, plus the `user-event` instance to interact through.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderHarnessOptions = {},
): RenderHarness {
  ensureDataSourceBound();
  return {
    ...render(<ProviderHarness history={historyFor(options)}>{ui}</ProviderHarness>),
    user: setupUser(),
  };
}

/**
 * Renders the real application at a route, so an integration case drives real routes, real guards and real
 * screens.
 *
 * The tree is `App` inside the harness's `MemoryRouter` and nothing else: `App` composes the five providers,
 * the application shell, the error boundary, the mini-cart and the toast viewport itself, so binding the
 * providers here as well would mount a second copy of every one of them. What a case supplies is where the
 * application starts; what it can then do is everything a visitor can — browse, search, filter, add to the
 * cart, sign in, check out — because every screen is answered from the bound seeded data rather than from a
 * fixture.
 *
 * @param options - The starting location and the entries behind it; see {@link RenderHarnessOptions}.
 * @returns The render result, plus the `user-event` instance to interact through.
 */
export function renderApp(options: RenderHarnessOptions = {}): RenderHarness {
  ensureDataSourceBound();
  return {
    ...render(
      <RouterHarness history={historyFor(options)}>
        <App />
      </RouterHarness>,
    ),
    user: setupUser(),
  };
}

// The API seam ------------------------------------------------------------------------------------

/**
 * What an armed failure may be described by: the seam's own matcher, or the request path alone.
 *
 * A matcher names any of the request's method, path, route id, status, code and message. A bare string is the
 * request path and must equal the request's pathname exactly — the seam's own rule, query string aside — so a
 * `RegExp` is what narrows to a family of paths, as `/^\/api\/products/` does for the listing and the facets.
 */
export type FailNextTarget = RequestFailureMatcher | string | RegExp;

/** The handle an armed failure is held by, so the case that armed it owns the cleanup. */
export interface FailureHandle {
  /**
   * Removes every failure the seam still holds armed — the seam's only removal verb — which makes it safe to
   * call after the arm has already been consumed and safe to call more than once.
   */
  disarm(): void;
}

/** The matcher an arm is placed with, a bare path widened to the seam's own member. */
function matcherFor(target: FailNextTarget): RequestFailureMatcher {
  if (typeof target === "string" || target instanceof RegExp) return { path: target };
  return target;
}

/**
 * Arms the next matching request to fail instead of being answered: how a case reaches an error state.
 *
 * The arm is one-shot, because the first request it applies to consumes it and answers with the failure, so a
 * case arms one per request it means to fail. Called with no target it fails the next request of any kind with
 * `503 data-source-unavailable` and the neutral message the seam words an unexpected failure with, which is the
 * failure every page's error state is written for and the one an integration case uses to prove that state
 * renders the message and offers its retry. A narrower arm fails one call inside a screen that issues several,
 * as `failNext({ method: "POST", path: "/api/cart/price" })` does for a refused basket.
 *
 * The switch belongs to the seam and is reached through `src/lib/apiClient.ts`, the module the suite drives, so
 * the failure a case arms is the failure the application would meet rather than a stub standing in for the
 * transport. Mocking stops here: no service, reducer, context or data module is replaced.
 *
 * @param target - What to fail: a matcher, a request path, or nothing to fail the next request of any kind.
 * @returns A handle whose `disarm` clears the failures the seam still holds armed.
 */
export function failNext(target: FailNextTarget = {}): FailureHandle {
  armSeamFailure(matcherFor(target));
  return {
    disarm: (): void => {
      clearInjectedFailures();
    },
  };
}

/**
 * Returns the seam to the state a fresh case expects: no armed failure, and no remembered order.
 *
 * Two things go and one stays. The armed failures go, so a failure an earlier case armed for a request it never
 * made cannot answer this case's request. The seam's idempotency store goes, so an order key an earlier case
 * remembered cannot replay its response into this case's submission. The bound data source stays — and is re-bound
 * if a case unbound it — because `tests/setup.ts` re-binds a source between cases in the project that renders,
 * so this re-binding is what keeps a case that unbound the seam mid-case answered for the rest of that case.
 * That is why this calls the seam's own state reset rather than the client's `resetApiClient`, which
 * forgets the binding along with the state. `tests/setup.ts` performs the same reset after every case, so a
 * case only needs this when it wants a clean seam mid-case.
 */
export function resetApiState(): void {
  resetMockServerState();
  ensureDataSourceBound();
}
