/**
 * Path: src/features/admin/SalesChart.tsx
 * Purpose: The dashboard's revenue chart with a bucket control and a series toggle for category or channel
 * Lines: 489
 */

import { useCallback, useId, useMemo } from "react";
import type { ChangeEvent, ElementType, ReactElement } from "react";

import { ChartPlaceholder } from "@/components/charts/ChartPlaceholder";
import { LineChart } from "@/components/charts/LineChart";
import type { LabelFormatter } from "@/components/charts/chartScales";
import { Button, ButtonGroup, IconButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Select";
import { Tooltip } from "@/components/ui/Tooltip";
import { COMMON_ACTIONS, PAGING_NOUNS } from "@/constants/content";
import { ADMIN_COPY, CHANNEL_LABELS as SALES_CHANNELS } from "@/constants/content-reports";
import { CATEGORY_DEFINITIONS, GRANULARITY_OPTIONS } from "@/constants/taxonomy";
import { bucketLabel } from "@/lib/analyticsService";
import { handOffThen, useFocusHandoff } from "@/components/ui/focusHandoff";
import type { BucketGranularity, ChartSeries, RevenueGroupBy } from "@/types/analytics";
import type { ApiError, DateRange } from "@/types/common";
import { bucketCount, formatDateRange } from "@/utils/dates";

/*
 * Class contract. `src/styles/admin-reports.css` is the sole definition site of the chart and dashboard
 * families and no file under `src/features/**` may import a stylesheet — `src/main.tsx` is the only importer
 * of `src/styles/**` — so every class below is adopted by name, and this comment is the list the sheet owes
 * the file: `sp-dashboard__section` is the block a dashboard stacks and spaces its heading and its chart
 * with; `sp-chart__title` is the chart family's heading type, `sp-chart__header` the wrapping row that pairs
 * a sentence with the controls, `sp-chart__controls` the row those controls sit in, and `sp-chart__frame` the
 * bordered, token-height plot area the chart draws in and the failure is stated in. The block this file
 * renders while the series are in flight is `ChartPlaceholder`'s, which renders that same header and the
 * pending plot and adopts the rest of the chart family — `sp-chart`, `sp-chart__legend`, `sp-chart__data` and
 * the paired table's own primitive — while the four names above stay here for the frame the failure takes.
 * That frame holds the alert primitive, whose `sp-alert` family `src/styles/components.css` declares with the
 * other primitives, and no class is restated here for it. `sp-select`, `sp-btn` and `sp-btn-group` are the
 * controls', declared by the sheets those components answer to.
 *
 * The line chart itself is not drawn here. `src/components/charts/LineChart.tsx` owns the frame, the grid,
 * the axis ticks, the point marks, the pointer and keyboard readout, the text-and-swatch legend, the paired
 * `.sp-chart__data` table and the fixed-height no-data state, and the geometry behind them belongs to
 * `chartScales.ts`; this file mounts three controls into that chart's `actions` slot and states the period
 * the series covers. No colour, radius or shadow literal, and no pixel media query, is written here.
 *
 * The hint control wears the supplementary-surface family's classes — `sp-tooltip-anchor` on the wrapper the
 * primitive renders, and `sp-tooltip` with the `sp-tooltip--start` placement and its `is-open` state on the
 * bubble — because that family is the primitive's own sheet and not this area's. For its own place in the row
 * it takes `sp-card__action` from `src/styles/data-display.css`, the design system's one class for the control
 * that closes a header row, and the auto margin that class declares is what holds the hint at the row's end
 * when the row wraps: a bubble placed on its trigger's inline-start side would otherwise open past the page's
 * own start edge on a narrow screen, where the document clips rather than scrolls it.
 *
 * The heading is rendered here rather than passed to the chart because the level is the page's to choose:
 * `LineChart` fixes its own heading at `h3`, while a dashboard nests this chart under a section and a report
 * nests it one level deeper, so `headingLevel` is honoured by the heading element this file renders and the
 * graphic is named with the same words through the chart's own `ariaLabel`. The sentence naming the period
 * moves into the chart's header row, beside the controls, exactly where the sheet places it.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content-reports.ts` holds no wording for the bucket control — a label
 * such as "Grouping" — so its accessible name is composed from the labels of the granularity choices the
 * vocabulary module already words, and the choices it offers are that module's `GRANULARITY_OPTIONS`. One
 * added key in content-reports.ts is all this control needs to read as a sentence.
 */

/** Every class this file puts on the page, each taken by name from the sheet that declares it. */
const CLASSES = {
  section: "sp-dashboard__section",
  title: "sp-chart__title",
  chart: "sp-chart",
  header: "sp-chart__header",
  controls: "sp-chart__controls",
  hint: "sp-card__action",
  frame: "sp-chart__frame",
} as const;

/**
 * The heading element each level the chart's page may ask for renders as, so the chart joins the document
 * outline at the level its page nests it rather than at one this component picks.
 */
const HEADING_ELEMENTS: Readonly<Record<2 | 3 | 4, ElementType>> = { 2: "h2", 3: "h3", 4: "h4" };

/**
 * The level the heading renders at when the page names none: the level a chart sits at inside a section,
 * which is the level `LineChart` gives a heading it renders itself.
 */
const DEFAULT_HEADING_LEVEL = 3;

/**
 * The number of series the chart draws for one split: one per category the catalogue sells in — the leaves of
 * the vocabulary's tree, which is the level `src/data/products.ts` assigns every product to — and one per
 * channel `src/constants/content-reports.ts` names. It is exported because the dashboard's breakdown block draws the
 * same series, so the two blocks stand in with the same number of legend entries rather than each counting
 * them its own way.
 *
 * @param groupBy - How the revenue is currently split.
 * @returns The number of series that split draws.
 */
export function seriesCountFor(groupBy: RevenueGroupBy): number {
  return groupBy === "channel"
    ? Object.keys(SALES_CHANNELS).length
    : CATEGORY_DEFINITIONS.filter((definition) => definition.parentSlug !== null).length;
}

/**
 * What joins the period and the comparison in the sentence under the heading. Neither side is worded here —
 * the range is `src/utils/dates.ts`'s and the comparison is `src/lib/analyticsService.ts`'s — so this file
 * authors no sentence, only the punctuation between two it was handed.
 */
const DESCRIPTION_SEPARATOR = " · ";

/**
 * The name the bucket control goes by: the granularity choices' own words, joined so the control reads as
 * the choice of grouping it is. See the design-system gap noted above the class contract.
 */
const BUCKET_CONTROL_LABEL = GRANULARITY_OPTIONS.map((option) => option.label).join(" / ");

/**
 * The two ways the revenue is split, in the order the toggle shows them, with the wording the copy module
 * owns. The set is closed as `RevenueGroupBy` is: a split by category or a split by channel, and no third
 * state, because a query that names no split answers with one total series rather than a toggle position.
 */
const SERIES_TOGGLES: readonly { readonly value: RevenueGroupBy; readonly label: string }[] = [
  { value: "category", label: ADMIN_COPY.CHART_SERIES_CATEGORY_LABEL },
  { value: "channel", label: ADMIN_COPY.CHART_SERIES_CHANNEL_LABEL },
];

/**
 * Whether a copy slot holds words a reader can see, so an absent or blank one renders nothing rather than
 * an empty paragraph.
 *
 * @param value - The copy a caller supplied, if any.
 * @returns True when the value holds something other than whitespace.
 */
function hasCopy(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/**
 * The bucket one of the control's own choices names, or `null` for a value that names none.
 *
 * A `<select>` reports its selection as a plain string, so the value is resolved against the vocabulary the
 * control rendered rather than asserted into the union: a value the options do not carry leaves the current
 * bucket untouched instead of putting an impossible granularity into the query.
 *
 * @param value - The value the control reported.
 * @returns The granularity that value names, or `null` when it names none.
 */
function toBucketGranularity(value: string): BucketGranularity | null {
  const option = GRANULARITY_OPTIONS.find((candidate) => candidate.value === value);
  return option === undefined ? null : option.value;
}

/**
 * The sentence under the chart's heading: the days the series covers, then the comparison the page measures
 * against, each already worded elsewhere.
 *
 * The range is formatted by `src/utils/dates.ts`, which owns every date the product displays, and the
 * comparison is the page's own `describeBaseline` sentence; each half is dropped when it is absent or
 * unreadable, and both being absent leaves no sentence at all rather than a stray separator.
 *
 * @param from - The first day of the period, as the page holds it.
 * @param to - The last day of the period, as the page holds it.
 * @param baselineLabel - The comparison the dashboard is stating, already worded by the page.
 * @returns The sentence, or `undefined` when neither half can be stated.
 */
function describePeriod(
  from: string | undefined,
  to: string | undefined,
  baselineLabel: string | undefined,
): string | undefined {
  const parts: string[] = [];
  if (from !== undefined && to !== undefined) {
    const range = formatDateRange(from, to);
    if (range !== "") parts.push(range);
  }
  if (hasCopy(baselineLabel)) parts.push(baselineLabel.trim());
  return parts.length === 0 ? undefined : parts.join(DESCRIPTION_SEPARATOR);
}

/**
 * The hint control's glyph: an information mark drawn from the text's own colour, so no colour is written
 * here. It is hidden from assistive technology because the control carrying it is named by its label, which
 * is what a reader hears, and the mark is only the sighted reader's cue that the control carries a
 * supplementary note.
 *
 * @returns The information mark.
 */
function InfoGlyph(): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth={2} />
      <path
        d="M12 10.6V17"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={2}
      />
      <circle cx="12" cy="7.4" r="1.1" fill="currentColor" />
    </svg>
  );
}

