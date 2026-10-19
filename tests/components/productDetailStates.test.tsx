/**
 * Path: tests/components/productDetailStates.test.tsx
 * Purpose: The product route's own states read from the outside: the segment it resolves, the trail, tabs and buy column it composes, and the failure, not-found and shortened-trail states its two reads can meet
 * Lines: 424
 */

import { describe, expect, it } from "vitest";

import {
  A11Y_COPY,
  CATALOG_COPY,
  CART_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FEEDBACK_COPY,
  NOT_FOUND_COPY,
  PAGE_TITLES,
  addedToCartMessage,
  cartButtonLabel,
  documentTitle,
  lowStockLabel,
  quantityLabel,
  ratingSummaryLabel,
} from "@/constants/content";
import { ROUTES, productPath } from "@/constants/routes";
import { BRANDS, CATEGORIES } from "@/data/categories";
import { PRODUCTS } from "@/data/products";
import { ProductDetailPage } from "@/features/catalog/ProductDetailPage";
import type { Category, Product } from "@/types/catalog";
import { formatMoney, formatRatingValue } from "@/utils/format";

import { headingNamed } from "../helpers/journeyHarness";
import type { UserEvent } from "../testUtils";
import { failNext, renderApp, renderWithProviders, screen, waitFor, within } from "../testUtils";

/*
 * The product route driven from the address a visitor types: every case starts at `/product/<segment>` in the
 * real application, so the read under test is the one the route itself issues rather than a component's props
 * arranged for it. The subjects are the seeded records that put the page in each state — a product the
 * storefront can sell, one it cannot, one the cart can take no more of, one whose identifier is not its slug's
 * own spelling and one nobody has reviewed — and every sentence and figure asserted below comes from the copy
 * module or from the record, so nothing is typed here.
 *
 * Two states a route can reach are not reachable from the seed and are reported rather than forced: a product
 * with no specifications and a category holding nothing else both need data the catalogue does not carry, and
 * a read that settles with neither a payload nor a failure cannot be produced by the shipped transport, which
 * resolves every failure as a value.
 *
 * The failures are armed at the seam. The product read goes through the listing route, which the catalogue
 * provider asks on mount as well, so a case that refuses it arms the request twice: whichever of the two the
 * provider's own read takes, the page's read is the other one and is refused.
 */

// The subjects this file reads, taken from the seeded collection --------------------------------

/** The first seeded product a predicate holds for, or a failure naming what the seed was expected to hold: a
 *  case whose subject is missing is a broken assumption about the data, not a screen to assert against. */
function productWhere(matches: (product: Product) => boolean, description: string): Product {
  const found = PRODUCTS.find(matches);
  if (found === undefined)
    throw new Error(`The seeded catalogue holds no product that is ${description}.`);
  return found;
}

/** A product the storefront can sell and a shopper has reviewed, so its buy controls act and its rating is
 *  the figure the product carries rather than the words the unreviewed state states. */
const SELLABLE = productWhere(
  (product) => product.stockOnHand > product.lowStockThreshold && product.ratingCount > 0,
  "in stock above its low-stock line and reviewed",
);

/** A product nobody has reviewed: the one whose buy column states the words instead of a figure. */
const UNREVIEWED = productWhere(
  (product) => product.ratingCount === 0 && product.stockOnHand > 0,
  "in stock and unreviewed",
);

/** A product the storefront cannot sell, which is the state both buy controls report themselves in. */
const UNSELLABLE = productWhere((product) => product.stockOnHand === 0, "out of stock");

/** A product the cart holds only a couple of, which is what lets a second add reach the line's ceiling. */
const CEILING = productWhere((product) => product.stockOnHand === 2, "held two units deep");

/** The one product whose identifier is not its slug's own spelling: the seed cut a long name and
 *  disambiguated the remainder with a hash, so an address carrying the slug is a segment the detail endpoint
 *  cannot key by and only the listing scan resolves. */
const HASHED_SEGMENT = productWhere(
  (product) => !product.id.endsWith(product.slug),
  "addressed by a slug its identifier does not spell",
);

