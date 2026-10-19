/**
 * Path: src/main.tsx
 * Purpose: Imports the stylesheets, binds the data source and mounts the application into `#root`
 * Lines: 219
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "@/App";
import { SESSION_STORAGE_KEYS } from "@/constants/config";
import { salesProDataSource } from "@/data/repositories";
import { registerDataSource } from "@/lib/mockServer";
import { readSessionStored, writeSessionStored } from "@/utils/storage";

/*
 * The eight stylesheets the plan maps, and the product's only import of `src/styles/**`: this module is what
 * `index.html` loads, so a sheet absent from this list is a sheet the application never gets and every class
 * it defines renders unstyled. The order is load-bearing rather than alphabetical — it is the cascade. Tokens
 * declares every colour, spacing, type, radius, shadow and z-index value; base resets the document and sets
 * typography; layout paints the shell; components carries the primitive families the pages compose; and the
 * four area sheets follow, so a surface rule beats a primitive rule of equal specificity (the header's search
 * field renders at 48px rather than the input's 40px for exactly this reason). Thirteen further sheets —
 * page-header, sidebar, controls, data-display, tabs-accordion, toasts, catalog-landing, catalog-detail, cart,
 * commerce-steps, summary-panel, chart-series and placeholders — reach the page from these eight through their
 * own `@import`, which is why no ninth path appears below and why none of them is imported anywhere else.
 */
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/layout.css";
import "@/styles/components.css";
import "@/styles/catalog.css";
import "@/styles/commerce.css";
import "@/styles/admin-reports.css";
import "@/styles/account.css";

/*
 * What this file owns, and what it deliberately leaves out.
 *
 * It is the composition root and nothing more: it wires the three things the application cannot discover for
 * itself — the data the transport answers from, the router the route table declares into, and the recovery a
 * failed chunk load meets after a deployment — and then mounts `App`. Everything past that belongs to a
 * provider, a service or a component; nothing here computes, fetches, stores or formats an application
 * value, and the only state it holds is the session-scoped stamp the stale-chunk recovery below keeps.
 *
 * Three placements are decisions rather than accidents. The data binding is made here, at module
 * scope and ahead of the first render, because the source is bound rather than imported:
 * `src/lib/mockServer.ts` declares the interface it needs and keeps no compile-time dependency on
 * `src/data`, so a real backend can replace the mock server without a feature changing. A request
 * arriving before the binding exists answers `503 data-source-unavailable`, so this is module-scope
 * work rather than an effect — an effect runs after the first render and would race the first
 * request a page makes. Binding twice is harmless; the seam holds one source.
 *
 * `BrowserRouter` is mounted here rather than inside `src/App.tsx` or `src/Router.tsx`, because both of those
 * declare routes for whichever router sits above them and neither may own one: the test harness renders the
 * same tree under a `MemoryRouter` to choose its own starting location, so the two files stay router-free and
 * this one supplies the browser's history. Nothing below may mount a second router.
 *
 * The mount element is resolved with a guard rather than a non-null assertion, so a build that ships without
 * `index.html`'s root element fails with a sentence naming what is missing instead of an unreadable property
 * access from inside React.
 */

/**
 * Binds the seeded data source before the first render, so the first request a page makes is answered from the
 * in-browser collections rather than with `503 data-source-unavailable`. It lives here, and not inside
 * `src/lib/mockServer.ts`, so the transport keeps no compile-time dependency on `src/data`.
 */
registerDataSource(salesProDataSource);

/** The id `index.html` declares on the element the application mounts into — the one place it is written. */
const ROOT_ELEMENT_ID = "root";

const rootElement = document.getElementById(ROOT_ELEMENT_ID);

if (rootElement === null) {
  throw new Error(
    `SalesPro could not start: the document has no element with id "${ROOT_ELEMENT_ID}", so the ` +
      "application has nothing to mount into. Check that index.html declares the root element it loads.",
  );
}

// Stale-chunk recovery ----------------------------------------------------------------------------

/*
 * What a visitor meets when a lazy import fails because the deployment under them changed.
 *
 * Vite fires `vite:preloadError` on `window` when a dynamic import of a build chunk fails, and the case this
 * product has to answer is the ordinary one: a document loaded before a deployment asks for a screen whose
 * chunk the new build renamed or moved, so the URL the loaded module graph holds is no longer served. A reload
 * is the recovery that works, because what is stale is the document's own record of its chunks and a fresh
 * load replaces exactly that. React's reaction on its own is the lazy rejection, which reaches the boundary
 * around the routed content as a screen that failed to render; here the visitor gets the page they asked for
 * instead.
 *
 * The listener is registered at module scope, ahead of `createRoot(...).render(...)`, for the same reason the
 * data binding above is: a lazy import can only fail after the first render, and a listener added from an
 * effect would arrive after the render that starts the import. This module is where it belongs because it is
 * what `index.html` loads and what owns the application's first load; a component could not own it, because the
 * failure is the module graph's and not any screen's.
 *
 * Nothing is printed. The recovery is `preventDefault()` and a reload, and a console sentence beside it would
 * be a diagnostic in a visitor's browser: the product's developer-facing surfaces are the error boundary and
 * the mock server, both development-only, and a production console stays clean.
 *
 * The one reload is guarded, because a reload that meets the same stale chunk again would reload
 * again and the visitor would watch the page blink instead of reading anything. The marker naming
 * the reload is `SESSION_STORAGE_KEYS.STALE_CHUNK_RECOVERY`, the tab-scoped key
 * `src/constants/config.ts` declares, and it is read and written through `src/utils/storage.ts` —
 * the product's one home for persistence, which resolves the store and reports a refusal as a value
 * — in the tab's session store, where it belongs because it records a property of this session
 * rather than durable state. It ages out after `STALE_CHUNK_RECOVERY_WINDOW_MS`, and until it does
 * a second failure drops the listener instead and lets the rejection stand, which the error
 * boundary renders as a page with a retry and a way home. The window is what keeps a later
 * deployment recoverable: a visitor who meets a stale chunk an hour into the session is reloaded as
 * a first-time visitor is, because no recent recovery is on record.

/** The event Vite fires on `window` when a dynamic import of a build chunk fails. */
const STALE_CHUNK_EVENT = "vite:preloadError";

