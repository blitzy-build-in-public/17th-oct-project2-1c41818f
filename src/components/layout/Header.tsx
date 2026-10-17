/**
 * Path: src/components/layout/Header.tsx
 * Purpose: Logo, primary navigation, search entry, cart badge and account menu, compressed below the small breakpoint
 * Lines: 564
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { Link, NavLink, createSearchParams, useLocation, useNavigate } from "react-router-dom";

import { BREAKPOINTS } from "@/constants/config";
import {
  A11Y_COPY,
  APP_COPY,
  COMMON_ACTIONS,
  HEADER_COPY,
  PAGE_TITLES,
  cartButtonLabel,
} from "@/constants/content";
import { ROUTES, loginPath, registerPath } from "@/constants/routes";
import type { RoutePath } from "@/constants/routes";
import { useAuth, useAuthDispatch } from "@/state/AuthContext";
import { useCart, useCartDispatch } from "@/state/CartContext";
import { useMediaQuery, useOnClickOutside } from "@/state/hooks";

/*
 * Class contract. Every class rendered below is defined in `src/styles/` and none of it is defined here:
 * `src/styles/layout.css` owns the header skeleton, the primary navigation (`sp-nav`, `sp-nav__list` and
 * `sp-nav__link`, whose current destination the router marks through `[aria-current="page"]`), the mobile
 * panel, and the cart and account triggers with their panels; `src/styles/catalog.css` owns the search row
 * the collapsed slot grows into (`sp-search-bar__form`, `sp-search-bar__input`, `sp-search-bar__submit`)
 * with `sp-input` and the button family of `src/styles/controls.css`; `src/styles/base.css` owns
 * `sp-visually-hidden`. The row switches at the medium stop, which is also where the search slot changes
 * what it holds. No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` —
 * and no colour, length, radius or breakpoint of this file's own appears below.
 */

/**
 * The query-string key a header search writes its term into.
 *
 * Declared here rather than spelled at the call site because the key is a contract with the search route,
 * which reads and rewrites the same parameter: `src/utils/queryParams.ts` owns that end of it and
 * `src/state/CatalogContext.tsx` derives the filter state from it, so the header's `q` and the route's `q`
 * are one word. This file does not import either module — the parameter name is the whole agreement.
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
 * The path data of each glyph, drawn inside a 24-unit box and filled with `currentColor`, so a glyph takes
 * the colour of the control around it and names no paint of its own. The magnifier's ring is two subpaths
 * wound in opposite directions, which is what the non-zero fill rule needs to leave its middle empty while
 * the handle, a subpath overlapping the ring, stays filled.
 */
