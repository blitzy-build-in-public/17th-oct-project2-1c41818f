/**
 * Path: src/data/analyticsGraph.ts
 * Purpose: The modules a first analytics or report read fetches on use — the seeded daily sales fact table, the aggregation rules and the report composition — with the loader that resolves them and the refusal a failed fetch answers with
 * Lines: 125
 */

// Not a path the plan maps on its own: it is a §0.5.5 split path of `src/data/repositories.ts`, the same way
// `src/data/collectionStore.ts` is that file's store half. The data source's own 33-member contract plus this
// concern cannot both sit inside the request's 600-line ceiling, and the ceiling is never raised, so the concern
// was split out rather than the file trimmed: it is the part of the data source's reach that no store state
// touches, which is exactly what makes it movable. Nothing here knows about a store — it resolves three modules
// and hands their members to the read that asked for them.

import { FEEDBACK_COPY } from "@/constants/content";
import { accept } from "@/data/collectionStore";
// The two foundations modules whose graph a first analytics or report read fetches, imported for their types
// alone: an `import type` is erased, so naming the members the loader caches below costs the entry chunk nothing
// — which is the whole point of fetching them, and the reason the loader below names no module of the layer
// above this one, which the data-access layer may not reach.
import type * as AnalyticsRules from "@/utils/analyticsRules";
import type * as ReportRules from "@/utils/reportRules";
import type { SalesRecord } from "@/types/analytics";
import type { Result } from "@/types/common";

/**
 * The graph a first analytics or report read needs and no other read does: the seeded daily sales fact table,
 * the aggregation rules that bucket it, and the report composition that turns a definition and a range into
 * rows.
 *
 * It is fetched on first use rather than carried by the entry chunk, because none of it belongs to the
 * catalogue, the cart or the checkout: `src/data/salesHistory.ts` reduces its daily rows out of the generated
 * orders, and the two services carry the bucketing, the comparison baselines and the report composition over
 * them. Vite splits at the dynamic-import boundary the loader below opens, so the first read that needs the
 * graph is what fetches it and every read after that reuses the copy it resolved.
 */
export interface DeferredAnalytics {
  /** The daily fact rows, one per category, channel and day of activity. */
  readonly salesRecords: readonly SalesRecord[];
  /** The KPI aggregation, with its comparison baseline. */
  readonly computeKpis: typeof AnalyticsRules.computeKpis;
  /** The revenue series, bucketed and optionally split. */
  readonly computeRevenueSeries: typeof AnalyticsRules.computeRevenueSeries;
  /** The ranked product performance over the order collection. */
  readonly computeTopProducts: typeof AnalyticsRules.computeTopProducts;
  /** The definition a report kind names, or `undefined` for a kind none declares. */
  readonly findDefinition: typeof ReportRules.findDefinition;
  /** The one composition a whole report run — rows, summary and series — comes from. */
  readonly runReportDefinition: typeof ReportRules.runReportDefinition;
}

/** The graph once a read has fetched it, or `null` before the first read that needs it. */
let analyticsGraph: DeferredAnalytics | null = null;

/** A fetch already in flight, so reads arriving together share one load rather than starting one each. */
let analyticsGraphLoad: Promise<DeferredAnalytics | null> | null = null;

/**
 * The deferred graph, fetching it when this is the first read that needs it: the three modules are imported
 * together, so a read costs one fetch however many of them it uses, and the members it resolved are remembered
 * for every read after it.
 *
 * A fetch that failed is not remembered: the memo is cleared and `null` is answered, so the next read starts a
 * fresh load rather than reading one failure for the life of the page. Nothing here reaches a caller as a
 * thrown error or a rejected promise, because a failure at the data seam is a value — the read that asked
 * shapes the `null` into a refusal.
 *
 * @returns The graph, or `null` when fetching it failed.
 */
export function loadAnalyticsGraph(): Promise<DeferredAnalytics | null> {
  if (analyticsGraph !== null) return Promise.resolve(analyticsGraph);
  analyticsGraphLoad ??= Promise.all([
    import("@/data/salesHistory"),
    import("@/utils/analyticsRules"),
    import("@/utils/reportRules"),
  ]).then(
    ([salesHistory, analytics, reports]) => {
      const loaded: DeferredAnalytics = {
        salesRecords: salesHistory.SALES_RECORDS,
        computeKpis: analytics.computeKpis,
        computeRevenueSeries: analytics.computeRevenueSeries,
        computeTopProducts: analytics.computeTopProducts,
        findDefinition: reports.findDefinition,
        runReportDefinition: reports.runReportDefinition,
      };
      analyticsGraph = loaded;
      analyticsGraphLoad = null;
      return loaded;
    },
    () => {
      analyticsGraphLoad = null;
      return null;
    },
  );
  return analyticsGraphLoad;
}

/**
 * The refusal a read whose graph could not be fetched is answered with: the `500` and `unexpected-error` the
 * transport words an outcome that never became a `Result` with, carrying the copy module's neutral sentence,
 * so a page shows its one generic failure whether the seam, the transport or this fetch is what failed.
 *
 * The code is restated here rather than imported, because the vocabulary `src/lib/apiContract.ts` owns is
 * outside the dependency whitelist this layer is given — the same choice `src/data/collectionStore.ts` recorded
 * for the refusals it decides.
 */
export function unexpectedFailure(): Result<never> {
  return {
    ok: false,
    error: { status: 500, code: "unexpected-error", message: FEEDBACK_COPY.ERROR_STATE_BODY },
  };
}

/**
 * Runs one read over the deferred graph, fetching the graph when this is the first read that needs it.
 *
 * @param read - The read to run, given the graph it needs.
 * @returns The read's value, or the shaped `500` failure when the graph could not be fetched; never a
 * rejection, so nothing escapes this module as a thrown error.
 */
export async function overAnalyticsGraph<TValue>(
  read: (graph: DeferredAnalytics) => TValue,
): Promise<Result<TValue>> {
  const graph = await loadAnalyticsGraph();
  return graph === null ? unexpectedFailure() : accept(read(graph));
}
