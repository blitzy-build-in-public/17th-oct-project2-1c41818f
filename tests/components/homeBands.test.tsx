/**
 * Path: tests/components/homeBands.test.tsx
 * Purpose: The landing route's two data bands and the read that feeds them: every state each band renders, the strip's focus behaviour, and the route's own failure and recovery
 * Lines: 594
 */

import { describe, expect, it, vi } from "vitest";

import { CategoryShowcase } from "@/features/home/CategoryShowcase";
import type { CategoryTile } from "@/features/home/CategoryShowcase";
import { FeaturedProducts } from "@/features/home/FeaturedProducts";
import { CATEGORY_TILES } from "@/data/categories";
import type { Product } from "@/types/catalog";
import { categoryId } from "@/utils/strings";

import { makeApiError } from "../fixtures";
import {
  A11Y_COPY,
  CATEGORY_DEFINITIONS,
  COMMON_ACTIONS,
  DEFAULT_FILTER_STATE,
  EMPTY_STATES,
  FEEDBACK_COPY,
  HOME_COPY,
  PRODUCTS,
  RELATED_PRODUCTS_LIMIT,
  ROUTES,
  failNext,
  filtersToPath,
  headingNamed,
  isolateJourneyCases,
  productCountLabel,
  productNamed,
  productPath,
  renderApp,
  screen,
  textOf,
  toggleFacetValue,
  waitFor,
  within,
} from "../helpers/journeyHarness";
import { renderWithProviders } from "../testUtils";

/*
 * The landing route's two data bands read from the outside, at the states the route's own happy path never
 * reaches: `renderWithProviders` mounts `FeaturedProducts` and `CategoryShowcase` on their own, which is what
 * the components are — presentational, total, fetching nothing — so the placeholder, the empty state and the
 * failure are reached by the props the route hands them, while the route itself is driven through `renderApp`
 * at `ROUTES.HOME` with the seam's own failure switch. Every page in this file is the product's: the copy
 * module owns every sentence, the taxonomy and the seeded catalogue own every label and figure, and the URL
 * writer owns every destination. No assertion reads a class name, a computed style or an internal.
 *
 * The three focus cases at the end of the first block are the one place this environment lays nothing out:
 * jsdom gives every element a zero-sized box and no horizontal overflow, so the strip's own scrollport and the
 * two boxes the focus handler compares are supplied by the case, and what is asserted is the request the
 * handler makes of them. `tests/components/focusHandoff.test.tsx` states the same rule for the region it
 * aligns; here the subject is the tile the strip brings fully into view.
 */

// The case's inputs ---------------------------------------------------------------------------------

/** The products the strip is handed: the seeded catalogue's leading records, in its own order. */
const FEATURED_PRODUCTS: readonly Product[] = PRODUCTS.slice(0, RELATED_PRODUCTS_LIMIT);

/** The reload a band is handed where the case does not press it. */
const NO_RETRY = (): void => undefined;

/** The failure a band is handed where the case asserts the shaped message rather than the neutral one. */
const FAILURE = makeApiError({ status: 503, code: "data-source-unavailable" });

/** The catalogue target a parent composes through the URL writer, as `HomePage` composes its own. */
const CATALOGUE_PATH = filtersToPath(ROUTES.CATALOG, DEFAULT_FILTER_STATE);

/** The two route ids the landing route's read asks, one request per band's data. */
const LISTING_ROUTE_ID = "products.list";
const FACETS_ROUTE_ID = "facets.list";

/** The seam's own simulated latency, and the value the suite runs every read at. */
const LATENCY_VARIABLE = "VITE_API_LATENCY_MS";
const HELD_ANSWER_LATENCY_MS = "1000";
const SUITE_API_LATENCY_MS = "0";

/** How wide the case says the strip is, and how far the tile inside it runs past that edge. */
const STRIP_WIDTH_PX = 400;
const TILE_START_PX = STRIP_WIDTH_PX - 100;

// Reading the rendered bands ------------------------------------------------------------------------

