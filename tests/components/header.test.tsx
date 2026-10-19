/**
 * Path: tests/components/header.test.tsx
 * Purpose: The header's own contract — the row's shape at each width, the search entry it carries, the account menu with its identity lines and its administrator destination, the mobile navigation panel, and the dismissal rules the two disclosures share
 * Lines: 450
 */

import type { ReactElement } from "react";

import { useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { Header } from "@/components/layout/Header";
import type { HeaderAccount, HeaderProps } from "@/components/layout/Header";
import { DEMO_ACCOUNTS } from "@/constants/config";
import {
  A11Y_COPY,
  COMMON_ACTIONS,
  HEADER_COPY,
  PAGE_TITLES,
  cartButtonLabel,
} from "@/constants/content";
import { ROUTES, loginPath, registerPath } from "@/constants/routes";
import { CUSTOMERS } from "@/data/customers";
import { displayName } from "@/lib/customerService";

import { desktopViewport } from "../helpers/journeyHarness";
import { renderWithProviders, screen, waitFor, within } from "../testUtils";
import type { RenderHarness, UserEvent } from "../testUtils";

/*
 * What the header owes the row it draws.
 *
 * `src/components/layout/Header.tsx` sits below the state layer: the session facts and the cart trigger
 * arrive as props, which are the public interface of the component the shell hands them to, so the cases
 * below render the header itself with the projection the composition root would hand it — the seeded
 * accounts' own names and emails, read from the records the application is answered from. The route it draws
 * against is the harness's `MemoryRouter`, and the probe beside it names the address the header's own
 * controls have reached, which is what a search submission and a navigation are observed through here.
 *
 * The two disclosures are driven the way a visitor drives them: their trigger, a press outside them, a key
 * at the keyboard. What a case asserts is what those leave behind — a panel in or out of the accessibility
 * tree, `aria-expanded` on the control that owns it, where the focus ends up — never a class name or a
 * rendered internal. `tests/setup.ts` installs a viewport one pixel below the small stop and reinstalls it
 * after every case, so the collapsed row is the default and the wide row is stated by the case that needs it.
 */

/** The session facts the shell hands a signed-out header. */
const SIGNED_OUT: HeaderAccount = {
  displayName: "",
  email: null,
  isAuthenticated: false,
  isAdministrator: false,
};

/** The seeded account an email names, as the projection the header renders. */
function seededAccount(email: string, isAdministrator: boolean): HeaderAccount {
  const record = CUSTOMERS.find((customer) => customer.email === email);
  if (record === undefined) throw new Error(`The seeded accounts do not hold "${email}".`);
  return {
    displayName: displayName(record),
    email: record.email,
    isAuthenticated: true,
    isAdministrator,
  };
}

/** The shopper every customer case renders, and the administrator every privileged case renders. */
const CUSTOMER_ACCOUNT = seededAccount(DEMO_ACCOUNTS.CUSTOMER_EMAIL, false);
const ADMIN_ACCOUNT = seededAccount(DEMO_ACCOUNTS.ADMIN_EMAIL, true);

/** The sign-out the header is handed where a case does not exercise it. */
function noSignOut(): void {
  return undefined;
}

/** The address the header's own controls have reached: a search submission and a navigation are read here. */
function LocationProbe(): ReactElement {
  const { pathname, search } = useLocation();
  return <p>{`${pathname}${search}`}</p>;
}

/** Renders the header with the facts a case states, beside the probe that names the route it reaches. */
function renderHeader(
  account: HeaderAccount,
  options: { readonly onSignOut?: () => void; readonly route?: string } = {},
): RenderHarness {
  const props: HeaderProps = {
    account,
    // The cart trigger is the cart slice's own component in the application; the header renders whatever
    // element it is handed, so a stand-in with the trigger's own accessible name is what this case asserts.
    cartTrigger: <button type="button">{cartButtonLabel(0)}</button>,
    onSignOut: options.onSignOut ?? noSignOut,
  };
  return renderWithProviders(
    <>
      <Header {...props} />
      <LocationProbe />
    </>,
    { route: options.route },
  );
}

/** The element a disclosure's trigger controls, which is where its panel is kept. */
function controlledPanel(trigger: HTMLElement): HTMLElement {
  const panelId = trigger.getAttribute("aria-controls");
  const panel = panelId === null ? null : document.getElementById(panelId);
  if (panel === null) {
    throw new Error("The control does not name the panel it opens.");
  }
  return panel;
}

/** The account menu's trigger, by the name it answers to. */
function accountTrigger(): HTMLElement {
  return screen.getByRole("button", { name: A11Y_COPY.ACCOUNT_MENU_LABEL });
}

/** The mobile navigation's trigger, by the name it answers to while it is closed. */
function menuButton(): HTMLElement {
  return screen.getByRole("button", { name: HEADER_COPY.MOBILE_MENU_OPEN_LABEL });
}

/** The header's own navigation, which the row and the mobile panel render under two names. */
function rowNavigation(): HTMLElement {
  return screen.getByRole("navigation", { name: A11Y_COPY.MAIN_NAV_LABEL });
}

/** Tab until the focus is inside a panel, so a case can state what a dismissal does with a focus it holds. */
async function tabIntoPanel(user: UserEvent, panel: HTMLElement): Promise<void> {
  for (let step = 0; step < 8 && !panel.contains(document.activeElement); step += 1) {
    await user.tab();
  }
  expect(panel.contains(document.activeElement)).toBe(true);
}

describe("the header's row at each width", () => {
  it.each([
    { width: "wide", holdsTheField: true },
    { width: "collapsed", holdsTheField: false },
  ] as const)(
    "draws the search entry as a $width row does, and the navigation control only where it is needed",
    ({ holdsTheField }) => {
      if (holdsTheField) desktopViewport();
      renderHeader(CUSTOMER_ACCOUNT);

      // Both widths carry the same shell: the wordmark, the row's own navigation, the account menu and the
      // cart trigger the composition root hands in.
      expect(screen.getByRole("link", { name: HEADER_COPY.NAV_HOME_LABEL })).toBeVisible();
      expect(
        within(rowNavigation()).getByRole("link", { name: HEADER_COPY.NAV_CATALOG_LABEL }),
      ).toBeVisible();
      expect(accountTrigger()).toBeVisible();
      expect(screen.getByRole("button", { name: cartButtonLabel(0) })).toBeVisible();

      if (holdsTheField) {
        // At and above the medium stop the slot holds the field itself, and the row's navigation is on the
        // page, so the menu button has nothing to open and is not rendered.
        expect(screen.getByRole("search", { name: HEADER_COPY.SEARCH_FIELD_LABEL })).toBeVisible();
        expect(
          screen.getByRole("searchbox", { name: HEADER_COPY.SEARCH_FIELD_LABEL }),
        ).toBeVisible();
        expect(
          screen.queryByRole("button", { name: HEADER_COPY.MOBILE_MENU_OPEN_LABEL }),
        ).toBeNull();
        return;
      }

      // Below it the slot holds a destination to the search screen instead, and the panel's control is drawn
      // because the row cannot hold the navigation.
      expect(screen.queryByRole("searchbox", { name: HEADER_COPY.SEARCH_FIELD_LABEL })).toBeNull();
      expect(screen.getByRole("link", { name: COMMON_ACTIONS.SEARCH })).toHaveAttribute(
        "href",
        ROUTES.SEARCH,
      );
      expect(menuButton()).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("navigation", { name: A11Y_COPY.MOBILE_NAV_LABEL })).toBeNull();
    },
  );
});