const HEADER_ICON_PATHS: Readonly<Record<HeaderIconName, string>> = {
  /** A caret: the disclosure marker inside the account trigger. */
  chevron: "M12 15.6 6.3 9.9 7.7 8.5 12 12.8 16.3 8.5 17.7 9.9z",
  /** A cross: the menu button closing the panel it opened. */
  close:
    "M6.4 4.9 12 10.5l5.6-5.6 1.5 1.5-5.6 5.6 5.6 5.6-1.5 1.5-5.6-5.6-5.6 5.6-1.5-1.5 5.6-5.6-5.6-5.6z",
  /** Three bars: the navigation the row cannot hold below the medium stop. */
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
 * hidden from assistive technology rather than given a second name that would make the control announce
 * itself twice. `control` puts it in the button family's icon box — the sizing an icon-only or labelled
 * button draws its glyph at — while `text` sizes it against the font it sits beside, which is what the caret
 * inside a labelled trigger needs.
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

/** One destination in the primary navigation. */
interface HeaderNavItem {
  /** The destination's name, from `HEADER_COPY`; it is the link's visible and accessible name. */
  readonly label: string;
  /** The route it reaches, taken from `ROUTES` so no path is written in this file. */
  readonly to: RoutePath;
  /** Matches the route exactly, so the landing page is current only on the landing page itself. */
  readonly end?: boolean;
}

/**
 * The storefront sections the header navigates to, declared once and rendered by mapping over them.
 *
 * Two entries, and deliberately not four: the cart and the account are controls of this header with
 * affordances of their own, so listing them here as well would put two controls on one destination in one row.
 */
const HEADER_NAV_ITEMS: readonly HeaderNavItem[] = [
  { label: HEADER_COPY.NAV_HOME_LABEL, to: ROUTES.HOME, end: true },
  { label: HEADER_COPY.NAV_CATALOG_LABEL, to: ROUTES.CATALOG },
];

/**
 * The primary navigation: one list, rendered by the header row above the medium stop and by the panel the
 * menu button toggles below it.
 *
 * One body for both placements is the point: `src/styles/layout.css` lays the same `sp-nav__list` out as a row
 * in the header and as a column in the panel, so the destinations a visitor can reach cannot differ with the
 * width of the window. Marking the current destination is `NavLink`'s, and the `end` a home link carries keeps
 * exactly one item marked, because no other route sits inside a prefix of `/`.
 *
 * @param props.items - The destinations to render, in reading order.
 * @returns An unordered list of navigation links.
 */
function HeaderNavList({ items }: { readonly items: readonly HeaderNavItem[] }): ReactElement {
  return (
    <ul className="sp-nav__list">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink className="sp-nav__link" end={item.end} to={item.to}>
            {item.label}
          </NavLink>
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
 * from a click elsewhere: a menu button whose pointer went down inside itself must not have the panel closed
 * by the dismissal handler a moment before its own click toggles that panel open again.
 */
function isWithin(element: HTMLElement | null, event: MouseEvent | TouchEvent): boolean {
  const target = event.target;
  return element !== null && target instanceof Node && element.contains(target);
}

/**
 * Hands the focus back to the trigger of a disclosure that is closing.
 *
 * A control that owns the focus and then leaves the page drops it on the document body, where a keyboard user
 * has to start again from the top. The focus therefore moves to the trigger — but only when it was inside the
 * panel: a dismissal that followed a click elsewhere must not pull the focus back off the control the visitor
 * just reached for.
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
 * The site header: the wordmark, the primary navigation, the search entry, the cart and the account.
 *
 * `src/components/layout/AppLayout.tsx` renders it above the routed content on every screen, with no props, so
 * it paints with the rest of the shell on first load: a visitor with no session and an empty cart sees the
 * complete header.
 *
 * What it reads. The session, for the account menu's contents and the administrator link; the cart, for the
 * count on the cart button and the state of the mini-cart drawer; and the location, for the return path the
 * sign-in links carry and for the key the open panel is compared against. The count is summed during render
 * from the cart's lines and stored nowhere, because a count kept beside the lines it counts is a second answer
 * to one question.
 *
 * The two disclosures. The account menu and the mobile navigation are disclosures rather than modals, which is
 * what `src/styles/layout.css` states for the dropdown: the trigger keeps the focus, so there is no trap to
 * manage. Escape closes the open one from anywhere in the header; a pointer landing outside dismisses it,
 * except on the menu button itself, whose own click toggles the panel a dismissal would otherwise close first;
 * and the focus goes back to the trigger when the panel was holding it. A panel is also keyed to the location
 * it was opened at, which is how a navigation closes it without an effect.
 *
 * Layout below the medium stop is the stylesheet's, not this file's: the sheet takes the navigation out of the
 * row and hides the menu button above the stop, so the only thing the markup decides is which of the two things
 * the search slot holds. That stop is read through the shared media-query hook from the width
 * `src/constants/config.ts` owns, never from a literal here.
 *
 * @returns The header landmark, with the mobile navigation panel it can open beneath the row.
 */
export function Header(): ReactElement {
  const { displayName, email, isAdministrator, isAuthenticated } = useAuth();
  const { signOut } = useAuthDispatch();
  const { isMiniCartOpen, lines } = useCart();
  // The cart's actions are read as the object they are, not destructured: `CartActions` declares its
  // members with method syntax, and a method taken off its receiver is what the type-aware lint rule
  // treats as unsafe. `signOut` above is a function-valued property, so it travels on its own.
  const cartActions = useCartDispatch();
  const location = useLocation();

  const isWideRow = useMediaQuery(`(min-width: ${BREAKPOINTS.MEDIUM}px)`);

  const [openPanel, setOpenPanel] = useState<OpenPanel | null>(null);

  const accountRegionRef = useRef<HTMLDivElement | null>(null);
  const accountPanelRef = useRef<HTMLDivElement | null>(null);
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobilePanelRef = useRef<HTMLDivElement | null>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement | null>(null);

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

  // The count is a fact about the lines, so it is summed during render and stored nowhere:
  // `src/features/cart/cartSelectors.ts` owns the cart's own reading of them and is not imported.
  const itemCount = lines.reduce((total, line) => total + line.quantity, 0);

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
    closeAccountMenu(false);
    // The session ends whether or not the store answers, so nothing waits on it here. A page a signed-out
    // visitor may no longer see is the route guard's business in `src/Router.tsx`, not a redirect of this
    // file's own, and the authoritative check stays in `src/lib/mockServer.ts`.
    void signOut();
  }, [closeAccountMenu, signOut]);

  const handleMobileOutside = useCallback(
    (event: MouseEvent | TouchEvent): void => {
      // The menu button sits outside the panel it toggles, so its own click is spared here: without this the
      // pointer-down would close the panel and the click would open it again, and the button could never
      // close what it opened.
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

  // Escape closes whichever disclosure is open and returns the focus to its trigger. The listener is
  // registered on the document because the focus may be anywhere inside the header, it exists only while a
  // panel is open, and the cleanup removes it so a closed panel leaves nothing running.
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

        {/* The row's navigation. The sheet removes it below the medium stop, where the panel takes over. */}
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

          <button
            aria-expanded={isMiniCartOpen}
            aria-haspopup="dialog"
            aria-label={cartButtonLabel(itemCount)}
            className="sp-cart-button"
            onClick={() => {
              cartActions.toggleMiniCart();
            }}
            type="button"
          >
            {HEADER_COPY.NAV_CART_LABEL}
            {itemCount > 0 ? (
              <span aria-hidden="true" className="sp-cart-badge">
                {itemCount}
              </span>
            ) : null}
          </button>

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
          the medium stop, where the row's own navigation returns. */}
      <div
        className="sp-nav-menu"
        hidden={!isMobileNavOpen}
        id={mobilePanelId}
        ref={mobilePanelRef}
      >
        <nav aria-label={A11Y_COPY.MAIN_NAV_LABEL} className="sp-nav sp-nav-menu__panel">
          <HeaderNavList items={HEADER_NAV_ITEMS} />
        </nav>
      </div>
    </header>
  );
}
