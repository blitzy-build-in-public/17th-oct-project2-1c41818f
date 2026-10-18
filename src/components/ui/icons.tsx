/**
 * Path: src/components/ui/icons.tsx
 * Purpose: The decorative glyphs the primitives and the feature surfaces render inside the controls that own their accessible names
 * Lines: 41
 */

import type { ReactElement } from "react";

/*
 * Why the glyphs live here rather than in the file that first drew one: three surfaces on two layers paint the
 * same close glyph — the modal and drawer family, the catalogue's filter chips and the search slice's
 * active-filter chips — and §0.3.2 lets a feature import a shared component but never another feature, so a
 * glyph two features need belongs in the shared presentation layer. Each caller keeps the class its own
 * stylesheet selects (the modal's `sp-modal__close` on the `IconButton`, the chip's remove-control classes), so
 * the sheet still sizes and positions the glyph and nothing here invents a class, a width or a height.
 */

/**
 * The close glyph: two crossing strokes, drawn in the current text colour so the control carrying it supplies
 * the paint.
 *
 * Decorative by construction — `aria-hidden` keeps it out of the accessibility tree and `focusable="false"`
 * keeps it out of the tab order — because the control wrapping it owns the accessible name: an `IconButton`'s
 * `label` for a dialog, the chip's own remove control for an applied filter. A stylesheet sizes it through the
 * class on that control, which is why no dimension is set here.
 *
 * @returns The glyph's SVG, in the `0 0 24 24` view box its path is drawn in.
 */
export function CloseIcon(): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path
        d="M6 6 18 18M18 6 6 18"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={2}
      />
    </svg>
  );
}
