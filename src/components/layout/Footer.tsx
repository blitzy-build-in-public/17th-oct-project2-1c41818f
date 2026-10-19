/**
 * Path: src/components/layout/Footer.tsx
 * Purpose: Link columns, the contact block and the currency and legal line
 * Lines: 162
 */

import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { A11Y_COPY, FOOTER_COPY, copyrightLabel } from "@/constants/content";
import { ROUTES, loginPath } from "@/constants/routes";

/**
 * One destination inside a footer link column.
 *
 * Both fields are data rather than markup: `label` is the word the visitor reads, which belongs to
 * `src/constants/content.ts`, and `to` is a target `src/constants/routes.ts` owns — one of its
 * `ROUTES` paths, or the value of one of its builders. Because neither is written here, a route
 * that moves or a label that is reworded is edited in exactly one place, and this file cannot
 * point at an address the application does not serve.
 */
interface FooterLink {
  /** The visible text of the link, from `FOOTER_COPY`. */
  readonly label: string;
  /** The in-application target, from `ROUTES` or a path builder. */
  readonly to: string;
}

/**
 * One group of links under its own heading.
 *
 * `id` names the group stably so the rendered list can be keyed by it. It is deliberately not a
 * DOM element id: nothing in this footer is referenced by id — the navigation is named by its own
 * `aria-label` and the columns are named by their headings — so the page carries no id the footer
 * happened to pick.
 */
interface FooterLinkColumn {
  /** Stable identity of the column, used as its React key. */
  readonly id: string;
  /** The column's heading, from `FOOTER_COPY`. */
  readonly heading: string;
  /** The destinations, in reading order. */
  readonly links: readonly FooterLink[];
}

/**
 * The footer's link columns, declared once and rendered by `map`.
 *
 * Two groups cover every shopper-facing destination the product offers from a footer: the
 * catalogue surfaces, and the account surfaces. Every target exists as a route in `src/Router.tsx`,
 * so no link leads anywhere the application cannot render. An administrator group is deliberately
 * absent: the dashboard and the reports are role-guarded in the router and are reached from the
 * account menu, and administrative editing is out of scope — a footer link into a refusal would be
 * a dead end rather than a convenience.
 */
const FOOTER_LINK_COLUMNS: readonly FooterLinkColumn[] = [
  {
    id: "shop",
    heading: FOOTER_COPY.SHOP_HEADING,
    links: [
      { label: FOOTER_COPY.SHOP_CATALOG_LABEL, to: ROUTES.CATALOG },
      { label: FOOTER_COPY.SHOP_SEARCH_LABEL, to: ROUTES.SEARCH },
      { label: FOOTER_COPY.SHOP_CART_LABEL, to: ROUTES.CART },
    ],
  },
  {
    id: "account",
    heading: FOOTER_COPY.ACCOUNT_HEADING,
    links: [
      { label: FOOTER_COPY.ACCOUNT_ORDERS_LABEL, to: ROUTES.ACCOUNT_ORDERS },
      { label: FOOTER_COPY.ACCOUNT_ADDRESSES_LABEL, to: ROUTES.ACCOUNT_ADDRESSES },
      // Carries the account as the intended destination, so a visitor who signs in from the footer
      // lands where they were heading instead of on the home page.
      { label: FOOTER_COPY.ACCOUNT_SIGN_IN_LABEL, to: loginPath(ROUTES.ACCOUNT) },
    ],
  },
];

/**
 * Renders one link column: its heading and its destinations.
 *
 * Private to this file and unexported, because a footer column is not a control any other surface
 * composes. Extracting it is what lets {@link FOOTER_LINK_COLUMNS} stay data and keeps the column's
 * markup in one place instead of repeated per group.
 */
function FooterColumn({ column }: { readonly column: FooterLinkColumn }): ReactElement {
  return (
    <div className="sp-footer__column">
      <h2 className="sp-footer__heading">{column.heading}</h2>
      <ul className="sp-footer__links">
        {column.links.map((link) => (
          <li key={link.to}>
            <Link className="sp-footer__link" to={link.to}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The site footer: the shopper's link columns, the block that explains what the storefront is, and
 * the legal line.
 *
 * Rendered by `AppLayout` with no props and no session, so it paints with the rest of the shell on
 * first load: it reads no context, holds no state, runs no effect and requests nothing, which is
 * what keeps it out of the way of every page's data. Every word it shows comes from
 * `src/constants/content.ts` and every target from `src/constants/routes.ts`; the component
 * composes them and invents neither.
 *
 * Structure and accessibility. The `<footer>` element is the page's contentinfo landmark. The link
 * columns sit in one `<nav>` named by `A11Y_COPY.FOOTER_NAV_LABEL`, each group carrying an `<h2>`
 * heading so the two are landmarks' worth of headings rather than an unlabelled list of links; the
 * explanatory block is an `<h2>` with an `<h3>` beneath it for the note inside it. The page's single
 * `<h1>` belongs to `PageHeader.tsx`, never here. Each destination is a `Link`, so it is focusable,
 * operable with the keyboard and announced as a link, and it inherits the shared focus treatment
 * from `src/styles/base.css` rather than suppressing it. Nothing here is a control: there is no
 * form, no button and no overlay.
 *
 * Styling. No stylesheet is imported, and
 * no colour, radius, shadow or pixel breakpoint is written here. The classes this component renders
 * are the contract the footer skeleton in `src/styles/layout.css` styles: `sp-footer`,
 * `sp-footer__inner`, `sp-footer__columns`, `sp-footer__column`, `sp-footer__heading`,
 * `sp-footer__links`, `sp-footer__link`, `sp-footer__contact`, `sp-footer__text`,
 * `sp-footer__subheading`, `sp-footer__legal` and `sp-footer__legal-text`.
 */
export function Footer(): ReactElement {
  // A plain year, not formatted date text: the sentence it fills is the copy module's, and date
  // formatting belongs to `src/utils/dates.ts`, which this file does not need and does not import.
  const year = new Date().getFullYear();

  return (
    <footer className="sp-footer">
      <div className="sp-footer__inner">
        <nav className="sp-footer__columns" aria-label={A11Y_COPY.FOOTER_NAV_LABEL}>
          {FOOTER_LINK_COLUMNS.map((column) => (
            <FooterColumn key={column.id} column={column} />
          ))}
        </nav>

        <section className="sp-footer__contact">
          <h2 className="sp-footer__heading">{FOOTER_COPY.ABOUT_HEADING}</h2>
          <p className="sp-footer__text">{FOOTER_COPY.ABOUT_BODY}</p>
          <h3 className="sp-footer__subheading">{FOOTER_COPY.CONTACT_HEADING}</h3>
          <p className="sp-footer__text">{FOOTER_COPY.CONTACT_BODY}</p>
        </section>

        <div className="sp-footer__legal">
          {/*
            One currency, so there is no currency control to render: a switcher would have a single
            entry. The currency sentence is likewise not composed here — user-facing copy has one
            home, `src/constants/content.ts` — so the line is the copyright the copy module builds
            from the product name and the current year.
          */}
          <p className="sp-footer__legal-text">{copyrightLabel(year)}</p>
        </div>
      </div>
    </footer>
  );
}
