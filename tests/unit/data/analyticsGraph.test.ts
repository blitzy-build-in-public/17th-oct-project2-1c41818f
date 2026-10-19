/**
 * Path: tests/unit/data/analyticsGraph.test.ts
 * Purpose: The deferred analytics and report graph: the one fetch every read that needs it shares, the `null` and the shaped `500` a failed fetch answers with, the fresh load the read after that failure starts, and the same refusal as the transport words it
 * Lines: 186
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_ACCOUNTS } from "@/constants/config";
import { FEEDBACK_COPY } from "@/constants/content";
import { REPORT_DEFINITIONS } from "@/constants/taxonomy";
import type { Session } from "@/types/account";
import type { ReportResult } from "@/types/analytics";
import type { Result } from "@/types/common";
import { addDays, toIsoDate } from "@/utils/dates";

import { expectRefusal, refusalOf, valueOf } from "../lib/mockServerHarness";

// The subject is the loader that fetches the three foundation modules a first analytics or report read
// needs: `src/data/salesHistory.ts`, `src/utils/analyticsRules.ts` and `src/utils/reportRules.ts`. Nothing
// about that fetch is observable from a caller except its two outcomes, so the cases drive the module's own
// exported functions — `loadAnalyticsGraph` and `overAnalyticsGraph` — and assert those outcomes: the
// members every read after the first shares, the `null` a failed fetch answers with, the `500` a read is
// given in its place, the fresh load the next read starts once a failure is not remembered, and the same
// refusal reaching a caller through the transport.
//
// The one lever a case has over that outcome is whether the fetch itself fails, which is what the branch
// under test is written for: `armFailedFetch` below makes the import of one of the three modules throw, so
// what fails is the fetch and not the product's logic. The module it fails — a pure rules module, whose
// logic is never replaced and whose members are never stubbed — is imported by the loader alone, so no
// service, reducer, context or data module is mocked, and every other case in this file imports the real
// modules and asserts against what they hold.

/** The module whose import fails in the cases that drive a failed fetch: one of the three the loader fetches. */
const FAILING_MODULE = "@/utils/reportRules";

/**
 * Arms the loader's next fetch to fail, so a case reaches the outcome the module answers with a `null` for.
 *
 * A module whose import throws is the only failure a module loader can be given, and it is the failure this
 * branch exists for: the product's own guard turns it into a value rather than letting it reach a page. The
 * arm is one-shot in effect but not in registration — `vi.doMock` is not hoisted, so it applies from where
 * the case calls it, and {@link releaseFailedFetch} takes it off again — which keeps every case here
 * independent of the order the file's cases run in.
 */
function armFailedFetch(): void {
  vi.doMock(FAILING_MODULE, () => {
    throw new Error("The report module's chunk never arrived.");
  });
}

/** Takes the armed failure off again and empties the module registry, so a later case loads the real modules. */
function releaseFailedFetch(): void {
  vi.doUnmock(FAILING_MODULE);
  vi.resetModules();
}

/** The data source, its binding and the client, imported from a registry this case owns: the seam a case
 *  drives the loader through, so the request it makes is dispatched into the store it built. */
async function freshSeam(): Promise<{
  readonly session: Session;
  readonly readReport: (kind: string) => Promise<Result<ReportResult>>;
}> {
  const [repositories, seam, client] = await Promise.all([
    import("@/data/repositories"),
    import("@/lib/mockServer"),
    import("@/lib/apiClient"),
  ]);
  seam.registerDataSource(repositories.createSalesProDataSource());
  const session = await valueOf(
    client.postJson<Session>(seam.API_PATHS.AUTH_LOGIN, {
      email: DEMO_ACCOUNTS.ADMIN_EMAIL,
      password: DEMO_ACCOUNTS.PASSWORD,
    }),
  );
  return {
    session,
    readReport: (kind: string): Promise<Result<ReportResult>> =>
      client.getJson<ReportResult>(seam.fillApiPath(seam.API_PATHS.REPORT_RUN, { kind }), {
        query: RANGE,
        sessionToken: session.token,
      }),
  };
}

