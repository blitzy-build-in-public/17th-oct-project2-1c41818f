/**
 * Path: src/features/home/HomePage.tsx
 * Purpose: Landing route composing the hero, featured-products and category-showcase sections
 * Lines: 299
 */

import type { ReactElement } from "react";

import { Link } from "react-router-dom";

import { RELATED_PRODUCTS_LIMIT } from "@/constants/config";
import { HOME_COPY, PAGE_TITLES, documentTitle } from "@/constants/content";
import { ROUTES } from "@/constants/routes";
import { SORT_OPTIONS } from "@/constants/taxonomy";
import { CategoryShowcase, type CategoryTile } from "@/features/home/CategoryShowcase";
import { FeaturedProducts } from "@/features/home/FeaturedProducts";
import { HeroSection } from "@/features/home/HeroSection";
import { buildFacets, listProducts } from "@/lib/catalogService";
import { useAsync, useDocumentTitle } from "@/state/hooks";
import type { Facet, FacetId, FilterState, Product } from "@/types/catalog";
import type { Result } from "@/types/common";
import { DEFAULT_FILTER_STATE, filtersToPath, toggleFacetValue } from "@/utils/queryParams";

/*
 * Class contract.
 *
 * No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` — so every class
 * below is consumed by name, and this comment is the list the sheets owe this file. `src/styles/layout.css`
 * owns the page: `sp-page` is a route's column of blocks at one rhythm, `sp-page--flush` cancels the application
 * region's opening padding so the hero band meets the header — the one page whose first band is full-bleed —
 * and `sp-container` is the width and gutter the bands below the hero sit in. `sp-stack` is the shared rhythm
 * this file gives the band's two actions.
 *
 * The bands themselves belong to `src/styles/catalog-landing.css`, which owns the landing surface:
 * `sp-hero*` and `sp-trust*` for `HeroSection`, `sp-featured*` for `FeaturedProducts`,
 * `sp-category-showcase` and `sp-category-tiles` for `CategoryShowcase`, and the promotional family this file
 * renders: `sp-promo-banner` and its `__body` and `__action` regions, which from `--breakpoint-md` place the
 * copy and the actions at the ends of one row. `src/styles/controls.css` owns the button family the band's
 * links borrow — `sp-btn` with `sp-btn--primary` and `sp-btn--secondary`, the spelling a file written from the
 * primitives onward uses — and `HeroSection` shows the same pair of a navigating link wearing a button's skin.
 *
 * Two placements are deliberate. The band carries no container of its own: `.sp-promo-banner` sets a vertical
 * padding and a tint and nothing inline, so it renders inside `sp-container` and takes that geometry, while the
 * hero above it is a full-bleed band carrying its own `__inner`. And the two actions sit in the sheet's single
 * `__action` slot inside the shared `sp-stack` rhythm: two inline-flex buttons left in a row would have no gap
 * between them and would run against the band's edge on a narrow phone, whereas the stack spaces them, reflows
 * them as one column and keeps each one's own target.
 *
 * This file renders no `<h1>` and no `<main>`. The page's single level-1 heading is the hero's: the landing route
 * is given a hero where every other route has a page header, and a breadcrumb trail has no parent segment at the
 * root route. The application shell owns the document's one main region.
 */

/**
 * The sort keys the taxonomy declares, derived from its option list rather than restated: a key named below has
 * to be one of the orders `SORT_OPTIONS` pairs with a label, so the strip cannot come to rest at an order the
 * sort control offers no choice for.
 */
type DeclaredSortKey = (typeof SORT_OPTIONS)[number]["value"];

/**
 * The order the featured strip rests at: the taxonomy's most-popular option, read out of `SORT_OPTIONS` rather
 * than written as a free string. A lookup by meaning would have to name the key anyway — the option list pairs
 * each key with a label and carries nothing else to match on — so the key is named once, against
 * {@link DeclaredSortKey}. The service orders that key by review count, the catalogue's only popularity signal,
 * and falls back to the average rating and then the identifier, so the strip is identical in every run.
 */
const FEATURED_SORT: DeclaredSortKey = "popularity";

/**
 * The catalogue listing the featured strip is drawn from: the canonical empty selection — no term, no facet, no
 * bound — put in {@link FEATURED_SORT}'s order. The paging fields keep the state's own defaults, because the
 * endpoint pages with the configured sizes only and `src/utils/queryParams.ts` normalises a size outside that
 * set back to the default.
 */
const FEATURED_FILTER: FilterState = { ...DEFAULT_FILTER_STATE, sort: FEATURED_SORT };

/**
 * The unfiltered catalogue URL this page offers. It is composed through `src/utils/queryParams.ts`, the only
 * module that writes a filter URL, so the showcase's empty state, the band's primary action and the featured
 * strip's own view-all link all name the same listing without any of them holding a path of its own.
 */
