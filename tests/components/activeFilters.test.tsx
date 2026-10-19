/**
 * Path: tests/components/activeFilters.test.tsx
 * Purpose: The applied-filter chip row: what each applied filter's chip reads as, what removing it writes, the cap and reveal a caller can ask for, and the row's absence when nothing is applied
 * Lines: 386
 */

import { describe, expect, it, vi } from "vitest";

import { FACET_DEFINITIONS } from "@/constants/taxonomy";
import type { FacetDefinition, FacetDefinitionOption } from "@/constants/taxonomy";
import { ActiveFilters } from "@/features/search/ActiveFilters";
import type { FilterState } from "@/types/catalog";
import type { MinorUnits } from "@/types/common";
import { formatMoney } from "@/utils/format";
import type { ActiveFilterEntry } from "@/utils/queryParams";
import { setFacetValues, setPriceRange, toggleTag } from "@/utils/queryParams";
import { categoryId } from "@/utils/strings";

import {
  CATEGORY_DEFINITIONS,
  COMMON_ACTIONS,
  DEFAULT_FILTER_STATE,
  OTHER_BRAND,
  PRODUCTS,
  ROUTES,
  SEARCH_COPY,
  SELECTED_BRAND,
  filtersToPath,
  isolateJourneyCases,
  removeFilterLabel,
  renderApp,
  screen,
  toggleFacetValue,
  waitFor,
  within,
} from "../helpers/journeyHarness";
import { renderWithProviders } from "../testUtils";

/*
 * The chip row read where a shopper meets it: the search route's own chips, which are the address's applied
 * filters and nothing else, and the row a caller renders on its own with the entries, the cap and the callbacks
 * it hands over. Every address is written through `src/utils/queryParams.ts`'s own writers — the module the page
 * reads it back with — so a case states the query a bookmark could carry rather than typing into a control whose
 * value could drift.
 *
 * Each chip's text is the product's own: a term facet's wording is resolved from the loaded facets, a rating or
 * availability band's wording comes from the taxonomy the filter panel also reads, a price range's money is
 * formatted by `src/utils/format.ts`, and a tag is the tag. No assertion here reads a class name, a computed
 * style or an internal.
 */

// The case's inputs ---------------------------------------------------------------------------------

/** A seeded category that holds products, which is the one a chip's label is resolved against. */
const CATEGORY =
  CATEGORY_DEFINITIONS.find((candidate) =>
    PRODUCTS.some((product) => product.categoryId === categoryId(candidate.slug)),
  ) ?? CATEGORY_DEFINITIONS[0];

/** That category's identifier: the term the category facet counts and the address carries in its own place. */
const CATEGORY_ID = categoryId(CATEGORY.slug);

/** A tag the address applies, which no facet declares: a tag is only ever its own wording. */
const TAG = "clearance";

/** One declared band or term of a facet, as the panel's control and the chip's own text both read it. */
function declaredOption(facetId: string, index = 0): FacetDefinitionOption {
  const definition: FacetDefinition | undefined = FACET_DEFINITIONS.find(
    (candidate) => candidate.id === facetId,
  );
  const option = definition?.options?.[index];
  if (option === undefined) {
    throw new Error(`The taxonomy declares no option ${index} for the ${facetId} facet.`);
  }
  return option;
}

/** Every price band the taxonomy declares, which is what tells one of its ranges from a range it does not name. */
function declaredPriceBands(): readonly FacetDefinitionOption[] {
  const definition: FacetDefinition | undefined = FACET_DEFINITIONS.find(
    (candidate) => candidate.id === "price",
  );
  return definition?.options ?? [];
}

/** The seeded catalogue's own price extremes, which bound a range no declared band names. */
const PRICE_EXTREMES = ((): { readonly minMinor: MinorUnits; readonly maxMinor: MinorUnits } => {
  const prices = PRODUCTS.map((product) => product.priceMinor);
  const minMinor = Math.min(...prices);
  const maxMinor = Math.max(...prices);
  const band = declaredPriceBands().find(
    (option) => (option.minMinor ?? null) === minMinor && (option.maxMinor ?? null) === maxMinor,
  );
  if (band !== undefined) {
    throw new Error(
      "The seeded prices span a declared band, so there is no custom range to state.",
    );
  }
  return { minMinor, maxMinor };
})();

