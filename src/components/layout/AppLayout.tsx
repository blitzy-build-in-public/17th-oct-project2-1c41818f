/**
 * Path: src/components/layout/AppLayout.tsx
 * Purpose: The page shell: skip link, header, routed content region, footer and the administrator sidebar branch
 * Lines: 126
 */

import type { ReactElement, ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { A11Y_COPY } from "@/constants/content";
import { ROUTE_PREFIXES, isActivePath } from "@/constants/routes";

import { AdminSidebar } from "./AdminSidebar";
import { Footer } from "./Footer";
import { Header, type HeaderProps } from "./Header";

/*
 * Class contract. Every class rendered below is defined in `src/styles/` and none of it is defined here.
 * `src/styles/layout.css` owns the application frame (`sp-app`) and its administrator variant
 * (`sp-app--admin`, a three-row grid whose middle row is the sidebar beside the content at every width,
 * as a rail of icons below the large stop and the labelled column from there), the three region hooks
 * this file gives its children (`sp-app__header`, `sp-app__main` and `sp-app__footer`) and the skip
 * link's own hook (`sp-app__skip-link`, which takes no rule of its own); `src/styles/base.css` owns the
 * `sp-skip-link` technique that hook decorates — hidden until it takes the focus and then lifted over
 * the sticky header. The region hooks are not decoration: the administrator grid places them as direct
 * children of the frame, and `sp-app__main` is the element carrying the page region's opening padding —
 * so a page that cancels it, the landing hero's `sp-page--flush`, cancels this file's padding rather
 * than a second copy of it — and, in the administrator variant, the measure and inline gutter that every
 * other route takes from `.sp-container`. No stylesheet is imported here, because `src/main.tsx` is the
 * only importer of `src/styles/**`, and no colour, length, radius, shadow or breakpoint of this file's
 * own appears below.
 */

/**
 * The id of the routed content region, and the fragment the skip link points at.
 *
 * Module-private rather than exported: the fragment and the region are one agreement inside this file,
 * and nothing outside it names the main region by id.
 */
const MAIN_CONTENT_ID = "main-content";

/**
 * Everything {@link AppLayout} accepts: the header's own props, which the shell passes through unchanged, and
 * the routed content it frames.
 */
export interface AppLayoutProps extends HeaderProps {
  /**
   * The routed content: the element `src/Router.tsx` resolves the current location to, or a route's own
   * element when the router nests its shell inside one. It lands in the shell's single `<main>` region
   * and is neither wrapped nor cloned here, so a route keeps the landmark structure its page declares.
   */
  readonly children: ReactNode;
}

/**
 * The application shell every route renders inside: the skip link, the header region, the routed content
 * region, the footer region, and — on an administrator's own screens — the sidebar that section is
 * navigated from.
 *
 * What it renders, and what that makes of the page. One skip link as the first focusable element, the
 * `Header` landmark, exactly one `<main>` holding the routed content, the `Footer` landmark, and the
 * `AdminSidebar` complement when the branch below holds. Nothing else: the shell owns no page title, so
 * the route's heading and the single `<h1>` belong to the page's own `PageHeader`; it is not a provider,
 * an error boundary, a router or the toast viewport, because `src/App.tsx` composes those around it; and
 * it does not render the mini-cart drawer, which the cart slice owns. That restraint is what lets the
 * shell render inside `MemoryRouter` in the integration tests with no provider this file supplies.
 *
 * The administrator branch is derived during render from the two facts it reads — the role on the session,
 * which arrives as a prop, and the current location, which it reads itself — so the shell holds no state, runs
 * no effect and memoises nothing, and a sign-out or a navigation re-derives it. The session facts reach it
 * because the composition root in `src/App.tsx` composes this shell inside every provider and reads them
 * there; the shell itself stays below the state layer and imports nothing from it. It is presentational: the
 * route guard in `src/Router.tsx` admits an administrator to the section and refuses everybody else, and
 * `src/lib/mockServer.ts` answers a non-administrator's analytics request with `403`. A redirect or a second
 * role check here would be a guard that hiding markup could defeat.
 *
 * @param props - The header's own props, passed straight through to it, and the routed content; see
 *   {@link AppLayoutProps}.
 * @returns The application frame around the routed content.
 */
export function AppLayout({ children, ...headerProps }: AppLayoutProps): ReactElement {
  const { pathname } = useLocation();

  // Prefix matching, not equality, so the reports screen inside `/admin` keeps the administrator shell.
  const isAdminSection =
    headerProps.account.isAdministrator && isActivePath(pathname, ROUTE_PREFIXES.ADMIN);

  return (
    <div className={isAdminSection ? "sp-app sp-app--admin" : "sp-app"}>
      {/* The fragment names the main region below: following it moves the sequential focus there, and
          `src/styles/base.css` lifts the link over the sticky header while it holds the focus. */}
      <a className="sp-skip-link sp-app__skip-link" href={`#${MAIN_CONTENT_ID}`}>
        {A11Y_COPY.SKIP_TO_CONTENT}
      </a>

      {/* A region of its own around the header landmark: the administrator grid targets this element as a
          direct child of the frame, and the stylesheet hands the band's chrome to it, which is why the
          header's own root drops the border once it sits inside the region. */}
      <div className="sp-app__header">
        <Header {...headerProps} />
      </div>

      {/*
        The sidebar is the frame's own child, which is the placement `src/styles/layout.css` reserves for
        it and what the administrator grid positions. It is the only copy of the administrator navigation
        the shell renders, and it is on the page at every width: the stylesheet collapses it to a rail of
        icons below the large stop and widens it into the labelled column from there. A second copy inside
        a drawer would need the overlay component from `src/components/ui`, which is outside this file's
        dependency set, and no drawer is rendered here.
      */}
      {isAdminSection ? <AdminSidebar /> : null}

      {/* The one main landmark of the document, and the region the skip link and every page's own padding
          hang off. `tabIndex={-1}` makes it a programmatic focus target without adding a tab stop. */}
      <main className="sp-app__main" id={MAIN_CONTENT_ID} tabIndex={-1}>
        {children}
      </main>

      {/* The footer's region, for the same reason as the header's: the grid targets it, and the band's
          chrome sits on the region while the footer's own root drops the border it would double. */}
      <div className="sp-app__footer">
        <Footer />
      </div>
    </div>
  );
}
