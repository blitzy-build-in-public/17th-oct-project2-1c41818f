/**
 * Path: src/components/ui/Pagination.tsx
 * Purpose: Windowed page numbers, the page-size selector and an announced result count
 * Lines: 244
 */

import { useCallback, type ChangeEvent, type ReactElement } from "react";

import { Button, IconButton } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { PAGE_SIZE_OPTIONS } from "@/constants/config";
import {
  A11Y_COPY,
  COMMON_ACTIONS,
  pageAnnouncement,
  productCountAnnouncement,
} from "@/constants/content";
import { usePagination } from "@/state/hooks";
import type { PageResult, SelectOption } from "@/types/common";
import { normalisePageSize } from "@/utils/collections";
import { formatNumber } from "@/utils/format";

/**
 * The paging control every listing surface shares: a previous control, the windowed page numbers and a next
 * control, optionally the page-size selector, and the result count as one polite announcement. The catalogue,
 * the search results, the order history, the dashboard tables and the three report tables all page through
 * it, which is why the paging contract has a single implementation rather than one per surface.
 *
 * Controlled, deliberately. Query state — the search term, the facets, the sort key and the page — lives in
 * the URL, and `src/utils/queryParams.ts` is the only module that reads or writes it, so this file holds no
 * page counter, no storage read and no navigation: it reports through `onPageChange` and `onPageSizeChange`
 * and renders the paging the caller passes, which is what makes a filtered, sorted, paged URL reload to the
 * same result set.
 *
 * No paging rule is restated here. `usePagination` in `src/state/hooks.ts` derives the clamped page, the
 * page count, the two bounds and the `pageWindow` entries from the helpers in `src/utils/collections.ts`,
 * and this file renders what it derives; a hand-rolled page count or window would be the second
 * implementation of a rule the request forbids duplicating.
 *
 * `src/components/ui/Table.tsx` imports this component — never the other way round, so no cycle exists
 * between the two. The paging fields below are the `PageResult` fields themselves, so a service result or
 * the table's paging projection spreads in unchanged.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content.ts` holds no wording for a page size (a label such as
 * "Per page"), so the selector is named by the pagination area's own key and each choice shows only its
 * number. One added key in that module is all this control needs to read as a sentence.
 */

/** The gap between two runs of page buttons: an ellipsis to sighted readers, hidden from assistive technology. */
const PAGE_WINDOW_ELLIPSIS_GLYPH = "…";

/**
 * Everything {@link Pagination} accepts.
 *
 * The first six fields are `PageResult`'s own paging fields — three required, three optional — so a listing's
 * payload passes straight into this component and the table's paging projection cannot describe paging
 * differently from the payload it came from. A type alias rather than an interface, because an interface
 * cannot extend the `Pick` and `Partial` projections this shape is built from.
 */
export type PaginationProps = Pick<PageResult<never>, "page" | "pageSize" | "total"> &
  Partial<Pick<PageResult<never>, "pageCount" | "hasNext" | "hasPrevious">> & {
    /** Called with the page the reader asked for; the caller writes it to the URL. */
    readonly onPageChange: (page: number) => void;
    /**
     * Called with a newly chosen page size. The caller writes it to the URL **together with a return to the
     * first page**: both values are the URL's, so a size change that the caller does not pair with a page
     * reset is the caller's to fix, and nothing is silently corrected here.
     */
    readonly onPageSizeChange?: (pageSize: number) => void;
    /** The sizes the selector offers. Defaults to `PAGE_SIZE_OPTIONS` from `src/constants/config.ts`. */
    readonly pageSizeOptions?: readonly number[];
    /** The navigation's accessible name. Defaults to the pagination label in the content module. */
    readonly label?: string;
    /** Renders every control inert, for a surface that is not yet interactive. */
    readonly isDisabled?: boolean;
    /** Appended to the control's own class, for a caller's layout. */
    readonly className?: string;
  };

/**
 * The chevron on a previous or next control: decorative, because the control carrying it owns the accessible
 * name. Its geometry is the drawing; its size comes from the icon box the button family gives it, so no width
 * or height is written here.
 *
 * @param props - Which way the chevron points.
 * @returns The glyph, hidden from assistive technology.
 */
function PageArrow({ direction }: { readonly direction: "previous" | "next" }): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path
        d={direction === "previous" ? "M15 5 8 12l7 7" : "M9 5l7 7-7 7"}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </svg>
  );
}