const CATALOGUE_PATH = filtersToPath(ROUTES.CATALOG, DEFAULT_FILTER_STATE);

/**
 * The products handed to the strip before the read answers and after one that found nothing to feature. Shared
 * rather than allocated per render, so a band re-rendering while the read is still in flight passes the same
 * reference it passed before.
 */
const NO_PRODUCTS: readonly Product[] = [];

/** The tiles handed to the showcase in those same two cases, shared for the same reason. */
const NO_TILES: readonly CategoryTile[] = [];

/**
 * The facet the showcase reads: the categories the catalogue counts, as `FacetId` names them. Each value's label
 * and count are the facet's own and pass through untouched — no total is assembled from child categories and no
 * value is re-ranked — and the destination applies the category through the same accessor the filter panel uses,
 * so a tile lands on exactly the listing the corresponding filter would produce.
 */
const CATEGORY_FACET_ID: FacetId = "category";

/**
 * Names the promotional band. The section points at it through `aria-labelledby`, so the landmark's accessible
 * name is the copy module's own headline rather than a string invented for it — the shape the page's other three
 * bands set. The headline is a level-2 heading, following the hero's level 1 and sitting beside the featured and
 * showcase bands without skipping a level.
 */
const PROMO_HEADING_ID = "promo-heading";

/** One action the band offers: where it goes, what it says and which variant of the button family it wears. */
interface PromoAction {
  /** Stable key for the link, so the band's markup is one map over data rather than two blocks of it. */
  readonly id: string;
  /** The route the action navigates to, taken from `ROUTES` — never written as a path here. */
  readonly to: string;
  /** The action's accessible name, which is its visible label, taken from the copy module. */
  readonly label: string;
  /** The variant of the shared button family: the band's one primary action, and the route beside it. */
  readonly variant: "primary" | "secondary";
}

/**
 * The two entry points the band carries, in reading order: the catalogue, which is what the band's copy invites
 * the visitor to start doing, and the search route, so a visitor who came for one product can go and look for it.
 * The third entry point the landing route offers is the cart, which the header's badge holds on every route, so
 * the band does not repeat it.
 *
 * Both are `Link`s rather than buttons: they navigate, so they keep a link's semantics, a middle click and an
 * open-in-a-new-tab behaviour, and borrow the button family for their look. Both labels are the copy module's —
 * the band's own action label, and the home copy's search-action label, which is the wording for exactly this
 * destination.
 */
const PROMO_ACTIONS: readonly PromoAction[] = [
  {
    id: "catalogue",
    to: ROUTES.CATALOG,
    label: HOME_COPY.PROMO_ACTION_LABEL,
    variant: "primary",
  },
  {
    id: "search",
    to: ROUTES.SEARCH,
    label: HOME_COPY.HERO_SECONDARY_ACTION_LABEL,
    variant: "secondary",
  },
];

/**
 * Everything the landing route renders once its read answers.
 *
 * The strip's products are a page of the catalogue and the showcase's tiles are the category facet's own values,
 * so neither band has to fetch, count or format anything: they render the state they are handed.
 */
interface HomeContent {
  /** The products to feature, in the order the catalogue returned them, already cut to the strip's length. */
  readonly featuredProducts: readonly Product[];
  /** One tile per category the catalogue counts, in the facet's own order. */
  readonly categoryTiles: readonly CategoryTile[];
}

/**
 * The showcase's tiles, read out of the category facet's own values.
 *
 * The label and the count are passed through exactly as the facet reports them, in the facet's order: a category
 * the catalogue holds nothing in keeps its place with a count of zero, a parent category is never given a total
 * assembled from its children, and nothing is sliced or re-ranked. Only the target is composed here, and it is
 * composed through the URL writer with the category applied by the shared facet accessor, so a tile and the
 * filter panel's own control for that category produce one URL. A response carrying no category facet, and a
 * facet carrying no values, both yield no tiles, which the band renders as its empty state.
 *
 * @param facets - The facets the read returned.
 * @returns One tile per category value, or an empty list when the response names none.
 */
function categoryTilesFrom(facets: readonly Facet[]): readonly CategoryTile[] {
  const categoryFacet = facets.find((facet) => facet.id === CATEGORY_FACET_ID);
  if (categoryFacet === undefined) return NO_TILES;
  return categoryFacet.values.map((value) => ({
    label: value.label,
    count: value.count,
    to: filtersToPath(
      ROUTES.CATALOG,
      toggleFacetValue(DEFAULT_FILTER_STATE, CATEGORY_FACET_ID, value.value),
    ),
  }));
}

