/**
 * Path: tests/integration/catalogSuggestionsFlow.test.tsx
 * Purpose: The suggestion list's keyboard choice and the product page it opens, with the review a signed-in customer adds and the addresses that resolve to nothing.
 * Lines: 348
 */

import { describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS } from "@/constants/config";
import { loginPath } from "@/constants/routes";
import type { Product } from "@/types/catalog";
import { formatDiscount, formatReviewCount, formatScaledPercent } from "@/utils/format";

import {
  A11Y_COPY,
  AVAILABILITY_PATTERN,
  CATALOG_COPY,
  PAGE_TITLES,
  PRODUCTS,
  RELATED_PRODUCTS_LIMIT,
  ROUTES,
  SEARCH_COPY,
  SEARCH_SUGGESTION_LIMIT,
  SELECTED_BRAND,
  content,
  failNext,
  formatMoney,
  formatRatingValue,
  headingNamed,
  isolateJourneyCases,
  productNamed,
  productPath,
  ratingSummaryLabel,
  renderApp,
  screen,
  settledTiles,
  textOf,
  tileHeadings,
  waitFor,
  within,
} from "../helpers/journeyHarness";

/*
 * The suggestion and product-page slices of the product driven through the real application: `renderApp` mounts
 * `src/App.tsx`, the providers, the pages and the seeded data source, so a case asserts what a visitor sees —
 * the rows a query suggests, the choice the keyboard takes, the product page it opens and the rating summary
 * that moves with the review the list gains. Every input comes from the seeded records or the copy module, so no
 * figure and no sentence is typed.
 */

/*
 * The seam's own simulated latency is the one lever a case has over how long an answer is held in flight:
 * `src/lib/mockServer.ts` reads `VITE_API_LATENCY_MS` per request, and `tests/setup.ts` stubs the suite's own
 * value in at module scope. A pending state a case asserts has to be held long enough for the assertion to
 * see it — at the suite's zero latency an answer can settle in the same flush as the request that asked for
 * it, which left whether the suggestion panel's ring ever painted to the host's scheduling.
 */
const HELD_ANSWER_LATENCY_MS = "1000";
/** The variable the seam reads that latency from. */
const LATENCY_VARIABLE = "VITE_API_LATENCY_MS";
/** The latency the suite runs every read at, which a case that holds one answer restores afterwards. */
const SUITE_API_LATENCY_MS = "0";

/** How a rating summary reads: the copy module's own sentence with both figures left open. */
const RATING_SUMMARY_PATTERN = /^Rated [0-9.]+ from [0-9,]+ reviews?$/;

/** What a suggestion row's caption joins the brand, the price and any saving with. */
const CAPTION_SEPARATOR = " \u00b7 ";

/** Where a page's rating summaries live: the review list's own and the related strip's tiles each sit in a
 *  named region, so what the pattern leaves outside every region is the product's own summary. */

/** What the review case submits: a star, a title and a body the review rule accepts. */
const SUBMITTED_STAR = "5";
const SUBMITTED_REVIEW_TITLE = "Journey review of the product's own figures";
const SUBMITTED_REVIEW_BODY = "Submitted by this case: the header and the list must move together.";

/** The summary the detail page states for the product, read synchronously so a case can await an assertion. */
function detailRatingSummary(): HTMLElement {
  const regions = screen.queryAllByRole("region");
  const found = screen
    .getAllByText(RATING_SUMMARY_PATTERN)
    .filter((element) => !regions.some((region) => region.contains(element)));
  const first = found[0];
  if (first === undefined || found.length > 1)
    throw new Error(`The product page stated ${String(found.length)} rating summaries of its own.`);
  return first;
}

/** The seeded product a suggestion row names, as the longest seeded name its own text starts with.
 *  A row renders the text it suggests first and its caption after it, so a brand or a category row
 *  starts with no product's name and names none. */
function suggestedProduct(text: string): Product | undefined {
  let named: Product | undefined;
  for (const product of PRODUCTS) {
    if (!text.startsWith(product.name)) continue;
    if (named === undefined || product.name.length > named.name.length) named = product;
  }
  return named;
}

