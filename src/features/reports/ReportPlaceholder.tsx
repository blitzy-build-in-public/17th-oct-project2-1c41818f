/**
 * Path: src/features/reports/ReportPlaceholder.tsx
 * Purpose: The shape a report's body takes while its run is in flight: summary figures, chart and table
 * Lines: 93
 */

import type { ReactElement } from "react";

import { ChartPlaceholder } from "@/components/charts/ChartPlaceholder";
import type { ChartPlaceholderProps } from "@/components/charts/ChartPlaceholder";
import { Skeleton } from "@/components/ui/Feedback";
import { ReportTablePlaceholder } from "@/features/reports/ReportTable";
import type { ReportDefinition } from "@/types/analytics";

/*
 * Class contract. No stylesheet is imported here — `src/main.tsx` is the only importer of `src/styles/**` — so
 * every class below is consumed by name. The three blocks are the report body's own, taken from
 * `src/styles/admin-reports.css`: `sp-report__summary` is the four-column summary grid, `sp-report__summary-item`
 * an entry in it, and the two figures inside are `sp-report-placeholder__summary-label` and
 * `__summary-value` from `src/styles/placeholders.css`, which is the sheet that owns the shape of every
 * data-page placeholder. The chart block and the table block are their own components', so this file writes no
 * rule of theirs.
 *
 * The block is decorative: the body it is rendered into carries `aria-busy`, the summary is hidden from
 * assistive technology, and the two blocks below it are hidden where they are built, so the only thing a
 * screen reader is told is that the region is filling.
 */

/** Every class this file puts on the page, each taken by name from the sheet that declares it. */
const CLASSES = {
  summary: "sp-report__summary",
  summaryItem: "sp-report__summary-item",
  summaryLabel: "sp-report-placeholder__summary-label",
  summaryValue: "sp-report-placeholder__summary-value",
} as const;

/** Everything {@link ReportBodyPlaceholder} accepts. */
export interface ReportBodyPlaceholderProps {
  /**
   * The definition the report will be run with, when the page already holds it: its columns are the placeholder
   * table's own headings. Omitted while the catalogue of definitions is still being read.
   */
  readonly definition?: ReportDefinition;
  /**
   * How many figures the run states above its table — the count `src/lib/reportService.ts` builds for the
   * report's kind — because the summary grid holds one entry per figure and its rows follow from that count.
   */
  readonly figures: number;
  /**
   * The chart block's own props, exactly as the report passes them to the chart it renders: the chart's
   * heading, its description and its period note, the series it draws and the bands its paired data table
   * holds. They are forwarded unchanged, so the placeholder's header and paired table are the chart's own.
   */
  readonly chart: ChartPlaceholderProps;
}

/**
 * The loading state of a report's body: the figures the run will state, the chart beside them and the table it
 * closes with, each occupying the space it will occupy once the run answers.
 *
 * It renders the three blocks the loaded body renders, in the order it renders them, which is what keeps the
 * region's height: the summary grid at one entry per figure the kind states, the chart block at its heading, its
 * plot ratio, a legend entry per series and one paired-table row per band, and the report table at a page of
 * placeholder rows with its totals row, its export row and its paging control. A caller that already holds its
 * definition passes it, so the placeholder's table carries the definitions' own headings.
 *
 * @param props - The definition, the figure count and the chart's own props; see {@link ReportBodyPlaceholderProps}.
 * @returns The decorative report body.
 */
export function ReportBodyPlaceholder({
  definition,
  figures,
  chart,
}: ReportBodyPlaceholderProps): ReactElement {
  const figureCount = Number.isFinite(figures) ? Math.max(0, Math.trunc(figures)) : 0;

  return (
    <>
      <div className={CLASSES.summary} aria-hidden="true">
        {/* The entries are interchangeable decorative pairs with no identity for a key to preserve, which is the
            same reason the shared skeleton keys its own lines by position. */}
        {Array.from({ length: figureCount }, (_figure, index) => (
          <div className={CLASSES.summaryItem} key={`report-placeholder-figure-${String(index)}`}>
            <Skeleton className={CLASSES.summaryLabel} variant="text" />
            <Skeleton className={CLASSES.summaryValue} variant="text" />
          </div>
        ))}
      </div>
      <ChartPlaceholder {...chart} />
      <ReportTablePlaceholder definition={definition} />
    </>
  );
}
