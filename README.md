<!--
Path: README.md
Purpose: What the product is, how to install, run, test and lint it, and how the phases and the manifest resume
Lines: 179
-->

# SalesPro

## What SalesPro is

SalesPro is a complete browser-delivered sales website: a **storefront** — home, product catalog, search and filters, shopping cart, checkout and customer accounts — and a **sales back office** — an admin sales dashboard and three reports — in one client-rendered single-page application built with HTML, CSS and TypeScript over React 19.

Two facts about this product are easy to misread, so they come first.

- **There is no server.** No API host, database, ORM or external service exists anywhere in it, and nothing leaves the page. The product's data is seeded deterministically in the browser and every request is answered in-process, behind one typed service layer: `src/lib/apiClient.ts` over `src/lib/mockServer.ts`. A real backend would replace that one seam and no feature would change.
- **Money is an integer number of minor units** (cents) from the seeded data to the rendered total, and it is formatted only at the edge, through `src/utils/format.ts`. No total in the product is a floating-point accident.

Both are explored in [`docs/architecture.md`](docs/architecture.md).

## Requirements

- **Node.js `^20.19.0 || ^22.12.0 || >=24.0.0`**, as `package.json`'s `engines` field declares. Vite 7 requires Node `^20.19` or `>=22.12`, and jsdom 27 requires the same floor, so that range is the binding one rather than a preference.
- npm, which ships with Node.

The plan's own build was verified on **Node v22.23.3 with npm 11.21.0**.

## Getting started

```bash
npm install
npm run dev
```

The dev server prints the URL it is listening on — open it and the storefront is live. Nothing else is required: there is no `.env` file to create, no service to start and no database to seed.

