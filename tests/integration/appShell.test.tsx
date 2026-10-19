/**
 * Path: tests/integration/appShell.test.tsx
 * Purpose: The composition root's own contract — the shell's landmarks and skip link, the error boundary's failure state with its retry and its way home, the focus a navigation into a guarded section moves, the administrator frame, and the toast viewport and mini-cart mounted beside the routed region
 * Lines: 391
 */

import { describe, expect, it, vi } from "vitest";

import { BREAKPOINTS, DEMO_ACCOUNTS } from "@/constants/config";
import {
  ACCOUNT_COPY,
  A11Y_COPY,
  APP_COPY,
  CART_COPY,
  COMMON_ACTIONS,
  FEEDBACK_COPY,
  HEADER_COPY,
  HOME_COPY,
  PAGE_TITLES,
  addedToCartMessage,
  cartButtonLabel,
  quantityLabel,
  quickAddLabel,
} from "@/constants/content";
import { ADMIN_COPY } from "@/constants/content-reports";
import { ROUTES } from "@/constants/routes";
import type { Product } from "@/types/catalog";

import {
  fieldLabel,
  productNamed,
  settledTiles,
  textOf,
  tileHeadings,
} from "../helpers/journeyHarness";
import { renderApp, screen, waitFor, within } from "../testUtils";
import type { UserEvent } from "../testUtils";

/*
 * What `src/App.tsx` owns, read where it can be observed.
 *
 * The composition root owns the provider chain, the error boundary around the routed content, the shell
 * around that boundary, and the two surfaces every route raises — the toast viewport and the lazily bound
 * mini-cart drawer — mounted beside the shell so that neither leaves with a page. The cases below take those
 * in turn, through the real application: routing, guards, screens, providers and data are all the product's
 * own, and no service, reducer, context or data module is replaced.
 *
 * The one fault this file injects is in the environment, not in the product, and it is the only way to reach
 * the boundary from outside: nothing inside the product can be made to throw, so the case refuses the viewport
 * query the routed catalogue and search screens ask the device for. The shell above them never asks for that
 * stop, so the routed content cannot render while the shell keeps rendering — which is exactly the failure the
 * boundary exists for, and the screen it shows is the product's own. The refusal is installed and withdrawn by
 * the case itself, and `tests/setup.ts` reinstalls its own media-query shim after every case.
 *
 * The rest of the shell is already exercised by the journey files — the cart badge and the drawer by
 * `shoppingFlow.test.tsx`, the guard's refusal and its error state by `sessionLifecycle.test.tsx` and
 * `accountFlow.test.tsx` — so what is added here is only what those miss: the landmarks and the skip link of a
 * real route, the boundary's failure state and its two ways out, the focus a navigation into a guarded section
 * moves onto the arriving screen's heading, the administrator frame's sidebar, and the two surfaces' mount
 * site beside the routed region.
 */

/** The id `src/components/layout/AppLayout.tsx` gives the document's one main region, and the fragment its
 *  skip link carries: the id is module-private there, so the agreement between the two is what a case checks. */
const MAIN_REGION_ID = "main-content";

/** The viewport query the catalogue and the search screen read the width of their facet column through: the
 *  only stop the routed screens ask the device for and the shell above them never does. */
const COLUMN_QUERY = `(min-width: ${BREAKPOINTS.XLARGE}px)`;

/** What the environment answers that query with when it cannot answer it at all: the failure's own message,
 *  which the boundary renders as the alert's text so a reader has the detail rather than a bare heading. */
const COLUMN_QUERY_REFUSAL = "The device could not report the width the facet column needs.";

/** The diagnostic `src/App.tsx` writes when a routed screen fails in a development build. */
const BOUNDARY_DIAGNOSTIC = "SalesPro: the routed content failed to render.";

