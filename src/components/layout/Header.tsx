/**
 * Path: src/components/layout/Header.tsx
 * Purpose: Logo, primary navigation, search entry, cart badge and account menu, compressed below the small breakpoint
 * Lines: 599
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactElement, ReactNode } from "react";
import { Link, NavLink, createSearchParams, useLocation, useNavigate } from "react-router-dom";

import { useMediaQuery, useOnClickOutside } from "@/components/ui/hooks";
import { BREAKPOINTS } from "@/constants/config";
import { A11Y_COPY, APP_COPY, COMMON_ACTIONS, HEADER_COPY, PAGE_TITLES } from "@/constants/content";
import {
  CATEGORY_SECTION_PATH,
  ROUTES,
  isDestinationCurrent,
  loginPath,
  registerPath,
} from "@/constants/routes";
import type { ActiveDestination, RoutePath } from "@/constants/routes";
import { useFocusHandoff } from "@/state/focusHandoff";

/*
 * Class contract. Every class rendered below is defined in `src/styles/` and none of it is defined here:
 * `src/styles/layout.css` owns the header skeleton, the primary navigation (`sp-nav`, `sp-nav__list` and
 * `sp-nav__link`, whose current destination the navigation marks through `[aria-current="page"]`), the mobile
 * panel, and the cart and account triggers with their panels; `src/styles/catalog.css` owns the search row
 * the collapsed slot grows into (`sp-search-bar__form`, `sp-search-bar__input`, `sp-search-bar__submit`)
 * with `sp-input` and the button family of `src/styles/controls.css`; `src/styles/base.css` owns
 * `sp-visually-hidden`. No stylesheet is imported here — `src/main.tsx` is the only importer of
 * `src/styles/**` — and no colour, length, radius or breakpoint of this file's own appears below.
 */

/**
 * The query-string key a header search writes its term into.
 *
 * Declared here rather than spelled at the call site because the key is a contract with the search route:
 * `src/utils/queryParams.ts` owns that end of it and `src/state/CatalogContext.tsx` derives the filter state
 * from it, so the header's `q` and the route's `q` are one word, and this file imports neither of them.
 */
const SEARCH_QUERY_KEY = "q";

/** The two disclosures the header can hold open. At most one of them is open at a time. */
type HeaderPanel = "account" | "mobile";

/**
 * The disclosure the header has opened, together with the location it was opened at.
 *
 * The location is what closes a panel on navigation without an effect: the open flag is derived from this
 * record and the current location's key, so a panel whose page has changed is not open and nothing has to be
 * written to state to say so.
 */
interface OpenPanel {
  /** Which disclosure is open. */
  readonly panel: HeaderPanel;
  /** The `key` of the location the panel was opened at; a different key means a different page. */
  readonly routeKey: string;
}

/** The glyphs the header draws. A keyed union, so a control names its icon and no path is written twice. */
type HeaderIconName = "chevron" | "close" | "menu" | "search";

/**
 * The path data of each glyph, drawn in a 24-unit box and filled with `currentColor` so a glyph takes the
 * colour of the control around it. The magnifier's ring is two subpaths wound in opposite directions, which
 * leaves its middle empty under the non-zero fill rule while the handle overlapping the ring stays filled.
 */
const HEADER_ICON_PATHS: Readonly<Record<HeaderIconName, string>> = {
  /** A caret: the disclosure marker inside the account trigger. */
  chevron: "M12 15.6 6.3 9.9 7.7 8.5 12 12.8 16.3 8.5 17.7 9.9z",
  /** A cross: the menu button closing the panel it opened. */
  close:
    "M6.4 4.9 12 10.5l5.6-5.6 1.5 1.5-5.6 5.6 5.6 5.6-1.5 1.5-5.6-5.6-5.6 5.6-1.5-1.5 5.6-5.6-5.6-5.6z",
  /** Three bars: the navigation the row cannot hold below the small stop. */
  menu: "M3 5.5h18v2.4H3zM3 10.8h18v2.4H3zM3 16.1h18v2.4H3z",
  /** A magnifier: the search ring with the handle that crosses it. */
  search:
    "M10.5 3.5a7 7 0 1 0 0 14 7 7 0 1 0 0-14Zm0 2a5 5 0 1 1 0 10 5 5 0 1 1 0-10Zm4.5 10 5.1 5.1 1.4-1.4-5.1-5.1z",
};