/** A segment that names no product: the route's fourth state, reached by asking for something absent. */
const ABSENT_SEGMENT = "no-such-product-in-the-catalogue";

// Reading the rendered surface -------------------------------------------------------------------

/** The buy column: the figures, the stepper and the two buy controls are the product's own, and the words an
 *  unreviewed product states stand here rather than beside the rating a reviewed one shows. */
function buyColumn(): HTMLElement {
  const column = document.querySelector<HTMLElement>(".sp-product-detail__aside");
  if (column === null) throw new Error("The product route rendered no buy column.");
  return column;
}

/** The trail the header draws above the product, named by the label the header gives it. */
function breadcrumbTrail(): HTMLElement {
  return screen.getByRole("navigation", { name: A11Y_COPY.BREADCRUMB_LABEL });
}

/** The button a name reaches on the page. */
function buttonNamed(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/** The quantity field the buy column offers, which a product with nothing to buy does not render. */
function quantityField(product: Product): HTMLElement {
  return screen.getByRole("spinbutton", { name: quantityLabel(product.name) });
}

/** Moves the quantity one step through the control that carries the step in its own name. */
async function stepQuantity(user: UserEvent, product: Product, step: string): Promise<void> {
  await user.click(screen.getByRole("button", { name: `${quantityLabel(product.name)}: ${step}` }));
}

/** The notices the application has raised, read from the region that carries them: the words are asserted
 *  inside it because the same sentence a notice states can stand in the page's own copy. */
async function toastRegion(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: A11Y_COPY.TOAST_REGION_LABEL });
}

/** The category a product sits in, and the category above it: what the trail above the product is built from. */
function categoriesOf(product: Product): {
  readonly category: Category;
  readonly parent: Category;
} {
  const category = CATEGORIES.find((entry) => entry.id === product.categoryId);
  if (category === undefined) throw new Error(`No seeded category holds "${product.name}".`);
  const parent = CATEGORIES.find((entry) => entry.id === category.parentId);
  if (parent === undefined) throw new Error(`The category of "${product.name}" sits under none.`);
  return { category, parent };
}

/** The name the vocabulary gives the brand a product carries. */
function brandNameOf(product: Product): string {
  const brand = BRANDS.find((entry) => entry.id === product.brandId);
  if (brand === undefined) throw new Error(`No seeded brand is "${product.brandId}".`);
  return brand.name;
}

// The page one product is read from --------------------------------------------------------------

