/**
 * Path: tests/components/productList.test.tsx
 * Purpose: The result area's four states, its two placements and its recovery controls, and the tile it renders: the product's own figures, its unbuyable mark, its quick add and the two skeleton placements
 * Lines: 452
 */

import { describe, expect, it, vi } from "vitest";

import { ProductCard, ProductCardPlaceholder } from "@/components/product/ProductCard";
import type { ProductCardProps, ProductCardVariant } from "@/components/product/ProductCard";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/constants/config";
import {
  A11Y_COPY,
  CATALOG_COPY,
  COMMON_ACTIONS,
  EMPTY_STATES,
  FEEDBACK_COPY,
  cartButtonLabel,
  lowStockLabel,
  quickAddLabel,
  ratingSummaryLabel,
} from "@/constants/content";
import { ROUTES, productPath } from "@/constants/routes";
import { BRAND_DEFINITIONS } from "@/constants/taxonomy";
import { PRODUCTS } from "@/data/products";
import { ProductList } from "@/features/catalog/ProductList";
import type { Product } from "@/types/catalog";
import { formatMoney, formatRatingValue } from "@/utils/format";
import { DEFAULT_FILTER_STATE, filtersToPath } from "@/utils/queryParams";
import { brandId } from "@/utils/strings";

import { tileHeadings, tileNames, textOf } from "../helpers/journeyHarness";
import { makeApiError, makeProduct, makeProductImage } from "../fixtures";
import { renderApp, renderWithProviders, screen, waitFor, within } from "../testUtils";
import type { UserEvent } from "../testUtils";

/*
 * The result area a catalogue page composes and the tile it renders, driven from the outside: the list is
 * handed the products, the status of the read that produced them, the failure if there was one and the control
 * a caller offers in place of its own, so every state below is reached through the component's own props rather
 * than by standing in for the service that answers it. The tile is presentational in the same way — it reads no
 * cart, and the add it raises is the callback the composing surface hands in — so a case renders one tile with
 * a listener for that callback and asserts what the tile itself states.
 *
 * The subjects the fixtures build are the cases props alone can produce: a product with a brand the vocabulary
 * does not hold, one with no imagery, one whose image carries no alt and one the storefront cannot sell. Two
 * things the tile's own code guards are not reachable through the component's typed props and are reported
 * rather than forced: an absent currency, which the product shape requires, so the shared default the tile
 * falls back to is unreachable, and the notice a cart raises once a line has reached its ceiling, which belongs
 * to `useQuickAdd` in `src/state/CartContext.tsx` and not to the tile — the last case below drives that notice
 * through the real application, because nothing short of the mounted toast viewport can show it.
 */

// The subjects this file builds -------------------------------------------------------------------

/** Three products priced apart, so a case can tell one tile from the next by its own figures. */
const TILE_PRODUCTS: readonly Product[] = [
  makeProduct(),
  makeProduct({ name: "Cascade Speaker", sku: "CAS-SP-002", priceMinor: 12_900 }),
  makeProduct({ name: "Trailhead Kettle", sku: "TRL-KT-003", priceMinor: 3_499 }),
];

/** The seeded product the storefront holds two of, which is the line whose ceiling the last case reaches. */
const CEILING_PRODUCT = ((): Product => {
  const found = PRODUCTS.find(
    (product) => product.stockOnHand === 2 && product.status === "active",
  );
  if (found === undefined) throw new Error("The seeded catalogue holds no product two units deep.");
  return found;
})();

// Reading the rendered surface -------------------------------------------------------------------

/** The vocabulary's own name for the brand a product carries, so the tile's brand line is held to the
 *  taxonomy the tile reads it from rather than to a sentence written here. */
function brandNameFor(product: Product): string {
  const definition = BRAND_DEFINITIONS.find((entry) => brandId(entry.slug) === product.brandId);
  if (definition === undefined)
    throw new Error(`The vocabulary holds no brand "${product.brandId}".`);
  return definition.name;
}

