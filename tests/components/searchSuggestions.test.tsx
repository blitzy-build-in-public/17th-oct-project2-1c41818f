/**
 * Path: tests/components/searchSuggestions.test.tsx
 * Purpose: The type-ahead panel: the rows a term's answer produces under one group title per kind, the caption each product row is resolved, the row the pointer chooses and the row it previews, and the request's loading, empty, failed and superseded states
 * Lines: 438
 */

import { describe, expect, it, vi } from "vitest";

import { COMMON_ACTIONS } from "@/constants/content";
import { BRANDS } from "@/data/categories";
import { SearchSuggestions, suggestionOptionId } from "@/features/search/SearchSuggestions";
import type { SuggestionRequestStatus } from "@/features/search/SearchSuggestions";
import { API_PATHS } from "@/lib/apiClient";
import type { SearchLookup } from "@/lib/searchService";
import type { Product, SearchSuggestion } from "@/types/catalog";
import type { ApiError } from "@/types/common";
import { formatDiscount, formatMoney, formatScaledPercent } from "@/utils/format";
import { DEFAULT_FILTER_STATE, filtersToPath, setQuery } from "@/utils/queryParams";
import { categoryId } from "@/utils/strings";

import { makeApiError } from "../fixtures";
import {
  A11Y_COPY,
  CATEGORY_DEFINITIONS,
  FEEDBACK_COPY,
  PRODUCTS,
  ROUTES,
  SEARCH_COPY,
  SEARCH_SUGGESTION_LIMIT,
  SELECTED_BRAND,
  categoryPath,
  failNext,
  isolateJourneyCases,
  productNamed,
  productPath,
  renderApp,
  screen,
  textOf,
  waitFor,
  within,
} from "../helpers/journeyHarness";
import { renderWithProviders } from "../testUtils";

/*
 * The suggestion panel both ways round. `renderApp` at the search route drives the real bar, so the field's own
 * debounce asks the seam for suggestions and the answer reaches this panel: the row the pointer previews, the
 * row it chooses, the rows a newer term leaves on screen, and the failed and the empty answers are all reached
 * the way a shopper reaches them. `renderWithProviders` mounts the panel on its own for the states and the rows
 * the bar cannot be relied on to produce on demand — a superseded request, a request never made, a row whose
 * product states no saving, a row of a kind a given answer happened to leave out, and the caller's own class.
 *
 * Nothing stands in for the product anywhere: the failure is armed at the seam through `failNext`, the empty
 * answer is a term the seeded catalogue genuinely does not hold, and every caption's expected wording is the
 * seeded record's own, formatted by the module the panel formats with.
 */

// The case's inputs ---------------------------------------------------------------------------------

/** The seam's own simulated latency, and the value the suite runs every read at. */
const LATENCY_VARIABLE = "VITE_API_LATENCY_MS";
const HELD_ANSWER_LATENCY_MS = "1000";
const SUITE_API_LATENCY_MS = "0";

/** A term no seeded product, brand or category answers: the query whose own answer is the empty panel. */
const NO_MATCH_TERM = "zzzqqqxyz";

/** The term a case types to have the bar answer with suggestions. */
const TYPED_TERM = SELECTED_BRAND.name;

/** The id the panel's listbox carries where a case mounts it on its own, from which its option ids derive. */
const LIST_ID = "case-suggestions";

/** What a row's caption joins the brand, the price and any saving with. */
const CAPTION_SEPARATOR = " \u00b7 ";

/** A brand's name, from the seeded brands the data layer answers the panel's lookup with. */
function brandNamed(id: string): string {
  const brand = BRANDS.find((candidate) => candidate.id === id);
  if (brand === undefined) throw new Error(`The seed holds no brand named "${id}".`);
  return brand.name;
}

/** A category's name, from the taxonomy the data layer counts its terms with. */
function categoryNamed(id: string): string {
  const category = CATEGORY_DEFINITIONS.find((candidate) => categoryId(candidate.slug) === id);
  if (category === undefined) throw new Error(`The seed holds no category named "${id}".`);
  return category.name;
}

/** The names the panel resolves a row's caption from, read from the records the panel is answered by. */
const LOOKUP: SearchLookup = { brandName: brandNamed, categoryName: categoryNamed };

/** A seeded product sold below its list price, so its row states the saving the record carries. */
const DISCOUNTED_PRODUCT = ((): Product => {
  const product = PRODUCTS.find((candidate) => candidate.listPriceMinor > candidate.priceMinor);
  if (product === undefined) {
    throw new Error("The seeded catalogue lists no product below its list price.");
  }
  return product;
})();