/** The section a band renders, which carries its own heading as its accessible name in every state. */
function band(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

/** The band's strip: the list the tiles are the direct children of. */
function strip(name: string): HTMLElement {
  return within(band(name)).getByRole("list");
}

/** One tile of a band, as the element the sheet lays out: the list item its own heading sits in. */
function tileAt(name: string, index: number): HTMLElement {
  const heading = within(band(name)).getAllByRole("heading", { level: 3 })[index];
  const tile = heading?.closest<HTMLElement>("li") ?? null;
  if (tile === null) throw new Error(`The band named "${name}" rendered no tile at ${index}.`);
  return tile;
}

/** A box in the fields the focus handler compares, which jsdom reports as zero-sized for every element. */
function box(leftPx: number, rightPx: number): DOMRect {
  return {
    x: leftPx,
    y: 0,
    width: rightPx - leftPx,
    height: 0,
    top: 0,
    right: rightPx,
    bottom: 0,
    left: leftPx,
    toJSON: (): unknown => ({}),
  };
}

/** How many products the seeded catalogue holds in one category, read from the records themselves. */
function productsIn(slug: string): number {
  return PRODUCTS.filter((product) => product.categoryId === categoryId(slug)).length;
}

/**
 * The catalogue target one showcase tile leads to: the listing scoped to that category through the URL
 * writer's own facet accessor, which is the URL the filter panel's control for it writes. The value is the
 * category's identifier — the term the category facet counts it under — rather than the slug its route names.
 */
function categoryListingPath(slug: string): string {
  return filtersToPath(
    ROUTES.CATALOG,
    toggleFacetValue(DEFAULT_FILTER_STATE, "category", categoryId(slug)),
  );
}

/** The tiles the showcase is handed where the case needs content: the seeded categories that hold products,
 *  each wearing the artwork the category tree serves for it — the same `data:image/svg+xml` URI the page's own
 *  join pairs with the value, read here from its one home. */
const SHOWCASE_TILES: readonly CategoryTile[] = CATEGORY_DEFINITIONS.filter(
  (category) => productsIn(category.slug) > 0,
)
  .slice(0, 3)
  .map((category) => ({
    label: category.name,
    count: productsIn(category.slug),
    image: CATEGORY_TILES[categoryId(category.slug)],
    to: categoryListingPath(category.slug),
  }));

// The featured-products band on its own -------------------------------------------------------------

describe("the featured-products band's own states", () => {
  it.each(["idle", "loading"] as const)(
    "holds the strip's shape, and says nothing about it, while the read is %s",
    async (status) => {
      renderWithProviders(
        <FeaturedProducts status={status} products={[]} error={null} onRetry={NO_RETRY} />,
      );

      const featured = await screen.findByRole("region", { name: HOME_COPY.FEATURED_TITLE });
      // The band states the read it is waiting on, and draws no tile and no way into the catalogue behind it.
      expect(featured).toHaveAttribute("aria-busy", "true");
      expect(within(featured).getByText(HOME_COPY.FEATURED_SUBTITLE)).toBeInTheDocument();
      expect(within(featured).queryAllByRole("heading", { level: 3 })).toHaveLength(0);
      expect(
        within(featured).queryByRole("link", { name: HOME_COPY.FEATURED_VIEW_ALL_LABEL }),
      ).toBeNull();
    },
  );

  it("renders one tile per product it is handed, each linking to that product's own page", async () => {
    renderWithProviders(
      <FeaturedProducts
        status="success"
        products={FEATURED_PRODUCTS}
        error={null}
        onRetry={NO_RETRY}
      />,
    );

    const featured = await screen.findByRole("region", { name: HOME_COPY.FEATURED_TITLE });
    const tiles = within(featured).getAllByRole("heading", { level: 3 });
    expect(tiles).toHaveLength(FEATURED_PRODUCTS.length);
    for (const heading of tiles) {
      const product = productNamed(textOf(heading));
      expect(within(heading).getByRole("link")).toHaveAttribute("href", productPath(product.slug));
    }
    // The way into the catalogue appears with the tiles, and the band is no longer reading.
    expect(
      within(featured).getByRole("link", { name: HOME_COPY.FEATURED_VIEW_ALL_LABEL }),
    ).toHaveAttribute("href", ROUTES.CATALOG);
    expect(featured).toHaveAttribute("aria-busy", "false");
    expect(strip(HOME_COPY.FEATURED_TITLE)).toBeInTheDocument();
  });

  it("offers the catalogue as the one way out when the read found nothing to feature", async () => {
    renderWithProviders(
      <FeaturedProducts status="success" products={[]} error={null} onRetry={NO_RETRY} />,
    );

    const featured = await screen.findByRole("region", { name: HOME_COPY.FEATURED_TITLE });
    expect(await headingNamed(EMPTY_STATES.catalogue.title, 3)).toBeInTheDocument();
    expect(within(featured).getByText(EMPTY_STATES.catalogue.description)).toBeInTheDocument();
    // One control, because the state's own action and the band's view-all are the same destination.
    expect(within(featured).getAllByRole("link")).toHaveLength(1);
    expect(
      within(featured).getByRole("link", { name: HOME_COPY.FEATURED_VIEW_ALL_LABEL }),
    ).toHaveAttribute("href", ROUTES.CATALOG);
  });

  it.each([
    { failure: "the failure's own message", error: FAILURE, stated: FAILURE.message, titled: true },
    {
      failure: "the neutral sentence where no failure is in hand",
      error: null,
      stated: FEEDBACK_COPY.ERROR_STATE_BODY,
      titled: false,
    },
  ])("reports $failure with a retry the band's parent owns", async ({ error, stated, titled }) => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(
      <FeaturedProducts status="error" products={[]} error={error} onRetry={onRetry} />,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(stated);
    // A failure the seam shaped is headed by the error state's own title; the defensive render, with no failure
    // to read, states the library's neutral sentence without a headline over it.
    if (titled) expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_TITLE);
    else expect(within(alert).queryByText(FEEDBACK_COPY.ERROR_STATE_TITLE)).toBeNull();

    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// The strip's own focus behaviour, at the layout the case supplies ---------------------------------

describe("the featured strip's focus behaviour", () => {
  it("asks for no scroll while the strip holds every tile it is showing", async () => {
    const { user } = renderWithProviders(
      <FeaturedProducts
        status="success"
        products={FEATURED_PRODUCTS}
        error={null}
        onRetry={NO_RETRY}
      />,
    );
    const tile = tileAt(HOME_COPY.FEATURED_TITLE, 0);
    const scrollIntoView = vi.fn();
    tile.scrollIntoView = scrollIntoView;

    // The band's own tab order: the view-all link, then the first tile's own link.
    await user.tab();
    await user.tab();

    expect(tile.contains(document.activeElement)).toBe(true);
    // The strip reports no horizontal overflow here, which is also every tile's state from the medium stop up,
    // so the tile the focus reached asks for nothing.
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("brings a tile the strip shows only partly fully into it when that tile takes focus", async () => {
    const { user } = renderWithProviders(
      <FeaturedProducts
        status="success"
        products={FEATURED_PRODUCTS}
        error={null}
        onRetry={NO_RETRY}
      />,
    );
    const list = strip(HOME_COPY.FEATURED_TITLE);
    const tile = tileAt(HOME_COPY.FEATURED_TITLE, 0);
    const scrollIntoView = vi.fn();
    // jsdom lays nothing out, so the scrollport and the two boxes the handler compares are the case's: a strip
    // this wide, holding a tile that starts inside its right edge and runs past it.
    Object.defineProperty(list, "scrollWidth", { value: STRIP_WIDTH_PX * 4, configurable: true });
    Object.defineProperty(list, "clientWidth", { value: STRIP_WIDTH_PX, configurable: true });
    list.getBoundingClientRect = (): DOMRect => box(0, STRIP_WIDTH_PX);
    tile.getBoundingClientRect = (): DOMRect => box(TILE_START_PX, TILE_START_PX + STRIP_WIDTH_PX);
    tile.scrollIntoView = scrollIntoView;

    await user.tab();
    await user.tab();

    // The tile is the box the strip clips, so it is the tile the scroll is asked for, at the alignment its own
    // `scroll-snap-align` rests at.
    expect(tile.contains(document.activeElement)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "start" });
  });

  it("asks for no scroll when the tile it reached already sits wholly inside the overflowing strip", async () => {
    const { user } = renderWithProviders(
      <FeaturedProducts
        status="success"
        products={FEATURED_PRODUCTS}
        error={null}
        onRetry={NO_RETRY}
      />,
    );
    const list = strip(HOME_COPY.FEATURED_TITLE);
    const tile = tileAt(HOME_COPY.FEATURED_TITLE, 0);
    const scrollIntoView = vi.fn();
    // The strip overflows, but the tile the focus reached lies between its two edges, so the tile is already
    // where a reader is looking and moving it would be motion with no work to do.
    Object.defineProperty(list, "scrollWidth", { value: STRIP_WIDTH_PX * 4, configurable: true });
    Object.defineProperty(list, "clientWidth", { value: STRIP_WIDTH_PX, configurable: true });
    list.getBoundingClientRect = (): DOMRect => box(0, STRIP_WIDTH_PX);
    tile.getBoundingClientRect = (): DOMRect => box(0, STRIP_WIDTH_PX / 2);
    tile.scrollIntoView = scrollIntoView;

    await user.tab();
    await user.tab();

    expect(tile.contains(document.activeElement)).toBe(true);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

// The category showcase on its own -----------------------------------------------------------------

describe("the category showcase's own states", () => {
  it.each(["idle", "loading"] as const)(
    "holds the tile grid's shape, and says nothing about it, while the read is %s",
    async (status) => {
      renderWithProviders(
        <CategoryShowcase
          status={status}
          tiles={[]}
          error={null}
          onRetry={NO_RETRY}
          browseAllTo={CATALOGUE_PATH}
        />,
      );

      const showcase = await screen.findByRole("region", { name: HOME_COPY.SHOWCASE_TITLE });
      expect(showcase).toHaveAttribute("aria-busy", "true");
      expect(within(showcase).getByText(HOME_COPY.SHOWCASE_SUBTITLE)).toBeInTheDocument();
      expect(within(showcase).queryAllByRole("listitem")).toHaveLength(0);
    },
  );

  it("renders a tile per category, naming it and counting the products inside it", async () => {
    renderWithProviders(
      <CategoryShowcase
        status="success"
        tiles={SHOWCASE_TILES}
        error={null}
        onRetry={NO_RETRY}
        browseAllTo={CATALOGUE_PATH}
      />,
    );

    const showcase = await screen.findByRole("region", { name: HOME_COPY.SHOWCASE_TITLE });
    const tiles = within(showcase).getAllByRole("listitem");
    expect(tiles).toHaveLength(SHOWCASE_TILES.length);
    SHOWCASE_TILES.forEach((tile, index) => {
      const rendered = tiles[index];
      expect(within(rendered).getByRole("heading", { level: 3 })).toHaveTextContent(tile.label);
      // The count is the figure the band was handed, in the copy library's own wording.
      expect(within(rendered).getByText(productCountLabel(tile.count))).toBeInTheDocument();
      // The tile is one link into the listing the parent scoped to that category.
      expect(within(rendered).getByRole("link")).toHaveAttribute("href", tile.to);
      // The artwork is the tile builder's own URI, painted inside the frame the sheet sizes and asking for
      // no file: the picture is decorative, so it carries no accessible name of its own.
      expect(rendered.querySelector("img")).toHaveAttribute("src", tile.image);
    });
    expect(showcase).toHaveAttribute("aria-busy", "false");
  });

  it("renders a tile the join left without artwork as no picture at all", async () => {
    const [first] = SHOWCASE_TILES;
    renderWithProviders(
      <CategoryShowcase
        status="success"
        tiles={[{ ...first, image: "" }]}
        error={null}
        onRetry={NO_RETRY}
        browseAllTo={CATALOGUE_PATH}
      />,
    );

    const showcase = await screen.findByRole("region", { name: HOME_COPY.SHOWCASE_TITLE });
    const [tile] = within(showcase).getAllByRole("listitem");
    // An empty source would be a request for the document itself rather than a decorative picture, so the
    // tile draws no image box and keeps everything else it carries.
    expect(tile.querySelector("img")).toBeNull();
    expect(within(tile).getByRole("heading", { level: 3 })).toHaveTextContent(first.label);
    expect(within(tile).getByText(productCountLabel(first.count))).toBeInTheDocument();
    expect(within(tile).getByRole("link")).toHaveAttribute("href", first.to);
  });

  it.each([
    {
      wiring: "the catalogue target the parent composed",
      browseAllTo: CATALOGUE_PATH,
      controlName: HOME_COPY.FEATURED_VIEW_ALL_LABEL,
      controlRole: "link" as const,
    },
    {
      wiring: "the reload the parent owns when no target is given",
      browseAllTo: undefined,
      controlName: COMMON_ACTIONS.RETRY,
      controlRole: "button" as const,
    },
  ])(
    "offers $wiring as the empty band's single control",
    async ({ browseAllTo, controlName, controlRole }) => {
      const onRetry = vi.fn();
      const { user } = renderWithProviders(
        <CategoryShowcase
          status="success"
          tiles={[]}
          error={null}
          onRetry={onRetry}
          browseAllTo={browseAllTo}
        />,
      );

      const showcase = await screen.findByRole("region", { name: HOME_COPY.SHOWCASE_TITLE });
      expect(await headingNamed(EMPTY_STATES.catalogue.title, 3)).toBeInTheDocument();
      expect(within(showcase).getByText(EMPTY_STATES.catalogue.description)).toBeInTheDocument();
      expect(within(showcase).getAllByRole(controlRole)).toHaveLength(1);
      const control = within(showcase).getByRole(controlRole, { name: controlName });

      if (controlRole === "link") {
        expect(control).toHaveAttribute("href", CATALOGUE_PATH);
        return;
      }
      await user.click(control);
      expect(onRetry).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { failure: "the failure's own message", error: FAILURE, stated: FAILURE.message, titled: true },
    {
      failure: "the neutral sentence where no failure is in hand",
      error: null,
      stated: FEEDBACK_COPY.ERROR_STATE_BODY,
      titled: false,
    },
  ])("reports $failure with a retry the band's parent owns", async ({ error, stated, titled }) => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(
      <CategoryShowcase
        status="error"
        tiles={[]}
        error={error}
        onRetry={onRetry}
        browseAllTo={CATALOGUE_PATH}
      />,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(stated);
    if (titled) expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_TITLE);
    else expect(within(alert).queryByText(FEEDBACK_COPY.ERROR_STATE_TITLE)).toBeNull();
    expect(within(band(HOME_COPY.SHOWCASE_TITLE)).queryAllByRole("listitem")).toHaveLength(0);

    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// The landing route that feeds both bands -----------------------------------------------------------

describe("the landing route's own read", () => {
  isolateJourneyCases();

  it("feeds both bands from one read, and offers the catalogue from the promo band's actions", async () => {
    renderApp({ route: ROUTES.HOME });

    const featured = await screen.findByRole("region", { name: HOME_COPY.FEATURED_TITLE });
    const stripTiles = await within(featured).findAllByRole("heading", { level: 3 });
    expect(stripTiles.length).toBeGreaterThan(0);
    expect(stripTiles.length).toBeLessThanOrEqual(RELATED_PRODUCTS_LIMIT);
    expect(
      within(featured).getByRole("link", { name: HOME_COPY.FEATURED_VIEW_ALL_LABEL }),
    ).toHaveAttribute("href", ROUTES.CATALOG);

    // The promotional band is static copy, so its two actions are on the page in every state of the read.
    const promo = band(HOME_COPY.PROMO_HEADING);
    expect(within(promo).getByText(HOME_COPY.PROMO_BODY)).toBeInTheDocument();
    expect(within(promo).getByRole("link", { name: HOME_COPY.PROMO_ACTION_LABEL })).toHaveAttribute(
      "href",
      ROUTES.CATALOG,
    );
    expect(
      within(promo).getByRole("link", { name: HOME_COPY.HERO_SECONDARY_ACTION_LABEL }),
    ).toHaveAttribute("href", ROUTES.SEARCH);

    // The showcase's tiles count the category facet's own values, and each one leads to the listing scoped to
    // that category — the URL the filter panel's own control for it writes.
    const showcase = await screen.findByRole("region", { name: HOME_COPY.SHOWCASE_TITLE });
    const tile = within(showcase).getAllByRole("listitem")[0];
    const label = textOf(within(tile).getByRole("heading", { level: 3 }));
    const category = CATEGORY_DEFINITIONS.find((candidate) => candidate.name === label);
    if (category === undefined) throw new Error(`No seeded category is named "${label}".`);
    expect(within(tile).getByRole("link")).toHaveAttribute(
      "href",
      categoryListingPath(category.slug),
    );
  });

  it("holds both bands' shape, and states the page's load once, while the read is in flight", async () => {
    vi.stubEnv(LATENCY_VARIABLE, HELD_ANSWER_LATENCY_MS);
    try {
      renderApp({ route: ROUTES.HOME });

      // The route's own placeholder carries the same announcement while its screen's chunk is fetched, so the
      // case waits for the band the chunk resolves into before it measures the page's read.
      const featured = await screen.findByRole("region", { name: HOME_COPY.FEATURED_TITLE });

      // One live region covers the page's whole load, because the placeholders themselves announce nothing.
      expect(await screen.findByText(A11Y_COPY.LOADING_ANNOUNCEMENT)).toBeInTheDocument();
      expect(featured).toHaveAttribute("aria-busy", "true");
      expect(band(HOME_COPY.SHOWCASE_TITLE)).toHaveAttribute("aria-busy", "true");
      expect(within(featured).queryAllByRole("heading", { level: 3 })).toHaveLength(0);
      expect(within(band(HOME_COPY.SHOWCASE_TITLE)).queryAllByRole("listitem")).toHaveLength(0);
    } finally {
      vi.stubEnv(LATENCY_VARIABLE, SUITE_API_LATENCY_MS);
    }

    // The held answer lands, so the placeholders give way to the tiles the same read produced.
    const settled = await within(band(HOME_COPY.FEATURED_TITLE)).findAllByRole("heading", {
      level: 3,
    });
    expect(settled.length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText(A11Y_COPY.LOADING_ANNOUNCEMENT)).toBeNull());
  });

  it("reports a failed catalogue read in both bands, and recovers on a band's own retry", async () => {
    // The landing route's read and the catalogue provider's own mount read ask the same endpoint, so both are
    // armed: whichever of them arrives first is the one answered with the failure the bands report.
    const arms = [failNext({ routeId: LISTING_ROUTE_ID }), failNext({ routeId: LISTING_ROUTE_ID })];
    const { user } = renderApp({ route: ROUTES.HOME });

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(2);
    for (const alert of alerts) {
      expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_TITLE);
      expect(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY })).toBeInTheDocument();
    }
    // Neither band invents content behind the failure.
    expect(
      within(band(HOME_COPY.FEATURED_TITLE)).queryAllByRole("heading", { level: 3 }),
    ).toHaveLength(0);
    expect(within(band(HOME_COPY.SHOWCASE_TITLE)).queryAllByRole("listitem")).toHaveLength(0);

    for (const arm of arms) arm.disarm();
    await user.click(within(alerts[0]).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    // The band's retry re-runs the route's whole read, so both bands recover from the one action.
    await waitFor(() =>
      expect(
        within(band(HOME_COPY.FEATURED_TITLE)).getAllByRole("heading", { level: 3 }).length,
      ).toBeGreaterThan(0),
    );
    expect(within(band(HOME_COPY.SHOWCASE_TITLE)).getAllByRole("listitem").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("reports a failure while counting the categories, and recovers on the showcase's own retry", async () => {
    // The route's second request is the one that fails here: the showcase's data never arrives, so the failure
    // the first read met is the whole read's, and both bands report it.
    const arms = [failNext({ routeId: FACETS_ROUTE_ID }), failNext({ routeId: FACETS_ROUTE_ID })];
    const { user } = renderApp({ route: ROUTES.HOME });

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(within(band(HOME_COPY.SHOWCASE_TITLE)).getAllByRole("alert")).toHaveLength(1);

    for (const arm of arms) arm.disarm();
    // The showcase's own band is the second section on the page, and its retry is the one this case presses.
    await user.click(within(alerts[1]).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    await waitFor(() =>
      expect(
        within(band(HOME_COPY.SHOWCASE_TITLE)).getAllByRole("listitem").length,
      ).toBeGreaterThan(0),
    );
    expect(
      within(band(HOME_COPY.FEATURED_TITLE)).getAllByRole("heading", { level: 3 }).length,
    ).toBeGreaterThan(0);
  });
});
