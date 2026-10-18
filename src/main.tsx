/**
 * Path: src/main.tsx
 * Purpose: Imports the stylesheets, binds the data source and mounts the application into `#root`
 * Lines: 90
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "@/App";
import { salesProDataSource } from "@/data/repositories";
import { registerDataSource } from "@/lib/mockServer";

/*
 * The eight stylesheets the plan maps, and the product's only import of `src/styles/**`: this module is what
 * `index.html` loads, so a sheet absent from this list is a sheet the application never gets and every class
 * it defines renders unstyled. The order is load-bearing rather than alphabetical — it is the cascade. Tokens
 * declares every colour, spacing, type, radius, shadow and z-index value; base resets the document and sets
 * typography; layout paints the shell; components carries the primitive families the pages compose; and the
 * four area sheets follow, so a surface rule beats a primitive rule of equal specificity (the header's search
 * field renders at 48px rather than the input's 40px for exactly this reason). Six further sheets — controls,
 * data-display, page-header, tabs-accordion, catalog-landing and catalog-detail — reach the page from these
 * eight through their own `@import`, which is why no ninth path appears below and why none of those six is
 * imported anywhere else.
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
 * It is the composition root and nothing more: it wires the two things the application cannot discover for
 * itself — the data the transport answers from, and the router the route table declares into — and then mounts
 * `App`. Everything past that belongs to a provider, a service or a component; nothing here computes, fetches,
 * stores or formats a value, and no state is held.
 *
 * Two placements are decisions rather than accidents. The data binding is made here, at module scope and ahead
 * of the first render, because the source is bound rather than imported: `src/lib/mockServer.ts` declares the
 * interface it needs and keeps no compile-time dependency on `src/data`, which is what let the transport be
 * generated before the data it serves and what will let a real backend replace the mock server without a
 * feature changing. A request arriving before the binding exists answers `503 data-source-unavailable`, so
 * this is module-scope work rather than an effect — an effect runs after the first render and would race the
 * first request a page makes. Binding twice is harmless; the seam holds one source.
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