/** What a price chip writes between its bounds, as the row's own formatter does. */
const BOUNDS_SEPARATOR = " \u2013 ";

/** The money a price chip states for a range whose band the vocabulary does not name. */
function boundsText(minMinor: MinorUnits | null, maxMinor: MinorUnits | null): string {
  if (minMinor !== null && maxMinor !== null) {
    return `${formatMoney(minMinor)}${BOUNDS_SEPARATOR}${formatMoney(maxMinor)}`;
  }
  return formatMoney(minMinor ?? maxMinor);
}

/** The address that applies `state` beside the brand chip every removal case watches the outcome by. */
function withBrand(
  state: FilterState,
  brand: { readonly id: string } = SELECTED_BRAND,
): FilterState {
  return toggleFacetValue(state, "brand", brand.id);
}

/**
 * One removable chip and the filter that must survive it: the address applying both, the chip's own text and the
 * text of the chip beside it. Between them the cases cover every kind of applied filter the row can be handed —
 * a term facet's value, a price range, a rating band, the availability toggle and a tag — because each kind is
 * removed through the accessor that owns it.
 */
const REMOVALS: readonly {
  readonly filter: string;
  readonly address: FilterState;
  readonly chip: string;
  readonly kept: string;
}[] = [
  {
    filter: "a category",
    address: withBrand(toggleFacetValue(DEFAULT_FILTER_STATE, "category", CATEGORY_ID)),
    chip: CATEGORY.name,
    kept: SELECTED_BRAND.name,
  },
  {
    filter: "a brand",
    address: withBrand(
      toggleFacetValue(DEFAULT_FILTER_STATE, "brand", SELECTED_BRAND.id),
      OTHER_BRAND,
    ),
    chip: SELECTED_BRAND.name,
    kept: OTHER_BRAND.name,
  },
  {
    filter: "a price range",
    address: withBrand(
      setPriceRange(DEFAULT_FILTER_STATE, PRICE_EXTREMES.minMinor, PRICE_EXTREMES.maxMinor),
    ),
    chip: boundsText(PRICE_EXTREMES.minMinor, PRICE_EXTREMES.maxMinor),
    kept: SELECTED_BRAND.name,
  },
  {
    filter: "a rating band",
    address: withBrand(
      setFacetValues(DEFAULT_FILTER_STATE, "rating", [declaredOption("rating").value]),
    ),
    chip: declaredOption("rating").label,
    kept: SELECTED_BRAND.name,
  },
  {
    filter: "the availability toggle",
    address: withBrand(
      setFacetValues(DEFAULT_FILTER_STATE, "availability", [declaredOption("availability").value]),
    ),
    chip: declaredOption("availability").label,
    kept: SELECTED_BRAND.name,
  },
  {
    filter: "a tag",
    address: withBrand(toggleTag(DEFAULT_FILTER_STATE, TAG)),
    chip: TAG,
    kept: SELECTED_BRAND.name,
  },
];

/** The chips a caller hands the row on its own: two brand values and a tag, in the order the row shows them. */
const CALLER_ENTRIES: readonly ActiveFilterEntry[] = [
  { kind: "facet", facetId: "brand", value: SELECTED_BRAND.id, label: null },
  { kind: "facet", facetId: "brand", value: OTHER_BRAND.id, label: null },
  { kind: "tag", value: TAG },
];

/** What those chips read as: the two brands' own names, and the tag. */
const CALLER_TEXTS: readonly string[] = [SELECTED_BRAND.name, OTHER_BRAND.name, TAG];

// Reading the row -----------------------------------------------------------------------------------

/** The chip row, awaited: its chips are the address's own and their wording comes from the loaded facets. */
async function chipsRow(): Promise<HTMLElement> {
  return screen.findByRole("list", { name: SEARCH_COPY.ACTIVE_FILTERS_HEADING });
}

