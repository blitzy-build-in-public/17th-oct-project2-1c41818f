/**
 * Path: src/components/layout/AppLayout.tsx
 * Purpose: The page shell: skip link, header, routed content region, footer and the administrator sidebar branch
 * Lines: 302
 */

import { useEffect, useRef } from "react";
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
 * (`sp-app--admin`, a three-row grid whose middle row is the sidebar beside the content at every width, as a
 * rail of icons below the large stop and the labelled column from there — the variant is chosen from the
 * location alone, which is what makes the grid and its reserved first column present from the first paint
 * while the sidebar that fills that column waits on the session), the three region hooks this file gives its
 * children (`sp-app__header`, `sp-app__main` and `sp-app__footer`) and the skip link's own hook
 * (`sp-app__skip-link`, which takes no rule of its own); `src/styles/base.css` owns the `sp-skip-link`
 * technique that hook decorates — hidden until it takes the focus and then lifted over the sticky header. The
 * region hooks are not decoration: the administrator grid places them as direct children of the frame, and
 * `sp-app__main` is the element carrying the page region's opening padding — so a page that cancels it, the
 * landing hero's `sp-page--flush`, cancels this file's padding rather than a second copy of it — and, in the
 * administrator variant, the measure and inline gutter that every other route takes from `.sp-container`. No
 * stylesheet is imported here, and no colour,
 * length, radius, shadow or breakpoint of this file's own appears below.
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
/**
 * How far the focus ring is painted outside the box it surrounds, read from the element that carries it
 * rather than repeated here: `src/styles/base.css` draws it as `outline: var(--focus-ring-width) solid …`
 * with `outline-offset: var(--focus-ring-offset)`, and an engine that paints no ring around an element —
 * a pointer focus, which that sheet deliberately leaves unringed — reports no reach at all.
 *
 * @param target - The focused element whose ring is in question.
 * @returns The ring's reach beyond the target's box, in pixels.
 */
function focusRingReach(target: HTMLElement): number {
  if (typeof window === "undefined") return 0;
  const style = window.getComputedStyle(target);
  const width = Number.parseFloat(style.outlineWidth);
  const offset = Number.parseFloat(style.outlineOffset);
  return (Number.isFinite(width) ? width : 0) + (Number.isFinite(offset) ? offset : 0);
}

/**
 * The bottom edge of the opaque band the sticky header paints over the top of the viewport: whatever
 * falls above this line is covered, because the header's surface is opaque and its rung of the z-index
 * ladder is above the content's.
 *
 * Measured from the header region rather than taken from `--layout-header-height`, which is only the
 * band's floor: the band grows with its own content, and the small screen's navigation panel expands
 * inside it.
 *
 * @param header - The header region this file renders, when it is mounted.
 * @returns That edge in viewport coordinates, and 0 where there is no window or no header to measure.
 */
function headerBandBottom(header: HTMLElement | null): number {
  if (typeof window === "undefined" || header === null) return 0;
  return Math.max(header.getBoundingClientRect().bottom, 0);
}

/**
 * Brings a focused target's indicator clear of the header band.
 *
 * A ring is painted outside its element's box, so a target whose box begins at the band's bottom edge —
 * the content region's own top, and a flush page's heading with it — carries its whole ring inside the
 * band, where nothing of it can be seen. The alignment below puts the target's start edge at the
 * scrollport's padded start instead, which is the clearance `src/styles/base.css` reserves for the
 * header on the document's scroll container and is therefore the one position that leaves both the box
 * and its ring below the band. A target already clear of the band is left exactly where the browser put
 * it, so the page does not move for a ring already visible where it stands.
 *
 * @param target - The element that has just taken the focus.
 * @param header - The header region this file renders, when it is mounted.
 */
function revealRingBelowHeader(target: HTMLElement, header: HTMLElement | null): void {
  if (typeof target.scrollIntoView !== "function") return;
  const ringTop = target.getBoundingClientRect().top - focusRingReach(target);
  if (ringTop >= headerBandBottom(header)) return;
  target.scrollIntoView({ block: "start", inline: "nearest" });
}