/** Everything {@link ChartControls} renders with: the two values and the two ways they are reported up. */
interface ChartControlsProps {
  /** The cut the page is currently bucketing by; the control shows it as its selection. */
  readonly bucket: BucketGranularity;
  /** Called with the granularity the reader picked. */
  readonly onBucketChange: (bucket: BucketGranularity) => void;
  /** How the page is currently splitting the revenue; the pressed toggle is the current one. */
  readonly groupBy: RevenueGroupBy;
  /** Called with the split the reader picked. */
  readonly onGroupByChange: (groupBy: RevenueGroupBy) => void;
}

/**
 * The chart's three controls, mounted together into the chart frame's header row.
 *
 * The bucket control is the field family's `Select` over `GRANULARITY_OPTIONS`, so the choices and their
 * wording come from the vocabulary module and no granularity name is written here. The split is a two-value
 * toggle: a `ButtonGroup` names the pair for assistive technology, each `Button` carries the vocabulary
 * module's words as its visible label, `aria-pressed` states which split is current, and the pressed control
 * also takes the primary variant so the current split is not signalled by the attribute alone. Each value has
 * exactly one control in the product — the page owns both and passes them down.
 *
 * The hint stands last, after the two controls it explains: an `IconButton` carrying an information mark,
 * wrapped in the `Tooltip` primitive, which reveals the copy module's sentence through `aria-describedby` on
 * pointer-over and on focus, dismisses it on Escape and leaves focus on the trigger. That is the
 * supplementary-surface contract and not the modal one — nothing about a hint interrupts the page, so the
 * background is never made inert and focus is never taken, which is the family `src/components/ui/Modal.tsx`
 * owns. The bubble is placed at the trigger's inline-start because this row ends at the content edge, where a
 * bubble centred on the control would reach past the page; its wording is the copy module's and is worded
 * nowhere here.
 *
 * @param props - The current bucket and split, and the callbacks that report a change.
 * @returns The three controls as one fragment, for the chart's `actions` slot.
 */
