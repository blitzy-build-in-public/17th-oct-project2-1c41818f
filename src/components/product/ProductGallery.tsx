/**
 * Path: src/components/product/ProductGallery.tsx
 * Purpose: Product imagery with a thumbnail strip, keyboard navigation and alt text
 * Lines: 271
 */

import { useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";

import { EmptyState } from "@/components/ui/Feedback";
import type { Product, ProductImage } from "@/types/catalog";

/*
 * Class contract. `src/styles/catalog-detail.css` is the sole definition site of this block — it is the sheet
 * `src/styles/catalog.css` loads with `@import "./catalog-detail.css";`. No stylesheet is imported here. Every
 * class below is consumed by name: `sp-gallery` for the block, `sp-gallery__stage` for the box the current image
 * sits in, `sp-gallery__image` for that image, `sp-gallery__thumbs` for the strip, `sp-gallery__thumb` for one
 * image's control and `sp-gallery__caption` for the line under the strip. State is carried by the attribute and
 * never by a second class: the sheet paints the current thumbnail through `[aria-current="true"]` — the accent
 * plus a thicker border, so the mark survives greyscale as well as colour — and the picture inside a thumbnail
 * is cropped to its box by the `src/styles/catalog.css` rule written for `.sp-gallery__thumb img`.
 *
 * The thumbnails are the plain `<button>` the sheet owns rather than a member of
 * `src/components/ui/Button.tsx`, for the reason `src/components/ui/Tabs.tsx` states for its own family:
 * `.sp-gallery__thumb` declares the control's whole visual contract — its square size, padding, border, radius
 * and background — and the button family's base rule, written for a standalone labelled control, would compete
 * with the rule that owns the element. The sheet publishes no class for a previous or a next control either,
 * and `sp-gallery__stage` places a single centred child, so the arrow-key walk below is the gallery's step
 * control and no unstyled control is rendered beside the stage to duplicate it.
 */

/** The class names of this block, named once so a render body repeats no string. */
const CLASSES = {
  root: "sp-gallery",
  stage: "sp-gallery__stage",
  image: "sp-gallery__image",
  thumbs: "sp-gallery__thumbs",
  thumb: "sp-gallery__thumb",
  caption: "sp-gallery__caption",
} as const;

/**
 * Joins the class names this block composes, leaving out every absent one.
 *
 * The caller's `className` may be absent, so the names that are present are joined and the rest are dropped
 * rather than left as a gap in the attribute. Class composition is not a concern `src/utils` owns —
 * `src/components/ui/Card.tsx` and `src/components/ui/Tabs.tsx` each keep their own copy of these three lines
 * for the same reason — so the join lives in the file that composes the classes.
 *
 * @param names - The classes in cascade order, any of which may be `false` or `undefined` to mean "omit".
 * @returns The names that were given, joined by a single space.
 */
function composeClassName(...names: readonly (string | false | undefined)[]): string {
  return names.filter((name): name is string => typeof name === "string" && name !== "").join(" ");
}

/**
 * The alt text one image is rendered and captioned with.
 *
 * The data layer's own wording is used verbatim, and a blank one falls back to the product's name. An empty
 * `alt` would hide the image that names its own thumbnail, while a file name or a view label invented here
 * would be a second home for imagery wording that `src/data/products.ts` already owns.
 *
 * @param image - The image being rendered.
 * @param productName - The name of the product the image belongs to.
 * @returns Alt text that holds something other than whitespace.
 */
function imageAltFor(image: ProductImage, productName: string): string {
  return image.alt.trim().length > 0 ? image.alt : productName;
}

/**
 * Brings a requested image index inside the images a product actually has.
 *
 * The index arrives from a caller's prop and from state a previous, longer image list left behind, and a
 * gallery that renders nothing because of either is worse than one showing an image, so every value is
 * brought inside the list rather than rejected: a fractional or non-finite one is truncated to a whole image,
 * a negative one becomes the first image and one past the end becomes the last.
 *
 * @param index - The index requested, which need not be an integer or inside the list.
 * @param count - How many images the product has.
 * @returns An integer index inside `0 … count - 1`, or `0` for a product with no images.
 */
function clampIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), count - 1);
}

/**
 * The image a key selects, or `null` for a key the strip leaves to the page.
 *
 * Only the keys the strip handles are claimed: Left and Right step through the images and wrap at either end,
 * because a gallery is a loop rather than a list with two dead ends, and Home and End reach the first and the
 * last image outright. Every other key — the vertical arrows that scroll the page included — returns `null` so
 * the strip refuses nothing the page needs, because a handler bound to the document rather than to these
 * controls would swallow them.
 *
 * @param key - The `key` of the keydown event.
 * @param fromIndex - The thumbnail the event came from.
 * @param count - How many images the product has.
 * @returns The index the key selects, or `null` when the strip does not handle the key.
 */
