/**
 * Path: src/features/reports/ReportsPage.tsx
 * Purpose: The reports route: report selector, range control and the selected report's view
 * Lines: 439
 */

import { useCallback, useMemo, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import type { TabItem } from "@/components/ui/Tabs";
import { STORAGE_KEYS } from "@/constants/config";
import { COMMON_ACTIONS, FEEDBACK_COPY, PAGE_TITLES, documentTitle } from "@/constants/content";
import { REPORTS_COPY } from "@/constants/content-reports";
import { ROUTES } from "@/constants/routes";
import { GRANULARITY_OPTIONS, REPORT_DEFINITIONS } from "@/constants/taxonomy";
import { defaultReportQuery, findDefinition, listReportDefinitions } from "@/lib/reportService";
// Both report endpoints are administrator-only — `src/lib/apiRoutes.ts` registers the catalogue and the run at
// that level — and the seam answers `401` to a request that carries no session, so the token travels with this
// page's read exactly as the three views of this slice carry it into theirs. `useAuth` is the product's single
// home for the session and its role claims; the guard over `/admin/*` in `src/Router.tsx` is convenience, and
// what actually admits the request is this credential.
import { useAuth } from "@/state/AuthContext";
import { useAsync, useDocumentTitle, useLocalStorage } from "@/state/hooks";
import type { BucketGranularity, ReportDefinition, ReportKind } from "@/types/analytics";
import type { DateRange } from "@/types/common";
import { bucketCount, defaultReportRange, maxReportRange } from "@/utils/dates";

import { CustomerReport } from "./CustomerReport";
import { DateRangePicker } from "./DateRangePicker";
import { ProductPerformanceReport } from "./ProductPerformanceReport";
import { ReportBodyPlaceholder } from "./ReportPlaceholder";
import { SalesReport } from "./SalesReport";

/*
 * Class contract. `src/styles/admin-reports.css` is the sole definition site of the administrator register and
 * no file under `src/features/**` may import a stylesheet — `src/main.tsx` is the only importer of
 * `src/styles/**` — so every class below is adopted by name, and this comment is the list the sheet owes the
 * file: `sp-admin__main` is the content column beside the sidebar, which the dashboard is written in too;
 * `sp-report` is the shell's grid at one gap; `sp-report__header` carries the period control and the cut
 * control at their own rhythm, and `sp-report__toolbar` the row they take from --breakpoint-md; and
 * `sp-report__selector` is the container the selector's own sideways scroll is given, and `sp-report__body` the
 * block a report stacks its figures, its chart and its table in, which the shell reserves while the catalogue is
 * in flight for the same reason the loaded shell gives it one. The selector class is
 * passed to `Tabs` — which composes a caller's class with its own `sp-tabs` — rather than written on a wrapper
 * of this file's, because a wrapper holding the tab list but not the panel would leave the selected report
 * outside the region its tab names. `sp-visually-hidden` is `src/styles/base.css`'s utility — the same one the
 * shared table's caption takes — and it carries the level-2 heading a report panel opens with: the heading is
 * the outline's link between this route's level-1 heading and the level-3 headings the report views render,
 * while the selected tab is what names the panel on screen, so the heading is present to a reader navigating
 * by heading and absent from the page a sighted reader sees. `sp-btn` with `sp-btn--secondary` is the
 * cross-link into the dashboard, taken exactly as `src/features/admin/AdminDashboardPage.tsx` takes the one
 * back, so the two screens cross over in a single idiom.
 *
 * Everything else belongs to the components composed here. `PageHeader` renders the route's only `<h1>` — the
 * shell owns no page title, so the heading belongs to the page, and the dashboard states its own the same way
 * — and its action slot is where the cross-link stands. `Tabs` renders the selector and mounts only the
 * selected panel, so a report that fetches is not mounted while another tab is selected, which is what keeps
 * the three report reads from running at once. The three views own their figures, their chart, their table and
 * the product's single CSV export; `DateRangePicker` owns the presets, the two date fields, the range rules
 * and the range this mount resumes from, and reports only ranges those rules accept — every one of them through
 * this page's one handler below, which is what writes the stored last-used range; `Select` is the field family
 * over the vocabulary module's own cut choices; and `Alert`, `EmptyState` and `Skeleton` are the shared states.
 * The body the pending shell reserves is `ReportPlaceholder`'s, which shapes the figures, the chart and the
 * table for itself, so no skeleton of the report's own is written here. No colour, radius or shadow literal and
 * no pixel media query is written here.
 *
 * BLITZY [DESIGN_SYSTEM_GAP]: `src/constants/content-reports.ts` words no label for the cut control, so the control
 * goes by its choices' own words, joined — exactly how the dashboard's bucket control names itself in
 * `src/features/admin/SalesChart.tsx`. One key in content-reports.ts is all that control needs to be labelled.
 *
 * BLITZY [COPY GAP]: the same module words no line for a report's own description, and no sheet declares a
 * class for one, so the definition's sentence is left to the view that already states it — `SalesReport` opens
 * with its definition's description — rather than repeated under the selector, where it would say the same
 * thing twice and would need a class the sheet does not hold.
 *
 * BLITZY [COPY GAP]: the definitions region's empty branch renders the library's neutral pairing rather than
 * `EMPTY_STATES`, because the content module holds no wording for a report catalogue that came back empty:
 * `reportRange`'s sentences would name a period and an absence of orders that the reader's chosen range has
 * nothing to do with, while the retry the state offers is the action that genuinely helps.
 */

/** Every class this file puts on the page, each taken by name from the sheet that declares it. */
const CLASSES = {
  column: "sp-admin__main",
  report: "sp-report",
  header: "sp-report__header",
  toolbar: "sp-report__toolbar",
  selector: "sp-report__selector",
  body: "sp-report__body",
  crossLink: "sp-btn sp-btn--secondary",
  visuallyHidden: "sp-visually-hidden",
} as const;

/** Everything a report view is handed: the period, the cut, and the one action its empty state offers. */
interface ReportViewProps {
  /** The period every figure of the report covers. */
  readonly range: DateRange;
  /** The cut the report's rows are bucketed by. */
  readonly granularity: BucketGranularity;
  /** The one action a report's no-activity state offers: the period is this page's, so the page is the only
   *  place that can widen it, and the view rendering that state calls this to have it widened. */
  readonly onWidenRange: () => void;
}

/** One report's view, as the selector mounts it: a function component over {@link ReportViewProps}. */
type ReportView = (props: ReportViewProps) => ReactElement;

/**
 * The view each report kind mounts, keyed by the kind the catalogue declares it under.
 *
 * The record is total over `ReportKind`, so a kind added to that union fails to compile here until it is given
 * a view, and the panel content is a lookup rather than a branch that could fall through to another report's
 * figures. The three views take the same three props, so the lookup's result is used the same way whichever it is.
 */
const REPORT_VIEWS: Readonly<Record<ReportKind, ReportView>> = {
  sales: SalesReport,
  products: ProductPerformanceReport,
  customers: CustomerReport,
};

/**
 * The report the route opens on: the first definition the vocabulary module declares, which is the sales
 * report. It is read from the catalogue rather than written as a kind here, so the opening selection is one
 * the catalogue genuinely holds.
 */
const DEFAULT_KIND: ReportKind = REPORT_DEFINITIONS[0].kind;

/** The catalogue a read has not answered with yet: one shared empty list, so the render reads a stable value. */
const NO_DEFINITIONS: readonly ReportDefinition[] = [];

/** The cut control's name: its choices' own words, joined, so the control reads as the set it offers. */
const CUT_CONTROL_LABEL = GRANULARITY_OPTIONS.map((option) => option.label).join(" / ");

/** The block size the selector's placeholder stands in at: the strip's own control height, so nothing shifts
 *  when the report names arrive in its place. */
const SELECTOR_PLACEHOLDER_HEIGHT = "var(--control-height-lg)";

/**
 * The figures the pending shell's summary block stands in with, and the series its pending chart stands in
 * with: the counts of the run the page opens on, which is the report the shell shows once the catalogue lands.
 * They are `src/lib/reportService.ts`'s — its `summarise` totals six figures for the sales report and its
 * `buildReportSeries` draws that report one series — and `src/features/reports/SalesReport.tsx` states the same
 * two counts as the summary and the chart it reserves for its own loading state. Reserving them here is what
 * keeps the body the catalogue read precedes the height of the body that replaces it; the block's other parts
 * — the plot ratio, the legend, the paired table and the report table — are sized by the components it composes.
 */
const PENDING_SUMMARY_FIGURE_COUNT = 6;
const PENDING_CHART_SERIES_COUNT = 1;

/** The level every heading this page renders below the route's own opens at: `PageHeader` owns the level-1
 *  heading, so a region this file describes — the definitions state, a report panel — heads itself at level 2
 *  and the level-3 headings the report views render descend from it without a level being skipped. */
const REGION_HEADING_LEVEL = 2;

/**
 * The report kind a tab reported, or `null` for an id no loaded definition declares. The lookup is what keeps
 * a string from reaching the mounted view as a report the catalogue does not hold.
 *
 * @param id - The id of the tab the reader activated.
 * @param definitions - The catalogue the selector was built from.
 * @returns The kind, or `null` when the id names no definition in that catalogue.
 */
function toReportKind(id: string, definitions: readonly ReportDefinition[]): ReportKind | null {
  return definitions.find((definition) => definition.kind === id)?.kind ?? null;
}

/**
 * The cut a select reported, or `null` for a value outside the offered choices, so a string cannot reach a
 * report as a bucket the chart and the service cannot word.
 *
 * @param value - The value the select reported.
 * @returns The cut, or `null` when it is not one of the choices.
 */
function toBucketGranularity(value: string): BucketGranularity | null {
  return GRANULARITY_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/**
 * The reports route: the product's reporting module, entered at `/admin/reports`.
 *
 * Three things are this page's own. **The catalogue of reports** is read once per session through
 * `reportService.listReportDefinitions`, and the selector is built from what came back rather than from a list
 * restated here, so the tab names, the tab count and the report each tab mounts all follow the catalogue the
 * seam serves. **The period and the cut** are this page's state, and this page is the only place either lives:
 * the range control is handed the range and reports back every range it applies, and the same two values are
 * passed down to whichever report is selected — which is what makes a changed range or a changed cut re-run the
 * mounted report, and only it, through the abort-aware read that report owns. Because the period is this page's,
 * the stored last-used range is this page's to write as well: the one handler below applies a range and
 * remembers it in the same step, so the range in force and the days the next visit opens on cannot disagree.
 * **The selection** is state too,
 * because which report a reader is looking at is a screen's own choice: the URL is the store of catalogue and
 * search query state, and this route reads and writes no query parameter.
 *
 * The catalogue read is the page's only request, and its four states render in the order they can occur: the
 * shell's own shape while it is in flight or while the session it needs is still being restored — the two
 * controls, at their own heights and working as they do once the catalogue lands, the strip of report names at
 * its control height, and a report body at the figures, the buckets and the table a report renders — the
 * alert carrying the seam's own message with the retry that runs it again, the state a catalogue that came back
 * empty earns, and then the shell — the period control beside the cut control, the selector, and the selected
 * report, whose own figures, chart, table and export states belong to the view that owns the request producing
 * them. A failure arrives as a value, so no `try`/`catch` wraps the call.
 *
 * Nothing is mirrored into state and no effect synchronises two pieces of React state: the selected definition,
 * the tab items and the mounted view are computed during render from the catalogue and the three values above,
 * so a re-render cannot leave the selector pointing at one report while another is on screen.
 *
 * Assumption: a session. Both endpoints are administrator-only, so the read is issued only once a session is in
 * hand, and a visitor without one stays in the pending state rather than being shown a failure for a request
 * this page has not been allowed to make — the guard over `/admin/*` sends that visitor to sign in.
 *
 * @returns The route: its heading block, and whichever of the four states the catalogue read is in.
 */
export function ReportsPage(): ReactElement {
  const { session } = useAuth();
  // The credential the administrator endpoints require, read from the session rather than kept here: the state
  // layer owns the session. Only the token travels, because the seam re-checks the role on every request.
  const sessionToken = session?.token;

  useDocumentTitle(documentTitle(PAGE_TITLES.REPORTS));

  // The report catalogue, read once per session: `useAsync` is keyed on the token, so signing in or out reads it
  // again, and it aborts a request it supersedes. The read waits for a session rather than being issued without
  // one, because an unauthenticated call could only be refused.
  const { status, data, error, reload } = useAsync<ReportDefinition[]>(
    (signal) => listReportDefinitions({ sessionToken, signal }),
    [sessionToken],
    { enabled: session !== null },
  );

  // The trailing window, taken once per mount from one reading of the clock: it is what the store falls back to
  // when nothing usable is remembered, and a page re-deriving "today" on every render would move it under the
  // reader.
  const fallbackRange = useMemo<DateRange>(() => defaultReportRange(), []);

  // The store this page remembers the period in, taken for its writer alone: the period in force is this page's
  // state below, and what a stored payload means is `storedRangeOr`'s one reading in `src/utils/storage.ts`,
  // applied by the range control, which resumes from the remembered days on mount and reports them upward like
  // any other range. The key comes from `STORAGE_KEYS` in `src/constants/config.ts` and the write itself goes
  // through `useLocalStorage` in `src/state/hooks.ts`, which owns the versioned envelope and the degradation,
  // so no payload is shaped here.
  const [, setStoredRange] = useLocalStorage<DateRange>(STORAGE_KEYS.REPORT_RANGE, fallbackRange);

  // The period the mounted report covers, seeded once per mount from the service's own trailing window. The
  // range control is handed this value and reports back every range it applies — including the last-used range
  // it restores on mount — so the period has exactly one owner and the control keeps none of it. The stored
  // last-used range is written from the one handler below, beside this state, so the period in force and the
  // days the next visit to either administrator surface opens on are set together and cannot disagree.
  const [range, setRange] = useState<DateRange>(() => {
    const opening = defaultReportQuery(REPORT_DEFINITIONS, DEFAULT_KIND);
    return { from: opening.from, to: opening.to };
  });

  // The cut the mounted report is bucketed by, seeded from the opening definition's own default. Switching
  // reports deliberately keeps the cut the reader chose: a control that moves under them is a control they did
  // not set, and the fallback is the first choice the control offers rather than a bucket written out here.
  const [granularity, setGranularity] = useState<BucketGranularity>(
    () =>
      defaultReportQuery(REPORT_DEFINITIONS, DEFAULT_KIND).bucket ?? GRANULARITY_OPTIONS[0].value,
  );

  // The report the reader is looking at. It is component state because the screen's own selection is not query
  // state; the selector reports an activated tab here and nothing else moves it.
  const [kind, setKind] = useState<ReportKind>(DEFAULT_KIND);

  const definitions = data ?? NO_DEFINITIONS;

  // The definition the page is showing, resolved during render: the selected kind's, or the catalogue's first
  // when the selection names none — a first render that outpaced the read, or a catalogue that dropped a report.
  // An absent result is an empty catalogue, which is the state below rather than a selector with no tabs in it.
  const selected = findDefinition(definitions, kind) ?? definitions[0];

  const handleReportSelect = useCallback(
    (id: string): void => {
      const next = toReportKind(id, definitions);
      if (next !== null) setKind(next);
    },
    [definitions],
  );

  const handleCutSelect = useCallback((event: ChangeEvent<HTMLSelectElement>): void => {
    const next = toBucketGranularity(event.target.value);
    if (next !== null) setGranularity(next);
  }, []);

  /** Applies a range: the period in force and the range remembered for the next visit together. This is the one
   *  writer of both, so a range a reader applies at the control, the range the control restores on mount and the
   *  widened range below all land here, and the store cannot be left behind a change the page made. */
  const applyRange = useCallback(
    (next: DateRange): void => {
      setRange(next);
      setStoredRange(next);
    },
    [setStoredRange],
  );

  // The one action a report's no-activity state offers. The period lives here and nowhere else, so the page is
  // the only place that can widen it, and a mounted view reaches it by asking for it rather than by holding a
  // control of its own. The value is the widest period the product accepts, which is what makes the action
  // resolve instead of moving the reader to a second control: the range control above the reports is where a
  // reader narrows one. A widened range is one the control's own rules accept, and it is applied through the
  // same one handler a reader's own range goes through, so it is remembered exactly like one and the store
  // cannot lag the range now in force.
  const widenPeriod = useCallback((): void => {
    applyRange(maxReportRange());
  }, [applyRange]);

  const isLoading = status === "idle" || status === "loading";
  const failure = status === "error" ? error : null;

  let region: ReactElement;
  if (isLoading) {
    // Shaped like the shell that arrives: the period control and the cut control at their own heights, the strip
    // of report names at its own control height, and under them the body a report renders — its figures, its
    // chart at the buckets this period and cut resolve to, and a page of its table. The two controls are the
    // real ones and work while the catalogue is read, because the period and the cut are this page's state and
    // neither waits on that read; the strip stands in for the names, which is the one part the read supplies.
    region = (
      <div aria-busy="true" className={CLASSES.report}>
        <div className={CLASSES.header}>
          <div className={CLASSES.toolbar}>
            <DateRangePicker onChange={applyRange} value={range} />
            <Select
              label={CUT_CONTROL_LABEL}
              onChange={handleCutSelect}
              options={GRANULARITY_OPTIONS}
              value={granularity}
            />
          </div>
        </div>
        <div className={CLASSES.selector}>
          <Skeleton height={SELECTOR_PLACEHOLDER_HEIGHT} />
        </div>
        <div className={CLASSES.body}>
          <ReportBodyPlaceholder
            chart={{
              title: REPORTS_COPY.SALES_CHART_HEADING,
              rows: bucketCount({ from: range.from, to: range.to }, granularity),
              series: PENDING_CHART_SERIES_COUNT,
            }}
            figures={PENDING_SUMMARY_FIGURE_COUNT}
          />
        </div>
      </div>
    );
  } else if (failure !== null) {
    // The catalogue could not be read: the message the seam shaped, and the retry that asks for it again. No
    // report is offered, because without a definition there is nothing to name, run or export.
    region = (
      <div className={CLASSES.report}>
        <Alert actionLabel={COMMON_ACTIONS.RETRY} error={failure} onAction={reload} tone="danger" />
      </div>
    );
  } else if (selected === undefined) {
    // The seam answered successfully and holds no report: a screen with no selector is stated as such, with the
    // retry that is the one action that can help here.
    region = (
      <div className={CLASSES.report}>
        <EmptyState
          actionLabel={COMMON_ACTIONS.RETRY}
          description={FEEDBACK_COPY.ERROR_STATE_BODY}
          headingLevel={REGION_HEADING_LEVEL}
          onAction={reload}
          title={FEEDBACK_COPY.ERROR_STATE_TITLE}
        />
      </div>
    );
  } else {
    // One tab per definition the catalogue declares, in the catalogue's own order, each naming its report by the
    // definition's name and mounting that kind's view over the page's period and cut. Only the selected panel is
    // mounted, so the reports the reader is not looking at issue no request at all.
    const tabs: readonly TabItem[] = definitions.map((definition) => {
      const Report = REPORT_VIEWS[definition.kind];
      return {
        id: definition.kind,
        label: definition.name,
        content: (
          <>
            {/* The panel's own heading: the outline descends from the route's level-1 heading to this level-2
                heading, which names the report the panel holds, and from there to the report view's own
                headings — the empty state's level-2 headline where the range recorded nothing, or the
                level-3 headings its sections carry where it has figures to show. It is visually hidden
                because the selected tab is what names this panel on screen and no sheet declares a heading
                for the block, so the heading is present to a reader navigating by heading and absent from the
                page a sighted reader sees. */}
            <h2 className={CLASSES.visuallyHidden}>{definition.name}</h2>
            <Report granularity={granularity} onWidenRange={widenPeriod} range={range} />
          </>
        ),
      };
    });

    region = (
      <div className={CLASSES.report}>
        {/* The period and the cut stand above the selector because they govern whichever report is selected,
            rather than being one report's own controls. Both are the page's state, and both are passed down. */}
        <div className={CLASSES.header}>
          <div className={CLASSES.toolbar}>
            <DateRangePicker onChange={applyRange} value={range} />
            <Select
              label={CUT_CONTROL_LABEL}
              onChange={handleCutSelect}
              options={GRANULARITY_OPTIONS}
              value={granularity}
            />
          </div>
        </div>
        <Tabs
          className={CLASSES.selector}
          items={tabs}
          label={REPORTS_COPY.SELECTOR_LABEL}
          onChange={handleReportSelect}
          value={selected.kind}
        />
      </div>
    );
  }

  return (
    <div className={CLASSES.column}>
      <PageHeader
        actions={
          // A link rather than a control of the button family: it navigates, and it is painted as the secondary
          // button the dashboard paints its own way back with, so the two screens cross over in one idiom.
          <Link className={CLASSES.crossLink} to={ROUTES.ADMIN}>
            {PAGE_TITLES.DASHBOARD}
          </Link>
        }
        description={REPORTS_COPY.INTRO}
        title={PAGE_TITLES.REPORTS}
      />
      {region}
    </div>
  );
}