function ChartControls({
  bucket,
  onBucketChange,
  groupBy,
  onGroupByChange,
}: ChartControlsProps): ReactElement {
  const handleBucketSelect = useCallback(
    (event: ChangeEvent<HTMLSelectElement>): void => {
      const next = toBucketGranularity(event.target.value);
      if (next !== null) onBucketChange(next);
    },
    [onBucketChange],
  );

  return (
    <>
      <Select
        label={BUCKET_CONTROL_LABEL}
        options={GRANULARITY_OPTIONS}
        value={bucket}
        onChange={handleBucketSelect}
      />
      <ButtonGroup label={ADMIN_COPY.CHART_SERIES_CONTROL_LABEL}>
        {SERIES_TOGGLES.map((toggle) => {
          const isCurrent = groupBy === toggle.value;
          return (
            <Button
              key={toggle.value}
              variant={isCurrent ? "primary" : "secondary"}
              size="sm"
              aria-pressed={isCurrent}
              onClick={() => {
                onGroupByChange(toggle.value);
              }}
            >
              {toggle.label}
            </Button>
          );
        })}
      </ButtonGroup>
      <Tooltip className={CLASSES.hint} content={ADMIN_COPY.CHART_SERIES_HINT} placement="start">
        <IconButton
          variant="ghost"
          size="sm"
          label={ADMIN_COPY.CHART_SERIES_HINT_LABEL}
          icon={<InfoGlyph />}
        />
      </Tooltip>
    </>
  );
}

