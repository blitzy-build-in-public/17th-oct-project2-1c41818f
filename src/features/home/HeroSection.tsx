/**
 * Path: src/features/home/HeroSection.tsx
 * Purpose: The landing hero: headline, supporting copy and the primary calls to action
 * Lines: 197
 */

import type { ReactElement } from "react";

import { Link } from "react-router-dom";

import { HOME_COPY } from "@/constants/content";
import { ROUTES } from "@/constants/routes";

/**
 * The class contract this section renders against.
 *
 * No stylesheet may be imported here — `src/main.tsx` is the only importer of `src/styles/**`
 * — so every class below is consumed by name, and this comment is the list the stylesheets owe
 * the file: `sp-hero`, `sp-hero__inner`, `sp-hero__copy`, `sp-hero__eyebrow`, `sp-hero__title`,
 * `sp-hero__body`, `sp-hero__actions`, `sp-hero__action` and `sp-hero__media` (catalog.css) for
 * the hero band, its centred container, its copy and its two-column reflow; the `sp-hero__art*`
 * classes below for the illustration; `sp-btn` with `sp-btn--primary` and `sp-btn--secondary`
 * (components.css) for the calls to action's button skin; and `sp-trust`,
 * `sp-trust__inner`, `sp-trust__list`, `sp-trust__item`, `sp-trust__icon` and `sp-trust__claim`
 * (catalog.css) for the trust strip.
 *
 * Each band carries its own `__inner` element instead of a shared container class, which is the
 * shape `src/components/layout/Footer.tsx` establishes, so no file in the folder has to be read
 * before this one and layout.css owns no class this section needs.
 *
 * The illustration and the three icons supply geometry only: every fill, stroke width, colour and
 * opacity is left to those classes, so no design value is written into this file and each of them
 * stays a token in `src/styles/tokens.css`.
 */

/**
 * Names the hero region. The section points at it through `aria-labelledby`, so the landmark's
 * accessible name is the page's own headline rather than a string invented for it.
 */
const HERO_HEADING_ID = "hero-heading";

/** One claim the storefront makes about itself, with the icon drawn beside it. */
interface TrustPoint {
  /** Stable key for the list item, and the hook a stylesheet can hang a per-icon look on. */
  readonly id: string;
  /** The claim itself, taken from `HOME_COPY` — never composed here. */
  readonly claim: string;
  /** The icon's geometry, in the 24×24 user space its `viewBox` declares. */
  readonly icon: readonly string[];
}

/**
 * The three claims the strip makes, in reading order: where the reviews come from, what happens to
 * the cart, and what the checkout does and does not do.
 *
 * The text belongs to the copy module and the paths are drawing data, so this is a structure the
 * view maps over rather than three blocks of repeated markup. Each claim is a whole sentence, so
 * the text carries the meaning and the icon beside it is decorative.
 */
const TRUST_POINTS: readonly TrustPoint[] = [
  {
    id: "reviews",
    claim: HOME_COPY.TRUST_REVIEWS_CLAIM,
    icon: [
      "M12 3.2 14.4 8.6 20.4 9.4 15.9 13.6 17.1 19.5 12 16.6 6.9 19.5 8.1 13.6 3.6 9.4 9.6 8.6Z",
    ],
  },
  {
    id: "cart",
    claim: HOME_COPY.TRUST_CART_CLAIM,
    icon: [
      "M2 3h3.4l2.6 12.6h10.4l2.1-8.4H5.6",
      "M9.8 20.9a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2",
      "M17 20.9a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2",
    ],
  },
  {
    id: "checkout",
    claim: HOME_COPY.TRUST_CHECKOUT_CLAIM,
    icon: [
      "M12 3.2 19 5.8v5.5c0 4.4-2.9 7.9-7 9.3-4.1-1.4-7-4.9-7-9.3V5.8Z",
      "M8.85 12.05 11.05 14.25 15.1 9.85",
    ],
  },
];

/**
 * The hero's illustration: a storefront and a sales panel drawn as line art.
 *
 * It is decorative, so it carries no text, takes no alt text and is hidden from assistive
 * technology by the wrapper that renders it. Nothing here requests an asset — there is no image
 * file, no data URI and no external URL — and every coordinate is a literal of the drawing
 * itself, the way a path's `d` data is, while each shape's colour, weight and opacity come from
 * its class.
 */