/** A seeded product sold at its list price, so its row states a price and no saving. */
const FULL_PRICE_PRODUCT = ((): Product => {
  const product = PRODUCTS.find((candidate) => candidate.listPriceMinor === candidate.priceMinor);
  if (product === undefined) {
    throw new Error("The seeded catalogue lists every product below its list price.");
  }
  return product;
})();

/** A seeded category that holds products, which the panel is handed a row of. */
const CATEGORY =
  CATEGORY_DEFINITIONS.find((candidate) =>
    PRODUCTS.some((product) => product.categoryId === categoryId(candidate.slug)),
  ) ?? CATEGORY_DEFINITIONS[0];

/** The caption a product row states: the brand and the price, and the saving only where the record has one. */
function captionOf(product: Product): string {
  const parts = [brandNamed(product.brandId), formatMoney(product.priceMinor, product.currency)];
  const discount = formatDiscount(product.listPriceMinor, product.priceMinor);
  if (discount > 0) parts.push(formatScaledPercent(discount, 0));
  return parts.join(CAPTION_SEPARATOR);
}

/** The rows a case hands the panel: two product rows, a brand row and a category row, kinds in the service's order. */
const SUGGESTIONS: readonly SearchSuggestion[] = [
  { text: DISCOUNTED_PRODUCT.name, kind: "product", target: productPath(DISCOUNTED_PRODUCT.slug) },
  { text: FULL_PRICE_PRODUCT.name, kind: "product", target: productPath(FULL_PRICE_PRODUCT.slug) },
  {
    text: SELECTED_BRAND.name,
    kind: "brand",
    target: filtersToPath(ROUTES.SEARCH, setQuery(DEFAULT_FILTER_STATE, SELECTED_BRAND.name)),
  },
  { text: CATEGORY.name, kind: "category", target: categoryPath(CATEGORY.slug) },
];

/** The record a product row's caption is resolved from, by the target that row names. */
function productLookup(target: string): Product | undefined {
  if (target === productPath(DISCOUNTED_PRODUCT.slug)) return DISCOUNTED_PRODUCT;
  if (target === productPath(FULL_PRICE_PRODUCT.slug)) return FULL_PRICE_PRODUCT;
  return undefined;
}

/**
 * The panel mounted on its own at one of the request's states, with the rows that state carries — none of them
 * by default, which is the answer every rowless state of a request that the field has already asked for is in.
 */
function renderPanel(
  status: SuggestionRequestStatus,
  options: {
    readonly suggestions?: readonly SearchSuggestion[];
    readonly error?: ApiError;
    readonly onRetry?: () => void;
    readonly className?: string;
  } = {},
) {
  return renderWithProviders(
    <SearchSuggestions
      suggestions={options.suggestions ?? []}
      lookup={LOOKUP}
      query={TYPED_TERM}
      status={status}
      error={options.error}
      listId={LIST_ID}
      activeIndex={-1}
      onSelect={vi.fn()}
      onRetry={options.onRetry}
      className={options.className}
    />,
    { route: ROUTES.SEARCH },
  );
}

// Reading the rendered panel ------------------------------------------------------------------------

/** The panel's listbox, awaited: the bar renders it once an answer has rows to show. */
async function suggestionsList(): Promise<HTMLElement> {
  return screen.findByRole("listbox", { name: SEARCH_COPY.SUGGESTIONS_LIST_LABEL });
}

/** The search field the bar renders, awaited, which is the control every app-driven case types into. */
async function searchField(): Promise<HTMLElement> {
  return screen.findByLabelText(SEARCH_COPY.FIELD_LABEL);
}

// The rows the panel renders -----------------------------------------------------------------------