describe("the header's search entry", () => {
  it("carries the term it was given to the search route", async () => {
    desktopViewport();
    const { user } = renderHeader(SIGNED_OUT);

    await user.type(
      screen.getByRole("searchbox", { name: HEADER_COPY.SEARCH_FIELD_LABEL }),
      "lamp",
    );
    await user.click(screen.getByRole("button", { name: COMMON_ACTIONS.SEARCH }));

    // The term travels as the query key the search route reads, which is the one contract between the two.
    expect(await screen.findByText(`${ROUTES.SEARCH}?q=lamp`)).toBeVisible();
  });

  it("carries no term at all when the field was submitted empty", async () => {
    desktopViewport();
    const { user } = renderHeader(SIGNED_OUT);

    await user.click(screen.getByRole("button", { name: COMMON_ACTIONS.SEARCH }));

    // An empty submission still reaches the search screen, which is where a visitor searches: what it must
    // not carry is a term, because an empty one would ask the route for no results rather than the catalogue.
    expect(await screen.findByText(ROUTES.SEARCH)).toBeVisible();
  });
});

describe("the account menu", () => {
  it("offers a visitor with no session the two ways in, carrying the screen they were on", async () => {
    const { user } = renderHeader(SIGNED_OUT, { route: ROUTES.CATALOG });
    const trigger = accountTrigger();

    await user.click(trigger);

    const panel = controlledPanel(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(panel).getByRole("link", { name: COMMON_ACTIONS.SIGN_IN })).toHaveAttribute(
      "href",
      loginPath(ROUTES.CATALOG),
    );
    expect(
      within(panel).getByRole("link", { name: COMMON_ACTIONS.CREATE_ACCOUNT }),
    ).toHaveAttribute("href", registerPath(ROUTES.CATALOG));
    expect(within(panel).queryByRole("link", { name: PAGE_TITLES.DASHBOARD })).toBeNull();
  });

  it("offers the session's own destinations, and the back office only to an administrator", async () => {
    const { user } = renderHeader(ADMIN_ACCOUNT);

    const trigger = accountTrigger();
    await user.click(trigger);

    const panel = controlledPanel(trigger);
    expect(
      within(panel).getByRole("link", { name: HEADER_COPY.ACCOUNT_MENU_PROFILE_LABEL }),
    ).toHaveAttribute("href", ROUTES.ACCOUNT);
    expect(
      within(panel).getByRole("link", { name: HEADER_COPY.ACCOUNT_MENU_ORDERS_LABEL }),
    ).toHaveAttribute("href", ROUTES.ACCOUNT_ORDERS);
    expect(
      within(panel).getByRole("link", { name: HEADER_COPY.ACCOUNT_MENU_ADDRESSES_LABEL }),
    ).toHaveAttribute("href", ROUTES.ACCOUNT_ADDRESSES);
    // The role's own destination, offered because this session holds it — the guard in `src/Router.tsx` and
    // the check in the seam stay the decisions that grant access.
    expect(within(panel).getByRole("link", { name: PAGE_TITLES.DASHBOARD })).toHaveAttribute(
      "href",
      ROUTES.ADMIN,
    );
  });

  it("offers a signed-in shopper no back office destination", async () => {
    const { user } = renderHeader(CUSTOMER_ACCOUNT);

    const trigger = accountTrigger();
    await user.click(trigger);

    const panel = controlledPanel(trigger);
    expect(
      within(panel).getByRole("link", { name: HEADER_COPY.ACCOUNT_MENU_PROFILE_LABEL }),
    ).toBeVisible();
    expect(within(panel).queryByRole("link", { name: PAGE_TITLES.DASHBOARD })).toBeNull();
  });

  /*
   * The identity the panel states is whatever the session's projection holds — a name, an address, both, or
   * neither while the projection is still unknown — and each case names what the panel shows of it.
   */
  it.each([
    { projection: "the name and the address", account: CUSTOMER_ACCOUNT, identityLines: 2 },
    {
      projection: "the name alone",
      account: { ...CUSTOMER_ACCOUNT, email: null },
      identityLines: 1,
    },
    {
      projection: "nothing at all",
      account: { ...CUSTOMER_ACCOUNT, displayName: "", email: null },
      identityLines: 0,
    },
  ] as const)("states $projection the session holds", async ({ account, identityLines }) => {
    const { user } = renderHeader(account);

    const trigger = accountTrigger();
    await user.click(trigger);

    const panel = controlledPanel(trigger);
    expect(within(panel).queryAllByRole("paragraph")).toHaveLength(identityLines);
    expect(within(panel).queryAllByText(CUSTOMER_ACCOUNT.displayName)).toHaveLength(
      identityLines === 0 ? 0 : 1,
    );
    expect(within(panel).queryAllByText(String(CUSTOMER_ACCOUNT.email))).toHaveLength(
      identityLines === 2 ? 1 : 0,
    );
  });

  it.each([ROUTES.LOGIN, ROUTES.REGISTER] as const)(
    "carries no return path from the account screen at %s",
    async (route) => {
      const { user } = renderHeader(SIGNED_OUT, { route });

      const trigger = accountTrigger();
      await user.click(trigger);

      // Returning to the screen just left is a loop, which is why these two screens are the ones the sign-in
      // and registration destinations are offered without the path the visitor is on.
      const panel = controlledPanel(trigger);
      expect(within(panel).getByRole("link", { name: COMMON_ACTIONS.SIGN_IN })).toHaveAttribute(
        "href",
        loginPath(),
      );
      expect(
        within(panel).getByRole("link", { name: COMMON_ACTIONS.CREATE_ACCOUNT }),
      ).toHaveAttribute("href", registerPath());
    },
  );

  it("closes itself and hands the sign-out on when the session ends from it", async () => {
    const onSignOut = vi.fn();
    const { user } = renderHeader(CUSTOMER_ACCOUNT, { onSignOut });

    const trigger = accountTrigger();
    await user.click(trigger);
    await user.click(
      within(controlledPanel(trigger)).getByRole("button", { name: COMMON_ACTIONS.SIGN_OUT }),
    );

    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: HEADER_COPY.ACCOUNT_MENU_PROFILE_LABEL })).toBeNull();
  });

  it("dismisses on a press outside it, and on the key a reader expects", async () => {
    const { user } = renderHeader(CUSTOMER_ACCOUNT);
    const trigger = accountTrigger();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.click(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // A panel that holds the keyboard gives it back to the control it hangs off, so the reader carries on
    // from where they opened it rather than from the document body.
    await user.click(trigger);
    const panel = controlledPanel(trigger);
    await tabIntoPanel(user, panel);
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("leaves the focus where the reader put it when it closes without holding it", async () => {
    const { user } = renderHeader(CUSTOMER_ACCOUNT);

    const trigger = accountTrigger();
    await user.click(trigger);
    // The trigger keeps the focus, which is outside the panel: closing on Escape must not move a focus the
    // panel was never holding.
    expect(trigger).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("closes itself when the visitor navigates away from the screen it was opened on", async () => {
    const { user } = renderHeader(CUSTOMER_ACCOUNT, { route: ROUTES.CATALOG });

    const trigger = accountTrigger();
    await user.click(trigger);
    expect(
      within(controlledPanel(trigger)).getByRole("link", {
        name: HEADER_COPY.ACCOUNT_MENU_ORDERS_LABEL,
      }),
    ).toBeVisible();

    await user.click(
      within(rowNavigation()).getByRole("link", { name: HEADER_COPY.NAV_HOME_LABEL }),
    );

    expect(await screen.findByText(ROUTES.HOME)).toBeVisible();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: HEADER_COPY.ACCOUNT_MENU_ORDERS_LABEL })).toBeNull();
  });
});

