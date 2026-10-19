/**
 * Path: tests/components/productGallery.test.tsx
 * Purpose: The gallery read from the outside: the imagery it orders and marks, the image it opens on, the selection a thumbnail or a key makes, and the empty state a product with no pictures reaches
 * Lines: 229
 */

import { describe, expect, it, vi } from "vitest";

import { ProductGallery } from "@/components/product/ProductGallery";
import type { Product, ProductImage } from "@/types/catalog";

import { makeProduct, makeProductImage } from "../fixtures";
import type { UserEvent } from "../testUtils";
import { renderWithProviders, screen, within } from "../testUtils";

/*
 * The gallery driven through its own props and its own controls: the product it is handed decides the imagery,
 * the opening index is the caller's, and every change is made through the thumbnails the strip renders — a
 * click on one, or a key on the focused one — so no case reaches into the component to move it. The images are
 * the fixture builders' and are handed over in reverse, so a strip that rendered them as given would show the
 * last image first rather than the one the data put at position zero.
 *
 * One thing the component guards is reported rather than forced: a thumbnail whose own element is missing,
 * which the rendered strip cannot produce. Every other branch of the component is reached below, the empty
 * state a product with no imagery renders included.
 */

// The imagery the strip is read from -----------------------------------------------------------------

/** The alt an image is named by: the data layer's own wording, or the product's name when that wording holds
 *  nothing — the same guarantee the gallery makes for the picture and its thumbnail. */
function altOf(image: ProductImage, product: Product): string {
  return image.alt.trim().length > 0 ? image.alt : product.name;
}

/** A product carrying one image per position, handed to the gallery in reverse. */
function galleryProduct(count: number): {
  readonly product: Product;
  readonly images: ProductImage[];
} {
  const base = makeProduct();
  const images = Array.from({ length: count }, (_slot, position) =>
    makeProductImage(base.name, { position }),
  );
  return { product: makeProduct({ images: [...images].reverse() }), images };
}

// Reading the rendered surface -----------------------------------------------------------------------

/** The strip of thumbnails: the group the gallery names with the product's own name. */
function stripFor(product: Product): HTMLElement {
  return screen.getByRole("group", { name: product.name });
}

/** The thumbnails the strip holds, in the order the gallery renders them. */
function thumbnailsFor(product: Product): HTMLElement[] {
  return within(stripFor(product)).getAllByRole("button");
}

/** The thumbnail the strip marks as the image being shown, found by the name that image gives it. */
function currentThumbnail(product: Product, alt: string): HTMLElement {
  const current = within(stripFor(product)).getByRole("button", { name: alt });
  if (current.getAttribute("aria-current") !== "true") {
    throw new Error(`The strip is not showing the image named "${alt}".`);
  }
  return current;
}

/** Sends one key to whatever holds the focus, which is the control the strip keeps tabbable. */
async function pressKey(user: UserEvent, key: string): Promise<void> {
  await user.keyboard(`{${key}}`);
}

// The imagery a product carries ----------------------------------------------------------------------