/** A `MediaQueryList` answering `matches`, which is all `useMediaQuery` reads from one. */
function mediaQueryList(query: string, matches: boolean): MediaQueryList {
  const noop = (): void => undefined;
  return {
    media: query,
    matches,
    onchange: null,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
}

/** The environment the shell renders in: every configured stop satisfied, which is what a full-width window
 *  reports and what `tests/setup.ts`'s baseline — one pixel below the small stop — is not. */
function answerViewportQueries(): void {
  window.matchMedia = (query: string): MediaQueryList =>
    mediaQueryList(query, query.includes("min-width"));
}

/** Makes the routed screens' own viewport query fail, so the content they render cannot be rendered while the
 *  shell above them — which asks for the two lower stops only — is unaffected. */
function refuseColumnQuery(): void {
  window.matchMedia = (query: string): MediaQueryList => {
    if (query.includes(COLUMN_QUERY)) throw new TypeError(COLUMN_QUERY_REFUSAL);
    return mediaQueryList(query, query.includes("min-width"));
  };
}

/** Signs the seeded account an email names in through the real form, and waits for that form to leave. */
async function signIn(user: UserEvent, email: string): Promise<void> {
  await user.type(await screen.findByLabelText(fieldLabel(ACCOUNT_COPY.EMAIL_LABEL)), email);
  await user.type(
    screen.getByLabelText(fieldLabel(ACCOUNT_COPY.PASSWORD_LABEL)),
    DEMO_ACCOUNTS.PASSWORD,
  );
  await user.click(screen.getByRole("button", { name: ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }));
  await waitFor(() => {
    expect(screen.queryByText(ACCOUNT_COPY.SIGN_IN_HEADING)).toBeNull();
  });
}

/**
 * Awaits the sign-in route being left, which is what the sign-in screen's own continuation does once the
 * session is in hand.
 *
 * A header panel is keyed to the location it was opened at, so the cases below wait here before opening one:
 * a panel opened while that continuation is still pending would be closed by the navigation itself. The
 * signal is the auth screens' own continuation control — the only "Continue" either of the two auth screens
 * renders, and rendered only while one of them is on screen with a session in hand.
 */
async function signInRouteLeft(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByRole("link", { name: COMMON_ACTIONS.CONTINUE })).toBeNull();
  });
}

/** The account section's own navigation, which only the account route renders: the signal that a signed-in
 *  customer's continuation has arrived, named from the copy that section draws its links from. */
function accountSectionArrival(): Promise<HTMLElement> {
  return screen.findByRole("link", { name: ACCOUNT_COPY.NAV_ORDERS_LABEL });
}

/**
 * Opens the header's account menu and answers its panel, read from the id the trigger controls.
 *
 * The panel is derived from the location it was opened at — the header keys it to the route it was opened on
 * — so a navigation that lands between the click and this read closes it again. The panel the trigger names
 * is therefore awaited rather than read once, which is what keeps a case honest about the state it is about to
 * drive; a caller whose own route is still arriving awaits that first, through
 * {@link accountSectionArrival} or the destination screen's own heading.
 */
async function openAccountMenu(user: UserEvent): Promise<HTMLElement> {
  const trigger = screen.getByRole("button", { name: A11Y_COPY.ACCOUNT_MENU_LABEL });
  await user.click(trigger);
  const panelId = trigger.getAttribute("aria-controls");
  const panel = panelId === null ? null : document.getElementById(panelId);
  if (panel === null) {
    throw new Error("The account menu is not reachable through its trigger's aria-controls.");
  }
  await waitFor(() => {
    expect(panel).toBeVisible();
  });
  return panel;
}

/** The boundary's failure state, awaited: its heading is the screen's own name. */
function failureState(): Promise<HTMLElement> {
  return screen.findByRole("heading", { level: 1, name: FEEDBACK_COPY.ERROR_BOUNDARY_TITLE });
}

/** A destination of the header's own navigation: a routed page's breadcrumb may carry the same name. */
function headerDestination(name: string): HTMLElement {
  return within(screen.getByRole("navigation", { name: A11Y_COPY.MAIN_NAV_LABEL })).getByRole(
    "link",
    {
      name,
    },
  );
}

/** The first product tile a listing has settled on, with the seeded record behind its name. */
function firstTileProduct(): Product {
  const heading = tileHeadings()[0];
  return productNamed(textOf(heading));
}