describe("the rows the suggestion panel renders", () => {
  isolateJourneyCases();

  it("lists a row per kind under its own group title, and marks the row it is told is current", async () => {
    renderWithProviders(
      <SearchSuggestions
        suggestions={SUGGESTIONS}
        lookup={LOOKUP}
        query={TYPED_TERM}
        status="success"
        listId={LIST_ID}
        activeIndex={2}
        onSelect={vi.fn()}
      />,
      { route: ROUTES.SEARCH },
    );

    const list = await suggestionsList();
    const rows = within(list).getAllByRole("option");
    expect(rows).toHaveLength(SUGGESTIONS.length);
    for (const heading of [
      SEARCH_COPY.SUGGESTIONS_PRODUCTS_HEADING,
      SEARCH_COPY.SUGGESTIONS_BRANDS_HEADING,
      SEARCH_COPY.SUGGESTIONS_CATEGORIES_HEADING,
    ]) {
      expect(within(list).getByRole("group", { name: heading })).toBeInTheDocument();
    }

    // The row the case reported as current carries the id the field's own reference is built from, and it is the
    // only one marked: every kind's rows are options of the one listbox.
    expect(rows[2]).toHaveAttribute("id", suggestionOptionId(LIST_ID, 2));
    expect(rows[2]).toHaveAttribute("aria-selected", "true");
    expect(rows[0]).toHaveAttribute("aria-selected", "false");

    // A row of a kind that names no product states its own words alone: a brand row and a category row carry no
    // brand, no price and no saving, because none of the three is part of what a suggestion is answered as.
    expect(textOf(rows[2])).toBe(SELECTED_BRAND.name);
    expect(textOf(rows[3])).toBe(CATEGORY.name);
  });

  it("captions a product row with the loaded record's brand, price and — only where it has one — its saving", async () => {
    renderWithProviders(
      <SearchSuggestions
        suggestions={SUGGESTIONS}
        lookup={LOOKUP}
        query=""
        status="success"
        listId={LIST_ID}
        activeIndex={-1}
        onSelect={vi.fn()}
        productLookup={productLookup}
      />,
      { route: ROUTES.SEARCH },
    );

    const list = await suggestionsList();
    const rows = within(list).getAllByRole("option");

    // The discounted record states its saving beside the price, in the formatter's own money and percentage.
    expect(textOf(rows[0])).toBe(`${DISCOUNTED_PRODUCT.name}${captionOf(DISCOUNTED_PRODUCT)}`);
    // The record carrying no saving states the brand and the price alone rather than a saving of nothing.
    expect(textOf(rows[1])).toBe(`${FULL_PRICE_PRODUCT.name}${captionOf(FULL_PRICE_PRODUCT)}`);
  });

  it("marks the runs a query token matched, and leaves the rest of the row unmarked", async () => {
    renderWithProviders(
      <SearchSuggestions
        suggestions={SUGGESTIONS}
        lookup={LOOKUP}
        query={TYPED_TERM}
        status="success"
        listId={LIST_ID}
        activeIndex={-1}
        onSelect={vi.fn()}
      />,
      { route: ROUTES.SEARCH },
    );

    const list = await suggestionsList();
    const rows = within(list).getAllByRole("option");
    // The matched run is the `mark` element the panel's own contract declares, so which run a row highlights
    // rests on the same rule its matching does, and the row the term does not answer holds no mark at all.
    const marked = rows.filter((row) => row.querySelectorAll("mark").length > 0);
    const unmarked = rows.filter((row) => row.querySelectorAll("mark").length === 0);
    expect(marked.length).toBeGreaterThan(0);
    expect(unmarked.length).toBeGreaterThan(0);
    expect(within(rows[3]).getByText(CATEGORY.name)).toBeInTheDocument();
  });
});

// The request states the panel renders --------------------------------------------------------------

