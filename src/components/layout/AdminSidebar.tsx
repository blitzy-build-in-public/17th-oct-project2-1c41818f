/**
 * Path: src/components/layout/AdminSidebar.tsx
 * Purpose: Administrator navigation that marks the current section
 * Lines: 165
 */

import type { ReactElement } from "react";
import { Link, NavLink } from "react-router-dom";

import { ADMIN_COPY, HEADER_COPY, PAGE_TITLES } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import type { RoutePath } from "@/constants/routes";

/*
 * Class contract. `src/styles/layout.css` is the sole definition site of the sidebar skeleton
 * (`sp-sidebar`) and of its `__title`, `__nav`, `__list`, `__item`, `__link`, `__icon`, `__label`
 * and `__return` parts, together with the rail the sidebar collapses to below the medium
 * breakpoint. That rail hides `sp-sidebar__label` with the visually-hidden technique
 * `src/styles/base.css` declares as `.sp-visually-hidden`, never with `display: none`, so an
 * administrator who cannot see the glyph still hears the destination's name. Nothing here imports
 * a stylesheet — only `src/main.tsx` imports `src/styles/**` — and no breakpoint appears here,
 * because the collapse belongs to the stylesheet that owns the layout.
 */

/** Names the heading that labels this landmark's navigation, so the words are written once. */
const ADMIN_SIDEBAR_HEADING_ID = "admin-sidebar-heading";

/**
 * The glyphs the administrator navigation can draw: the dashboard grid, the reports rows and the
 * storefront doorway. A keyed union rather than one component per glyph, so a destination names
 * its icon by key and a glyph is never drawn from a second copy of its path data.
 */
type AdminIconName = "dashboard" | "reports" | "storefront";

/**
 * The path data of each glyph, drawn inside a 24-unit box.
 *
 * Every one is a filled shape, which lets `currentColor` be the only paint any glyph names: the
 * icon then takes the colour of the link around it, and the glyph itself carries no width, no
 * height and no colour literal for a stylesheet or a token to disagree with.
 */
const ADMIN_ICON_PATHS: Readonly<Record<AdminIconName, string>> = {
  /** Four tiles: the dashboard grid. */
  dashboard: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z",
  /** Three ruled rows of unequal length: the report. */
  reports: "M3 5h18v3H3zM3 11h12v3H3zM3 17h18v3H3z",
  /** A roof carried over a doorway: the storefront. */
  storefront: "M12 3L2 12h3v9h5v-6h4v6h5v-9h3z",
};

/**
 * One destination in the administrator navigation.
 *
 * `end` belongs to the item rather than to the link, because the dashboard route is also the
 * prefix of the reports route: matched loosely, `/admin` would stay current while the reports
 * screen is open and two items would carry `aria-current="page"` at once.
 */
interface AdminNavItem {
  /** The destination's name, shown in the item and used as the link's accessible name. */
  readonly label: string;
  /** The route the item navigates to, taken from `ROUTES` so no path is written in this file. */
  readonly to: RoutePath;
  /** Which entry of `ADMIN_ICON_PATHS` the item draws. */
  readonly icon: AdminIconName;
  /** Matches the route exactly, so a route that prefixes a deeper one marks only one item. */
  readonly end?: boolean;
}

/**
 * The administrator surfaces SalesPro defines, declared once and rendered by mapping over them.
 *
 * These two are the whole administrator area: no product, order, inventory, customer or promo-code
 * administration is in the product, so an item added here would link to a route that does not
 * exist. The labels are the titles of the pages the routes render, so a screen and the link that
 * reaches it cannot disagree about what the screen is called.
 */
const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { label: PAGE_TITLES.DASHBOARD, to: ROUTES.ADMIN, icon: "dashboard", end: true },
  { label: PAGE_TITLES.REPORTS, to: ROUTES.ADMIN_REPORTS, icon: "reports" },
];

/**
 * Draws one administrative glyph.
 *
 * Decorative by construction: the label beside it names the destination, so the glyph is hidden
 * from assistive technology and taken out of the tab order rather than given a second name that
 * would make the link announce itself twice.
 */
function AdminGlyph({ name }: { readonly name: AdminIconName }): ReactElement {
  return (
    <svg aria-hidden="true" className="sp-sidebar__icon" focusable="false" viewBox="0 0 24 24">
      <path d={ADMIN_ICON_PATHS[name]} fill="currentColor" />
    </svg>
  );
}

/**
 * The glyph and the name that every administrator link renders, so one destination is rendered by
 * one body whichever element carries the link.
 *
 * The label stays in the markup at every width: the rail hides it visually and not from the
 * accessibility tree, which is what leaves each icon-only link with its accessible name.
 */
function AdminLinkBody({
  icon,
  label,
}: {
  readonly icon: AdminIconName;
  readonly label: string;
}): ReactElement {
  return (
    <>
      <AdminGlyph name={icon} />
      <span className="sp-sidebar__label">{label}</span>
    </>
  );
}

/**
 * The administrator navigation: the section's title and the surfaces inside it.
 *
 * `src/components/layout/AppLayout.tsx` renders it, with no props, in the branch that decides this
 * sidebar belongs on the page; everything it shows therefore comes from the constants above. It
 * holds no state, reads no context and takes no children, so it renders identically on every
 * administrator screen.
 *
 * The route guard is deliberately absent. `src/Router.tsx` admits an administrator to `/admin` and
 * `/admin/reports` and sends everybody else to sign-in, and `src/lib/mockServer.ts` refuses the
 * analytics a non-administrator asks for. A check repeated in a navigation component would be a
 * guard that hiding a link could defeat, so this file performs none.
 *
 * Marking the current section is `NavLink`'s: it applies `aria-current="page"` to the active link,
 * and `src/styles/components.css` and `src/styles/layout.css` style the current item from that
 * attribute rather than from a conditional class name. The `end` the dashboard item carries is what
 * keeps exactly one link marked while the reports screen is open.
 *
 * `isActivePath` in `src/constants/routes.ts` is deliberately not called: comparing the current
 * pathname here would make this component subscribe to the router through a location hook and
 * re-render on every navigation, while `NavLink` already performs the same prefix-and-exact match
 * against the location it reads. Guarding a section by `ROUTE_PREFIXES` is likewise the router's
 * business rather than the navigation a guard renders, so the prefixes stay where they are checked.
 */
export function AdminSidebar(): ReactElement {
  return (
    <aside className="sp-sidebar">
      <h2 className="sp-sidebar__title" id={ADMIN_SIDEBAR_HEADING_ID}>
        {ADMIN_COPY.HEADING}
      </h2>
      <nav aria-labelledby={ADMIN_SIDEBAR_HEADING_ID} className="sp-sidebar__nav">
        <ul className="sp-sidebar__list">
          {ADMIN_NAV_ITEMS.map((item) => (
            <li className="sp-sidebar__item" key={item.to}>
              <NavLink className="sp-sidebar__link" end={item.end} to={item.to}>
                <AdminLinkBody icon={item.icon} label={item.label} />
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Link className="sp-sidebar__link sp-sidebar__return" to={ROUTES.HOME}>
        <AdminLinkBody icon="storefront" label={HEADER_COPY.NAV_HOME_LABEL} />
      </Link>
    </aside>
  );
}
