/**
 * Path: src/features/account/AccountLayout.tsx
 * Purpose: Account shell with side navigation and the routed account view
 * Lines: 190
 */

import type { ReactElement } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { ACCOUNT_COPY, A11Y_COPY, PAGE_TITLES } from "@/constants/content";
import { ROUTES, isActivePath } from "@/constants/routes";
import type { RoutePath } from "@/constants/routes";
import { useAuth } from "@/state/AuthContext";

/*
 * Class contract. `src/styles/account.css` is the sole definition site of the account shell, and no file
 * under `src/features/**` imports a stylesheet, so every class below is consumed by name: `sp-account` is the
 * grid that is one column on a phone and the section column beside the view from 768, `sp-account__nav` the
 * strip that scrolls sideways until that stop turns it into the sticky column, `sp-account__nav-list` the
 * list the sheet flattens (`role="list"` in this markup is what keeps its semantics once `list-style: none`
 * drops the markers), `sp-account__nav-link` the destination whose `[aria-current="page"]` rule pairs the
 * accent with the leading bar its `::before` draws, `sp-account__nav-icon` the glyph square that keeps the
 * rows even, and `sp-account__content` the column the routed view lands in. `sp-container` and `sp-page` come
 * from `src/styles/layout.css`: `.sp-app__main` pads the page region and those two carry its width and its
 * rhythm. No breakpoint, colour, radius, shadow or length literal appears here, because the layout belongs to
 * the stylesheet that owns it.
 *
 * The page shell is not this file's. `src/components/layout/AppLayout.tsx` renders the skip link, the header,
 * the main region and the footer around the routed content, and `src/Router.tsx` renders that shell around
 * this layout, guards `/account/*` for a customer or an administrator and mounts the three views as this
 * route's children. This layout hosts them through `<Outlet/>` and imports none of them, which is what keeps
 * one feature slice from importing its sibling. It guards nothing either: a route guard is the router's and
 * hiding a link is not access control.
 *
 * Heading and title contract. This layout renders the account area's one `<h1>`, naming the section the
 * visitor is in, and `ProfilePage`, `OrderHistoryPage` and `AddressBookPage` render `<h2>` headings inside
 * it. Each view sets the document title for its own route through `useDocumentTitle`, so this file sets none:
 * an effect in this component runs after the view's and would be the title left standing.
 */

/**
 * The glyphs the account navigation can draw, one per destination, so a destination names its icon by key and
 * a glyph is never drawn from a second copy of its path data.
 */
type AccountIconName = "profile" | "orders" | "addresses" | "dashboard" | "reports";

/**
 * The path data of each glyph, drawn inside a 24-unit box as filled shapes, which lets `currentColor` be the
 * only paint any of them names: a glyph then takes the colour of the link around it and carries no width, no
 * height and no colour of its own.
 */
const ACCOUNT_ICON_PATHS: Readonly<Record<AccountIconName, string>> = {
  /** A head above a pair of shoulders: the profile. */
  profile: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 10c4.42 0 8 2.24 8 5v1H4v-1c0-2.76 3.58-5 8-5z",
  /** A lidded box: an order. */
  orders: "M3 6h18v3H3zM5 11h14v10H5z",
  /** A dropped pin: an address. */
  addresses: "M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z",
  /** Four tiles of unequal size: the dashboard. */
  dashboard: "M3 3h8v8H3zM13 3h8v5h-8zM3 13h8v8H3zM13 10h8v11h-8z",
  /** Bars of unequal height: the report. */
  reports: "M4 3h3v18H4zM10.5 8h3v13h-3zM17 13h3v8h-3z",
};

/**
 * One destination in the account navigation.
 *
 * `end` belongs to the item rather than to the link, because `/account` is the prefix of every other account
 * route and `/admin` is the prefix of the reports route: matched loosely, the profile and the dashboard would
 * each stay current while a screen beside them is open, and two items would carry `aria-current="page"` at
 * once.
 */
interface AccountNavItem {
  /** The destination's name, shown in the item and used as part of the link's accessible name. */
  readonly label: string;
  /** The route the item navigates to, taken from `ROUTES` so no path is written in this file. */
  readonly to: RoutePath;
  /** Which entry of {@link ACCOUNT_ICON_PATHS} the item draws. */
  readonly icon: AccountIconName;
  /** Matches the route exactly, so a route that prefixes a deeper one marks only one item. */
  readonly end?: boolean;
}

/** The three sections of the account area, in the order the navigation shows them. */
const ACCOUNT_NAV_ITEMS: readonly AccountNavItem[] = [
  { label: ACCOUNT_COPY.NAV_PROFILE_LABEL, to: ROUTES.ACCOUNT, icon: "profile", end: true },
  { label: ACCOUNT_COPY.NAV_ORDERS_LABEL, to: ROUTES.ACCOUNT_ORDERS, icon: "orders" },
  { label: ACCOUNT_COPY.NAV_ADDRESSES_LABEL, to: ROUTES.ACCOUNT_ADDRESSES, icon: "addresses" },
];