/** How a header glyph takes its size. */
type HeaderGlyphSize = "control" | "text";

/**
 * Draws one header glyph.
 *
 * Decorative by construction: every control that carries one also carries an accessible name, so the glyph is
 * hidden from assistive technology rather than given a second, announcing name. `control` sizes it inside the
 * button family's icon box, while `text` sizes it against the font it sits beside, as the caret inside a
 * labelled trigger needs.
 *
 * @param props.name - Which entry of {@link HEADER_ICON_PATHS} to draw.
 * @param props.size - How the glyph takes its size; see {@link HeaderGlyphSize}. Defaults to `control`.
 * @returns The glyph, as a decorative inline SVG.
 */
function HeaderGlyph({
  name,
  size = "control",
}: {
  readonly name: HeaderIconName;
  readonly size?: HeaderGlyphSize;
}): ReactElement {
  const followsText = size === "text";

  return (
    <svg
      aria-hidden="true"
      className={followsText ? undefined : "sp-btn__icon"}
      focusable="false"
      height={followsText ? "1em" : undefined}
      viewBox="0 0 24 24"
      width={followsText ? "1em" : undefined}
    >
      <path d={HEADER_ICON_PATHS[name]} fill="currentColor" />
    </svg>
  );
}

/**
 * One destination in the primary navigation: a label over the route it reaches, plus the sections the
 * destination also covers, which {@link isDestinationCurrent} reads.
 */
interface HeaderNavItem extends ActiveDestination {
  /** The destination's name, from `HEADER_COPY`; it is the link's visible and accessible name. */
  readonly label: string;
  /** The route it reaches, taken from `ROUTES` so no path is written in this file. */
  readonly to: RoutePath;
}

/**
 * The storefront sections the header navigates to, declared once and rendered by mapping over them.
 *
 * Two entries, and deliberately not four: the cart and the account are controls of this header with
 * affordances of their own, so listing them here as well would put two controls on one destination in one row.
 */
const HEADER_NAV_ITEMS: readonly HeaderNavItem[] = [
  { label: HEADER_COPY.NAV_HOME_LABEL, to: ROUTES.HOME, end: true },
  { label: HEADER_COPY.NAV_CATALOG_LABEL, to: ROUTES.CATALOG, sections: [CATEGORY_SECTION_PATH] },
];

/**
 * The primary navigation: one list, rendered by the header row above the small stop and by the panel the
 * menu button toggles below it.
 *
 * One body for both placements is the point: `src/styles/layout.css` lays the same `sp-nav__list` out as a row
 * in the header and as a column in the panel, so the destinations a visitor can reach cannot differ with the
 * width of the window. The destination the visitor is in is decided by `isDestinationCurrent` — the one home of
 * that comparison, which reads `isActivePath` — and written onto the link as `aria-current="page"`, the
 * attribute `src/styles/layout.css` paints the accent colour and the underline from. `NavLink` is deliberately
 * not used for these links: its active test compares the location against the resolved destination alone, so
 * the catalogue's own category listings could never be marked. Exactly one item is current at a time, because
 * the home destination matches exactly and nothing else sits inside a prefix of `/`.
 *
 * @param props.items - The destinations to render, in reading order.
 * @returns An unordered list of navigation links.
 */