/**
 * The paging control: previous, the page numbers around the current one, next, and the size selector.
 *
 * Both bounds are disabled from the paging itself rather than from a flag the caller may forget: the page
 * count and the two flags are taken from `usePagination` when the caller supplies none, and a caller holding a
 * `PageResult` supplies values that already agree with what it derives. The page it announces is the clamped
 * one, so a URL naming a page past the end still reports a page that exists.
 *
 * The result count is one polite live region, present from the first render and only ever having its text
 * changed, because a region inserted at the moment of the update is not announced reliably — this is how the
 * catalogue and the search results announce a new count after a filter change and a new page after a page
 * change. Both sentences come from `src/constants/content.ts`; the number is grouped by `src/utils/format.ts`.
 *
 * The size selector is rendered only when the caller passes `onPageSizeChange`, and its choices are the
 * configured sizes with the size in force among them, so the control can never show a size it does not offer.
 *
 * @param props - The paging in force, where a change is reported and the optional presentation; see
 *   {@link PaginationProps}.
 * @returns The navigation region holding the count, the page controls and the size selector.
 */
export function Pagination({
  page,
  pageSize,
  total,
  pageCount,
  hasNext,
  hasPrevious,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  label = A11Y_COPY.PAGINATION_LABEL,
  isDisabled = false,
  className,
}: PaginationProps): ReactElement {
  // The size in force, normalised through the same helper `usePagination` uses, so a size change is told from
  // a page change by comparison rather than by which control was used: the hook reports a page move with the
  // size it is paging by and a size change with the size asked for.
  const currentPageSize = normalisePageSize(pageSize);

  const handleChange = useCallback(
    (nextPage: number, nextPageSize: number): void => {
      if (nextPageSize !== currentPageSize) {
        onPageSizeChange?.(nextPageSize);
        return;
      }
      onPageChange(nextPage);
    },
    [currentPageSize, onPageChange, onPageSizeChange],
  );

  const {
    page: currentPage,
    pageCount: derivedPageCount,
    hasNext: derivedHasNext,
    hasPrevious: derivedHasPrevious,
    slots,
    goTo,
    next,
    previous,
    setPageSize,
  } = usePagination({ page, pageSize, total, onChange: handleChange });

  const countOfPages = pageCount ?? derivedPageCount;
  const canGoPrevious = !isDisabled && (hasPrevious ?? derivedHasPrevious);
  const canGoNext = !isDisabled && (hasNext ?? derivedHasNext);
  const announcement = `${productCountAnnouncement(total)} ${pageAnnouncement(
    currentPage,
    countOfPages,
  )}`;

  const handleSizeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>): void => {
      setPageSize(Number(event.target.value));
    },
    [setPageSize],
  );

  const sizeChoices: readonly SelectOption[] = [...new Set([...pageSizeOptions, currentPageSize])]
    .sort((left, right) => left - right)
    .map((size) => ({ value: String(size), label: formatNumber(size) }));

  return (
    <nav
      className={className === undefined ? "sp-pagination" : `sp-pagination ${className}`}
      aria-label={label}
    >
      <span className="sp-pagination__count" role="status">
        {announcement}
      </span>
      <div className="sp-pagination__pages">
        <IconButton
          className="sp-pagination__page"
          variant="ghost"
          label={COMMON_ACTIONS.PREVIOUS}
          icon={<PageArrow direction="previous" />}
          disabled={!canGoPrevious}
          onClick={previous}
        />
        {slots.map((slot, index) =>
          typeof slot === "number" ? (
            <Button
              key={slot}
              className="sp-pagination__page"
              variant="ghost"
              aria-current={slot === currentPage ? "page" : undefined}
              disabled={isDisabled}
              onClick={() => goTo(slot)}
            >
              {formatNumber(slot)}
            </Button>
          ) : (
            <span
              key={`gap-${String(index)}`}
              className="sp-pagination__ellipsis"
              aria-hidden="true"
            >
              {PAGE_WINDOW_ELLIPSIS_GLYPH}
            </span>
          ),
        )}
        <IconButton
          className="sp-pagination__page"
          variant="ghost"
          label={COMMON_ACTIONS.NEXT}
          icon={<PageArrow direction="next" />}
          disabled={!canGoNext}
          onClick={next}
        />
      </div>
      {onPageSizeChange === undefined ? null : (
        <Select
          containerClassName="sp-pagination__size"
          label={A11Y_COPY.PAGINATION_LABEL}
          options={sizeChoices}
          value={String(currentPageSize)}
          isDisabled={isDisabled}
          onChange={handleSizeChange}
        />
      )}
    </nav>
  );
}