function HeroArtwork(): ReactElement {
  return (
    <svg
      className="sp-hero__art"
      viewBox="0 0 424 300"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path className="sp-hero__art-frame" d="M12 18h400v264H12z" />
      <path className="sp-hero__art-bar" d="M40 42h150" />
      <path className="sp-hero__art-tile" d="M40 74h104v92H40z" />
      <path className="sp-hero__art-media" d="M52 86h80v40H52z" />
      <path className="sp-hero__art-line" d="M52 140h58" />
      <path className="sp-hero__art-tile" d="M164 74h104v92H164z" />
      <path className="sp-hero__art-media" d="M176 86h80v40H176z" />
      <path className="sp-hero__art-line" d="M176 140h58" />
      <path className="sp-hero__art-tile" d="M288 74h104v92H288z" />
      <path className="sp-hero__art-media" d="M300 86h80v40H300z" />
      <path className="sp-hero__art-line" d="M300 140h58" />
      <path className="sp-hero__art-column" d="M40 216h26v30H40z" />
      <path className="sp-hero__art-column" d="M76 194h26v52H76z" />
      <path className="sp-hero__art-column" d="M112 226h26v20H112z" />
      <path className="sp-hero__art-column" d="M148 186h26v60H148z" />
      <path className="sp-hero__art-column" d="M184 206h26v40H184z" />
      <path className="sp-hero__art-line" d="M232 196h160" />
      <path className="sp-hero__art-line" d="M232 220h128" />
      <path className="sp-hero__art-line" d="M232 244h96" />
    </svg>
  );
}

/**
 * The landing route's hero: its headline, supporting copy and the two calls to action, followed by
 * the trust strip.
 *
 * It takes no props and reads no context, because it renders the same for every visitor: the
 * landing page's own read of the catalogue supplies the featured products and the category tiles,
 * and this section is static copy above them. That is also why the route's single `<h1>` lives
 * here — §0.6.4 allows one heading level 1 per page, and the landing page has no page header to
 * carry one.
 *
 * Both calls to action are `Link`s rather than buttons: they navigate, so they keep a link's
 * semantics, middle-click and "open in a new tab" behaviour, and borrow the button classes for
 * their look. Their labels are the copy module's, and each reads as an action on its own
 * ("Shop the catalogue", "Search products") so neither depends on the sentence above it.
 *
 * The trust strip sits inside this section's landmark rather than in a second one. The copy module
 * carries no heading for it, and inventing one here would split the page's copy across two homes,
 * so the strip is an unlabelled band in the hero's own labelled region — no landmark is left
 * unnamed and no sentence is written outside `src/constants/content.ts`.
 */
export function HeroSection(): ReactElement {
  return (
    <section className="sp-hero" aria-labelledby={HERO_HEADING_ID}>
      <div className="sp-hero__inner">
        <div className="sp-hero__copy">
          <p className="sp-hero__eyebrow">{HOME_COPY.HERO_EYEBROW}</p>
          <h1 className="sp-hero__title" id={HERO_HEADING_ID}>
            {HOME_COPY.HERO_HEADLINE}
          </h1>
          <p className="sp-hero__body">{HOME_COPY.HERO_BODY}</p>
          <div className="sp-hero__actions">
            <Link className="sp-btn sp-btn--primary sp-hero__action" to={ROUTES.CATALOG}>
              {HOME_COPY.HERO_PRIMARY_ACTION_LABEL}
            </Link>
            <Link className="sp-btn sp-btn--secondary sp-hero__action" to={ROUTES.SEARCH}>
              {HOME_COPY.HERO_SECONDARY_ACTION_LABEL}
            </Link>
          </div>
        </div>
        <div className="sp-hero__media" aria-hidden="true">
          <HeroArtwork />
        </div>
      </div>
      <div className="sp-trust">
        <div className="sp-trust__inner">
          <ul className="sp-trust__list" role="list">
            {TRUST_POINTS.map((point) => (
              <li className="sp-trust__item" key={point.id}>
                <svg
                  className="sp-trust__icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  aria-hidden="true"
                  focusable="false"
                >
                  {point.icon.map((path) => (
                    <path d={path} key={path} />
                  ))}
                </svg>
                <p className="sp-trust__claim">{point.claim}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