/**
 * The two administrator surfaces, added to the navigation for an administrator alone.
 *
 * The route guard admits an administrator to `/account/*`, while the administrator's own navigation is
 * `src/components/layout/AdminSidebar.tsx`, which `AppLayout` renders on the administrator screens only. An
 * administrator who opens an account screen would otherwise have to type a dashboard path, so the dashboard
 * and the reports are offered from here. This is not a second sidebar: the two destinations join the account
 * list in place, and they are drawn from the same `ROUTES` and the same `PAGE_TITLES` the sidebar reads, so a
 * screen and the link that reaches it cannot disagree about what the screen is called.
 */
const ADMIN_ENTRY_ITEMS: readonly AccountNavItem[] = [
  { label: PAGE_TITLES.DASHBOARD, to: ROUTES.ADMIN, icon: "dashboard", end: true },
  { label: PAGE_TITLES.REPORTS, to: ROUTES.ADMIN_REPORTS, icon: "reports" },
];

/**
 * Draws one navigation glyph.
 *
 * Decorative by construction: the label beside it names the destination, so the glyph is hidden from
 * assistive technology and taken out of the tab order rather than given a second name that would make the
 * link announce itself twice. `evenodd` is declared here rather than stored per glyph, so a glyph carrying an
 * opening — the pin's eye — draws it as a hole instead of depending on the direction its subpaths are written
 * in.
 */
function AccountGlyph({ name }: { readonly name: AccountIconName }): ReactElement {
  return (
    <svg aria-hidden="true" className="sp-account__nav-icon" focusable="false" viewBox="0 0 24 24">
      <path d={ACCOUNT_ICON_PATHS[name]} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/**
 * The heading of the account route the visitor is on, taken from the page titles so the `<h1>`, the navigation
 * and the view's own document title all name the screen the same way.
 *
 * An order inside the history is titled as an order rather than as the list: `/account/orders/:orderId` has no
 * entry of its own that `isActivePath` could match, since it compares paths literally and never matches a
 * declared parameter, so the deeper path is recognised as an order within the history and named accordingly.
 * The order number itself is unavailable here — it belongs to the view's data — so the heading names the
 * screen, and `PageHeader` derives the rest of the trail from the location.
 */
function accountSectionTitle(pathname: string): string {
  if (isActivePath(pathname, ROUTES.ACCOUNT_ORDERS)) {
    return isActivePath(pathname, ROUTES.ACCOUNT_ORDERS, { exact: true })
      ? PAGE_TITLES.ORDERS
      : PAGE_TITLES.ORDER_DETAIL;
  }
  if (isActivePath(pathname, ROUTES.ACCOUNT_ADDRESSES)) {
    return PAGE_TITLES.ADDRESSES;
  }
  return PAGE_TITLES.ACCOUNT;
}

/**
 * The account shell: the area's heading, the section navigation and the routed view.
 *
 * It is the parent route of `/account`, `/account/orders`, `/account/orders/:orderId` and
 * `/account/addresses`, so the three views render inside it through `<Outlet/>` and a visitor can move between
 * the sections without leaving the area. The current destination is marked by `NavLink`, which applies
 * `aria-current="page"` to the one link matching the location: `src/styles/account.css` styles that attribute,
 * pairing the accent with a leading bar so the state survives a greyscale rendering, and assistive technology
 * announces it. `PageHeader` derives the breadcrumb trail from the location; a trail is not passed in, because
 * this shell cannot name the order behind a detail path and a trail built here would be a second copy of
 * `deriveBreadcrumbTrail`'s ancestor table. A sign-out control is deliberately absent — the header's account
 * menu owns that action — because a second one would be a second implementation of it.
 */
export function AccountLayout(): ReactElement {
  const { pathname } = useLocation();
  const { isAdministrator } = useAuth();
  const items = isAdministrator ? [...ACCOUNT_NAV_ITEMS, ...ADMIN_ENTRY_ITEMS] : ACCOUNT_NAV_ITEMS;

  return (
    <div className="sp-container">
      <div className="sp-page">
        <PageHeader title={accountSectionTitle(pathname)} />
        <div className="sp-page__body">
          <div className="sp-account">
            <nav aria-label={A11Y_COPY.ACCOUNT_NAV_LABEL} className="sp-account__nav">
              <ul className="sp-account__nav-list" role="list">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink className="sp-account__nav-link" end={item.end} to={item.to}>
                      <AccountGlyph name={item.icon} />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="sp-account__content">
              <Outlet />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