describe("the product route a visitor opens", () => {
  it("resolves the segment into the product, with its trail, its figures and its gallery", async () => {
    renderApp({ route: productPath(SELLABLE.slug) });

    // The address carries the readable slug, and the read that answers it walks the listing for the row whose
    // slug it is: the product's own name is what the page takes its heading and its title from.
    expect(await headingNamed(SELLABLE.name)).toBeInTheDocument();
    expect(document.title).toBe(documentTitle(SELLABLE.name));

    // The trail above it: the home route, the parent category and the category, each a link, with the
    // product's own name as the crumb the visitor is on and no link for it.
    const { category, parent } = categoriesOf(SELLABLE);
    const trail = breadcrumbTrail();
    const links = within(trail).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      PAGE_TITLES.HOME,
      parent.name,
      category.name,
    ]);
    expect(links[0]).toHaveAttribute("href", ROUTES.HOME);
    expect(within(trail).getByText(SELLABLE.name)).toHaveAttribute("aria-current", "page");

    // The buy column's own figures: who made it, what it is sold as, what it costs, the rating as one
    // sentence and the availability in the library's words.
    const column = buyColumn();
    expect(within(column).getByText(brandNameOf(SELLABLE))).toBeInTheDocument();
    expect(within(column).getByText(SELLABLE.sku)).toBeInTheDocument();
    expect(
      within(column).getByText(formatMoney(SELLABLE.priceMinor, SELLABLE.currency)),
    ).toBeInTheDocument();
    expect(
      within(column).getByText(
        ratingSummaryLabel(formatRatingValue(SELLABLE.ratingAverage), SELLABLE.ratingCount),
      ),
    ).toBeInTheDocument();
    expect(within(column).getByText(CATALOG_COPY.IN_STOCK_LABEL)).toBeInTheDocument();
    expect(quantityField(SELLABLE)).toHaveValue(1);

    // The imagery: the strip names the product and holds one control per image, the first one current, and
    // the caption under it states the words of the image on the stage.
    const images = SELLABLE.images;
    const strip = screen.getByRole("group", { name: SELLABLE.name });
    expect(within(strip).getAllByRole("button")).toHaveLength(images.length);
    expect(within(strip).getAllByRole("button")[0]).toHaveAttribute("aria-current", "true");
    expect(screen.getByText(images[0]?.alt ?? SELLABLE.name)).toBeInTheDocument();
  });

  it("resolves an address carrying a slug the product's identifier does not spell", async () => {
    renderApp({ route: productPath(HASHED_SEGMENT.slug) });

    // The scan is what makes this address exact: the slug is not the identifier's suffix, so a keyed read
    // would answer the not-found state here and the product would never be named.
    expect(await headingNamed(HASHED_SEGMENT.name)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: NOT_FOUND_COPY.TITLE })).toBeNull();
  });

  it("states the unreviewed words in place of a rating a product nobody has reviewed does not have", async () => {
    renderApp({ route: productPath(UNREVIEWED.slug) });

    await headingNamed(UNREVIEWED.name);

    // A nought average from no reviews is not a score, so the column states what the product lacks rather
    // than a figure, and the sentence a rated product carries is not announced anywhere on the page.
    expect(within(buyColumn()).getByText(EMPTY_STATES.reviews.title)).toBeInTheDocument();
    expect(
      screen.queryByText(
        ratingSummaryLabel(formatRatingValue(UNREVIEWED.ratingAverage), UNREVIEWED.ratingCount),
      ),
    ).toBeNull();
  });

  it("walks the three tabs it composes and hosts the review list in the third", async () => {
    const { user } = renderApp({ route: productPath(SELLABLE.slug) });
    await headingNamed(SELLABLE.name);

    // The description tab is the one the page opens on: the long description and the features it lists.
    expect(screen.getByText(SELLABLE.description)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: CATALOG_COPY.FEATURES_HEADING }),
    ).toBeInTheDocument();

    // The specifications tab pairs every label with its value.
    await user.click(screen.getByRole("tab", { name: CATALOG_COPY.SPECIFICATIONS_HEADING }));
    const firstSpec = SELLABLE.specs[0];
    if (firstSpec === undefined) throw new Error(`"${SELLABLE.name}" carries no specifications.`);
    expect(await screen.findByText(firstSpec.label)).toBeInTheDocument();
    expect(screen.getByText(firstSpec.value)).toBeInTheDocument();

    // The reviews tab hosts the review section, which owns the list, its filter and its paging itself.
    await user.click(screen.getByRole("tab", { name: CATALOG_COPY.REVIEWS_HEADING }));
    expect(
      await screen.findByRole("region", { name: CATALOG_COPY.REVIEWS_HEADING }),
    ).toBeInTheDocument();
  });
});

// The two ways a shopper orders what they are reading ---------------------------------------------