function keyboardTargetIndex(key: string, fromIndex: number, count: number): number | null {
  switch (key) {
    case "ArrowLeft":
      return (fromIndex - 1 + count) % count;
    case "ArrowRight":
      return (fromIndex + 1) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** Everything {@link ProductGallery} accepts. */
export interface ProductGalleryProps {
  /**
   * The product whose imagery is shown. Its images are ordered by `position` and its name names the strip, so
   * the gallery is given the product rather than a bare list of pictures.
   */
  readonly product: Product;
  /**
   * The image to open on, counted from zero. A fractional, negative or out-of-range value is brought inside
   * the list rather than rejected, and a later change to the prop does not move the gallery: this is the
   * opening image, not a bound value.
   */
  readonly initialIndex?: number;
  /** Reports the image a shopper settled on, so a caller can keep a second view of it in step. */
  readonly onImageChange?: (image: ProductImage, index: number) => void;
  /**
   * The strip's accessible name, in place of the product's own name.
   *
   * It exists because the words belong to the copy library rather than to a component: a caller that has a
   * better phrase — or that gains one when `src/constants/content.ts`, the home of every user-facing sentence,
   * has room for a gallery key it does not carry today — passes it here instead of having it written into this
   * file beside the markup.
   */
  readonly imagesLabel?: string;
  /** Extra classes for the gallery block. */
  readonly className?: string;
}

/**
 * The product's imagery on the detail route: the current image in a reserved box, a thumbnail per image beneath
 * it, and the current image's own words as the caption under the strip.
 *
 * The strip is a `role="group"` named by `aria-label` holding one real button per image, rather than a tablist:
 * the buttons change what the stage shows, but no tab panel is rendered for a tab to control, and a listbox
 * would promise keyboard semantics — typeahead, multi-select — that a gallery does not implement. Each
 * thumbnail is named by its own image's alt text, so the strip is announced as pictures of the product rather
 * than as "button, button, button".
 *
 * Two properties make it usable without a pointer. The current thumbnail is the group's single tabbable element
 * and every other one leaves the tab order, so the strip is one stop in the page's order rather than one stop
 * per image; and Left, Right, Home and End move the selection and the focus together, so a keyboard user
 * follows the change instead of hunting for it. Focus is moved from the handler that decides the move rather
 * than from an effect watching the index, and the index is derived during render from what the shopper last
 * chose and how many images the product has, so no second copy of it is ever stored or synchronised.
 *
 * The component is presentational: it fetches nothing, holds no asynchronous state and renders none of the
 * page's loading, empty or error states. Every `src` it renders is the data URI the data layer built, so the
 * gallery costs no image request and needs no zoom, lightbox or lazy-loading behaviour beyond showing the
 * image the shopper chose.
 *
 * @param props - The product, the opening image, the change callback, the strip's name and the extra classes.
 * @returns The gallery block, or the shared empty state when the product has no imagery.
 */
export function ProductGallery({
  product,
  initialIndex = 0,
  onImageChange,
  imagesLabel,
  className,
}: ProductGalleryProps): ReactElement {
  // The copy is sorted rather than the product's own array: position is the seeded order, and a prop is not
  // this component's to reorder. At most four images are carried, so the copy costs less than memoising it.
  const images = [...product.images].sort((left, right) => left.position - right.position);
  const [selectedIndex, setSelectedIndex] = useState(() => clampIndex(initialIndex, images.length));
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

  if (images.length === 0) {
    // Written in the product's own words rather than in a sentence invented here: the copy library has no
    // gallery key to name this state with, and a phrase written beside this markup would be a second home for
    // wording that `src/constants/content.ts` owns.
    return (
      <EmptyState
        className={composeClassName(CLASSES.root, className)}
        title={product.name}
        description={product.summary}
      />
    );
  }

  const currentIndex = clampIndex(selectedIndex, images.length);
  const currentImage = images[currentIndex];
  const currentAlt = imageAltFor(currentImage, product.name);

  const selectImage = (nextIndex: number, shouldMoveFocus: boolean): void => {
    if (nextIndex === currentIndex) return;
    setSelectedIndex(nextIndex);
    onImageChange?.(images[nextIndex], nextIndex);

    // The focused control is the selected one, so a keyboard user's next arrow key continues from the image
    // they are looking at rather than from the one the strip opened on.
    if (shouldMoveFocus) thumbRefs.current[nextIndex]?.focus();
  };

  const handleThumbKeyDown = (event: KeyboardEvent<HTMLButtonElement>, fromIndex: number): void => {
    const nextIndex = keyboardTargetIndex(event.key, fromIndex, images.length);
    if (nextIndex === null) return;

    // Left and Right are the keys the strip answers with a move of its own, so the page must not scroll
    // sideways under it as well.
    event.preventDefault();
    selectImage(nextIndex, true);
  };

  return (
    <div className={composeClassName(CLASSES.root, className)}>
      <div className={CLASSES.stage}>
        <img
          className={CLASSES.image}
          src={currentImage.url}
          alt={currentAlt}
          width={currentImage.width}
          height={currentImage.height}
        />
      </div>
      <div className={CLASSES.thumbs} role="group" aria-label={imagesLabel ?? product.name}>
        {images.map((image, index) => {
          const isCurrent = index === currentIndex;

          return (
            <button
              key={image.id}
              ref={(element) => {
                thumbRefs.current[index] = element;
              }}
              type="button"
              className={CLASSES.thumb}
              aria-current={isCurrent ? "true" : undefined}
              tabIndex={isCurrent ? 0 : -1}
              onClick={() => {
                selectImage(index, false);
              }}
              onKeyDown={(event) => {
                handleThumbKeyDown(event, index);
              }}
            >
              <img
                src={image.url}
                alt={imageAltFor(image, product.name)}
                width={image.width}
                height={image.height}
              />
            </button>
          );
        })}
      </div>
      {/* The region holds the words of the image on the stage, so a selection that changes the picture is
          announced as well as painted — the caption a sighted visitor reads and the sentence a screen reader
          speaks are one string rather than two. */}
      <p className={CLASSES.caption} aria-live="polite" aria-atomic="true">
        {currentAlt}
      </p>
    </div>
  );
}