describe("the application shell", () => {
  it("frames a routed screen with one banner, one main region and one footer, and puts the skip link first", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });

    const main = await screen.findByRole("main");
    expect(main).toHaveAttribute("id", MAIN_REGION_ID);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(
      await within(main).findByRole("heading", { level: 1, name: PAGE_TITLES.CATALOG }),
    ).toBeVisible();
    // The shell's own header is read through what it holds: a routed page draws a `header` of its own inside
    // the main region — the page header every screen composes — and this environment resolves both to the
    // banner role, so the landmark is named by its contents rather than queried by role.
    const primaryNav = screen.getByRole("navigation", { name: A11Y_COPY.MAIN_NAV_LABEL });
    expect(primaryNav.closest("header")).not.toBeNull();
    expect(screen.getByRole("link", { name: APP_COPY.APP_NAME })).toHaveAttribute(
      "href",
      ROUTES.HOME,
    );
    expect(screen.getByRole("contentinfo")).toBeVisible();

    // The document's first focusable element is the skip link, and the fragment it carries is the main
    // region's own id — the one agreement between the two, since the region names itself nowhere else.
    await user.tab();
    const skipLink = screen.getByRole("link", { name: A11Y_COPY.SKIP_TO_CONTENT });
    expect(skipLink).toHaveFocus();
    expect(skipLink).toHaveAttribute("href", `#${MAIN_REGION_ID}`);
    expect(document.getElementById(MAIN_REGION_ID)).toBe(main);
  });

  /*
   * The boundary's failure state, in the two builds it distinguishes. Its diagnostic is development-only, so
   * the case states the build it runs in and asserts what that build reports: the screen either way, and the
   * console line only in a development one. The flag is put back afterwards, which is the mode the suite runs
   * in and the value every other case reads.
   */
  it.each([
    { dev: true, reports: true },
    { dev: false, reports: false },
  ] as const)(
    "keeps the shell around a screen that cannot render, reporting it only in a development build (dev: $dev)",
    async ({ dev, reports }) => {
      refuseColumnQuery();
      vi.stubEnv("DEV", dev);
      // React reports a caught failure through the console as well; the spy keeps the run's output clean and
      // is asserted only for the product's own line.
      const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);

      renderApp({ route: ROUTES.CATALOG });

      const failure = await failureState();
      const main = screen.getByRole("main");
      expect(failure).toBeVisible();
      // The failure state replaces the routed content and nothing else: the shell it sits inside still stands,
      // which is what leaves every navigation control usable from a screen that could not render.
      expect(within(main).getByText(FEEDBACK_COPY.ERROR_BOUNDARY_BODY)).toBeVisible();
      expect(within(main).getByText(COLUMN_QUERY_REFUSAL)).toBeVisible();
      expect(
        within(main).queryByRole("heading", { level: 1, name: PAGE_TITLES.CATALOG }),
      ).toBeNull();
      expect(screen.getByRole("banner")).toBeVisible();
      expect(screen.getByRole("contentinfo")).toBeVisible();
      expect(headerDestination(HEADER_COPY.NAV_CATALOG_LABEL)).toBeVisible();
      // Both ways out are offered: a document-level link to the router's root, which holds however the render
      // failed, and the recovery that mounts the routed content again.
      expect(
        screen.getByRole("link", { name: FEEDBACK_COPY.ERROR_BOUNDARY_HOME_LABEL }),
      ).toHaveAttribute("href", ROUTES.HOME);
      expect(screen.getByRole("button", { name: COMMON_ACTIONS.RETRY })).toBeVisible();

      expect(reported.mock.calls.some(([first]) => first === BOUNDARY_DIAGNOSTIC)).toBe(reports);

      reported.mockRestore();
      answerViewportQueries();
      vi.stubEnv("DEV", true);
    },
  );

  it("mounts the routed screen again, in place, when the retry is taken once the fault has cleared", async () => {
    refuseColumnQuery();
    const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { user } = renderApp({ route: ROUTES.CATALOG });
    expect(await failureState()).toBeVisible();

    answerViewportQueries();
    await user.click(screen.getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    // No reload and no navigation: the failure the boundary held is dropped, and with it the state that
    // replaced the routed content — so the screen that failed is the one that renders now.
    expect(
      await within(screen.getByRole("main")).findByRole("heading", {
        level: 1,
        name: PAGE_TITLES.CATALOG,
      }),
    ).toBeVisible();
    expect(screen.queryByText(FEEDBACK_COPY.ERROR_BOUNDARY_TITLE)).toBeNull();
    expect(screen.queryByText(COLUMN_QUERY_REFUSAL)).toBeNull();

    reported.mockRestore();
  });

  it("moves the focus onto the arriving screen's own heading when a navigation enters a guarded section", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signIn(user, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
    await signInRouteLeft();
    // The sign-in screen continues to the account section once the session is in hand; a later navigation
    // closes a header panel, so that arrival is awaited before any of the shell's panels is opened.
    await accountSectionArrival();

    await openAccountMenu(user);
    await user.click(screen.getByRole("link", { name: HEADER_COPY.ACCOUNT_MENU_ORDERS_LABEL }));

    // The section's own placeholder renders first, so the arriving screen has no heading for a commit: the
    // region holds the focus until the heading the screen renders for itself takes it, which is where a
    // keyboard user is meant to land.
    const arriving = await screen.findByRole("heading", { level: 1, name: PAGE_TITLES.ORDERS });
    await waitFor(() => {
      expect(arriving).toHaveFocus();
    });
    expect(screen.getByRole("main")).not.toHaveFocus();
    expect(
      await within(screen.getByRole("main")).findByRole("table", {
        name: ACCOUNT_COPY.ORDERS_HEADING,
      }),
    ).toBeVisible();
  });

  it("draws the administrator's sidebar inside the back office and leaves it off the storefront", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signIn(user, DEMO_ACCOUNTS.ADMIN_EMAIL);
    // The administrator's own home is where the sign-in screen continues to, and the panel is opened only
    // once that route has been left, for the reason stated above.
    await signInRouteLeft();

    const panel = await openAccountMenu(user);
    await user.click(within(panel).getByRole("link", { name: PAGE_TITLES.DASHBOARD }));

    expect(
      await screen.findByRole("heading", { level: 1, name: PAGE_TITLES.DASHBOARD }),
    ).toBeVisible();
    const sidebar = await screen.findByRole("complementary", { name: ADMIN_COPY.HEADING });
    expect(within(sidebar).getByRole("link", { name: HEADER_COPY.NAV_HOME_LABEL })).toHaveAttribute(
      "href",
      ROUTES.HOME,
    );

    // The sidebar is the section's, not the role's: the same administrator browsing the storefront keeps the
    // storefront's single-column shell.
    await user.click(headerDestination(HEADER_COPY.NAV_CATALOG_LABEL));
    expect(
      await screen.findByRole("heading", { level: 1, name: PAGE_TITLES.CATALOG }),
    ).toBeVisible();
    expect(screen.queryByRole("complementary", { name: ADMIN_COPY.HEADING })).toBeNull();
  });

  it("keeps the toast viewport and the mini-cart beside the routed region, across a route change", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });
    await settledTiles();
    const product = firstTileProduct();
    await user.click(
      within(tileHeadings()[0].closest("li") ?? tileHeadings()[0]).getByRole("button", {
        name: quickAddLabel(product.name),
      }),
    );
    expect(await screen.findByText(addedToCartMessage(product.name))).toBeVisible();

    await user.click(headerDestination(HEADER_COPY.NAV_HOME_LABEL));
    expect(
      await screen.findByRole("heading", { level: 1, name: HOME_COPY.HERO_HEADLINE }),
    ).toBeVisible();
    // The message the catalogue raised is still on screen at the landing route, because the viewport that
    // renders it is mounted beside the routed region rather than inside it.
    expect(screen.getByText(addedToCartMessage(product.name))).toBeVisible();

    // The drawer is the mount site's other surface: it is the cart slice's own component, bound lazily and
    // mounted here, and the header's row draws the trigger the composition root hands it.
    await user.click(screen.getByRole("button", { name: cartButtonLabel(1) }));
    const drawer = await screen.findByRole("dialog", { name: CART_COPY.MINI_CART_HEADING });
    expect(
      within(drawer).getByRole("spinbutton", { name: quantityLabel(product.name) }),
    ).toBeVisible();
  });

  it("returns the account panel to its signed-out offers when the session ends from it", async () => {
    const { user } = renderApp({ route: ROUTES.LOGIN });
    await signIn(user, DEMO_ACCOUNTS.CUSTOMER_EMAIL);
    // The arrival is awaited before the panel is opened: the sign-in screen navigates to the account section
    // as soon as the session is adopted, and a panel opened on the route being left is closed again by that
    // navigation — so the case opens the menu on the route it means to be on.
    await signInRouteLeft();
    await accountSectionArrival();

    const panel = await openAccountMenu(user);
    await user.click(within(panel).getByRole("button", { name: COMMON_ACTIONS.SIGN_OUT }));

    // The command belongs to the shell rather than the panel: the sign-out the composition root hands the frame
    // is what the row's action calls, and the session that ends there redraws the panel as the visitor who is
    // no longer signed in sees it — the two offers of a signed-out session and no command to sign out. The
    // sign-out is itself a navigation, and a panel is keyed to the location it was opened at, so the panel is
    // closed by the header's usual rule and its content is read where it stands rather than by reopening it.
    expect(within(panel).getByText(COMMON_ACTIONS.SIGN_IN)).toBeInTheDocument();
    expect(within(panel).getByText(COMMON_ACTIONS.CREATE_ACCOUNT)).toBeInTheDocument();
    expect(within(panel).queryByText(COMMON_ACTIONS.SIGN_OUT)).toBeNull();
  });
});