/**
 * How long a completed recovery stands before another one may be made, in milliseconds.
 *
 * A minute is longer than any reload takes and much shorter than a session: it is what stops a stale chunk the
 * reload could not clear — the file is gone from the server, not merely renamed — from reloading the document
 * on every attempt, while leaving a later deployment free to recover.
 */
const STALE_CHUNK_RECOVERY_WINDOW_MS = 60_000;

/**
 * When this document last recovered, held in memory for a browser that refuses the session store.
 *
 * It does not survive a reload, so a browser with no usable store can recover once per document; what it does
 * guarantee is that a second failure in the same document never reloads, which is the loop it exists to stop.
 */
let inMemoryRecoveryStamp: number | null = null;

/** Proves a value read back through {@link readRecoveryStamp} is the instant it records. */
function isRecoveryStamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Reads the time of the recovery this session already made, or `null` when there is none to report.
 *
 * The read goes through `src/utils/storage.ts`, so the tab's session store is resolved in that module's guard
 * and a browser that refuses it — a private window, a locked-down profile, a blocked cookie policy — is never
 * reached from here as a throw. A store holding nothing usable, of any age, answers the in-memory marker, which
 * is the record that answers the same question for the document that is failing.
 *
 * @returns The epoch milliseconds of the last recovery, or `null` if this session has made none.
 */
function readRecoveryStamp(): number | null {
  return readSessionStored<number | null>(
    SESSION_STORAGE_KEYS.STALE_CHUNK_RECOVERY,
    inMemoryRecoveryStamp,
    isRecoveryStamp,
  );
}

/**
 * Records that this session has just recovered, so the next failure inside the window does not.
 *
 * The in-memory marker is set first and the session store is asked afterwards, so the answer this returns is
 * the store's own: `false` means the marker did not reach it, which costs the guard its reach across the
 * reload — a marker the store will not keep is not there for the next document to read — and costs the
 * recovery nothing, because a fresh document is what fixes a stale chunk.
 *
 * @param stamp - The epoch milliseconds of the recovery being recorded.
 * @returns `true` when the marker was stored, `false` when the session store refused it.
 */
function writeRecoveryStamp(stamp: number): boolean {
  inMemoryRecoveryStamp = stamp;
  return writeSessionStored(SESSION_STORAGE_KEYS.STALE_CHUNK_RECOVERY, stamp);
}

/**
 * The recovery: reload once for a stale chunk, and hand the second failure to the error boundary.
 *
 * @param event - Vite's notification that a chunk load failed. `preventDefault()` is what stops Vite
 *   reporting the same failure again on top of the reload, which would leave a visitor with an
 *   unhandled rejection beside the page they were about to get back.
 */
function recoverFromStaleChunk(event: Event): void {
  event.preventDefault();

  const lastRecovery = readRecoveryStamp();
  if (lastRecovery !== null && Date.now() - lastRecovery < STALE_CHUNK_RECOVERY_WINDOW_MS) {
    // The reload just made met the same stale chunk, so another would meet it too. Dropping the listener
    // leaves the rejection to React, whose boundary renders it — with the retry and the way home — as a
    // screen the visitor can act on.
    window.removeEventListener(STALE_CHUNK_EVENT, recoverFromStaleChunk);
    return;
  }

  if (!writeRecoveryStamp(Date.now())) {
    // A marker the store would not keep cannot be consulted after the reload, so the guard's reach ends with
    // this document and the listener goes with it: a later failure in this document is React's boundary to
    // render rather than a reload the store has no record of. The reload is still made, because a fresh
    // document is what fixes a stale chunk and dropping it would cost the visitor the page they asked for.
    window.removeEventListener(STALE_CHUNK_EVENT, recoverFromStaleChunk);
  }

  window.location.reload();
}

window.addEventListener(STALE_CHUNK_EVENT, recoverFromStaleChunk);

createRoot(rootElement).render(
  // StrictMode is kept on: it surfaces an impure render, a missing cleanup or an unstable provider value while
  // developing, and the seeded generators are deterministic, so its double invocation yields two identical
  // datasets rather than two different ones.
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
