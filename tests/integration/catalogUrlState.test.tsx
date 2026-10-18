/**
 * Path: tests/integration/catalogUrlState.test.tsx
 * Purpose: The catalogue's query contract with the address bar: writes raised inside one render, a loaded address canonicalised, and a canonical address left alone.
 * Lines: 208
 */

import { useEffect } from "react";
import type { ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_PAGE_SIZE } from "@/constants/config";
import { ROUTES, loginPath } from "@/constants/routes";
import { CATEGORY_DEFINITIONS } from "@/constants/taxonomy";
import { BRANDS } from "@/data/categories";
import { PRODUCTS } from "@/data/products";
import { useCatalogFilters } from "@/state/CatalogContext";
import { pageCountFor } from "@/utils/collections";
import { filtersToPath, setQuery, withSort, DEFAULT_FILTER_STATE } from "@/utils/queryParams";
import { categoryId } from "@/utils/strings";

import { renderWithProviders, resetApiState, screen, waitFor } from "../testUtils";

/*
 * What this file proves.
 *
 * Query state has one store and it is the address bar, so the cases here read the location itself: which query a
 * write leaves, and which query a loaded address ends at. A harness's `MemoryRouter` keeps that query out of
 * `window.location`, so it has to be rendered to be read, and this file is where the location-reading cases live.
 */

// The address bar the cases read ---------------------------------------------------------------------

/** Every location the probe rendered, oldest first: a repeat is a replacement that did not settle. */
const RENDERED_LOCATIONS: string[] = [];

/** The category facet value the write below applies, and the label the taxonomy offers it under. */
const AUDIO_CATEGORY =
  CATEGORY_DEFINITIONS.find((definition) => definition.slug === "audio") ?? CATEGORY_DEFINITIONS[0];
const AUDIO_CATEGORY_ID = categoryId(AUDIO_CATEGORY.slug);

/** The seeded brand the same event applies, which the facet panel counts a value for. */
const BRAND = BRANDS[0];

/**
 * The location the tree is on, rendered, beside a button raising two facet writes inside one event.
 *
 * Two clicks cannot raise two writes inside one tick, because a render separates one click from the next, so the
 * pair is raised from one handler — the shape a burst of real clicks reaches whenever the address bar cannot keep
 * up with them.
 */
