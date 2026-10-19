/**
 * Path: tests/components/appLayout.test.tsx
 * Purpose: The page shell's own contract — the skip link and the three landmark regions, the administrator frame's sidebar branch read from the session and the location, and the route-change focus move with the ring correction that carries it onto the arriving screen's heading
 * Lines: 388
 */

import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import { Link, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppLayout } from "@/components/layout/AppLayout";
import type { AppLayoutProps } from "@/components/layout/AppLayout";
import type { HeaderAccount } from "@/components/layout/Header";
import { ADMIN_COPY } from "@/constants/content-reports";
import { A11Y_COPY, HEADER_COPY, PAGE_TITLES } from "@/constants/content";
import { ROUTES } from "@/constants/routes";

import { renderWithProviders, screen, waitFor, within } from "../testUtils";

/*
 * What the shell owes the pages it frames.
 *
 * `src/components/layout/AppLayout.tsx` is presentational: it holds no state, reads no context, derives both
 * of its facts during render — the administrator frame from the location, the sidebar from the role as well —
 * and has exactly one effect, the focus move a route change makes. Its props are the public interface of that
 * contract, so the cases below render the shell itself with the session facts the composition root would hand
 * it, and a screen of the case's own as its child. That is the only way to observe the last of the shell's
 * duties honestly: the ring correction reads a box and a computed style, and this environment lays nothing
 * out, so the heading's own ring and its position are given by the screen the case renders — the technique
 * `focusHandoff.test.tsx` uses for the same reason — and what is asserted is where the focus ends up, never a
 * class name or a computed style of the shell's own.
 *
 * The shell is rendered inside the suite's providers and its `MemoryRouter`, which is where it always stands:
 * `src/App.tsx` mounts it inside every provider, and its own children read the location. Nothing here stands
 * in for a service, a reducer, a context or a data module.
 */

/** The two facts a case states: the session the shell is handed, and the section the location names. */
const SIGNED_OUT: HeaderAccount = {
  displayName: "",
  email: null,
  isAuthenticated: false,
  isAdministrator: false,
};

const CUSTOMER: HeaderAccount = {
  displayName: "Ada Lindqvist",
  email: "ada.lindqvist@salespro.test",
  isAuthenticated: true,
  isAdministrator: false,
};

const ADMINISTRATOR: HeaderAccount = {
  displayName: "Miles Okafor",
  email: "miles.okafor@salespro.test",
  isAuthenticated: true,
  isAdministrator: true,
};

/** The sign-out the shell passes to the header; no case signs out, so it records nothing. */
function noSignOut(): void {
  return undefined;
}

/** The cart trigger the composition root hands the shell: here, a stand-in element, since the cart slice is
 *  not what these cases are about and the header renders whatever it is given. */
const CART_TRIGGER = <span />;

/** Renders the shell around a child, with the session and the location the case states. */
function renderShell(
  options: {
    readonly account?: HeaderAccount;
    readonly route?: string;
    readonly children?: ReactElement;
  } = {},
): ReturnType<typeof renderWithProviders> {
  const props: AppLayoutProps = {
    account: options.account ?? SIGNED_OUT,
    cartTrigger: CART_TRIGGER,
    onSignOut: noSignOut,
    children: options.children ?? <p>The routed screen</p>,
  };
  return renderWithProviders(<AppLayout {...props} />, { route: options.route });
}

/** The sidebar's landmark, when the shell has drawn one. */
function sidebar(): HTMLElement | null {
  return screen.queryByRole("complementary", { name: ADMIN_COPY.HEADING });
}