describe("the buy controls a product's own figures govern", () => {
  it("refuses both controls, without touching the cart, for a product the storefront cannot sell", async () => {
    const { user } = renderApp({ route: productPath(UNSELLABLE.slug) });
    await headingNamed(UNSELLABLE.name);

    // Nothing is offered to buy, so no quantity field is rendered at all, and both controls report
    // themselves unavailable in the state the sheet dims rather than by leaving the tab order.
    expect(screen.queryByRole("spinbutton", { name: quantityLabel(UNSELLABLE.name) })).toBeNull();
    const addToCart = buttonNamed(CATALOG_COPY.ADD_TO_CART_LABEL);
    const buyNow = buttonNamed(CATALOG_COPY.BUY_NOW_LABEL);
    expect(addToCart).toHaveAttribute("aria-disabled", "true");
    expect(buyNow).toHaveAttribute("aria-disabled", "true");
    // The refusal is stated twice over one figure: the stock line the reader sees, and the description both
    // controls point at, so a reader who reaches one of them is told why it is refused.
    expect(
      within(buyColumn()).getByText(CATALOG_COPY.OUT_OF_STOCK_LABEL, {
        ignore: ".sp-visually-hidden",
      }),
    ).toBeInTheDocument();
    const refusal = document.getElementById(addToCart.getAttribute("aria-describedby") ?? "");
    expect(refusal).not.toBeNull();
    expect(refusal).toHaveTextContent(CATALOG_COPY.OUT_OF_STOCK_LABEL);

    // A control the shopper can reach either acts or explains itself, and a product with nothing to sell
    // can do neither: the cart is left as it was and neither control opens the basket or leaves the page.
    await user.click(addToCart);
    await user.click(buyNow);

    expect(buttonNamed(cartButtonLabel(0))).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: CART_COPY.MINI_CART_HEADING })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: UNSELLABLE.name })).toBeInTheDocument();
  });

  it("adds the quantity chosen, opens the cart it went into and reports the ceiling the line reached", async () => {
    const { user } = renderApp({ route: productPath(CEILING.slug) });
    await headingNamed(CEILING.name);

    // Two units, which is the whole of what the product is stocked with.
    await stepQuantity(user, CEILING, COMMON_ACTIONS.ADD);
    expect(quantityField(CEILING)).toHaveValue(CEILING.stockOnHand);

    // The add reports itself twice over: the confirmation names the product where the visitor is looking,
    // and the basket it went into is opened on the line it holds.
    await user.click(buttonNamed(CATALOG_COPY.ADD_TO_CART_LABEL));
    const drawer = await screen.findByRole("dialog", { name: CART_COPY.MINI_CART_HEADING });
    expect(
      await within(drawer).findByRole("spinbutton", { name: quantityLabel(CEILING.name) }),
    ).toHaveValue(CEILING.stockOnHand);
    expect(
      within(await toastRegion()).getByText(addedToCartMessage(CEILING.name)),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: CART_COPY.MINI_CART_HEADING })).toBeNull(),
    );
    expect(buttonNamed(cartButtonLabel(CEILING.stockOnHand))).toBeInTheDocument();

    // The line holds all the cart can take of it, so the next add is the one case the panel reports rather
    // than absorbs: the ceiling is announced, nothing is added and no basket is opened on nothing.
    await stepQuantity(user, CEILING, COMMON_ACTIONS.REMOVE);
    expect(quantityField(CEILING)).toHaveValue(1);
    await user.click(buttonNamed(CATALOG_COPY.ADD_TO_CART_LABEL));

    expect(
      await within(await toastRegion()).findByText(lowStockLabel(CEILING.stockOnHand)),
    ).toBeInTheDocument();
    expect(buttonNamed(cartButtonLabel(CEILING.stockOnHand))).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: CART_COPY.MINI_CART_HEADING })).toBeNull();
  });

  it("sends a shopper who buys now straight to the checkout with the line in the cart", async () => {
    const { user } = renderApp({ route: productPath(SELLABLE.slug) });
    await headingNamed(SELLABLE.name);

    await user.click(buttonNamed(CATALOG_COPY.BUY_NOW_LABEL));

    expect(await headingNamed(PAGE_TITLES.CHECKOUT)).toBeInTheDocument();
    expect(
      within(await toastRegion()).getByText(addedToCartMessage(SELLABLE.name)),
    ).toBeInTheDocument();
    expect(buttonNamed(cartButtonLabel(1))).toBeInTheDocument();
  });
});

// The read that feeds the strip beside the product ------------------------------------------------