describe("the mobile navigation panel", () => {
  it("opens and closes from its control, reporting the state the panel is in", async () => {
    const { user } = renderHeader(SIGNED_OUT);

    const button = menuButton();
    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-label", HEADER_COPY.MOBILE_MENU_CLOSE_LABEL);
    // The panel carries the same destinations the row does, so no width decides where a visitor can reach.
    const panel = controlledPanel(button);
    const destinations = within(panel)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(destinations).toEqual(
      within(rowNavigation())
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    );

    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-label", HEADER_COPY.MOBILE_MENU_OPEN_LABEL);
    expect(screen.queryByRole("navigation", { name: A11Y_COPY.MOBILE_NAV_LABEL })).toBeNull();
  });

  it("dismisses on a press outside it, and keeps its own control free to toggle it", async () => {
    const { user } = renderHeader(SIGNED_OUT);
    const button = menuButton();

    await user.click(button);
    await user.click(document.body);
    expect(button).toHaveAttribute("aria-expanded", "false");

    // The control sits outside the panel it toggles, so its own press must not be read as a dismissal: it
    // closes what it opened rather than closing and reopening it.
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: A11Y_COPY.MOBILE_NAV_LABEL })).toBeNull();
  });

  it("closes on Escape and gives the focus back to the control that opened it", async () => {
    const { user } = renderHeader(SIGNED_OUT);

    const button = menuButton();
    await user.click(button);
    await tabIntoPanel(user, controlledPanel(button));
    await user.keyboard("{Escape}");

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();

    // Escape is the key that dismisses it and no other is: a key the reader presses while a panel is up is
    // theirs, and the panel waits for the dismissal they asked for.
    await user.click(button);
    await user.keyboard("{Tab}");
    expect(button).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: A11Y_COPY.MOBILE_NAV_LABEL })).toBeVisible();
    });
  });
});