/** Whether the row is on the page at all, which is what its absence is asserted against. */
function rowIsShown(): boolean {
  return screen.queryByRole("list", { name: SEARCH_COPY.ACTIVE_FILTERS_HEADING }) !== null;
}

// The chips the search route derives from its own address --------------------------------------------

describe("the chips a search applies", () => {
  isolateJourneyCases();

  it.each(REMOVALS)(
    "removes $filter's own value, leaves the filter beside it applied, and announces it",
    async ({ address, chip, kept }) => {
      const { user } = renderApp({ route: filtersToPath(ROUTES.SEARCH, address) });
      const row = await chipsRow();
      expect(await within(row).findByText(chip)).toBeInTheDocument();

      await user.click(within(row).getByRole("button", { name: removeFilterLabel(chip) }));

      // The removed filter's chip is gone from the row the address now writes, the filter beside it stands, and
      // the removal is stated by the row's own polite region — which is why every case keeps a second chip.
      await waitFor(() => expect(within(row).queryByText(chip)).toBeNull());
      expect(within(row).getByText(kept)).toBeInTheDocument();
      expect(screen.getByText(removeFilterLabel(chip))).toBeInTheDocument();
    },
  );

  it("labels a term chip with the wording the loaded facets carry, and not the identifier", async () => {
    renderApp({
      route: filtersToPath(
        ROUTES.SEARCH,
        toggleFacetValue(DEFAULT_FILTER_STATE, "category", CATEGORY_ID),
      ),
    });

    const row = await chipsRow();
    expect(await within(row).findByText(CATEGORY.name)).toBeInTheDocument();
    expect(within(row).queryByText(CATEGORY_ID)).toBeNull();
  });

  it("renders no row at all while the address applies no filter", async () => {
    renderApp({ route: ROUTES.SEARCH });

    // The page's own field is this case's awaited first expectation: what it asserts is an absence, so there is
    // nothing on the page to await for it, and the providers below the route issue their reads on mount.
    expect(await screen.findByLabelText(SEARCH_COPY.FIELD_LABEL)).toBeInTheDocument();
    expect(rowIsShown()).toBe(false);
    expect(screen.queryByRole("button", { name: COMMON_ACTIONS.CLEAR_ALL })).toBeNull();
  });

  it("clears every applied filter from the row's own clear-all action", async () => {
    const { user } = renderApp({
      route: filtersToPath(
        ROUTES.SEARCH,
        withBrand(toggleFacetValue(DEFAULT_FILTER_STATE, "category", CATEGORY_ID)),
      ),
    });
    const row = await chipsRow();
    // The chips come from the address and their wording from the loaded facets, so the resolved wording is the
    // state this case works in: the chip is awaited on the text the facets give it rather than on the row's own.
    expect(await within(row).findByText(CATEGORY.name)).toBeInTheDocument();
    expect(
      within(row).getAllByRole("button", { name: removeFilterLabel(CATEGORY.name) }),
    ).toHaveLength(1);

    await user.click(within(row).getByRole("button", { name: COMMON_ACTIONS.CLEAR_ALL }));

    // Nothing is applied any more, and a row with no chip is not rendered at all.
    await waitFor(() => expect(rowIsShown()).toBe(false));
  });

  it.each([
    {
      bounds: "both of its bounds",
      state: setPriceRange(DEFAULT_FILTER_STATE, PRICE_EXTREMES.minMinor, PRICE_EXTREMES.maxMinor),
      text: boundsText(PRICE_EXTREMES.minMinor, PRICE_EXTREMES.maxMinor),
    },
    {
      bounds: "its lower bound alone",
      state: setPriceRange(DEFAULT_FILTER_STATE, PRICE_EXTREMES.minMinor, null),
      text: boundsText(PRICE_EXTREMES.minMinor, null),
    },
    {
      bounds: "its upper bound alone",
      state: setPriceRange(DEFAULT_FILTER_STATE, null, PRICE_EXTREMES.maxMinor),
      text: boundsText(null, PRICE_EXTREMES.maxMinor),
    },
  ])("states a price chip's $bounds as the money they name", async ({ state, text }) => {
    renderApp({ route: filtersToPath(ROUTES.SEARCH, state) });

    const row = await chipsRow();
    expect(within(row).getByText(text)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: removeFilterLabel(text) })).toBeInTheDocument();
  });

  it("takes a declared price band's own wording rather than its two bounds", async () => {
    const band = declaredOption("price", 1);
    renderApp({
      route: filtersToPath(
        ROUTES.SEARCH,
        setFacetValues(DEFAULT_FILTER_STATE, "price", [band.value]),
      ),
    });

    const row = await chipsRow();
    expect(within(row).getByText(band.label)).toBeInTheDocument();
    expect(
      within(row).queryByText(boundsText(band.minMinor ?? null, band.maxMinor ?? null)),
    ).toBeNull();
  });
});