/** The dated range a report run uses: the trailing thirty days, the range the dashboard opens on. */
const RANGE = { from: addDays(toIsoDate(new Date()), -30), to: toIsoDate(new Date()) };

beforeEach(() => {
  // A fresh module registry per case, because the loader remembers what it fetched for the life of its
  // module: a case sharing the previous case's instance would measure that memo and not its own fetch.
  vi.resetModules();
});

afterEach(() => {
  releaseFailedFetch();
});

describe("the deferred graph's load", () => {
  it("resolves the members of the three modules once, and gives every read after it the same graph", async () => {
    const graph = await import("@/data/analyticsGraph");
    const analytics = await import("@/utils/analyticsRules");
    const history = await import("@/data/salesHistory");

    const loaded = await graph.loadAnalyticsGraph();

    expect(loaded).not.toBeNull();
    // The second call answers the remembered graph rather than fetching again: one fetch per document.
    expect(await graph.loadAnalyticsGraph()).toBe(loaded);
    // The members are the modules' own, so a read runs the product's rules rather than a copy of them.
    expect(loaded?.salesRecordsFor).toBe(history.salesRecordsFor);
    expect(loaded?.computeKpis).toBe(analytics.computeKpis);
    expect(loaded?.runReportDefinition).toBe(
      (await import("@/utils/reportRules")).runReportDefinition,
    );
  });

  it("runs a read over the graph it resolved and answers that read's own value", async () => {
    const graph = await import("@/data/analyticsGraph");

    const definition = await valueOf(
      graph.overAnalyticsGraph((loaded) => loaded.findDefinition(REPORT_DEFINITIONS, "sales")),
    );

    // The graph's own composition resolves the definition the report kind names, which is what proves the
    // fetched members are the ones a read reaches.
    expect(definition?.kind).toBe("sales");
    expect(definition?.columns.length).toBeGreaterThan(0);
  });

  it("answers `null` for a fetch that failed, and starts a fresh load for the read after it", async () => {
    armFailedFetch();
    const graph = await import("@/data/analyticsGraph");

    await expect(graph.loadAnalyticsGraph()).resolves.toBeNull();

    // The failure is not remembered: the next read starts a fresh fetch, which resolves once the module can
    // be imported again rather than reading one failure for the life of the page.
    releaseFailedFetch();
    const retried = await graph.loadAnalyticsGraph();

    expect(retried).not.toBeNull();
    expect(retried?.computeTopProducts).toBe(
      (await import("@/utils/analyticsRules")).computeTopProducts,
    );
  });

  it("shapes a failed fetch as the transport's own `500`, so a page shows its one generic failure", async () => {
    armFailedFetch();
    const graph = await import("@/data/analyticsGraph");

    const refusal = await refusalOf(
      graph.overAnalyticsGraph((loaded) => loaded.computeTopProducts),
    );

    expectRefusal(refusal, 500, "unexpected-error");
    expect(refusal.message).toBe(FEEDBACK_COPY.ERROR_STATE_BODY);
  });

  it("answers a report run through the transport with that same `500` when the graph cannot be fetched", async () => {
    armFailedFetch();
    const graph = await import("@/data/analyticsGraph");
    const seam = await freshSeam();

    // The administrator's run reaches the data source's own read, which is refused exactly as a caller of the
    // loader is: the same status, the same code and the same sentence.
    const refusal = await refusalOf(seam.readReport("sales"));

    expectRefusal(refusal, 500, "unexpected-error");
    expect(refusal.message).toBe(FEEDBACK_COPY.ERROR_STATE_BODY);
    await expect(graph.loadAnalyticsGraph()).resolves.toBeNull();
  });

  it("answers that run with the report itself while the graph can be fetched", async () => {
    // The control for the case above: the same request through the same transport is answered with a report,
    // so the `500` there is the failed fetch and not a refusal of the session, the route or the store.
    const seam = await freshSeam();

    const report = await valueOf(seam.readReport("sales"));

    expect(seam.session.role).toBe("admin");
    expect(report.from).toBe(RANGE.from);
    expect(report.to).toBe(RANGE.to);
    expect(report.rows.length).toBeGreaterThan(0);
  });
});