/** The result area: the region the tiles or their placeholders fill, named as the page's own results list. */
function resultsList(): HTMLElement {
  return screen.getByRole("list", { name: CATALOG_COPY.RESULTS_REGION_LABEL });
}

/** The tiles a result area holds, as the elements it rendered: the placeholders are hidden from assistive
 *  technology, so the region's own children are what the count of them is read from. */
function tilesIn(list: HTMLElement): readonly Element[] {
  return [...list.children];
}

/** The one tile the case rendered, placed in the list a caller would place it in. */
function renderedTile(): HTMLElement {
  return screen.getByRole("listitem");
}

/** The action slot a tile renders: the box the quick add or its placeholder sits in, which the placement
 *  decides the parent of. */
function actionSlotIn(tile: Element): HTMLElement {
  const slot = tile.querySelector<HTMLElement>(".sp-product-card__actions");
  if (slot === null) throw new Error("The tile rendered no action slot.");
  return slot;
}

/** The body a tile renders, which is what the action slot travels with in the list placement. */
function bodyIn(tile: Element): HTMLElement {
  const body = tile.querySelector<HTMLElement>(".sp-product-card__body");
  if (body === null) throw new Error("The tile rendered no body.");
  return body;
}

/** The notices the application has raised, read from the region that carries them: the same sentence a notice
 *  states can stand in the page's own copy, so the words are asserted inside the region. */
async function toastRegion(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: A11Y_COPY.TOAST_REGION_LABEL });
}

/** Renders one tile with a listener standing in for the surface that owns the add, in the list a caller places
 *  a tile in. */
function renderTile(
  product: Product,
  props: Partial<
    Pick<ProductCardProps, "variant" | "showQuickAdd" | "priority" | "brandName">
  > = {},
): {
  readonly tile: HTMLElement;
  readonly onAddToCart: ReturnType<typeof vi.fn>;
  readonly user: UserEvent;
} {
  const onAddToCart = vi.fn();
  const { user } = renderWithProviders(
    <ul>
      <ProductCard product={product} onAddToCart={onAddToCart} {...props} />
    </ul>,
  );
  return { tile: renderedTile(), onAddToCart, user };
}

// The four states a result area renders ------------------------------------------------------------

