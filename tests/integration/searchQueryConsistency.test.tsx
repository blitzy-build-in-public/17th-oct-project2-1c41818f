/**
 * Path: tests/integration/searchQueryConsistency.test.tsx
 * Purpose: The regression guard for the search surface's count: a listing states a count, and renders tiles, only for the query the address bar names
 * Lines: 148
 */

import { describe, expect, it, vi } from "vitest";
import { useLayoutEffect } from "react";
import type { ReactElement } from "react";
import { useLocation } from "react-router-dom";

import { SEARCH_COPY, searchSummaryLabel } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { SearchPage } from "@/features/search/SearchPage";
import { useCatalog, useCatalogFilters } from "@/state/CatalogContext";

import {
  announcedTotal,
  EMPTY_STATES,
  headingNamed,
  isolateJourneyCases,
  pageBodyRegion,
  readAnnouncedTotal,
  renderApp,
  screen,
  textOf,
  tileNames,
  waitFor,
} from "../helpers/journeyHarness";
import { renderWithProviders } from "../testUtils";

/*
 * What this file guards, and how it reaches the frame the defect lives in.
 *
 * The state layer keeps the previous query's page while a new read is on its way — the retention an error state
 * falls back on — so a listing surface that states `view.page` as its answer before that read settles labels one
 * query's figures with another query's wording. The window is short and the settled result is correct either
 * way, which is why a case that only asserts the settled screen cannot fail on the defect.
 *
 * Two instruments reach it. The first holds the read back — the seam's own configured response delay is raised
 * for the length of the case — so the window between the submit and the answer is a state a case can assert on.
 * The second records every commit the surface takes part in from a layout effect, which runs after the commit's
 * DOM mutation and before the passive effect that issues the next read, so the first frame after the address bar
 * moves is observed rather than missed between two frames.
 *
 * Both instruments assert the same rule: while the query in the address bar has no answer in hand, no count of
 * another query is stated and no tile of another query is rendered. The term is one no seeded product matches,
 * so the query's own answer holds nothing and every figure asserted is read from the copy module or the seam.
 */

/** A term no seeded product matches, so the query's own answer is the empty result set. */
const NO_MATCH_TERM = "zzzqqqxyz";
/** The response delay the seam is held at while the unanswered window is asserted. */
const HOLD_MS = "1000";
/** The count sentences a listing states, which are the paragraphs the search and catalogue surfaces render. */
const COUNT_SELECTOR = "p.sp-result-count";
/** A rendered tile's name, which only a product a listing actually holds renders. */
const TILE_NAME_SELECTOR = ".sp-product-card__name";

/** The count sentences the surface is stating right now, in render order. */
function countSentences(): string[] {
  return Array.from(document.querySelectorAll(COUNT_SELECTOR)).map(
    (element) => element.textContent ?? "",
  );
}

describe("the count a search surface states while a query is unanswered", () => {
  isolateJourneyCases();

  it("states no count and renders no tile of the previous query until the answer lands", async () => {
    const { user } = renderApp({ route: ROUTES.SEARCH });
    const allProducts = await announcedTotal();
    expect(allProducts).toBeGreaterThan(0);

    // The read for the submitted term is held back, so the window between the address bar moving and the answer
    // landing is wide enough for a case to assert on — it is a paint in a browser and a state here.
    vi.stubEnv("VITE_API_LATENCY_MS", HOLD_MS);
    try {
      await user.type(screen.getByLabelText(SEARCH_COPY.FIELD_LABEL), NO_MATCH_TERM);
      await user.keyboard("{Enter}");

      expect(countSentences().join(" ")).not.toContain(String(allProducts));
      expect(readAnnouncedTotal()).toBe(-1);
      expect(tileNames()).toHaveLength(0);
    } finally {
      vi.stubEnv("VITE_API_LATENCY_MS", "0");
    }

    // The query's own answer: the term matched nothing, and only its own sentence is stated for it.
    expect(await headingNamed(EMPTY_STATES.searchResults.title, 2)).toBeInTheDocument();
    expect(textOf(pageBodyRegion())).toContain(searchSummaryLabel(NO_MATCH_TERM, 0));
  });

  it("renders no tile of the previous query in the commit that moves the address bar", async () => {
    const frames: Frame[] = [];
    const { user } = renderWithProviders(
      <>
        <FrameProbe frames={frames} />
        <SearchPage />
      </>,
      { route: ROUTES.SEARCH },
    );
    const allProducts = await announcedTotal();
    expect(allProducts).toBeGreaterThan(0);

    await user.type(screen.getByLabelText(SEARCH_COPY.FIELD_LABEL), NO_MATCH_TERM);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(tileNames()).toHaveLength(0));

    const answered = frames.filter((frame) => frame.search.includes(NO_MATCH_TERM));
    expect(answered.length).toBeGreaterThan(0);
    for (const frame of answered) {
      expect(frame.counts.join(" ")).not.toContain(String(allProducts));
      expect(frame.tiles).toHaveLength(0);
    }
  });
});

/** One commit of the results surface, read after that commit's DOM mutation. */
interface Frame {
  /** The address bar's own query, the term the context read from it, and whether the view answers that query. */
  readonly search: string;
  readonly counts: readonly string[];
  readonly tiles: readonly string[];
}

/**
 * Records what the results surface rendered in every commit it takes part in.
 *
 * Its layout effect carries no dependency list on purpose: it must run for each commit, and being a reader of
 * both catalogue contexts makes the probe re-render with the page whenever the query or the load moves, which
 * is what puts its effect in that same commit.
 */
function FrameProbe({ frames }: { readonly frames: Frame[] }): ReactElement | null {
  const location = useLocation();
  const view = useCatalog();
  const catalog = useCatalogFilters();
  useLayoutEffect(() => {
    frames.push({
      search: `${location.search}|${catalog.filters.q}|${String(view.query !== null)}`,
      counts: countSentences(),
      tiles: Array.from(document.querySelectorAll(TILE_NAME_SELECTOR)).map(
        (element) => element.textContent ?? "",
      ),
    });
  });
  return null;
}