/**
 * Hands the focus from the content region to the level-1 heading of the screen that has rendered inside
 * it, when there is one, and answers whether the heading took it.
 *
 * The region is the landmark a navigation lands in, but it is not a target a reader can see the focus
 * on: it spans the page's full width and begins under the header, so its ring is drawn in the rows the
 * header covers and in the columns beyond the viewport. The heading the screen renders for itself is
 * drawn inside the page, below the band, and it is the one that names the new screen — which is why the
 * focus finishes on the heading rather than staying on the region, and why a screen that renders no
 * heading at all leaves the region holding it.
 *
 * `tabIndex` is written to the node rather than rendered, because the heading belongs to a page that
 * declares none and therefore never clears the one written here — the imperative-DOM technique
 * `src/components/ui/overlayEngine.ts` uses for the inert application root. `-1` makes the heading a
 * programmatic focus target without adding a tab stop to the page's own reading order.
 *
 * @param main - The content region that holds the focus.
 * @param header - The header region this file renders, when it is mounted.
 * @returns True when the heading took the focus; false while the screen has rendered none, or when the
 *   browser refused it.
 */
function focusScreenHeading(main: HTMLElement, header: HTMLElement | null): boolean {
  const heading = main.querySelector("h1");
  if (heading === null) return false;
  heading.tabIndex = -1;
  heading.focus();
  if (document.activeElement !== heading) return false;
  revealRingBelowHeader(heading, header);
  return true;
}

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
 * `AdminSidebar` complement on an administrator's own screens. Nothing else: the shell owns no page title, so
 * the route's heading and the single `<h1>` belong to the page's own `PageHeader`; it is not a provider,
 * an error boundary, a router or the toast viewport, because `src/App.tsx` composes those around it; and
 * it does not render the mini-cart drawer, which the cart slice owns. That restraint is what lets the
 * shell render inside `MemoryRouter` in the integration tests with no provider this file supplies.
 *
 * The administrator frame and the administrator sidebar are decided by different facts, and each is read from
 * the source that knows it. The frame is derived from the current location alone, because the location is known
 * at the first render while the session is restored asynchronously: a frame that waited for the role would lay
 * the routed content out full width and then move it into the grid's second column when the restore resolved,
 * shifting the content the visitor is already reading. The sidebar is derived from the role as well as the
 * location, because everything it lists is the session's and it belongs to the section: a visitor the guard has
 * not yet turned away gets the reserved column with nothing inside it, and an administrator browsing the
 * storefront keeps the storefront's single-column shell. Both facts reach the shell as props — the composition
 * root in `src/App.tsx` composes it inside every provider and reads the session there, so the shell itself
 * stays below the state layer and imports nothing from it — and both are derived during render, since the shell
 * holds no state and memoises nothing, and a sign-out or a navigation re-derives them. Its one effect is the
 * route-change focus move described below: the control a navigation came from left with the screen that held
 * it, so the region the new route landed in takes the focus rather than the document body, and the arriving
 * screen's own level-1 heading takes it from the region as soon as the screen renders one — a synchronisation
 * with the document's focus and not state this shell keeps. It is
 * presentational: the route guard in `src/Router.tsx` admits an administrator to the section and refuses
 * everybody else, and `src/lib/mockServer.ts` answers a non-administrator's analytics request with `403`. A
 * redirect or a second role check here would be a guard that hiding markup could defeat.
 *
 * @param props - The header's own props, passed straight through to it, and the routed content; see
 *   {@link AppLayoutProps}.
 * @returns The application frame around the routed content.
 */