describe("the shell's regions", () => {
  it("draws one skip link, one header, one main region and one footer around the routed content", () => {
    renderShell({ children: <p>Routed screen</p> });

    const main = screen.getByRole("main");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(within(main).getByText("Routed screen")).toBeVisible();
    expect(main).toHaveAttribute("tabindex", "-1");

    // The skip link is the frame's first element and the fragment it carries is the id of the one region it
    // points at, which is the whole agreement between the two.
    const skipLink = screen.getByRole("link", { name: A11Y_COPY.SKIP_TO_CONTENT });
    expect(skipLink).toHaveAttribute("href", `#${main.id}`);
    expect(skipLink.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const banner = screen.getByRole("banner");
    expect(
      within(banner).getByRole("navigation", { name: A11Y_COPY.MAIN_NAV_LABEL }),
    ).toBeVisible();
    expect(screen.getByRole("contentinfo")).toBeVisible();
  });

  /*
   * The administrator frame and the sidebar answer two different questions, and the matrix below keeps them
   * apart: the frame follows the location alone, so the reserved column is there before the session has
   * resolved, while the sidebar follows the role as well, because everything it lists is the session's.
   */
  it.each([
    {
      who: "a visitor with no session",
      account: SIGNED_OUT,
      route: ROUTES.ADMIN,
      showsSidebar: false,
    },
    {
      who: "an administrator on the dashboard",
      account: ADMINISTRATOR,
      route: ROUTES.ADMIN,
      showsSidebar: true,
    },
    {
      who: "an administrator on a report inside the section",
      account: ADMINISTRATOR,
      route: ROUTES.ADMIN_REPORTS,
      showsSidebar: true,
    },
    {
      who: "an administrator browsing the storefront",
      account: ADMINISTRATOR,
      route: ROUTES.CATALOG,
      showsSidebar: false,
    },
    {
      who: "a customer on their own account screens",
      account: CUSTOMER,
      route: ROUTES.ACCOUNT,
      showsSidebar: false,
    },
  ] as const)(
    "shows the administrator sidebar to $who only where it belongs",
    ({ account, route, showsSidebar }) => {
      renderShell({ account, route });

      const drawn = sidebar();
      if (!showsSidebar) {
        expect(drawn).toBeNull();
        return;
      }
      expect(drawn).not.toBeNull();
      const panel = drawn ?? document.body;
      // The section's navigation is the sidebar's and reaches both of its screens plus the way back out to the
      // storefront, which is every destination the section has.
      expect(within(panel).getByRole("link", { name: PAGE_TITLES.DASHBOARD })).toHaveAttribute(
        "href",
        ROUTES.ADMIN,
      );
      expect(within(panel).getByRole("link", { name: PAGE_TITLES.REPORTS })).toHaveAttribute(
        "href",
        ROUTES.ADMIN_REPORTS,
      );
      expect(within(panel).getByRole("link", { name: HEADER_COPY.NAV_HOME_LABEL })).toHaveAttribute(
        "href",
        ROUTES.HOME,
      );
    },
  );
});

// The route-change focus move, and the screen that makes its timing and its ring observable --------------

/** The two addresses the harness moves between. */
const FIRST_ROUTE = "/first";
const SECOND_ROUTE = "/second";

/** What the arriving screen renders for itself. */
type Arrival = "heading-now" | "heading-later" | "heading-on-demand" | "no-heading";

/** How the arriving heading's own ring stands: painted inside its box, or reaching beyond it. */
type Ring = "clear" | "under-the-band";

/** The name the arriving screen's heading reads as. */
const ARRIVING_HEADING = "The second screen";

/** The control the harness offers for a heading that arrives on demand. */
const SHOW_HEADING = "Show the heading";

/** The label of the destination the first screen carries. */
const GO_ON = "Go to the second screen";

/** What the screen with no heading of its own renders, one commit at a time. */
const UNSHAPED_SCREEN_TEXT = [
  "Waiting for the screen…",
  "Still fetching the screen…",
  "This screen declares no heading of its own.",
] as const;

/** The ring's own reach, given to the heading the way a stylesheet gives it to a focused control. */
const RING_STYLES: Readonly<Record<Ring, { outlineOffset?: string; outlineWidth?: string }>> = {
  clear: {},
  "under-the-band": { outlineWidth: "3px", outlineOffset: "2px" },
};

/** Everything {@link ShellScreen} accepts. */
interface ShellScreenProps {
  /** What the arriving screen renders for itself; see {@link Arrival}. */
  readonly arrival: Arrival;
  /** How the arriving heading's ring stands; see {@link Ring}. */
  readonly ring: Ring;
  /** Called with the options the shell aligns the heading by, if it asks it to align at all. */
  readonly onAlign: (options?: boolean | ScrollIntoViewOptions) => void;
}

/**
 * A screen shaped like the ones the shell frames: a first screen carrying a destination, and a second whose
 * own level-1 heading arrives when the case says it does.
 *
 * The screen takes shape one commit at a time, each scheduled from the commit before it, which is what a route
 * whose code is still being fetched does: neither of the commits in between carries a heading, so the region
 * is watched across them. jsdom implements no `scrollIntoView` at all, so the heading hands the shell the stub
 * the alignment is observed through, and the ring is the case's own — a computed style this environment
 * reports only for an element that carries one.
 */
function ShellScreen({ arrival, ring, onAlign }: ShellScreenProps): ReactElement {
  const { pathname } = useLocation();
  const [stage, setStage] = useState(0);
  const [isHeadingShown, setHeadingShown] = useState(false);
  const hasArrived = pathname === SECOND_ROUTE;
  const takesShape = arrival === "heading-later" || arrival === "no-heading";

  useEffect(() => {
    if (!hasArrived || !takesShape || stage >= 2) return undefined;
    const next = setTimeout(() => {
      setStage(stage + 1);
    }, 0);
    return () => {
      clearTimeout(next);
    };
  }, [hasArrived, stage, takesShape]);

  if (!hasArrived) {
    return <Link to={SECOND_ROUTE}>{GO_ON}</Link>;
  }

  const heading = (
    <h1
      ref={(node): void => {
        if (node !== null) node.scrollIntoView = onAlign;
      }}
      style={RING_STYLES[ring]}
    >
      {ARRIVING_HEADING}
    </h1>
  );

  if (arrival === "heading-now") return heading;

  if (arrival === "heading-on-demand") {
    return (
      <>
        <button onClick={() => setHeadingShown(true)} type="button">
          {SHOW_HEADING}
        </button>
        {isHeadingShown ? heading : null}
      </>
    );
  }

  if (arrival === "no-heading") return <p>{UNSHAPED_SCREEN_TEXT[stage]}</p>;

  if (stage === 0) return <span />;
  return stage === 1 ? <p>{UNSHAPED_SCREEN_TEXT[1]}</p> : heading;
}

/** Renders the harness screen inside the shell, at the first of the harness's two routes. */
function renderFocusMovement(
  arrival: Arrival,
  ring: Ring,
  onAlign: (options?: boolean | ScrollIntoViewOptions) => void,
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <AppLayout account={SIGNED_OUT} cartTrigger={CART_TRIGGER} onSignOut={noSignOut}>
      <ShellScreen arrival={arrival} onAlign={onAlign} ring={ring} />
    </AppLayout>,
    { route: FIRST_ROUTE },
  );
}