// The row a caller renders on its own ---------------------------------------------------------------

describe("the row a caller renders on its own", () => {
  isolateJourneyCases();

  it("shows the cap it is given, and reveals the rest from the control it puts beside them", async () => {
    const { user } = renderWithProviders(
      <ActiveFilters entries={CALLER_ENTRIES} maxVisible={2} />,
      {
        route: ROUTES.SEARCH,
      },
    );
    const row = await chipsRow();
    const [first, second, third] = CALLER_TEXTS;

    expect(await within(row).findByText(first)).toBeInTheDocument();
    expect(within(row).getByText(second)).toBeInTheDocument();
    // The chip past the cap is not drawn, and neither is the removal that belongs to it: the reveal is the only
    // way to either of them.
    expect(within(row).queryByText(third)).toBeNull();
    expect(within(row).queryByRole("button", { name: removeFilterLabel(third) })).toBeNull();

    await user.click(within(row).getByRole("button", { name: COMMON_ACTIONS.VIEW_ALL }));

    expect(within(row).getByText(third)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: removeFilterLabel(third) })).toBeInTheDocument();
    // The reveal takes its own control with it, and the clear-all action is still offered beside the chips.
    expect(within(row).queryByRole("button", { name: COMMON_ACTIONS.VIEW_ALL })).toBeNull();
    expect(within(row).getByRole("button", { name: COMMON_ACTIONS.CLEAR_ALL })).toBeInTheDocument();
  });

  it.each([
    { cap: "the number of chips it holds", maxVisible: CALLER_ENTRIES.length },
    { cap: "a value under one", maxVisible: 0 },
  ])("shows every chip when the cap is $cap, and reveals nothing", async ({ maxVisible }) => {
    renderWithProviders(<ActiveFilters entries={CALLER_ENTRIES} maxVisible={maxVisible} />, {
      route: ROUTES.SEARCH,
    });

    const row = await chipsRow();
    for (const text of CALLER_TEXTS) {
      expect(await within(row).findByText(text)).toBeInTheDocument();
    }
    expect(within(row).queryByRole("button", { name: COMMON_ACTIONS.VIEW_ALL })).toBeNull();
  });

  it("hands a removal and the clear-all action to the caller that supplies them", async () => {
    const onRemove = vi.fn();
    const onClearAll = vi.fn();
    // The row is placed by the caller, which appends its own class to the row's own: this case asserts the row
    // it places behaves as every other case in this file reads it.
    const { user } = renderWithProviders(
      <ActiveFilters
        entries={CALLER_ENTRIES}
        onRemove={onRemove}
        onClearAll={onClearAll}
        className="sp-page__body"
      />,
      { route: ROUTES.SEARCH },
    );
    const row = await chipsRow();
    const [first] = CALLER_TEXTS;
    expect(await within(row).findByText(first)).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: removeFilterLabel(first) }));

    // The caller owns the removal, so the chip it names stays where the entries still hold it, and the removal
    // is announced exactly as a removal the row performs itself is.
    expect(onRemove).toHaveBeenCalledWith(CALLER_ENTRIES[0]);
    expect(within(row).getByText(first)).toBeInTheDocument();
    expect(screen.getByText(removeFilterLabel(first))).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: COMMON_ACTIONS.CLEAR_ALL }));

    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(within(row).getByText(first)).toBeInTheDocument();
  });
});