describe("the related products the page offers beside the one it is showing", () => {
  it("states the strip's failure with its retry, and re-reads the strip the retry asks for", async () => {
    const refusal = failNext({ routeId: "products.related" });
    const { user } = renderApp({ route: productPath(SELLABLE.slug) });
    await headingNamed(SELLABLE.name);

    // The strip settles on its own, so the product above it is readable while the failure stands, and the
    // heading row that names the landmark is rendered in every state.
    const strip = screen.getByRole("region", { name: CATALOG_COPY.RELATED_HEADING });
    const alert = await within(strip).findByRole("alert");
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_BODY);

    // The failure is the seam's and it is one-shot, so the retry answers with the neighbours themselves.
    refusal.disarm();
    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    await waitFor(() => expect(within(strip).getAllByRole("listitem").length).toBeGreaterThan(0));
    expect(within(strip).queryByRole("alert")).toBeNull();
  });
});

// The fourth state, which is not this page at all -------------------------------------------------

describe("an address that names no product", () => {
  it("renders the not-found view in place of the header and the body", async () => {
    renderApp({ route: productPath(ABSENT_SEGMENT) });

    expect(await headingNamed(NOT_FOUND_COPY.TITLE)).toBeInTheDocument();
    expect(screen.getByText(NOT_FOUND_COPY.BODY)).toBeInTheDocument();
    expect(document.title).toBe(documentTitle(PAGE_TITLES.NOT_FOUND));

    // The route's own header is gone with the product, so no trail claims a page that is not there and the
    // not-found heading is the page's only principal one.
    expect(screen.queryByRole("navigation", { name: A11Y_COPY.BREADCRUMB_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: CATALOG_COPY.ADD_TO_CART_LABEL })).toBeNull();
  });

  it("renders the same view for an address carrying no segment at all", async () => {
    renderWithProviders(<ProductDetailPage />, { route: ROUTES.PRODUCT });

    expect(await headingNamed(NOT_FOUND_COPY.TITLE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CATALOG_COPY.ADD_TO_CART_LABEL })).toBeNull();
  });
});

// The failure of the read that names the product, and the trail a failed category read shortens -----

describe("the reads the route's header and body are named by", () => {
  it("states the product read's failure with its retry, and re-reads the product the retry asks for", async () => {
    const refusal = failNext({ routeId: "products.list" });
    failNext({ routeId: "products.list" });
    const { user } = renderApp({ route: productPath(SELLABLE.slug) });

    // The page opens on the route's own name while the product is unknown, and the one read that names it
    // having failed leaves the alert carrying the failure and the way to ask again.
    await headingNamed(PAGE_TITLES.PRODUCT);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_BODY);
    expect(screen.queryByRole("navigation", { name: A11Y_COPY.BREADCRUMB_LABEL })).toBeNull();
    expect(screen.queryByText(SELLABLE.description)).toBeNull();

    refusal.disarm();
    await user.click(within(alert).getByRole("button", { name: COMMON_ACTIONS.RETRY }));

    expect(await headingNamed(SELLABLE.name)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(SELLABLE.description)).toBeInTheDocument();
  });

  it("keeps the trail at the home route and the product when the category read fails", async () => {
    failNext({ routeId: "categories.list" });
    renderApp({ route: productPath(SELLABLE.slug) });

    // The category read feeds the trail alone, so a failure there shortens it rather than replacing the
    // product the visitor asked for: the page they opened still reads as the page, with no crumb invented
    // for a category the read could not name.
    expect(await headingNamed(SELLABLE.name)).toBeInTheDocument();
    const { category, parent } = categoriesOf(SELLABLE);
    const trail = breadcrumbTrail();
    expect(within(trail).getAllByRole("link")).toHaveLength(1);
    expect(within(trail).getByRole("link", { name: PAGE_TITLES.HOME })).toHaveAttribute(
      "href",
      ROUTES.HOME,
    );
    expect(within(trail).queryByText(parent.name)).toBeNull();
    expect(within(trail).queryByText(category.name)).toBeNull();
    expect(within(trail).getByText(SELLABLE.name)).toHaveAttribute("aria-current", "page");
  });
});