describe("the result area a page composes", () => {
  it("stands the page's own placeholders in while the read is in flight", async () => {
    renderWithProviders(<ProductList items={[]} status="idle" placeholderCount={3} />);

    // A read that has not answered says nothing about being empty: the region states that it is filling and
    // holds one placeholder tile per product the page paged by.
    const list = resultsList();
    await waitFor(() => expect(list).toHaveAttribute("aria-busy", "true"));
    expect(tilesIn(list)).toHaveLength(3);
    // Nothing is counted out to a reader: the placeholders are decorative, so the region offers no rows.
    expect(within(list).queryAllByRole("listitem")).toHaveLength(0);
    expect(within(list).queryByRole("status")).toBeNull();
  });

  it("lays the placeholders out in the placement it was given, at the count the page paged by", async () => {
    renderWithProviders(
      <ProductList items={[]} status="loading" layout="list" placeholderCount={Number.NaN} />,
    );

    // A count that does not describe a page is replaced by the configured page size rather than rendering
    // nothing, and the list placement is the one the container is laid out in.
    const list = resultsList();
    await waitFor(() => expect(list).toHaveClass("sp-product-list"));
    expect(tilesIn(list)).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(list).not.toHaveClass("sp-product-grid");
  });

  it("offers the retry on the recovery block when the caller has no better way out", async () => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(
      <ProductList items={[]} status="success" onRetry={onRetry} />,
    );

    // A successful read that matched nothing states what the filters left and offers the one control that
    // can change it, which is the caller's own reload.
    expect(
      await screen.findByRole("heading", { name: EMPTY_STATES.catalogue.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(EMPTY_STATES.catalogue.description)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: COMMON_ACTIONS.RETRY }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the caller's own control in place of the retry it would otherwise offer", async () => {
    renderWithProviders(
      <ProductList
        items={[]}
        status="success"
        onRetry={vi.fn()}
        emptyAction={<a href={ROUTES.CATALOG}>{EMPTY_STATES.catalogue.actionLabel}</a>}
      />,
    );

    // A catalogue emptied by its filters is emptied by the filters rather than by a failed request, so the
    // caller's way out is the one control rendered and no second, useless one stands beside it.
    expect(
      await screen.findByRole("link", { name: EMPTY_STATES.catalogue.actionLabel }),
    ).toHaveAttribute("href", ROUTES.CATALOG);
    expect(screen.getByRole("heading", { name: EMPTY_STATES.catalogue.title })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: COMMON_ACTIONS.RETRY })).toBeNull();
  });

  it("states that nothing matched without any control when the caller offers none", async () => {
    renderWithProviders(<ProductList items={[]} status="success" />);

    // The headline and its explanation alone: neither a retry the caller did not supply nor an action it
    // did.
    expect(
      await screen.findByRole("heading", { name: EMPTY_STATES.catalogue.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(EMPTY_STATES.catalogue.description)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("carries the failure the read shaped with the retry the caller passes", async () => {
    const onRetry = vi.fn();
    const error = makeApiError({ message: FEEDBACK_COPY.ERROR_STATE_BODY });
    const { user } = renderWithProviders(
      <ProductList items={[]} status="error" error={error} onRetry={onRetry} />,
    );

    // The failure is a value at this seam, so the message the seam shaped is what the failure states.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_TITLE);
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_BODY);
    await user.click(screen.getByRole("button", { name: COMMON_ACTIONS.RETRY }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("states the neutral failure for a read that failed without a shaped error or a retry", async () => {
    renderWithProviders(<ProductList items={[]} status="error" />);

    // A failure that carried no error still says what happened and what to do, and a caller that offered no
    // retry leaves the failure with no control rather than a button that does nothing.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_TITLE);
    expect(alert).toHaveTextContent(FEEDBACK_COPY.ERROR_STATE_BODY);
    expect(within(alert).queryByRole("button")).toBeNull();
  });

  it("lists one tile per product, in the placement it was given", async () => {
    renderWithProviders(<ProductList items={TILE_PRODUCTS} status="success" layout="list" />);

    const list = resultsList();
    expect(list).toHaveClass("sp-product-list");
    const tiles = await within(list).findAllByRole("listitem");
    expect(tiles).toHaveLength(TILE_PRODUCTS.length);
    for (const product of TILE_PRODUCTS) {
      const link = within(list).getByRole("link", { name: product.name });
      expect(link).toHaveAttribute("href", productPath(product.slug));
      // The surface composing the grid owns the add, so every tile is handed a control that names itself
      // and the product it adds.
      expect(
        within(list).getByRole("button", { name: quickAddLabel(product.name) }),
      ).toBeInTheDocument();
    }
  });
});

// The tile a page renders --------------------------------------------------------------------------

describe("the catalogue tile", () => {
  it("presents the product's own figures and hands its add to the surface that owns it", async () => {
    const product = TILE_PRODUCTS[0];
    if (product === undefined) throw new Error("The case built no product to render.");
    const { tile, onAddToCart, user } = renderTile(product);

    // Every figure is the product's own: the brand from the taxonomy, the name as the link's text, the
    // rating with its review count as one sentence and the price as the money it is.
    expect(await within(tile).findByRole("link", { name: product.name })).toHaveAttribute(
      "href",
      productPath(product.slug),
    );
    expect(within(tile).getByRole("heading", { level: 3, name: product.name })).toBeInTheDocument();
    expect(within(tile).getByText(brandNameFor(product))).toBeInTheDocument();
    expect(
      within(tile).getByText(
        ratingSummaryLabel(formatRatingValue(product.ratingAverage), product.ratingCount),
      ),
    ).toBeInTheDocument();
    expect(
      within(tile).getByText(formatMoney(product.priceMinor, product.currency)),
    ).toBeInTheDocument();

    // The add is the surface's: the tile calls the callback it was handed with its own product and reads
    // nothing else.
    const quickAdd = within(tile).getByRole("button", { name: quickAddLabel(product.name) });
    expect(quickAdd).not.toHaveAttribute("aria-disabled");
    await user.click(quickAdd);
    expect(onAddToCart).toHaveBeenCalledWith(product);

    // In the grid placement the action slot is the tile's own last row rather than part of its body.
    expect(bodyIn(tile).contains(actionSlotIn(tile))).toBe(false);
  });

  it("takes the caller's brand name over the one the vocabulary holds", async () => {
    const product = makeProduct();
    const { tile } = renderTile(product, { brandName: "  Northcrest  " });
    expect(await within(tile).findByText("Northcrest")).toBeInTheDocument();
  });

  it("shows no brand for an identifier nothing resolves", async () => {
    const product = makeProduct({ brandId: brandId("absent-brand") });
    const { tile } = renderTile(product);

    // The tile still names the product; what it refuses is the raw identifier, which is not a word a shopper
    // should read.
    expect(await within(tile).findByRole("link", { name: product.name })).toBeInTheDocument();
    expect(within(tile).queryByText(/brd_/)).toBeNull();
  });

  it("keeps its media box for a product with no imagery rather than reflowing the tile", async () => {
    const product = makeProduct({ images: [] });
    const { tile } = renderTile(product);

    expect(await within(tile).findByRole("link", { name: product.name })).toBeInTheDocument();
    expect(within(tile).queryByRole("img")).toBeNull();
  });

  it("names the picture with the product's own name when the image's alt holds nothing", async () => {
    const product = makeProduct();
    const blank = makeProductImage(product.name, { alt: "   " });
    const { tile } = renderTile(makeProduct({ images: [blank] }));

    expect(await within(tile).findByAltText(product.name)).toBeInTheDocument();
  });

  it("reports a product it cannot sell and describes the quick add with the mark that explains it", async () => {
    const product = makeProduct({ name: "Aurora Desk Lamp", stockOnHand: 0 });
    const { tile, onAddToCart, user } = renderTile(product);

    // The availability words are stated as text, the mark over the image says the same thing, and the control
    // reports itself unavailable in the state that keeps it in the tab order.
    expect(await within(tile).findByText(CATALOG_COPY.OUT_OF_STOCK_LABEL)).toBeInTheDocument();
    expect(within(tile).getByText(CATALOG_COPY.QUICK_ADD_UNAVAILABLE_LABEL)).toBeInTheDocument();
    const quickAdd = within(tile).getByRole("button", { name: quickAddLabel(product.name) });
    expect(quickAdd).toHaveAttribute("aria-disabled", "true");

    // The control is described by the mark, so a reader who reaches it is told why it will not act. What the
    // activation does about it is the composing surface's rule, which is why the tile still hands its product
    // on rather than deciding here.
    const description = document.getElementById(quickAdd.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toContain(CATALOG_COPY.QUICK_ADD_UNAVAILABLE_LABEL);
    await user.click(quickAdd);
    expect(onAddToCart).toHaveBeenCalledWith(product);
  });

  it.each<readonly [ProductCardVariant, "body" | "tile"]>([
    ["grid", "tile"],
    ["list", "body"],
  ])("moves the quick add into the %s placement's own slot", (variant, owner) => {
    const product = makeProduct();
    const { tile } = renderTile(product, { variant });

    const slot = actionSlotIn(tile);
    const parent = owner === "body" ? bodyIn(tile) : tile;
    expect(parent.contains(slot)).toBe(true);
    expect(
      within(tile).getByRole("button", { name: quickAddLabel(product.name) }),
    ).toBeInTheDocument();
  });

  it("withholds the quick add from a surface whose own container is the link", async () => {
    const product = makeProduct();
    const { tile } = renderTile(product, { showQuickAdd: false });

    expect(await within(tile).findByRole("link", { name: product.name })).toBeInTheDocument();
    expect(within(tile).queryByRole("button", { name: quickAddLabel(product.name) })).toBeNull();
  });

  it("holds its picture for the viewport it is already in when the surface marks it eager", async () => {
    const { tile } = renderTile(makeProduct(), { priority: true });

    const picture = await within(tile).findByRole("img");
    expect(picture).toHaveAttribute("loading", "eager");
    expect(picture.getAttribute("fetchpriority")).toBe("high");
  });

  it("leaves its picture to the viewport when nothing marks it eager", async () => {
    const { tile } = renderTile(makeProduct());

    const picture = await within(tile).findByRole("img");
    expect(picture).toHaveAttribute("loading", "lazy");
    expect(picture.getAttribute("fetchpriority")).toBe("auto");
  });

  it.each<readonly [ProductCardVariant, "body" | "tile"]>([
    ["grid", "tile"],
    ["list", "body"],
  ])("stands a hidden placeholder in for a tile in the %s placement", (variant, owner) => {
    const { container } = renderWithProviders(
      <ul>
        <ProductCardPlaceholder variant={variant} />
      </ul>,
    );

    // The placeholder is decorative: it is not a row a reader is counted, and it wears the tile's own regions
    // so the grid reserves the box the loaded tile fills — the action slot moving with the body in the list
    // placement, exactly as the loaded tile's does.
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    const placeholder = container.querySelector<HTMLElement>(".sp-product-card--placeholder");
    if (placeholder === null) throw new Error("The placeholder rendered no tile.");
    const slot = actionSlotIn(placeholder);
    const parent = owner === "body" ? bodyIn(placeholder) : placeholder;
    expect(parent.contains(slot)).toBe(true);
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
  });

  it("stands a placeholder in with the tile's own default placement", () => {
    const { container } = renderWithProviders(<ProductCardPlaceholder />);
    const placeholder = container.querySelector<HTMLElement>(".sp-product-card--placeholder");
    if (placeholder === null) throw new Error("The placeholder rendered no tile.");
    expect(placeholder.contains(actionSlotIn(placeholder))).toBe(true);
  });

  it("raises the notice the cart holds once a tile's line has reached its ceiling", async () => {
    // The whole result set fits one page, so the tile for the product is rendered whatever rank the term
    // gives it among the products that share its words.
    const { user } = renderApp({
      route: filtersToPath(ROUTES.CATALOG, {
        ...DEFAULT_FILTER_STATE,
        q: CEILING_PRODUCT.name,
        pageSize: PAGE_SIZE_OPTIONS[PAGE_SIZE_OPTIONS.length - 1] ?? DEFAULT_PAGE_SIZE,
      }),
    });
    const heading = await waitFor(() => {
      const found = tileHeadings().find((entry) => textOf(entry) === CEILING_PRODUCT.name);
      if (found === undefined) throw new Error(`The search rendered: ${tileNames().join(" | ")}`);
      return found;
    });
    const quickAdd = within(heading.closest("li") ?? heading).getByRole("button", {
      name: quickAddLabel(CEILING_PRODUCT.name),
    });

    // The tile adds one unit at a time and the line may hold as many as the storefront stocks, so the add
    // that would pass that number is the one the cart reports rather than absorbs.
    await user.click(quickAdd);
    await user.click(quickAdd);
    expect(await screen.findByRole("button", { name: cartButtonLabel(2) })).toBeInTheDocument();

    await user.click(quickAdd);

    expect(
      await within(await toastRegion()).findByText(lowStockLabel(CEILING_PRODUCT.stockOnHand)),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: cartButtonLabel(2) })).toBeInTheDocument();
  });
});