function HeaderNavList({ items }: { readonly items: readonly HeaderNavItem[] }): ReactElement {
  const { pathname } = useLocation();

  return (
    <ul className="sp-nav__list">
      {items.map((item) => (
        <li key={item.to}>
          <Link
            aria-current={isDestinationCurrent(pathname, item) ? "page" : undefined}
            className="sp-nav__link"
            to={item.to}
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The header's search field: the form the search slot grows into at and above the medium stop.
 *
 * Private to this file, because it is not a control another surface composes. The search page has a bar of its
 * own — `src/features/search/SearchBar.tsx`, with type-ahead, recent terms and a clear action — and this field
 * deliberately holds none of that: it submits a term to the search route and stops, so the route's concern
 * keeps one home. The term is read from the control when the form is submitted rather than held in state,
 * because the field has no dependent UI here and a keystroke should re-render nothing.
 *
 * @returns The search landmark: a labelled field and its submit control.
 */
function HeaderSearchForm(): ReactElement {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const term = (inputRef.current?.value ?? "").trim();

      // A blank submission still goes to the search screen, because that is where a visitor searches, but
      // it carries no `q`: an empty term would ask the route for no results rather than for the catalogue.
      if (term === "") {
        void navigate(ROUTES.SEARCH);
        return;
      }

      void navigate({
        pathname: ROUTES.SEARCH,
        search: createSearchParams({ [SEARCH_QUERY_KEY]: term }).toString(),
      });
    },
    [navigate],
  );

  return (
    <form
      aria-label={HEADER_COPY.SEARCH_FIELD_LABEL}
      className="sp-search-bar__form"
      onSubmit={handleSubmit}
      role="search"
    >
      <label className="sp-visually-hidden" htmlFor={inputId}>
        {HEADER_COPY.SEARCH_FIELD_LABEL}
      </label>
      <input
        autoComplete="off"
        className="sp-input sp-search-bar__input"
        enterKeyHint="search"
        id={inputId}
        placeholder={HEADER_COPY.SEARCH_PLACEHOLDER}
        ref={inputRef}
        type="search"
      />
      <button
        aria-label={COMMON_ACTIONS.SEARCH}
        className="sp-btn sp-btn--icon sp-search-bar__submit"
        type="submit"
      >
        <HeaderGlyph name="search" />
      </button>
    </form>
  );
}

/**
 * Reports whether a pointer event landed inside an element, which is what tells a control's own click apart
 * from a click elsewhere: a menu button's own pointer-down must not close the panel a moment before its click
 * toggles that panel open again.
 */
function isWithin(element: HTMLElement | null, event: MouseEvent | TouchEvent): boolean {
  const target = event.target;
  return element !== null && target instanceof Node && element.contains(target);
}

/**
 * Hands the focus back to the trigger of a disclosure that is closing.
 *
 * A control that owns the focus and then leaves the page drops it on the document body, where a keyboard user
 * starts again from the top. The focus therefore moves to the trigger — but only when it was inside the panel,
 * so a dismissal following a click elsewhere cannot pull it off the control the visitor reached for.
 *
 * @param panel - The panel being closed, which held the focus or did not.
 * @param trigger - The control that opened it and receives the focus back.
 */
function returnFocusToTrigger(panel: HTMLElement | null, trigger: HTMLElement | null): void {
  if (trigger === null || panel === null || typeof document === "undefined") return;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !panel.contains(active)) return;
  trigger.focus();
}

/**
 * The session facts the header renders, read once by the shell in `src/App.tsx` and handed down as one value:
 * the header sits below the state layer and reads no state context, so the four facts the account menu needs
 * travel together rather than as four props that would have to be kept in step.
 */
export interface HeaderAccount {
  /** The account's full name for the menu, or `""` while it is not known. */
  readonly displayName: string;
  /** The account's email address for the menu, or `null` while the identity projection is not known. */
  readonly email: string | null;
  /** Whether a session worth acting on is held, which is what the account menu branches on. */
  readonly isAuthenticated: boolean;
  /** Whether that session is a sales administrator's, which is what offers the back office link. */
  readonly isAdministrator: boolean;
}

/**
 * Everything {@link Header} accepts.
 *
 * Every one is required, and the shell supplies all of them: the composition root composes the header inside
 * every provider, so no fact here is ever unknown. A default would be worse — a missing account would hide the
 * controls a signed-in shopper needs.
 *
 * The cart arrives as an element rather than as facts: it is the cart slice's own component that reads the
 * basket, handed in here so a cart change or a drawer toggle re-renders that button and not the wordmark, the
 * navigation, the search row and the account menu beside it, while this file sits below the state layer.
 */
export interface HeaderProps {
  /** The session the account menu renders; see {@link HeaderAccount}. */
  readonly account: HeaderAccount;
  /** Ends the session, once the account menu has closed itself. */
  readonly onSignOut: () => void;
  /** The cart trigger the row renders; see {@link HeaderProps} and `src/features/cart/HeaderCartButton.tsx`. */
  readonly cartTrigger: ReactNode;
}

/**
 * The site header: the wordmark, the primary navigation, the search entry, the cart and the account.
 *
 * `src/components/layout/AppLayout.tsx` renders it above the routed content and hands it the shell's props, so
 * it paints with the rest of the shell on first load.
 *
 * What it reads, and what it is handed. It reads the location — for the return path the sign-in links carry and
 * for the key the open panel is compared against — and the viewport stop through the shared media-query hook.
 * The session facts and the cart trigger arrive as props, because the session and the cart belong to `src/state`
 * and this file reads no session or cart from it: the shell reads the session in `src/App.tsx` and the cart
 * slice reads the cart in its own trigger component.
 *
 * The two disclosures. The account menu and the mobile navigation are disclosures, not modals, which is what
 * `src/styles/layout.css` states for the dropdown: the trigger keeps the focus, so there is no trap. Escape
 * closes the open one; an outside pointer dismisses it, except on the menu button whose own click toggles the
 * panel; and the focus goes back to the trigger that was holding it. A panel is keyed to the location it was
 * opened at, which is how a navigation closes it without an effect.
 *
 * Layout is shared between the sheet and this file at the navigation's stop: the markup renders the menu
 * button below the small breakpoint and none above it, so no control is left with nothing to open, and the
 * search slot's own stop — where it holds the field rather than a trigger — is the medium one.
 *
 * @param props - The session facts, the sign-out, the cart count and the mini-cart disclosure; see
 *   {@link HeaderProps}.
 * @returns The header landmark, with the mobile navigation panel it can open beneath the row.
 */
export function Header({ account, onSignOut, cartTrigger }: HeaderProps): ReactElement {
  const { displayName, email, isAdministrator, isAuthenticated } = account;
  const location = useLocation();

  const isWideRow = useMediaQuery(`(min-width: ${BREAKPOINTS.MEDIUM}px)`);
  // The navigation's stop is the small one, so the trigger is rendered only below it: above the stop the row
  // carries the destinations itself, and a button with nothing to open would stay in the tab order. Both widths
  // come from `src/constants/config.ts` through the shared media-query hook, never from a literal here.
  const showsMenuButton = !useMediaQuery(`(min-width: ${BREAKPOINTS.SMALL}px)`);

  const [openPanel, setOpenPanel] = useState<OpenPanel | null>(null);

  const accountRegionRef = useRef<HTMLDivElement | null>(null);
  const accountPanelRef = useRef<HTMLDivElement | null>(null);
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobilePanelRef = useRef<HTMLDivElement | null>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement | null>(null);

  /*
   * Where the keyboard goes when a sign-out takes its own control away: the account menu and the sign-out button
   * inside it both leave with the session, so the focus is armed onto the trigger the menu hangs off, which
   * stays in the document in both session states and is a control of its own.
   */
  const { handOffFocus: handOffSignOut } = useFocusHandoff<HTMLButtonElement>(accountTriggerRef);

  // Ids are allocated per instance rather than declared as module constants, so two headers rendered on one
  // page would still name their own panels and no `aria-controls` could point at the wrong one.
  const accountPanelId = useId();
  const mobilePanelId = useId();

  const routeKey = location.key;
  const activePanel =
    openPanel !== null && openPanel.routeKey === routeKey ? openPanel.panel : null;
  const isAccountMenuOpen = activePanel === "account";
  const isMobileNavOpen = activePanel === "mobile";

  // The screen the visitor is on, carried to the sign-in and registration screens so they arrive back
  // where they were. The two account screens are excluded: returning to the screen just left is a loop.
  const returnTo =
    location.pathname === ROUTES.LOGIN || location.pathname === ROUTES.REGISTER
      ? undefined
      : `${location.pathname}${location.search}`;

  const accountName = displayName === "" ? (email ?? "") : displayName;

  /**
   * Opens the disclosure a trigger names, or closes it when it is already the open one. The location it is
   * opened at travels with the record, which is what closes every panel on the next navigation.
   */
  const togglePanel = useCallback(
    (panel: HeaderPanel): void => {
      setOpenPanel((current) =>
        current !== null && current.panel === panel && current.routeKey === routeKey
          ? null
          : { panel, routeKey },
      );
    },
    [routeKey],
  );

  /** Closes the account menu, handing the focus back to its trigger only when the panel was holding it. */
  const closeAccountMenu = useCallback((returnFocus: boolean): void => {
    if (returnFocus) returnFocusToTrigger(accountPanelRef.current, accountTriggerRef.current);
    setOpenPanel((current) => (current !== null && current.panel === "account" ? null : current));
  }, []);

  /** Closes the mobile navigation panel, with the same rule for the focus it may be holding. */
  const closeMobileNav = useCallback((returnFocus: boolean): void => {
    if (returnFocus) returnFocusToTrigger(mobilePanelRef.current, mobileMenuButtonRef.current);
    setOpenPanel((current) => (current !== null && current.panel === "mobile" ? null : current));
  }, []);

  const handleSignOut = useCallback((): void => {
    // Armed before the menu closes, so the commit that removes the sign-out button is the one that puts the focus
    // on the account trigger rather than on the body.
    handOffSignOut();
    closeAccountMenu(false);
    // The session ends whether or not the store answers, which is the shell's own decision, and nothing here
    // waits on it. A page a signed-out visitor may no longer see is the route guard's business in
    // `src/Router.tsx`, not a redirect of this file's own, and the authoritative check stays in
    // `src/lib/mockServer.ts`.
    onSignOut();
  }, [closeAccountMenu, handOffSignOut, onSignOut]);

  const handleMobileOutside = useCallback(
    (event: MouseEvent | TouchEvent): void => {
      // The menu button sits outside the panel it toggles, so its own click is spared here: without this the
      // pointer-down would close the panel and the click would open it again, so it could never close it.
      if (isWithin(mobileMenuButtonRef.current, event)) return;
      closeMobileNav(false);
    },
    [closeMobileNav],
  );

  useOnClickOutside(
    accountRegionRef,
    () => {
      closeAccountMenu(false);
    },
    { enabled: isAccountMenuOpen },
  );
  useOnClickOutside(mobilePanelRef, handleMobileOutside, { enabled: isMobileNavOpen });

  // Escape closes whichever disclosure is open and returns the focus to its trigger, from a listener on the
  // document: the focus may be anywhere in the header, and it exists only while a panel is open.
  useEffect(() => {
    if (activePanel === null) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (activePanel === "account") {
        closeAccountMenu(true);
      } else {
        closeMobileNav(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePanel, closeAccountMenu, closeMobileNav]);

  return (
    <header className="sp-header">
      <div className="sp-header__inner">
        <div className="sp-header__brand">
          <Link className="sp-header__logo" to={ROUTES.HOME}>
            {APP_COPY.APP_NAME}
          </Link>
        </div>

        {/* The row's navigation. The sheet removes it below the small stop, where the panel takes over. */}
        <nav aria-label={A11Y_COPY.MAIN_NAV_LABEL} className="sp-header__nav sp-nav">
          <HeaderNavList items={HEADER_NAV_ITEMS} />
        </nav>

        <div className="sp-header__actions">
          <div className="sp-header__search">
            {isWideRow ? (
              <HeaderSearchForm />
            ) : (
              // Below the medium stop the slot holds a trigger rather than a field: the search screen is one
              // tap away, and a field beside the brand and the other controls would not fit in the row.
              <Link className="sp-btn sp-btn--icon" to={ROUTES.SEARCH}>
                <HeaderGlyph name="search" />
                <span className="sp-visually-hidden">{COMMON_ACTIONS.SEARCH}</span>
              </Link>
            )}
          </div>

          {
            // Rendered only below the small stop, where it is the row's only way to the primary navigation;
            // above it the row holds the navigation itself and the control has nothing to open.
            showsMenuButton ? (
              <button
                aria-controls={mobilePanelId}
                aria-expanded={isMobileNavOpen}
                aria-label={
                  isMobileNavOpen
                    ? HEADER_COPY.MOBILE_MENU_CLOSE_LABEL
                    : HEADER_COPY.MOBILE_MENU_OPEN_LABEL
                }
                className="sp-btn sp-btn--icon sp-header__menu-button"
                onClick={() => {
                  togglePanel("mobile");
                }}
                ref={mobileMenuButtonRef}
                type="button"
              >
                <HeaderGlyph name={isMobileNavOpen ? "close" : "menu"} />
              </button>
            ) : null
          }

          {/* The cart read belongs to the trigger itself, which the shell composes out of the cart slice: a
              cart change or a drawer toggle re-renders that button and not the row it sits in, and nothing in
              this file imports the state layer to make it so. */}
          {cartTrigger}

          <div className="sp-account-menu" ref={accountRegionRef}>
            <button
              aria-controls={accountPanelId}
              aria-expanded={isAccountMenuOpen}
              aria-label={A11Y_COPY.ACCOUNT_MENU_LABEL}
              className="sp-account-menu__trigger"
              onClick={() => {
                togglePanel("account");
              }}
              ref={accountTriggerRef}
              type="button"
            >
              {HEADER_COPY.NAV_ACCOUNT_LABEL}
              <HeaderGlyph name="chevron" size="text" />
            </button>

            <div
              className="sp-account-menu__panel"
              hidden={!isAccountMenuOpen}
              id={accountPanelId}
              ref={accountPanelRef}
            >
              {isAuthenticated ? (
                <>
                  {accountName === "" ? null : (
                    <p>
                      <strong>{accountName}</strong>
                    </p>
                  )}
                  {email === null ? null : (
                    <p>
                      <small>{email}</small>
                    </p>
                  )}
                  <NavLink className="sp-nav__link" end to={ROUTES.ACCOUNT}>
                    {HEADER_COPY.ACCOUNT_MENU_PROFILE_LABEL}
                  </NavLink>
                  <NavLink className="sp-nav__link" to={ROUTES.ACCOUNT_ORDERS}>
                    {HEADER_COPY.ACCOUNT_MENU_ORDERS_LABEL}
                  </NavLink>
                  <NavLink className="sp-nav__link" to={ROUTES.ACCOUNT_ADDRESSES}>
                    {HEADER_COPY.ACCOUNT_MENU_ADDRESSES_LABEL}
                  </NavLink>
                  {/* The administrator's way into the back office, offered only to a session that holds the
                      role. The route guard in `src/Router.tsx` and the check in `src/lib/mockServer.ts` stay
                      the decisions that grant access; hiding a link is convenience, not a guard. */}
                  {isAdministrator ? (
                    <NavLink className="sp-nav__link" to={ROUTES.ADMIN}>
                      {PAGE_TITLES.DASHBOARD}
                    </NavLink>
                  ) : null}
                  {/* A destination wears `sp-nav__link` and so does this action, so the panel reads as one
                      list of rows while a button keeps the semantic of a command rather than a link. */}
                  <button className="sp-nav__link" onClick={handleSignOut} type="button">
                    {COMMON_ACTIONS.SIGN_OUT}
                  </button>
                </>
              ) : (
                <>
                  <Link className="sp-nav__link" to={loginPath(returnTo)}>
                    {COMMON_ACTIONS.SIGN_IN}
                  </Link>
                  <Link className="sp-nav__link" to={registerPath(returnTo)}>
                    {COMMON_ACTIONS.CREATE_ACCOUNT}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* The navigation the row cannot hold, toggled by the menu button and removed by the sheet at and above
          the small stop, where the row's own navigation returns. */}
      <div
        className="sp-nav-menu"
        hidden={!isMobileNavOpen}
        id={mobilePanelId}
        ref={mobilePanelRef}
      >
        <nav aria-label={A11Y_COPY.MOBILE_NAV_LABEL} className="sp-nav sp-nav-menu__panel">
          <HeaderNavList items={HEADER_NAV_ITEMS} />
        </nav>
      </div>
    </header>
  );
}