/**
 * Everything {@link SalesChart} accepts.
 *
 * The query is the page's, not this component's: it holds the dated range, the bucket and the split, and it
 * performs the one revenue read, so the `series` handed down here are the same array the page's breakdown
 * charts, and the line and the breakdown can never disagree. This component reports a changed bucket or split
 * back through `onBucketChange` and `onGroupByChange` and renders nothing of its own in between.
 *
 * `baselineLabel`, `from` and `to` are the context the sentence under the heading is built from, and each is
 * optional: a page that states neither still gets a chart, with no sentence.
 *
 * The revenue read's failure is handed in rather than decided here, because §0.6.4's four states belong to the
 * surface that owns the query: this chart renders the failure in its own frame, directly under the heading row
 * and the two controls, so the bucket or the split can still be changed while the failure is on screen and the
 * alert's retry re-runs that one read.
 */
export interface SalesChartProps {
  /** The revenue series to plot, exactly as the page read them: one per category or one per channel. */
  readonly series: readonly ChartSeries[];
  /** The cut the series are bucketed by, shown by the bucket control and read by the axis wording. */
  readonly bucket: BucketGranularity;
  /** Called with the granularity the reader picked, for the page to write into its query. */
  readonly onBucketChange: (bucket: BucketGranularity) => void;
  /** How the revenue is currently split, shown by the pressed half of the series toggle. */
  readonly groupBy: RevenueGroupBy;
  /** Called with the split the reader picked, for the page to write into its query. */
  readonly onGroupByChange: (groupBy: RevenueGroupBy) => void;
  /** The comparison the page is stating, already worded by `describeBaseline`, named in the sentence under
   *  the heading so the chart does not imply a baseline it is not measuring against. */
  readonly baselineLabel?: string;
  /** The first day of the period the series cover, for the sentence under the heading. */
  readonly from?: string;
  /** The last day of the period the series cover, for the sentence under the heading. */
  readonly to?: string;
  /** The chart's heading, and the graphic's accessible name. Omitted, no heading is rendered and the graphic
   *  is named by its series. */
  readonly title?: string;
  /** The level the heading renders at, defaulted to 3 so a chart inside a dashboard section keeps the
   *  outline in order. The size is the chart title's at every level. */
  readonly headingLevel?: 2 | 3 | 4;
  /** Whether the page is still reading the period's series. While it is, the frame holds a placeholder and
   *  the two controls stay reachable, so the bucket can be changed without leaving the page. Defaults to
   *  false. */
  readonly isLoading?: boolean;
  /**
   * The failure the page's own revenue read reported, or `null` when it answered. While a failure is handed in
   * the frame states it in place of the plot, under the same heading row and beside the same two controls, so
   * the chart keeps its place on the dashboard and the bucket or the split remains a way to ask again. A
   * failure takes precedence over `isLoading`, because a read that did not answer is not still in flight.
   */
  readonly error?: ApiError | null;
  /**
   * Called when the reader asks for the series again: the page's `reload` for the read behind this chart, so
   * the retry re-runs that one request and no other. It renders no control of its own, being the alert's action
   * alone, and is passed through untouched.
   */
  readonly onRetry?: () => void;
}

/**
 * The dashboard's revenue over time: the line chart the page's series are drawn in, the bucket control and the
 * category-or-channel toggle that change what is plotted, the hint control that explains what the split
 * reports, and the sentence naming the period and the comparison the figures belong to.
 *
 * It is presentational and holds no state. The series, the range, the bucket and the split all arrive as props
 * and every change goes back through a callback, because the query belongs to the page and to the URL behind
 * it; nothing is fetched, recomputed or reformatted here. A changed bucket or split re-reads the period, and
 * that read swaps the frame's skeleton for the chart with both controls inside it, so each change is handed to
 * the page already composed with the handoff that puts the focus on the section below. Bucket wording — on the
 * axis, in the readout and in the paired data table — is `bucketLabel`'s, so a key is never re-derived from a
 * date string in this file, and the series keep the token-referenced colours the service assigned them, which
 * is what carries the legend's swatch and the dash patterns that separate the lines without relying on hue.
 *
 * A period with no revenue is the chart's own empty state, in its own fixed-height frame, and the paired data
 * table beneath the plot is what keeps every figure readable without colour or geometry. While the page is
 * still reading, the block stands in as the shape it will take — the same header, the plot at the drawing's own
 * ratio, a legend entry per series and a paired table row per bucket — so the region it occupies is the region
 * the series fill. The heading and every control are already rendered while that happens, so a reader can
 * change the bucket or the split, or read the hint beside them, without leaving the page while the request is
 * in flight. A read the page could not answer takes that same frame, with the same heading row and the same
 * live controls above it, and states the failure with its retry, so the chart is one surface of the dashboard
 * failing rather than the dashboard.
 *
 * @param props - The series, the two query values with their callbacks, the period and comparison wording,
 *   the heading and its level, the loading flag, and the failure with its retry.
 * @returns The chart block: an optional heading, the sentence, and the chart with its controls.
 */
