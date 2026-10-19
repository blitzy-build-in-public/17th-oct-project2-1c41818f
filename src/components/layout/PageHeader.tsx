/**
 * Path: src/components/layout/PageHeader.tsx
 * Purpose: Breadcrumbs with page title, description and action slot
 * Lines: 238
 */

import type { ReactElement, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { Skeleton } from "@/components/ui/Feedback";
import { A11Y_COPY, PAGE_TITLES } from "@/constants/content";
import { ROUTES, isActivePath } from "@/constants/routes";
import type { RoutePath } from "@/constants/routes";

/**
 * The header frame's own class, and the modifier `src/styles/page-header.css` reads to make the header hold the
 * block size the settled one takes. Both spellings are declared by that sheet, which is the family's sole
 * definition site, and the modifier is composed here because it is the one class the frame's string is built
 * from rather than written whole.
 */
const FRAME_CLASS = "sp-page-header";
const LOADING_FRAME_CLASS = "sp-page-header--loading";

/**
 * One crumb of a page header's trail.
 *
 * A crumb carrying `to` navigates to that route; the crumb naming the page the visitor is already
 * on carries no `to` and renders as text.
 */
export interface BreadcrumbItem {
  /** Text the crumb shows. */
  readonly label: string;
  /** Route the crumb navigates to; absent on the crumb naming the current page. */
  readonly to?: RoutePath;
}

/** Everything {@link PageHeader} accepts. */
export interface PageHeaderProps {
  /**
   * The trail for a route whose ancestors cannot be named from their URLs — a product, a category
   * or an order. Supply it when the page holds the real names; omit it everywhere else and the
   * trail is derived from the location.
   */
  readonly breadcrumbs?: readonly BreadcrumbItem[];
  /** The page's heading, and the only `<h1>` the route renders. */
  readonly title: string;
  /** Optional supporting line under the heading. */
  readonly description?: string;
  /** The page's primary control — a button, a link or a group of them. */
  readonly actions?: ReactNode;
  /**
   * How many crumbs the settled trail holds, for a page whose own names are still being read.
   *
   * A route whose trail, heading and supporting line are named by a read — the product route is the only one —
   * cannot pass them before the read answers, and the header its URL supports on its own is a row of crumbs, a
   * lane of heading and no supporting line short of the one the answer produces: the trail closes over a second
   * row, the heading's name wraps to a second lane and the supporting line arrives, and the block below the
   * header is pushed down by all three. Given the number of crumbs the answer holds, the header paints that many
   * placeholder crumbs in place of the trail, holds the heading at the lanes its name will take and reserves the
   * supporting line's rows, so the block below it is where it already was when the names land.
   *
   * Every route whose header is static leaves it out and renders exactly as it always did. One that gives it
   * must pass the `description` its settled header carries, because the loading header reserves that line
   * whether or not the settled one fills it.
   */
  readonly breadcrumbSlots?: number;
}

/** A route that can be named from its path, paired with the copy that names it. */
interface NamedSection {
  /** The section's route pattern, taken from `src/constants/routes.ts`. */
  readonly to: RoutePath;
  /** The section's label, taken from `src/constants/content.ts`. */
  readonly label: string;
}

/**
 * Every static section a derived trail can name, in ancestor order — `account` before
 * `account/orders`, `admin` before `admin/reports` — so a single pass over this list builds the
 * trail in the right order and no route needs a branch of its own.
 *
 * The parameterised routes are deliberately absent: `/product/:slug`, `/category/:slug` and
 * `/order-confirmation/:orderId` hold their names in the data, and a trail derived from those URLs
 * would present a prettified slug to the visitor as though it were the product's own name.
 */
const NAMED_SECTIONS: readonly NamedSection[] = [
  { to: ROUTES.CATALOG, label: PAGE_TITLES.CATALOG },
  { to: ROUTES.SEARCH, label: PAGE_TITLES.SEARCH },
  { to: ROUTES.CART, label: PAGE_TITLES.CART },
  { to: ROUTES.CHECKOUT, label: PAGE_TITLES.CHECKOUT },
  { to: ROUTES.ACCOUNT, label: PAGE_TITLES.ACCOUNT },
  { to: ROUTES.ACCOUNT_ORDERS, label: PAGE_TITLES.ORDERS },
  { to: ROUTES.ACCOUNT_ADDRESSES, label: PAGE_TITLES.ADDRESSES },
  { to: ROUTES.ADMIN, label: PAGE_TITLES.DASHBOARD },
  { to: ROUTES.ADMIN_REPORTS, label: PAGE_TITLES.REPORTS },
  { to: ROUTES.LOGIN, label: PAGE_TITLES.SIGN_IN },
  { to: ROUTES.REGISTER, label: PAGE_TITLES.REGISTER },
];

/**
 * Builds the trail a path supports on its own: the home route unless the visitor is already there,
 * then every named ancestor of the current path, then `title` as the current crumb.
 *
 * It refuses to invent a label. On a parameterised route only the ancestors that genuinely resolve
 * appear — `/product/a-slug` yields home and the page's own title — because the product's name is
 * not in its URL. A page that holds the real name passes it through `breadcrumbs` instead.
 * Exported so the derivation can be exercised on its own; pages leave it to {@link PageHeader}.
 */
export function deriveBreadcrumbTrail(pathname: string, title: string): readonly BreadcrumbItem[] {
  const trail: BreadcrumbItem[] = [];

  if (!isActivePath(pathname, ROUTES.HOME, { exact: true })) {
    trail.push({ label: PAGE_TITLES.HOME, to: ROUTES.HOME });
  }

  for (const section of NAMED_SECTIONS) {
    // A path names itself through `title`, so it is never repeated as one of its own ancestors.
    if (isActivePath(pathname, section.to, { exact: true })) {
      continue;
    }
    if (isActivePath(pathname, section.to)) {
      trail.push({ label: section.label, to: section.to });
    }
  }

  trail.push({ label: title });
  return trail;
}

/**
 * Renders one crumb: text carrying `aria-current="page"` for the page the visitor is on, a link for
 * an ancestor, and plain text for an unlinked middle crumb a caller supplied.
 */
function renderCrumb(item: BreadcrumbItem, isCurrent: boolean): ReactElement {
  if (isCurrent) {
    return (
      <span className="sp-page-header__crumb sp-page-header__crumb--current" aria-current="page">
        {item.label}
      </span>
    );
  }
  if (item.to === undefined) {
    return <span className="sp-page-header__crumb">{item.label}</span>;
  }
  return (
    <Link className="sp-page-header__crumb" to={item.to}>
      {item.label}
    </Link>
  );
}

/**
 * The heading block every route opens with: the trail back through the ancestors of the page, the
 * page's one `<h1>`, an optional supporting line and the page's primary control.
 *
 * `breadcrumbs` wins whenever a page supplies a non-empty trail, because a product, a category and
 * an order can only be named from the data they were loaded from; otherwise the trail is derived
 * from the current location. A trail of a single crumb is not drawn at all: a route with nowhere to
 * go back to — the landing page — shows its heading alone, and one crumb would only repeat it.
 *
 * `breadcrumbSlots` is for the page that has neither the trail nor the heading nor the supporting line yet,
 * because a read names all three; the header then paints the slots those parts occupy rather than the two crumbs
 * its URL supports, and keeps the block size of the header they will produce — see {@link PageHeaderProps}.
 *
 * Every class it renders belongs to the page-header contract `src/styles/page-header.css` publishes as the
 * family's sole definition site, and `src/styles/layout.css` — which loads that sheet with
 * `@import "./page-header.css";` — names the two parts carrying no rule of their own:
 * `sp-page-header__breadcrumbs`, a plain wrapper, and `sp-page-header__title`, whose heading-1 type
 * `src/styles/base.css` paints on the `h1` element. Nothing here imports a stylesheet, so nothing here
 * reads the stylesheets or adds a class of its own.
 */
export function PageHeader({
  breadcrumbs,
  title,
  description,
  actions,
  breadcrumbSlots,
}: PageHeaderProps): ReactElement {
  const { pathname } = useLocation();
  // A count of none is no count: a caller that passes nothing, or passes a value that does not describe a
  // trail, gets the header this component has always rendered.
  const slotCount =
    breadcrumbSlots !== undefined && breadcrumbSlots > 0 ? Math.trunc(breadcrumbSlots) : 0;
  const isLoading = slotCount > 0;
  const trail =
    breadcrumbs !== undefined && breadcrumbs.length > 0
      ? breadcrumbs
      : deriveBreadcrumbTrail(pathname, title);
  const hasDescription = description !== undefined && description.trim() !== "";
  const hasActions = actions !== undefined && actions !== null;

  return (
    <header className={isLoading ? `${FRAME_CLASS} ${LOADING_FRAME_CLASS}` : FRAME_CLASS}>
      {isLoading ? (
        // The trail's rows as the crumbs that will replace them, in the same list: the slots are as wide as the
        // words they stand in for, so they close over the second row at the width the real trail does. The
        // wrapper is hidden from assistive technology because there is nothing to navigate to yet — the page's
        // own name is on the `h1` below, which is what the loading header says.
        <nav className="sp-page-header__breadcrumbs" aria-hidden="true">
          <ol className="sp-page-header__breadcrumb-list">
            {Array.from({ length: slotCount }, (_slot, index) => (
              // The key is positional on purpose: every slot is the same decorative box, with no identity and no
              // state for a key to preserve across a re-render.
              <li className="sp-page-header__breadcrumb-item" key={`crumb-slot-${String(index)}`}>
                <Skeleton variant="text" className="sp-page-header__crumb-slot" />
              </li>
            ))}
          </ol>
        </nav>
      ) : trail.length > 1 ? (
        <nav className="sp-page-header__breadcrumbs" aria-label={A11Y_COPY.BREADCRUMB_LABEL}>
          <ol className="sp-page-header__breadcrumb-list">
            {trail.map((item, index) => (
              <li
                className="sp-page-header__breadcrumb-item"
                // A trail is positional, so a crumb's position and its label identify it.
                key={`${index}-${item.label}`}
              >
                {renderCrumb(item, index === trail.length - 1)}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <h1 className="sp-page-header__title">{title}</h1>
      {isLoading ? (
        // The supporting line's slot: one block standing in for the paragraph the settled header carries, sized
        // by the sheet to the rows that paragraph takes at this width.
        <div className="sp-page-header__description-slot" aria-hidden="true">
          <Skeleton variant="text" lines={2} />
        </div>
      ) : hasDescription ? (
        <p className="sp-page-header__description">{description}</p>
      ) : null}
      {hasActions ? <div className="sp-page-header__actions">{actions}</div> : null}
    </header>
  );
}
