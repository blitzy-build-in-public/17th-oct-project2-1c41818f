/**
 * Path: src/components/layout/PageHeader.tsx
 * Purpose: Breadcrumbs with page title, description and action slot
 * Lines: 174
 */

import type { ReactElement, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { A11Y_COPY, PAGE_TITLES } from "@/constants/content";
import { ROUTES, isActivePath } from "@/constants/routes";
import type { RoutePath } from "@/constants/routes";

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
 * Every class it renders is defined once in `src/styles/layout.css`, which `src/main.tsx` is the
 * only file to import; nothing here reads the stylesheets or adds a class of its own.
 */
export function PageHeader({
  breadcrumbs,
  title,
  description,
  actions,
}: PageHeaderProps): ReactElement {
  const { pathname } = useLocation();
  const trail =
    breadcrumbs !== undefined && breadcrumbs.length > 0
      ? breadcrumbs
      : deriveBreadcrumbTrail(pathname, title);
  const hasDescription = description !== undefined && description.trim() !== "";
  const hasActions = actions !== undefined && actions !== null;

  return (
    <header className="sp-page-header">
      {trail.length > 1 ? (
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
      {hasDescription ? <p className="sp-page-header__description">{description}</p> : null}
      {hasActions ? <div className="sp-page-header__actions">{actions}</div> : null}
    </header>
  );
}