describe("the shopper's suggestions and the product page they open", () => {
  isolateJourneyCases();

  it("suggests a capped, grouped list and takes the keyboard's choice to a product", async () => {
    const { user } = renderApp({ route: ROUTES.SEARCH });
    const field = await screen.findByLabelText(SEARCH_COPY.FIELD_LABEL);

    // The panel's first answer is held while the case watches it arrive, so the loading ring it announces is
    // asserted rather than raced.
    vi.stubEnv(LATENCY_VARIABLE, HELD_ANSWER_LATENCY_MS);
    try {
      await user.type(field, SELECTED_BRAND.name);
      expect(await screen.findByText(A11Y_COPY.LOADING_ANNOUNCEMENT)).toBeInTheDocument();
    } finally {
      vi.stubEnv(LATENCY_VARIABLE, SUITE_API_LATENCY_MS);
    }

    const list = await screen.findByRole("listbox", { name: SEARCH_COPY.SUGGESTIONS_LIST_LABEL });
    const options = within(list).getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(SEARCH_SUGGESTION_LIMIT);
    expect(within(list).getAllByRole("group").length).toBeGreaterThan(0);

    await user.keyboard("{ArrowDown}");
    expect(within(list).getByRole("option", { selected: true })).toBeInTheDocument();
    await user.keyboard("{Enter}");

    // The best-ranked row for a typed brand name is one of that brand's products, so the choice opens a
    // product page — the page is re-read on every attempt, because the heading it shows is a new element.
    await waitFor(() => {
      const landed = screen.getByRole("heading", { level: 1 });
      expect(productNamed(textOf(landed)).brandId).toBe(SELECTED_BRAND.id);
    });
  });

  it("captions a suggested product with the record the loaded catalogue page holds", async () => {
    const { user } = renderApp({ route: ROUTES.SEARCH });
    const field = await screen.findByLabelText(SEARCH_COPY.FIELD_LABEL);

    // The brand is searched for through the field, so the page behind the panel is the one holding that
    // brand's products: the flow in which the record a caption states is in hand.
    await user.type(field, SELECTED_BRAND.name);
    await user.keyboard("{Enter}");
    const pageNames = await settledTiles();

    // Submitting closes the panel while the field keeps the focus, so the focus is moved off it first and then
    // clicked back. The panel opens on the term as it has settled: while nothing searchable has settled yet the
    // bar offers this session's recent terms, so the case waits for the answer's own product group before it
    // reads the list, which is the panel that carries the captions.
    await user.tab();
    await user.click(field);
    await screen.findByRole("group", { name: SEARCH_COPY.SUGGESTIONS_PRODUCTS_HEADING });
    const list = screen.getByRole("listbox", { name: SEARCH_COPY.SUGGESTIONS_LIST_LABEL });

    // Only a product the loaded page holds can be captioned, because the records a caption is resolved from
    // are that page's own, and the row's brand is the brand searched for.
    const rows = within(list).getAllByRole("option");
    let captioned: { readonly row: HTMLElement; readonly product: Product } | undefined;
    for (const row of rows) {
      const product = suggestedProduct(textOf(row));
      if (product === undefined || product.brandId !== SELECTED_BRAND.id) continue;
      if (!pageNames.includes(product.name)) continue;
      captioned = { row, product };
      break;
    }
    if (captioned === undefined) {
      throw new Error(
        `No suggested ${SELECTED_BRAND.name} row named a product the page holds; ` +
          `the page held ${pageNames.join(", ")}; the rows read ${rows.map(textOf).join(" | ")}.`,
      );
    }
    const { row, product } = captioned;

    // The caption states the brand and the price of the seeded record — figures a suggestion does not carry —
    // and a record on sale carries the whole percentage saved beside them.
    const price = formatMoney(product.priceMinor, product.currency);
    const caption = `${SELECTED_BRAND.name}${CAPTION_SEPARATOR}${price}`;
    expect(within(row).getByText(caption, { exact: false })).toBeInTheDocument();
    if (product.listPriceMinor > product.priceMinor) {
      const discount = formatDiscount(product.listPriceMinor, product.priceMinor);
      expect(
        within(row).getByText(`${caption}${CAPTION_SEPARATOR}${formatScaledPercent(discount, 0)}`),
      ).toBeInTheDocument();
    }
  });

  it("opens a product from the catalogue with its fields, tabs and related strip", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });
    await settledTiles();

    const heading = tileHeadings().find((entry) => productNamed(textOf(entry)).ratingCount > 0);
    if (heading === undefined) throw new Error("The page rendered no reviewed product.");
    const product = productNamed(textOf(heading));
    await user.click(within(heading).getByRole("link"));

    expect(await headingNamed(product.name)).toBeInTheDocument();
    expect(screen.getByText(product.description)).toBeInTheDocument();
    for (const feature of product.features) {
      expect(screen.getAllByText(feature).length).toBeGreaterThan(0);
    }
    expect(
      screen.getAllByText(formatMoney(product.priceMinor, product.currency)).length,
    ).toBeGreaterThan(0);
    if (product.listPriceMinor > product.priceMinor) {
      const list = formatMoney(product.listPriceMinor, product.currency);
      expect(screen.getAllByText(list).length).toBeGreaterThan(0);
    }
    const rated = ratingSummaryLabel(formatRatingValue(product.ratingAverage), product.ratingCount);
    expect(screen.getAllByText(rated).length).toBeGreaterThan(0);
    expect(screen.getAllByText(AVAILABILITY_PATTERN).length).toBeGreaterThan(0);

    // The gallery's strip is keyboard navigable from the thumbnail it marks as the picture on show.
    const gallery = screen.getByRole("group", { name: product.name });
    const thumbs = within(gallery).getAllByRole("button");
    expect(thumbs).toHaveLength(product.images.length);
    expect(thumbs[0]).toHaveAttribute("aria-current", "true");
    thumbs[0].focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(thumbs[1]).toHaveAttribute("aria-current", "true"));

    await user.click(screen.getByRole("tab", { name: CATALOG_COPY.SPECIFICATIONS_HEADING }));
    for (const spec of product.specs) {
      expect(screen.getAllByText(spec.label).length).toBeGreaterThan(0);
    }

    await user.click(screen.getByRole("tab", { name: CATALOG_COPY.REVIEWS_HEADING }));
    const reviews = screen.getByRole("region", { name: CATALOG_COPY.REVIEWS_HEADING });
    expect(within(reviews).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(screen.getByLabelText(CATALOG_COPY.REVIEWS_RATING_FILTER_LABEL)).toBeInTheDocument();

    // Every related product is drawn from the category the product being read sits in.
    const related = await screen.findByRole("region", { name: CATALOG_COPY.RELATED_HEADING });
    const relatedTiles = await within(related).findAllByRole("heading", { level: 3 });
    expect(relatedTiles.length).toBeGreaterThan(0);
    expect(relatedTiles.length).toBeLessThanOrEqual(RELATED_PRODUCTS_LIMIT);
    for (const tile of relatedTiles) {
      expect(productNamed(textOf(tile)).categoryId).toBe(product.categoryId);
    }
  });

  it("keeps the product when its category tree cannot be read, and shortens the trail to it", async () => {
    const { user } = renderApp({ route: ROUTES.CATALOG });
    await settledTiles();
    const heading = tileHeadings()[0];
    const product = productNamed(textOf(heading));

    // The page's own read of the tree is the one this case refuses: the product's read is answered normally, so
    // the page renders the product it was asked for with the trail it can build without the tree — the
    // shortened home-to-product trail, which is also the render a product page paints while the tree is still
    // in flight. Asserting it here is what makes that render a property of the case rather than of timing.
    const refusal = failNext({ routeId: "categories.list" });
    await user.click(within(heading).getByRole("link"));

    expect(await headingNamed(product.name)).toBeInTheDocument();
    const trail = await screen.findByRole("navigation", { name: A11Y_COPY.BREADCRUMB_LABEL });
    expect(within(trail).getAllByRole("listitem")).toHaveLength(2);
    expect(within(trail).getAllByRole("link")).toEqual([
      within(trail).getByRole("link", { name: PAGE_TITLES.HOME }),
    ]);
    expect(within(trail).getByText(product.name)).toBeInTheDocument();
    refusal.disarm();
  });

  it("moves the product's own rating summary with the review the list gains", async () => {
    const product = PRODUCTS.find((entry) => entry.ratingCount > 0);
    if (product === undefined) throw new Error("The seeded catalogue holds no reviewed product.");

    // The review form is offered to a signed-in customer alone, so the session is taken through the real sign-in
    // screen with this product as the path it returns to, which is where the review prompt's own link leads.
    const { user } = renderApp({ route: loginPath(productPath(product.slug)) });
    await user.type(
      await screen.findByLabelText(content.ACCOUNT_COPY.EMAIL_LABEL, { exact: false }),
      DEMO_ACCOUNTS.CUSTOMER_EMAIL,
    );
    await user.type(
      screen.getByLabelText(content.ACCOUNT_COPY.PASSWORD_LABEL, { exact: false }),
      DEMO_ACCOUNTS.PASSWORD,
    );
    await user.click(
      screen.getByRole("button", { name: content.ACCOUNT_COPY.SIGN_IN_SUBMIT_LABEL }),
    );
    await screen.findByRole("heading", { level: 1, name: product.name });

    // The aggregate the page states before the write, read from the seeded record rather than typed.
    const seededSummary = textOf(detailRatingSummary());
    expect(seededSummary).toBe(
      ratingSummaryLabel(formatRatingValue(product.ratingAverage), product.ratingCount),
    );

    await user.click(screen.getByRole("tab", { name: CATALOG_COPY.REVIEWS_HEADING }));
    const reviews = screen.getByRole("region", { name: CATALOG_COPY.REVIEWS_HEADING });
    await waitFor(() =>
      expect(within(reviews).getAllByText(formatReviewCount(product.ratingCount))).not.toHaveLength(
        0,
      ),
    );

    const form = screen.getByRole("form", { name: CATALOG_COPY.WRITE_REVIEW_LABEL });
    await user.click(within(form).getByRole("radio", { name: SUBMITTED_STAR }));
    await user.type(
      within(form).getByLabelText(CATALOG_COPY.REVIEW_FORM_TITLE_LABEL),
      SUBMITTED_REVIEW_TITLE,
    );
    await user.type(
      within(form).getByLabelText(CATALOG_COPY.REVIEW_FORM_BODY_LABEL),
      SUBMITTED_REVIEW_BODY,
    );
    await user.click(
      within(form).getByRole("button", { name: CATALOG_COPY.REVIEW_FORM_SUBMIT_LABEL }),
    );

    // One write, two surfaces: the list gains the row the store now holds, and the summary above it states the
    // review set that row belongs to, so the page stops contradicting the list it is showing.
    const movedCount = formatReviewCount(product.ratingCount + 1);
    await waitFor(() => {
      expect(within(reviews).getAllByText(movedCount)).not.toHaveLength(0);
      expect(textOf(detailRatingSummary())).toContain(movedCount);
    });
  });
});

/*
 * The state every surface that can resolve nothing shares: the catch-all route, a category segment naming no
 * category and a product segment naming no product render the one view `src/components/ui/NotFoundView.tsx`
 * owns, so each names itself in the tab and heads itself with the page's one `<h1>`. The segments are written
 * out because a case's whole subject is an address that resolves to nothing.
 */
describe("an address the product cannot serve", () => {
  it.each([
    ["an unmatched address", "/this-route-does-not-exist"],
    ["a category the catalogue does not hold", "/category/does-not-exist"],
    ["a product the catalogue does not hold", "/product/does-not-exist"],
  ])("names %s in the tab and in its only heading", async (_case, route) => {
    renderApp({ route });

    expect(
      await screen.findByRole("heading", { level: 1, name: content.NOT_FOUND_COPY.TITLE }),
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // The tab is written by a passive effect after the view commits, so it is awaited to the same settle the
    // heading above is, rather than read on the frame the heading appears in.
    await waitFor(() =>
      expect(document.title).toBe(content.documentTitle(content.PAGE_TITLES.NOT_FOUND)),
    );
    expect(screen.getByText(content.NOT_FOUND_COPY.BODY)).toBeVisible();
  });
});