describe("the gallery a product's own imagery is shown in", () => {
  it("orders the imagery by position and marks the image it opened on", async () => {
    const { product, images } = galleryProduct(3);
    const { user } = renderWithProviders(<ProductGallery product={product} />);
    const first = images[0];
    const second = images[1];
    if (first === undefined || second === undefined)
      throw new Error("The case built too few images.");

    // One control per image, named by that image's own alt, and only the current one is in the tab order:
    // the strip is a single stop for a keyboard user rather than one stop per picture.
    const thumbnails = thumbnailsFor(product);
    expect(thumbnails).toHaveLength(images.length);
    for (const image of images) {
      expect(
        within(stripFor(product)).getByRole("button", { name: altOf(image, product) }),
      ).toBeInTheDocument();
    }
    const current = currentThumbnail(product, altOf(first, product));
    expect(current).toHaveAttribute("tabindex", "0");
    expect(thumbnails[1]).toHaveAttribute("tabindex", "-1");
    expect(thumbnails[0]).toBe(current);

    // The words of the image on the stage are the caption a sighted reader and a screen reader both get, and
    // they are the words of the image the data put at position zero rather than of the one handed over last.
    expect(screen.getByText(altOf(first, product))).toBeInTheDocument();
    expect(screen.queryByText(altOf(second, product))).toBeNull();

    // The strip is one stop in the page's order.
    await user.tab();
    expect(document.activeElement).toBe(current);
  });

  it.each<readonly [number, "first" | "last" | "second"]>([
    [-3, "first"],
    [1.5, "second"],
    [9, "last"],
    [Number.NaN, "first"],
  ])(
    "brings the image it opens on inside the imagery the product carries: %s",
    (_index, expected) => {
      const { product, images } = galleryProduct(3);
      const wanted =
        expected === "first"
          ? images[0]
          : expected === "second"
            ? images[1]
            : images[images.length - 1];
      if (wanted === undefined) throw new Error("The case built too few images.");

      renderWithProviders(<ProductGallery product={product} initialIndex={_index} />);

      // An index the strip cannot reach is brought inside the list rather than rejected: a gallery that
      // rendered nothing would be worse than one showing a picture.
      expect(currentThumbnail(product, altOf(wanted, product))).toBeInTheDocument();
      expect(screen.getByText(altOf(wanted, product))).toBeInTheDocument();
    },
  );

  it("selects the image a thumbnail asks for, reports it, and ignores the one already shown", async () => {
    const { product, images } = galleryProduct(3);
    const third = images[2];
    if (third === undefined) throw new Error("The case built too few images.");
    const onImageChange = vi.fn();
    const { user } = renderWithProviders(
      <ProductGallery product={product} onImageChange={onImageChange} />,
    );

    // A click moves the picture and the caption, and the caller is told which image the shopper settled on.
    await user.click(
      within(stripFor(product)).getByRole("button", { name: altOf(third, product) }),
    );

    expect(currentThumbnail(product, altOf(third, product))).toBeInTheDocument();
    expect(screen.getByText(altOf(third, product))).toBeInTheDocument();
    expect(onImageChange).toHaveBeenCalledTimes(1);
    expect(onImageChange).toHaveBeenCalledWith(third, images.length - 1);

    // The image already on the stage is not a change: nothing is reported and the strip stays where it is.
    await user.click(
      within(stripFor(product)).getByRole("button", { name: altOf(third, product) }),
    );

    expect(onImageChange).toHaveBeenCalledTimes(1);
    expect(currentThumbnail(product, altOf(third, product))).toBeInTheDocument();
  });

  it("walks the strip with the arrow keys, wraps at both ends and leaves the keys it does not answer", async () => {
    const { product, images } = galleryProduct(3);
    const [first, second, third] = images;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("The case built too few images.");
    }
    const { user } = renderWithProviders(<ProductGallery product={product} />);
    const thumbnailNamed = (image: ProductImage): HTMLElement =>
      within(stripFor(product)).getByRole("button", { name: altOf(image, product) });

    // The control that holds the focus is the image being shown, and a key moves both together so a keyboard
    // user follows the change instead of hunting for it.
    await user.tab();
    expect(document.activeElement).toBe(thumbnailNamed(first));

    // The left arrow from the first image reaches the last: a gallery is a loop rather than a list with two
    // dead ends.
    await pressKey(user, "ArrowLeft");
    expect(currentThumbnail(product, altOf(third, product))).toBe(document.activeElement);

    // The right arrow from the last reaches the first.
    await pressKey(user, "ArrowRight");
    expect(currentThumbnail(product, altOf(first, product))).toBe(document.activeElement);

    // Home reaches the first image, which is already shown, so the strip stays as it is.
    await pressKey(user, "Home");
    expect(currentThumbnail(product, altOf(first, product))).toBe(document.activeElement);

    // End reaches the last image.
    await pressKey(user, "End");
    expect(currentThumbnail(product, altOf(third, product))).toBe(document.activeElement);

    // A key the strip does not handle is left to the page: the picture on the stage does not move.
    await pressKey(user, "ArrowDown");
    expect(currentThumbnail(product, altOf(third, product))).toBe(document.activeElement);
    expect(screen.getByText(altOf(third, product))).toBeInTheDocument();

    // The strip still holds one tabbable control: the one it is showing.
    expect(thumbnailNamed(third)).toHaveAttribute("tabindex", "0");
    expect(thumbnailNamed(second)).toHaveAttribute("tabindex", "-1");
  });

  it("states the product's own words for a picture whose alt holds nothing", () => {
    const bare = makeProduct();
    const product = makeProduct({ images: [makeProductImage(bare.name, { alt: "   " })] });
    renderWithProviders(<ProductGallery product={product} />);

    // An empty alt would hide the picture and the control that names it, so the product's own name is what
    // both are named and captioned by.
    expect(screen.getByText(bare.name)).toBeInTheDocument();
    expect(within(stripFor(product)).getByRole("button", { name: bare.name })).toBeInTheDocument();
    expect(screen.getAllByAltText(bare.name).length).toBeGreaterThan(0);
  });

  it("renders the product's own words in place of the strip when it carries no imagery", () => {
    const bare = makeProduct({ images: [] });
    renderWithProviders(<ProductGallery product={bare} />);

    // The copy library holds no key that names this state, so the state is written in the product's own
    // words: its name and its summary, in the shared empty state, and no strip to walk.
    expect(screen.getByRole("heading", { name: bare.name })).toBeInTheDocument();
    expect(screen.getByText(bare.summary)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: bare.name })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