describe("the route-change focus move", () => {
  it("moves nothing on the first render of a path, and gives the arriving heading the focus on a navigation", async () => {
    const align = vi.fn();
    const { user } = renderFocusMovement("heading-now", "clear", align);

    // The first render of a path is not a navigation: an arrival by URL or by reload leaves the focus where
    // the browser put it, which is the document body.
    expect(document.body).toHaveFocus();

    await user.click(screen.getByRole("link", { name: GO_ON }));

    const heading = await screen.findByRole("heading", { level: 1, name: ARRIVING_HEADING });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(screen.getByRole("main")).not.toHaveFocus();
    // A ring whose reach stays inside its box is left exactly where the browser drew it, so the page is not
    // moved for it.
    expect(align).not.toHaveBeenCalled();
  });

  it("brings a heading whose ring reaches beyond its box clear of the header band", async () => {
    const align = vi.fn();
    const { user } = renderFocusMovement("heading-now", "under-the-band", align);

    await user.click(screen.getByRole("link", { name: GO_ON }));

    const heading = await screen.findByRole("heading", { level: 1, name: ARRIVING_HEADING });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    // The ring is painted outside the box, and the box begins at the header band's own bottom edge — where
    // nothing of it can be seen — so the heading is aligned to the scrollport's padded start instead.
    expect(align).toHaveBeenCalledWith({ block: "start", inline: "nearest" });
  });

  it("hands the focus on when the heading a screen renders a commit later arrives", async () => {
    const align = vi.fn();
    const { user } = renderFocusMovement("heading-later", "clear", align);

    await user.click(screen.getByRole("link", { name: GO_ON }));

    // The two commits between the navigation and the heading carry none, so the region the navigation landed
    // in is what holds the focus while the screen is still coming — the way station the two neighbouring cases
    // hold still — and the heading takes it from there as soon as the screen renders one.
    const heading = await screen.findByRole("heading", { level: 1, name: ARRIVING_HEADING });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(screen.getByRole("main")).not.toHaveFocus();
  });

  it("leaves the region holding the focus when the arriving screen renders no heading at all", async () => {
    const align = vi.fn();
    const { user } = renderFocusMovement("no-heading", "clear", align);

    await user.click(screen.getByRole("link", { name: GO_ON }));

    const region = screen.getByRole("main");
    await waitFor(() => {
      expect(region).toHaveFocus();
    });
    // Both of the screen's later commits are across, and neither brought a heading: the region keeps the focus
    // rather than handing it to nothing.
    expect(await screen.findByText(UNSHAPED_SCREEN_TEXT[2])).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(region).toHaveFocus();
  });

  it("leaves the focus alone once the reader has moved it, even when a heading arrives afterwards", async () => {
    const align = vi.fn();
    const { user } = renderFocusMovement("heading-on-demand", "clear", align);

    await user.click(screen.getByRole("link", { name: GO_ON }));
    const region = screen.getByRole("main");
    await waitFor(() => {
      expect(region).toHaveFocus();
    });

    const control = screen.getByRole("button", { name: SHOW_HEADING });
    await user.click(control);

    // The reader reached for a control of the arriving screen, so the focus is theirs: the heading that lands
    // afterwards does not take it back.
    const heading = await screen.findByRole("heading", { level: 1, name: ARRIVING_HEADING });
    expect(control).toHaveFocus();
    expect(heading).not.toHaveFocus();
  });
});