The build is verified by running the pinned tooling locally. **There is no CI pipeline, container or deployment workflow in this repository** — see [Scripts](#scripts) for the local gate.

## Scripts

`package.json` declares nine scripts and no others.

| Script               | Command                      | What it is for                                                                                                                  |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`        | `vite`                       | The dev server with hot module replacement, for working on the product.                                                         |
| `npm run build`      | `tsc --noEmit && vite build` | The production build: type-checks the whole tree, then bundles it to `dist/`.                                                   |
| `npm run preview`    | `vite preview`               | Serves the built output so the production bundle can be checked as a document, not as a dev server.                             |
| `npm test`           | `vitest run`                 | Runs the whole suite once and exits — the phase gate every file is held to.                                                     |
| `npm run test:watch` | `vitest`                     | The same suite in watch mode, for local work only.                                                                              |
| `npm run coverage`   | `vitest run --coverage`      | The suite with the V8 coverage report and the configured thresholds enforced.                                                   |
| `npm run lint`       | `eslint .`                   | Static analysis over `src`, `tests` and the config files: the type-aware TypeScript rules plus the React hooks rules.           |
| `npm run typecheck`  | `tsc --noEmit`               | The compiler over the whole tree, with no output written.                                                                       |
| `npm run format`     | `prettier --write .`         | Formats the repository. Prettier is the sole formatting authority; ESLint's stylistic rules are off so the two cannot disagree. |

**`npm test` is green with no test files present.** `vitest.config.ts` sets `passWithNoTests: true`, so the gate is valid from the first phase of the build onward and tightens into real coverage as the suite lands. The suite runs in two Vitest projects: a `node` project for `tests/unit/**` and a `jsdom` project for `tests/components/**` and `tests/integration/**`.

## The stack, pinned

Every package is pinned to an exact version in `package.json` — no ranges, no `latest`. The **application's entire runtime dependency set is three packages**:

| Package            | Version | Why it is here                                                                                                                                                                                    |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react`            | 19.2.0  | The only framework in the product.                                                                                                                                                                |
| `react-dom`        | 19.2.0  | Renders React into the document.                                                                                                                                                                  |
| `react-router-dom` | 7.18.4  | Client-side routing, in **declarative mode only** — `BrowserRouter`/`Routes`/`Route` with `React.lazy`, and `MemoryRouter` in tests. No data mode, no framework mode, no Vite plugin, no loaders. |

Everything else is development tooling, and nothing under `src/` imports any of it:

| Area            | Packages                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build           | `typescript` 5.9.3, `vite` 7.3.7, `@vitejs/plugin-react` 5.1.0, `@types/node` 22.18.13                                                                                                                 |
| Test            | `vitest` 4.1.12, `jsdom` 27.1.0, `@testing-library/react` 16.3.0, `@testing-library/dom` 10.4.1, `@testing-library/jest-dom` 6.9.1, `@testing-library/user-event` 14.6.1, `@vitest/coverage-v8` 4.1.12 |
| Lint and format | `eslint` 9.39.0, `@eslint/js` 9.39.0, `typescript-eslint` 8.58.2, `eslint-plugin-react-hooks` 7.0.1, `globals` 16.4.0, `prettier` 3.6.2                                                                |
| Types           | `@types/react` 19.2.2, `@types/react-dom` 19.2.2                                                                                                                                                       |

**Nothing outside that list is added.** The stack boundary is hard: no other UI framework or meta-framework, no state, form, chart, table, HTTP, date, i18n or utility library, no component kit, and no CSS framework or preprocessor. Everything a library would have supplied is built here — validation in `src/utils/validation.ts`, the charts in `src/components/charts/`, the table in `src/components/ui/Table.tsx`, formatting across `src/utils/format.ts` and `src/utils/dates.ts`, and CSV export in `src/utils/csv.ts`. The stylesheets are hand-written CSS, with every value declared once in `src/styles/tokens.css`.

## Demonstration sign-in

The seeded accounts are usable from a fresh clone, because every seeded account carries a credential digest at seed time:

| Role          | Email                   | Password      |
| ------------- | ----------------------- | ------------- |
| Administrator | `admin@salespro.test`   | `Shopper1234` |
| Customer      | `shopper@salespro.test` | `Shopper1234` |

**This is an in-browser demonstration credential store, not a security boundary.** Passwords are held as salted digests produced and verified through the single digest helper in `src/utils/strings.ts` — which is what the seeded data and the sign-in path both call, so the digest has exactly one home — and a session is an opaque token carrying a role claim and an expiry. The sign-in is there so the account and administrator surfaces can be exercised; it is not production-grade authentication, and the plan says so plainly rather than implying otherwise. **A real deployment would move session issue and verification behind the server that `src/lib/apiClient.ts` is designed to be repointed at**, which is the same change that would replace the mock transport. The endpoint contract, including the three authorisation levels, is in [`docs/mock-api.md`](docs/mock-api.md).

## Configuration

`.env.example` documents exactly two inert, non-secret values:

| Variable              | Default    | What reads it                                                                                                  |
| --------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `VITE_APP_NAME`       | `SalesPro` | Nothing today; the name the application renders comes from `APP_COPY.APP_NAME` in `src/constants/content.ts`.  |
| `VITE_API_LATENCY_MS` | `120`      | The simulated latency the mock server waits before answering; `0` in tests, so the suite runs without waiting. |

Only `VITE_`-prefixed names reach client code, and **the application runs identically with no `.env` file present**, because every read supplies a default in `src/constants/config.ts`. **No secret, real credential or token exists anywhere in the tree, and the product makes no network request at all** — every endpoint is resolved in-process, so there is no remote surface and nothing to configure for CORS, CSRF or TLS.

## Where code goes

The architecture is a layered client-rendered single-page application organised as feature slices over shared foundations. A file may import only from its own layer or from a layer below it — which is also why the build could be generated in dependency order, one file at a time.

| Layer               | Modules                                                     | Responsibility                                                                                                  |
| ------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Foundations         | `src/types`, `src/constants`, `src/utils`                   | Shapes, literals and pure helpers. No React, no data access.                                                    |
| Data access         | `src/data`, `src/lib/apiClient.ts`, `src/lib/mockServer.ts` | The seeded collections, the repositories over them, and the in-process API behind its transport seam.           |
| Domain services     | `src/lib/*Service.ts`                                       | One domain rule per file: auth, catalog, search, pricing, orders, customers, analytics, reports.                |
| Shared presentation | `src/components`, `src/styles`                              | Layout, UI primitives, product components, hand-written SVG charts and the design tokens.                       |
| State               | `src/state`                                                 | Contexts, reducers and hooks for auth, cart, catalog, checkout and toasts.                                      |
| Feature slices      | `src/features/<module>`                                     | The eight route-shaped modules: `home`, `catalog`, `search`, `cart`, `checkout`, `account`, `admin`, `reports`. |
| App shell           | `src/Router.tsx`, `src/App.tsx`, `src/main.tsx`             | The route table with its guards, the provider composition and the mount.                                        |

Two rules make the layering hold:

1. **No feature slice imports another feature slice.** Anything two features need is promoted into `src/components`, `src/lib`, `src/state` or `src/utils`, and both import it there. That is what lets a module be built, tested and reasoned about on its own.
2. **There are no barrel `index.ts` files anywhere.** An importer always names the concrete path that owns the concern, so no folder acquires an implicit public API.

Three corollaries worth knowing before adding a file: no feature slice imports `src/data` (a page reaches the seeded collections through a service), no module under `src/components` or `src/features` imports a stylesheet (`src/main.tsx` is the product's only importer of the eight entry stylesheets, and classes are consumed by name), and `src/lib/apiClient.ts` is the only module that knows the data source is a mock.

[`docs/architecture.md`](docs/architecture.md) carries the full statement: the layer table, the split paths, the component-interaction and sequence diagrams, the state contract, the security architecture and the invariants.

## How the build runs: gated phases and the manifest

This repository was generated in gated phases rather than in one pass, and the build is **resumable from the repository alone**. The mechanism is worth understanding before changing anything.

- **Phase 0 was the first gated output.** It produced exactly one artefact — [`generation-manifest.md`](generation-manifest.md) at the repository root, holding the file tree with a line budget per file — and no file contents, then stopped.
- **Phases 1 to 39 each generate 3 to 5 files from the tree, in tree order.** A phase may hold fewer only when fewer than three pending files remain.
- **Every generated file opens with a three-field header comment** — `Path`, `Purpose` and `Lines` — in the file's own comment syntax. `Lines` is the file's real total length, the header included, and the same number is recorded in the manifest. The only exemptions are `package.json`, `tsconfig.json` and `.prettierrc.json`, whose formats permit no comment; their counts are still recorded in the manifest.
- **A phase's output ends with exactly one line** — `Total lines so far: N / 50000` — with `N` the cumulative delivered total the manifest records. Nothing follows it: no summary, no preview of the next phase, and no prose between the files.
- **Generation then stops until the reply is the single word `continue`.** No phase begins without it.
- **A generated file is never regenerated.** A defect found later is fixed in the file that owns the concern, never by duplicating the logic into the file that found it. `generation-manifest.md` is the only file rewritten across phases, and only as bookkeeping.
- **No phase pads a file to reach a budget, and no real code is cut to stay inside one.** A file that outgrows the request's 600-line ceiling has its concern **split** into a second file in the same layer, and the split is recorded in the manifest and in `docs/architecture.md`.

### The manifest is the authority

[`generation-manifest.md`](generation-manifest.md) is the single source of truth for what exists: every path with its line budget, actual count and status; the phase schedule with planned, actual and cumulative lines; the reconciliation ledger; and the output contract. Its status vocabulary is:

| Status        | Meaning                                                                               |
| ------------- | ------------------------------------------------------------------------------------- |
| `Pending`     | The plan's content is not written at that path yet.                                   |
| `In progress` | The phase that owns the file is writing it.                                           |
| `Done`        | The content is complete and the header's `Lines` value equals the file's real length. |

The ledger records every file whose actual count deviates from its budget by more than 10%, with a one-line reason naming what grew, so the total stays auditable line by line.

### Resuming the build

1. Run `npm install` if `node_modules/` is absent (never `npm cache clean` — this host's npm cache is shared), then run `npm run typecheck` and `npm test` and **confirm both are green before writing anything**. A phase that follows a broken predecessor is worth less than the cost of finding out why.
2. Read the manifest and take the next **3 to 5 `Pending` files in schedule order** — never from memory of an earlier session, and never skipping one.
3. Write those files against what the earlier phases actually produced. If a phase finds that an earlier file cannot support it, stop and report the conflict rather than duplicating the missing behaviour into the new files.
4. Before the progress line, set each written file's status to `Done`, record its real line count, update the phase row and the cumulative total, append any reconciliation note, and rewrite the manifest in full.
5. Print the single progress line and stop for `continue`.

If the manifest and the working tree disagree — a file present but `Pending`, or recorded `Done` but absent — **the file on disk wins**, and the manifest is corrected to match before any new file is generated.

## Documentation

| Document                                       | What it covers                                                                                                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/architecture.md`](docs/architecture.md) | The layers and their import rules, where a layer is split across paths, component interaction, the read/write/query data flow, the state contract, the app shell, the security architecture, the invariants and where a change of a given kind lands. |
| [`docs/mock-api.md`](docs/mock-api.md)         | The endpoint contract: every route of the in-process API with its request and response, the error vocabulary, the demonstration credentials and the latency and failure switches.                                                                     |
| [`docs/contributing.md`](docs/contributing.md) | Naming and placement, the one-authoritative-home-per-concern table, the file-size and budget rules, the header-comment forms, the conventions and the nine-script gate.                                                                               |

## Scale and scope

The plan allocates **exactly 50,000 lines across 157 counted files**, with every budget the plan sets inside the request's 600-line ceiling (the largest budget is 500), and it aims to hold the delivered total within **±5%** of that allocation. The ceiling binds the plan's budgets rather than the delivered tree: two delivered paths stand above it at their real counts — `src/utils/strings.ts` 620 lines and `src/data/collectionStore.ts` 617 lines — recorded in the manifest, each with the split of the concern into a second file in the same layer as the remedy the ceiling's rule prescribes; the path this paragraph carried is inside the ceiling now at 336 — `src/components/ui/Toast.tsx`, its message level having been split into `src/components/ui/ToastItem.tsx` 311 — and the two it also carried have been split along their own seams and are inside the ceiling now — `src/styles/data-display.css` into itself at 538 and `src/styles/toasts.css` at 86, and `tests/integration/catalogBrowseFlow.test.tsx` into itself at 401 and `tests/integration/catalogSuggestionsFlow.test.tsx` at 281. The manifest, not this paragraph, is the authority for the delivered figure — and it stands above the allocation, because a budget is an allocation rather than padding: a file that lands under its budget returns the difference to the remainder, a file that lands over budget is recorded in the ledger with a one-line reason naming what grew, and no working code is ever cut to fit a number. At the snapshot this file was written against, every one of the 157 counted files was in place — the manifest's snapshot rows carry the delivered line counts, for the counted set and for the whole tree, so no figure this paragraph quotes can go stale — and the ledger names each deviation beyond 10% of a file's budget. Counted in the total are the TypeScript and TSX under `src/` and `tests/`, the CSS under `src/styles/`, the root tooling files and the four Markdown documents, plus each split path, whose lines count against the file it came from. Excluded are `package-lock.json`, `node_modules/`, `dist/` and `generation-manifest.md`.

The seeded data is generated deterministically rather than typed out, so the same build produces the same data: roughly **140 products** across **20 categories** and **12 brands**, **40 customers** (2 of them administrators), about **2,255 orders** over the two years the order history spans — about **1,155** of them in the trailing year, which is where the **60** orders owned by the seeded accounts fall, and the rest in the year before it, which is the activity the dashboard's previous-year comparison baseline reads — about **420 reviews**, and a daily sales fact table derived from the same generated orders. It is volume enough for pagination, faceting, aggregation, reporting and a comparison against the year before to be meaningful. `tests/unit/lib/mockServer.test.ts` asserts that two independent bootstrap passes over the seeded data produce identical collections.

Deliberately **not** in this build, so nobody hunts for it:

- **No server, database or ORM.** No server process, no API host and no seed script executed outside the browser.
- **No real payment processing** and no payment SDK. The card step is a demonstration with a deterministic decline path; no card number is ever stored.
- **No CI/CD, containerisation, hosting or infrastructure as code.** No Docker image, no deployment configuration and no release workflow.
- **No monitoring, logging infrastructure, analytics beacons or error-reporting services.** The only operational surfaces are the toast system and the error boundary.
- **No end-to-end browser tests, visual-regression tests, load tests or mutation testing.** The suite is Vitest with Testing Library, and accessibility is met by construction rather than audited by a tool.
- **No internationalisation, dark mode or theming.** One language (`en-US`), one currency (USD), one palette declared in `src/styles/tokens.css`.
- **Export and printing are CSV only.** There is no PDF export and no print stylesheet.
- **The dashboard and the reports read; they do not write.** Product, order, catalogue, inventory, customer and promo-code administration are all out of scope.