describe("the states of the suggestion request", () => {
  isolateJourneyCases();

  it("renders nothing while no request has been made for the field's term", async () => {
    const { container } = renderPanel("idle");

    // A request that has not been made states nothing: the panel is absent rather than empty.
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a request a newer one replaced", async () => {
    // A superseded request is a cancelled keystroke rather than a fault, so the panel states nothing about it —
    // and the failure the seam answers a cancelled request with is what this state is written for.
    const { container } = renderPanel("error", {
      error: makeApiError({ status: 499, code: "request-aborted" }),
    });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("stands its loading ring where there are no rows to keep", async () => {
    renderPanel("loading", { className: "sp-page__body" });

    // The panel is anchored to the field and reports the wait through the ring's own live region, and it holds
    // no listbox, because there is no row for the field's reference to name.
    expect(await screen.findByRole("status")).toHaveTextContent(A11Y_COPY.LOADING_ANNOUNCEMENT);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says the term matched nothing once a request has answered without rows", async () => {
    renderPanel("success");

    expect(await screen.findByText(SEARCH_COPY.SUGGESTIONS_EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("reports a failed request with the retry its caller owns, in the register a failure speaks in", async () => {
    const failure = makeApiError({ status: 503, code: "data-source-unavailable" });
    const onRetry = vi.fn();
    const { user } = renderPanel("error", { error: failure, onRetry });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_TITLE);
    expect(alert).toHaveTextContent(failure.message);
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// The panel the bar feeds, driven through the real field -------------------------------------------------

describe("the suggestions the search field is answered with", () => {
  isolateJourneyCases();

  it("lists a capped answer for the term typed, under a group title per kind it holds", async () => {
    const { user } = renderApp({ route: ROUTES.SEARCH });
    await user.type(await searchField(), TYPED_TERM);

    const list = await suggestionsList();
    const rows = within(list).getAllByRole("option");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(SEARCH_SUGGESTION_LIMIT);
    expect(within(list).getAllByRole("group").length).toBeGreaterThan(0);
    // Every row states the words it suggests: a row carrying no caption is still a row a shopper reads.
    for (const row of rows) expect(textOf(row)).not.toBe("");
  });

  it("previews the row the pointer is over, and names it the way the field's own reference does", async () => {
    const { user } = renderApp({ route: ROUTES.SEARCH });
    const field = await searchField();
    await user.type(field, TYPED_TERM);
    const list = await suggestionsList();
    const rows = within(list).getAllByRole("option");
    if (rows.length < 2)
      throw new Error(`The answer for "${TYPED_TERM}" held ${rows.length} rows.`);

    await user.hover(rows[1]);

    // The row under the pointer becomes the current one, and the field's own reference names that row's id.
    await waitFor(() => expect(rows[1]).toHaveAttribute("aria-selected", "true"));
    expect(rows[0]).toHaveAttribute("aria-selected", "false");
    expect(rows[1]).toHaveAttribute("id", suggestionOptionId(list.id, 1));
    expect(field).toHaveAttribute("aria-activedescendant", suggestionOptionId(list.id, 1));
  });

  it("opens the target of the row the pointer chooses", async () => {
    const { user } = renderApp({ route: ROUTES.SEARCH });
    await user.type(await searchField(), TYPED_TERM);
    const list = await suggestionsList();

    await user.click(within(list).getAllByRole("option")[0]);

    // The best-ranked row for a typed brand name is one of that brand's products, so the choice opens a product
    // page — re-read on every attempt, because the heading the page shows is a new element.
    await waitFor(() => {
      const landed = screen.getByRole("heading", { level: 1 });
      expect(productNamed(textOf(landed)).brandId).toBe(SELECTED_BRAND.id);
    });
  });

  it("keeps the rows the last answer produced while a newer term is answered", async () => {
    const { user } = renderApp({ route: ROUTES.SEARCH });
    const field = await searchField();
    await user.type(field, TYPED_TERM);
    const list = await suggestionsList();
    const rowsBefore = within(list).getAllByRole("option").length;
    expect(rowsBefore).toBeGreaterThan(0);

    // The panel is read in the window the next term's request is in: a held latency keeps that request in flight,
    // so what is asserted is the state the panel is in while it waits rather than after it has answered.
    vi.stubEnv(LATENCY_VARIABLE, HELD_ANSWER_LATENCY_MS);
    try {
      await user.type(field, " ");
      const panel = list.parentElement;
      if (panel === null) throw new Error("The listbox sits in no panel.");

      await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "true"));
      // The rows are kept rather than emptied: the panel reports the wait without refilling around the typist.
      expect(within(list).getAllByRole("option").length).toBe(rowsBefore);
    } finally {
      vi.stubEnv(LATENCY_VARIABLE, SUITE_API_LATENCY_MS);
    }

    await waitFor(() => expect(list.parentElement).not.toHaveAttribute("aria-busy", "true"));
  });

  it("reports a failed suggestion read, and answers again from the retry it offers", async () => {
    const { user } = renderApp({ route: ROUTES.SEARCH });
    const field = await searchField();
    const failure = failNext({ path: API_PATHS.SEARCH_SUGGEST });

    await user.type(field, TYPED_TERM);

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_TITLE);
    expect(screen.queryByRole("listbox")).toBeNull();

    failure.disarm();
    await user.click(within(alerts[0]).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    const answered = await suggestionsList();
    expect(within(answered).getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("says a term matched nothing rather than drawing an empty list", async () => {
    const { user } = renderApp({ route: ROUTES.SEARCH });
    await user.type(await searchField(), NO_MATCH_TERM);

    expect(await screen.findByText(SEARCH_COPY.SUGGESTIONS_EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
