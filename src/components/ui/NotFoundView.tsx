/**
 * Path: src/components/ui/NotFoundView.tsx
 * Purpose: The one not-found view every surface renders when the address it was given resolves to nothing.
 * Lines: 66
 */

import type { ReactElement } from "react";

import { Link } from "react-router-dom";

import { ButtonGroup } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Feedback";
import { HEADER_COPY, NOT_FOUND_COPY } from "@/constants/content";
import { ROUTES } from "@/constants/routes";

/*
 * Class contract. No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` —
 * so every class below is consumed by name. `src/styles/layout.css` owns the page geometry the view is laid
 * out in (`sp-container`, `sp-page`); `src/styles/controls.css` owns the button family its two ways out take,
 * as `sp-btn` with the `--primary` and `--secondary` modifiers, and the `sp-btn-group--align-center` rule that
 * packs the group to the middle of the page; and the empty state's own parts (`sp-empty`, `sp-empty__title`,
 * `sp-empty__body`) arrive with `EmptyState`. No colour, length, radius, shadow or breakpoint of this file's
 * own appears below.
 *
 * The wording is the content library's and both destinations are the route constants', so no sentence and no
 * path is written here. No live region is declared here either: how one of these states is announced belongs
 * to the shared empty state this view composes, and a second region wrapped around it would nest two.
 */

/**
 * The view an unmatched address renders, wherever in the product that state is reached.
 *
 * One composition for all three surfaces that reach it — the catch-all route, a category route whose segment
 * names no category, and a product route whose segment names no product — which is the point of the file: the
 * state is the same state, so it reads the same way rather than in three variations that keep naming the page
 * they replaced. Its heading is level 1 because the view is the page's principal content wherever it lands,
 * and each surface renders it in place of its own header, so the route keeps exactly one `<h1>` and no
 * breadcrumb trail claims a page that is not there.
 *
 * Both controls are router links and neither reloads the document: the catalogue, which is the action the
 * wording names, and the home page. They are one control group rather than two loose links, which is what
 * gives them the button family's skin and packs them to the middle of the page.
 *
 * @returns The not-found view.
 */
export function NotFoundView(): ReactElement {
  return (
    <div className="sp-container">
      <div className="sp-page">
        <EmptyState
          headingLevel={1}
          title={NOT_FOUND_COPY.TITLE}
          description={NOT_FOUND_COPY.BODY}
        />
        <ButtonGroup align="center">
          <Link className="sp-btn sp-btn--primary" to={ROUTES.CATALOG}>
            {NOT_FOUND_COPY.ACTION_LABEL}
          </Link>
          <Link className="sp-btn sp-btn--secondary" to={ROUTES.HOME}>
            {HEADER_COPY.NAV_HOME_LABEL}
          </Link>
        </ButtonGroup>
      </div>
    </div>
  );
}