function QueryStateProbe(): ReactElement {
  const location = useLocation();
  const catalog = useCatalogFilters();

  useEffect(() => {
    RENDERED_LOCATIONS.push(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  return (
    <div>
      <span data-testid="location">{`${location.pathname}${location.search}`}</span>
      <button
        type="button"
        onClick={() => {
          catalog.toggleFacet("category", AUDIO_CATEGORY_ID);
          catalog.toggleFacet("brand", BRAND.id);
        }}
      >
        {AUDIO_CATEGORY.name}
      </button>
    </div>
  );
}

/** The location the probe renders now. */
function renderedLocation(): string {
  return screen.getByTestId("location").textContent ?? "";
}

/** Whether each location the probe rendered appeared once, which a replacement that never settled would break. */
function settledInOnePass(): boolean {
  return new Set(RENDERED_LOCATIONS).size === RENDERED_LOCATIONS.length;
}

/**
 * The addresses whose keys name no state the reader keeps, each with the canonical form of that same selection
 * beside it. A page size outside the configured set, a page below the first, an unknown sort key, a rating off
 * the scale and a flag that is neither `true` nor `1` are read back to their defaults, so the writer omits them;
 * a page past the last is clamped to the page the listing served; an inverted price pair is renormalised; and one
 * category value written fifty times is one selection. Every expected address is therefore the writer's own
 * canonical form of what the query reader resolved.
 */
const CRAFTED_ADDRESSES = [
  { label: "an unconfigured page size", query: "pageSize=7", expected: "" },
  { label: "a page size of zero", query: "pageSize=0", expected: "" },
  { label: "a page size that is not a figure", query: "pageSize=abc", expected: "" },
  { label: "a page size past the configured set", query: "pageSize=1000000", expected: "" },
  { label: "a page below the first", query: "page=0", expected: "" },
  {
    label: "a page above the last",
    query: "page=99999",
    expected: `?page=${pageCountFor(PRODUCTS.length, DEFAULT_PAGE_SIZE)}`,
  },
  { label: "an unknown sort key", query: "sort=notasortkey", expected: "" },
  { label: "a rating off the scale", query: "minRating=9", expected: "" },
  { label: "a flag that is neither true nor 1", query: "inStock=notaboolean", expected: "" },
  {
    label: "an inverted price range",
    query: "minPrice=500&maxPrice=1",
    expected: "?maxPrice=500&minPrice=1",
  },
  {
    label: "one category written fifty times",
    query: `categoryIds=${Array.from({ length: 50 }, () => AUDIO_CATEGORY_ID).join(",")}`,
    expected: `?categoryIds=${AUDIO_CATEGORY_ID}`,
  },
];

describe("the catalogue's query contract with the address bar", () => {
  beforeEach(() => {
    resetApiState();
    RENDERED_LOCATIONS.length = 0;
  });

  it("applies two writes a single event raises", async () => {
    const { user } = renderWithProviders(<QueryStateProbe />, { route: ROUTES.CATALOG });
    await waitFor(() => expect(renderedLocation()).toBe(ROUTES.CATALOG));

    await user.click(screen.getByRole("button", { name: AUDIO_CATEGORY.name }));

    // Both selections land: the second write composes from the query the first one asked for, where composing it
    // from the params of the render the two share would overwrite the first.
    expect(renderedLocation()).toBe(
      `${ROUTES.CATALOG}?brandIds=${BRAND.id}&categoryIds=${AUDIO_CATEGORY_ID}`,
    );
  });

  it("replaces a loaded address with the selection it already renders", async () => {
    const crafted = `pageSize=1000000&page=-5&categoryIds=${AUDIO_CATEGORY_ID},${AUDIO_CATEGORY_ID}&sort=notasortkey`;
    renderWithProviders(<QueryStateProbe />, { route: `${ROUTES.CATALOG}?${crafted}` });

    // The unconfigured size, the page below the first and the unknown sort key name no state, and the value
    // written twice is one selection: the address ends at the canonical form of the selection it renders.
    await waitFor(() =>
      expect(renderedLocation()).toBe(`${ROUTES.CATALOG}?categoryIds=${AUDIO_CATEGORY_ID}`),
    );
    expect(settledInOnePass()).toBe(true);
  });

  it("clamps a page past the last to the page the catalogue served", async () => {
    renderWithProviders(<QueryStateProbe />, { route: `${ROUTES.CATALOG}?page=99999` });

    const lastPage = pageCountFor(PRODUCTS.length, DEFAULT_PAGE_SIZE);
    await waitFor(() => expect(renderedLocation()).toBe(`${ROUTES.CATALOG}?page=${lastPage}`));
    expect(settledInOnePass()).toBe(true);
  });

  it.each(CRAFTED_ADDRESSES)(
    "replaces a loaded address holding $label with the selection it renders",
    async ({ query, expected }) => {
      renderWithProviders(<QueryStateProbe />, { route: `${ROUTES.CATALOG}?${query}` });

      await waitFor(() => expect(renderedLocation()).toBe(`${ROUTES.CATALOG}${expected}`));
      expect(settledInOnePass()).toBe(true);
    },
  );

  it("drops a relevance sort left without a term, so one selection is one URL", async () => {
    renderWithProviders(<QueryStateProbe />, { route: `${ROUTES.SEARCH}?sort=relevance` });

    // Relevance ranks a term, so with no term the reader repairs it to the query's own default and the address
    // holds no sort at all: the control and the listing are read from the URL, and here they agree.
    await waitFor(() => expect(renderedLocation()).toBe(ROUTES.SEARCH));
    expect(settledInOnePass()).toBe(true);
  });

  it("leaves a canonical address where it stands", async () => {
    const canonical = filtersToPath(
      ROUTES.SEARCH,
      withSort(setQuery(DEFAULT_FILTER_STATE, BRAND.name), "relevance"),
    );
    renderWithProviders(<QueryStateProbe />, { route: canonical });

    await waitFor(() => expect(RENDERED_LOCATIONS.length).toBeGreaterThan(0));

    // Nothing to replace: the address is already the writer's own canonical form for what it renders, so the
    // probe renders it once and no history entry is spent on it.
    expect(renderedLocation()).toBe(canonical);
    expect(RENDERED_LOCATIONS).toEqual([canonical]);
  });

  it("leaves a parameter the catalogue does not own exactly as it stands", async () => {
    const scoped = filtersToPath(ROUTES.CATALOG, {
      ...DEFAULT_FILTER_STATE,
      categoryIds: [AUDIO_CATEGORY_ID],
    });
    const signIn = loginPath(scoped);
    renderWithProviders(<QueryStateProbe />, { route: signIn });

    await waitFor(() => expect(RENDERED_LOCATIONS.length).toBeGreaterThan(0));

    // The sign-in link carries the path the visitor was sent away from in `returnTo`, which the catalogue neither
    // reads nor writes: a replacement composed from the catalogue's own keys alone would drop it.
    expect(renderedLocation()).toBe(signIn);
    expect(RENDERED_LOCATIONS).toEqual([signIn]);
  });
});