export function SalesChart({
  series,
  bucket,
  onBucketChange,
  groupBy,
  onGroupByChange,
  baselineLabel,
  from,
  to,
  title,
  headingLevel = DEFAULT_HEADING_LEVEL,
  isLoading = false,
  error,
  onRetry,
}: SalesChartProps): ReactElement {
  const headingId = useId();
  const Heading = HEADING_ELEMENTS[headingLevel];
  const hasTitle = hasCopy(title);
  const description = describePeriod(from, to, baselineLabel);
  const failure = error ?? null;

  // The period the series cover, when the page states one: it is what the bucket wording qualifies a clipped
  // band by, and it is built from the two props so the formatter below stays stable while they hold still.
  const range = useMemo<DateRange | undefined>(
    () => (from === undefined || to === undefined ? undefined : { from, to }),
    [from, to],
  );

  /*
   * The region the two controls hand the focus off to, and the handoff itself.
   *
   * Changing the bucket or the split re-reads the period, and while that read is in flight the frame holds a
   * skeleton with the controls rendered into its header — so the control the reader just used is unmounted by
   * the commit that starts the read, and the browser would drop the focus onto `document.body`. This section
   * wraps both of the frame's states, which is what makes it the region to hand the focus to, and its heading
   * names it.
   */
  const { regionRef, handOffFocus } = useFocusHandoff();

  // The axis, the readout and the paired table read a band key through one formatter, so the bucket's human
  // wording has one home in `src/lib/analyticsService.ts`, told which period it is wording over; an
  // already-worded key is printed as it stands.
  const formatLabel = useCallback<LabelFormatter>(
    (key: string): string => bucketLabel(key, bucket, range) || key,
    [bucket, range],
  );

  const controls = (
    <ChartControls
      bucket={bucket}
      onBucketChange={handOffThen(handOffFocus, onBucketChange)}
      groupBy={groupBy}
      onGroupByChange={handOffThen(handOffFocus, onGroupByChange)}
    />
  );

  // The bands the arriving series cover are the buckets the period and the cut resolve to, counted by the same
  // rule `src/lib/analyticsService.ts` buckets by, so the placeholder's paired table is exactly as long as the
  // table that replaces it. A period with an end missing counts none, which is the only reading available.
  const bandCount = hasCopy(from) && hasCopy(to) ? bucketCount({ from, to }, bucket) : 0;

  return (
    <section
      className={CLASSES.section}
      aria-labelledby={hasTitle ? headingId : undefined}
      ref={regionRef}
      tabIndex={-1}
    >
      {hasTitle ? (
        <Heading id={headingId} className={CLASSES.title}>
          {title}
        </Heading>
      ) : null}

      {failure !== null ? (
        <div className={CLASSES.chart}>
          <div className={CLASSES.header}>
            {description === undefined ? null : <p>{description}</p>}
            <div className={CLASSES.controls}>{controls}</div>
          </div>
          <div className={CLASSES.frame}>
            <Alert
              actionLabel={COMMON_ACTIONS.RETRY}
              error={failure}
              onAction={onRetry}
              tone="danger"
            />
          </div>
        </div>
      ) : isLoading ? (
        <ChartPlaceholder
          actions={controls}
          description={description}
          rows={bandCount}
          series={seriesCountFor(groupBy)}
        />
      ) : (
        /* The paired table's rows are the buckets the series are cut into — reporting periods and never
         * products — so the pager beneath it counts periods, which is what the chart is over. */
        <LineChart
          series={series}
          description={description}
          actions={controls}
          ariaLabel={title}
          formatLabel={formatLabel}
          countNoun={PAGING_NOUNS.PERIODS}
        />
      )}
    </section>
  );
}