export function AppLayout({ children, ...headerProps }: AppLayoutProps): ReactElement {
  const { pathname } = useLocation();

  const mainRef = useRef<HTMLElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);

  /** The pathname the previous render resolved to. A ref rather than state, because it is a fact about the
   *  last commit and not a reason to render, and because it survives React 19's StrictMode double
   *  invocation of the effect below: a mount runs that effect twice, and the second run compares the path the
   *  first one just wrote. */
  const previousPathRef = useRef(pathname);

  /*
   * The route-change focus move, and the shell's only effect.
   *
   * A navigation replaces the content the keyboard user was standing in, so the control the focus was on goes
   * away with the screen that held it and the browser drops the focus onto `document.body` — the next Tab then
   * restarts at the skip link, however deep into the previous screen the visitor had travelled. The focus is
   * moved to the document's one main region instead, which is a landmark the route's own heading tree names, so
   * a screen reader announces the region the navigation landed in.
   *
   * It is keyed on the pathname alone — never on the search string and never on the location key — so a filter,
   * a sort or a page change inside one route leaves the focus where the visitor put it, and a route that
   * resolves to the path it already held moves nothing. The first render of a path is skipped too, so an
   * arrival by URL, by reload or by a redirect leaves focus at the top of the document where the browser put
   * it, and only a navigation from one path to another takes it.
   *
   * The region is a way station, not the destination, and the heading of the new screen is what the focus
   * finishes on. A ring is painted outside its element's box, and the region's box begins exactly at the
   * header band's bottom edge, so the ring of a region that keeps the focus is drawn under the opaque header
   * and outside the viewport's columns: a keyboard user is announced into the new screen with no visible
   * indicator anywhere on it — the reason the move is carried through to the heading. The
   * screen's own `<h1>` is drawn inside the page, below the band, and it names where the reader has arrived,
   * which is why the move is carried through to it. `focusScreenHeading` documents the move and the ring
   * correction that goes with it; a screen that renders no heading — the placeholder a route shows while its
   * code is fetched is one — keeps the focus on the region.
   */
  useEffect(() => {
    if (previousPathRef.current === pathname) return undefined;
    previousPathRef.current = pathname;
    const main = mainRef.current;
    if (main === null) return undefined;
    /*
     * The region first, because the control the navigation came from has already left with the screen that
     * held it: focusing the region on this commit is what keeps the focus off `document.body` while the new
     * screen is still on its way, and a screen whose code the browser has to fetch renders its heading a
     * commit or more after this one.
     */
    main.focus();
    /*
     * Then the heading, as soon as the screen has rendered one. That is usually this same commit — the router
     * performs a navigation as a transition, and a transition is not committed until its content is ready —
     * so the heading is looked for once here before anything is watched.
     *
     * A route whose code is still being fetched renders its heading in a later commit of the boundary inside
     * this region, and a commit of that subtree is not one this component renders in, so an effect could not
     * see it: the region is watched for it instead, through the browser's own signal that the region's content
     * changed. The watch ends as soon as a heading takes the focus, and it moves nothing once the focus has
     * left the region for somewhere else — a reader's next Tab, or an overlay that opened in the meantime, is
     * not this rule's to overrule.
     */
    if (focusScreenHeading(main, headerRef.current)) return undefined;
    if (typeof MutationObserver !== "function") return undefined;
    const observer = new MutationObserver(() => {
      if (document.activeElement !== main) {
        observer.disconnect();
        return;
      }
      if (focusScreenHeading(main, headerRef.current)) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  // Prefix matching, not equality, so the reports screen inside `/admin` keeps the administrator shell.
  const isAdminSection = isActivePath(pathname, ROUTE_PREFIXES.ADMIN);
  // The sidebar needs both facts and the frame only the first: it is the session's navigation, so it waits
  // for the role, while the grid it sits in is reserved by the route before the session has resolved. The role
  // reaches it as the account prop the header above is given, which is how the shell reads a session fact
  // without importing the state layer.
  const { isAdministrator } = headerProps.account;
  const showsAdminSidebar = isAdministrator && isAdminSection;

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
      <div className="sp-app__header" ref={headerRef}>
        <Header {...headerProps} />
      </div>

      {/*
        The sidebar is the frame's own child, which is the placement `src/styles/layout.css` reserves for
        it and what the administrator grid positions, and it is gated on the session as well as the route:
        every entry it shows is an administrator's, while the column it fills is reserved by the location
        alone, so a visitor the guard has not turned away yet gets the column and nothing in it. It is the
        only copy of the administrator navigation the shell renders, and it is on the page at every width: the
        stylesheet collapses it to a rail of icons below the large stop and widens it into the labelled column
        from there. A second copy inside a drawer would need the overlay component from `src/components/ui`,
        which is outside this file's dependency set, and no drawer is rendered here.
      */}
      {showsAdminSidebar ? <AdminSidebar /> : null}

      {/* The one main landmark of the document, and the region the skip link and every page's own padding
          hang off. `tabIndex={-1}` makes it a programmatic focus target without adding a tab stop. */}
      <main className="sp-app__main" id={MAIN_CONTENT_ID} tabIndex={-1} ref={mainRef}>
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