/**
 * The slice's single read: the featured listing first, then the facets the showcase counts.
 *
 * The two requests run in sequence rather than together, because a view keeps one catalogue request in flight at
 * a time, and the first failure is returned unchanged — a seam that answered nothing is reported once, by the
 * read that met it, rather than being turned into a second request that fails the same way. The signal travels
 * into both, so a navigation away from the route cancels whichever request is outstanding.
 *
 * The strip is cut to `RELATED_PRODUCTS_LIMIT`, the configured small-count literal nearest this use: the plan
 * declares no home-specific strip length, `src/constants/config.ts` owns every configured number, and the
 * endpoint accepts only the configured page sizes — so the request is paged at the state's default size and the
 * page keeps its leading products, which is a choice about what to display rather than a figure computed here.
 *
 * @param signal - The abort signal of the read, forwarded into both requests.
 * @returns The strip's products and the showcase's tiles, or the shaped failure; never a rejection.
 */
async function loadHomeContent(signal: AbortSignal): Promise<Result<HomeContent>> {
  const listing = await listProducts(FEATURED_FILTER, { signal });
  if (!listing.ok) return listing;

  // The showcase counts the whole catalogue — every category, with the number of products inside it — so its
  // facets are asked for with the canonical empty selection, whose sort and paging a facet request ignores.
  const facets = await buildFacets(DEFAULT_FILTER_STATE, { signal });
  if (!facets.ok) return facets;

  return {
    ok: true,
    value: {
      featuredProducts: listing.value.items.slice(0, RELATED_PRODUCTS_LIMIT),
      categoryTiles: categoryTilesFrom(facets.value),
    },
  };
}

/**
 * The promotional band: what the free-delivery rule means for the visitor's basket, and the entry points that
 * let them act on it.
 *
 * It is static copy with no state of its own, which is what lets the landing route render it whether the
 * catalogue read has answered, failed or is still in flight: a visitor whose requests are slow still finds the
 * page's invitation and a way into the catalogue. The rule is stated in the cart summary's own terms — the
 * threshold is that panel's figure, formatted there — so no amount is computed or rendered here, and the band's
 * links are mapped from {@link PROMO_ACTIONS} so its markup is one expression rather than repeated blocks.
 *
 * @returns The band's section landmark.
 */
function PromoBanner(): ReactElement {
  return (
    <section className="sp-promo-banner" aria-labelledby={PROMO_HEADING_ID}>
      <div className="sp-promo-banner__body">
        <h2 id={PROMO_HEADING_ID}>{HOME_COPY.PROMO_HEADING}</h2>
        <p>{HOME_COPY.PROMO_BODY}</p>
      </div>
      <div className="sp-promo-banner__action sp-stack">
        {PROMO_ACTIONS.map((action) => (
          <Link className={`sp-btn sp-btn--${action.variant}`} key={action.id} to={action.to}>
            {action.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * The landing route: the hero, the featured strip, the category showcase and the promotional band.
 *
 * It owns the slice's single read. The catalogue's requests are capped at one in flight per view, so the two
 * bands that show catalogue data are fed by one loader rather than by a request each, and both are handed that
 * read's status, payload and failure: this component derives no state of its own, mirrors nothing into React
 * state and runs no effect beyond the read, so a filter, a count or a total has exactly one home in
 * `src/lib/catalogService.ts`.
 *
 * The hero renders in every state, because it is static copy, so the route never blanks: a slow read shows the
 * two bands' placeholders under a complete hero, and a failed read shows the shaped failure with a retry in each
 * band, which is the hook's own `reload` re-running the whole read. The page is a column of labelled blocks
 * inside the shell's main region — this file starts no main region and declares no level-1 heading — and the
 * route's title comes from the copy module so no page writes the product name into its own.
 *
 * @returns The landing route's blocks.
 */
export function HomePage(): ReactElement {
  const homeRead = useAsync(loadHomeContent, []);

  useDocumentTitle(documentTitle(PAGE_TITLES.HOME));

  return (
    <div className="sp-page sp-page--flush">
      <HeroSection />
      {/* The hero is a full-bleed band with its own inner, so the bands below it take the shared container and
          the route's rhythm from a nested page column: one geometry rule for the width, one gap between blocks. */}
      <div className="sp-container">
        <div className="sp-page">
          <FeaturedProducts
            status={homeRead.status}
            products={homeRead.data?.featuredProducts ?? NO_PRODUCTS}
            error={homeRead.error}
            onRetry={homeRead.reload}
          />
          <CategoryShowcase
            status={homeRead.status}
            tiles={homeRead.data?.categoryTiles ?? NO_TILES}
            error={homeRead.error}
            onRetry={homeRead.reload}
            browseAllTo={CATALOGUE_PATH}
          />
          <PromoBanner />
        </div>
      </div>
    </div>
  );
}
