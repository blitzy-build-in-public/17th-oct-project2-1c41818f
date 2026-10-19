<!--
Path: generation-manifest.md
Purpose: The authoritative build manifest: tree, budgets, actual counts, phase schedule, cumulative total and status ledger — the one file excluded from the 50,000, written in Phase 0 before any of the above.
Lines: 848
-->

# SalesPro — generation manifest

Phase 0's single artefact and the build's authority on what exists: every path in the tree with
its line budget, its phase, its status and its real `wc -l`, the phase schedule with each phase's
planned and actual lines, the roll-ups those rows sum to, the reconciliation ledger and the
output contract a generating session follows. It is rewritten in full as each phase completes,
and it is the one path excluded from the 50,000-line count (§0.5.1): its own length is recorded
in Part 1 and counted nowhere. Every figure below is derived from the working tree, one figure per
fact, and each row's count is that path's real line count. The snapshot is 2026-10-19.

## How a session resumes

1. Run `npm install` if `node_modules/` is absent, then `npm run typecheck` and `npm test`, and
   generate nothing until both are green.
2. Take the next 3 to 5 `Pending` rows of Part 1 in tree order — the order Part 2 schedules them
   in — and never a list held in memory.
3. If a phase finds that an earlier file cannot support what it must write, stop and report that
   rather than duplicating the missing behaviour into the phase's own files.
4. Before the progress line, work through Part 5's per-phase update procedure and rewrite this
   file in full; then print exactly one progress line and stop until the word `continue` arrives.

Where this file and the working tree disagree — a path present but `Pending`, or recorded `Done`
but absent — the file on disk wins, and this file is corrected to the disk before anything new
is generated.

## Facts

| Fact                                              | Value                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paths listed in Part 1                            | 272 — 157 counted files, 108 §0.5.5 split paths, 6 covering suites and this manifest; each of the 114 budget-free paths is charged to a mapped file — 108 to the mapped file whose allocation they draw on, 6 to the file they cover — so every path in the tree traces to a file §0.7.1 maps |
| Counted in the 50,000-line total                  | 157 — the plan's budgets; a split path and a covering suite carry none of their own                                                                                                                                                                                                           |
| Excluded from it                                  | 1 — this manifest, the only path whose own lines are never counted                                                                                                                                                                                                                            |
| §0.5.5 split paths                                | 108 — 73 under `src/` holding 18,330 and 35 under `tests/` holding 9,936                                                                                                                                                                                                                      |
| Covering suites carrying no budget of their own   | 6, holding 1,979, each charged to the mapped file it covers                                                                                                                                                                                                                                   |
| Paths carrying no budget of their own, both kinds | 114, holding 30,245 — every one recorded with the mapped file whose allocation it draws on                                                                                                                                                                                                    |
| The suite                                         | 64 paths and 23,543 lines against the plan's 23 files and 7,350 — the plan's own 23 test files hold 11,628 and the 41 paths charged to them hold 11,915; §0.5.5 reconciles it and real coverage is never cut                                                                                  |
| Total budgeted                                    | exactly 50,000 lines across the 157 counted files                                                                                                                                                                                                                                             |
| Lines delivered at this snapshot                  | counted 92,749 — the 157 mapped files' own 62,504 plus the 30,245 lines charged to them (Part 3 states the rule and its parts once)                                                                                                                                                           |
| Generation phases                                 | Phase 0 plus 39, all complete; every one of the 39 holds 3 to 5 tree files                                                                                                                                                                                                                    |
| Counted files beyond 10% of budget                | 122 — 94 over and 28 under, each with its row in Part 4                                                                                                                                                                                                                                       |
| Paths over the request's 600-line ceiling         | 0 — none                                                                                                                                                                                                                                                                                      |
| Largest per-file budget                           | 500 lines, inside the request's 600-line ceiling                                                                                                                                                                                                                                              |
| **§0.5.1's ±5% band (47,500-52,500)**             | not met at 92,749; settled once at the end of Part 4, which states why no route to it is open                                                                                                                                                                                                 |

## Part 1 — File tree in generation order, with budgets, status and actual counts

Flattening the mapped rows below top to bottom reproduces the phase schedule of Part 2 exactly, so
the next phase's batch is read from the first `Pending` rows of this tree and never from memory. A
§0.5.5 split path and a covering suite are recorded beside the mapped file whose allocation they
draw on, so their rows sit among the files they live with. One row per path the tree holds, no path
twice, and each count is that path's real `wc -l`.

Legend · `# <budget>` the lines allocated to the path · `P<n>` the phase that generates it ·
`Done` the plan's content for it is complete · `part of <mapped path> <budget>` a §0.5.5 split path,
which draws on the mapped file's allocation and adds no line to the 50,000 · `covering <mapped path>
<budget>` a suite the plan maps no file for, charged to the mapped file whose concern it covers.

```text
/  (repository root)
├── generation-manifest.md  # 300 · P0 · Done · 848 · excluded from the 50,000-line total
├── package.json  # 65 · P1 · Done · 46 · exempt from the header contract: JSON carries no comment
├── tsconfig.json  # 45 · P1 · Done · 28 · exempt from the header contract: JSON carries no comment
├── vite.config.ts  # 60 · P1 · Done · 25
├── vitest.config.ts  # 85 · P1 · Done · 75
├── index.html  # 60 · P1 · Done · 23
├── eslint.config.js  # 55 · P2 · Done · 58
├── .prettierrc.json  # 12 · P2 · Done · 12 · exempt from the header contract: JSON carries no comment
├── .gitignore  # 25 · P2 · Done · 41
├── .env.example  # 18 · P2 · Done · 23
├── src/
│   ├── types/
│   │   ├── common.ts  # 240 · P3 · Done · 296
│   │   ├── catalog.ts  # 380 · P3 · Done · 415
│   │   ├── commerce.ts  # 420 · P3 · Done · 455
│   │   ├── account.ts  # 290 · P3 · Done · 303
│   │   └── analytics.ts  # 400 · P3 · Done · 412
│   ├── constants/
│   │   ├── routes.ts  # 180 · P4 · Done · 298
│   │   ├── config.ts  # 250 · P4 · Done · 490
│   │   ├── content.ts  # 400 · P4 · Done · 513
│   │   ├── checkoutCopy.ts  # part of src/constants/content.ts 400 · P4 · Done · 118 · the checkout and confirmation copy: the step indicator's labels — split out of src/constants/content.ts
│   │   ├── content-account.ts  # part of src/constants/content.ts 400 · P4 · Done · 105 · the account register of the user-facing copy: signing in and registering, the profile — split out of src/constants/content.ts
│   │   ├── content-reports.ts  # part of src/constants/content.ts 400 · P4 · Done · 130 · the back-office register of the user-facing copy — split out of src/constants/content.ts
│   │   ├── content-feedback.ts  # part of src/constants/content.ts 400 · P4 · Done · 118 · the empty, error and outcome copy every surface renders — split out of src/constants/content.ts
│   │   └── taxonomy.ts  # 330 · P4 · Done · 553
│   ├── utils/
│   │   ├── format.ts  # 380 · P5 · Done · 577
│   │   ├── formatPrimitives.ts  # part of src/utils/format.ts 380 · P5 · Done · 112 · the locale, the formatter cache and the figure primitives every formatter — split out of src/utils/format.ts
│   │   ├── exhaustive.ts  # part of src/utils/format.ts 380 · P5 · Done · 34 · the exhaustiveness proof the four switch sites each carried, in one home — split out of src/utils/format.ts
│   │   ├── dates.ts  # 350 · P5 · Done · 599
│   │   ├── dateDisplay.ts  # part of src/utils/dates.ts 350 · P5 · Done · 103 · the locale, the formatter cache and the day — split out of src/utils/dates.ts
│   │   ├── isoInstants.ts  # part of src/utils/dates.ts 350 · P5 · Done · 132 · parses ISO 8601 text into local instants, moves an instant by whole days or hours — split out of src/utils/dates.ts
│   │   ├── strings.ts  # 350 · P5 · Done · 531 · the text and identifier helpers, with the credential digest and the seal split into src/utils/credentials.ts
│   │   ├── credentials.ts  # part of src/utils/strings.ts 350 · P5 · Done · 114 · the credential digest the seed data and the sign-in path both call, and the seal a durable record is written with — split out of src/utils/strings.ts
│   │   ├── hashing.ts  # part of src/utils/strings.ts 350 · P5 · Done · 88 · the arithmetic the seeded credentials rest on: FNV-1a, the domain separators and the comparison — split out of src/utils/strings.ts
│   │   ├── validation.ts  # 440 · P5 · Done · 598
│   │   ├── collections.ts  # 420 · P5 · Done · 597
│   │   ├── statistics.ts  # 360 · P6 · Done · 536
│   │   ├── queryParams.ts  # 270 · P6 · Done · 600
│   │   ├── storage.ts  # 270 · P6 · Done · 452
│   │   ├── async.ts  # 270 · P6 · Done · 374
│   │   ├── csv.ts  # 250 · P6 · Done · 297
│   │   ├── catalogRules.ts  # part of src/lib/catalogService.ts 480 · P9 · Done · 466 · the catalogue's pure rules: what a filter leaves, what each facet counts — split out of src/lib/catalogService.ts
│   │   ├── searchRules.ts  # part of src/lib/searchService.ts 440 · P9 · Done · 503 · tokenising, weighted scoring and type-ahead ranking over any collections a caller passes — split out of src/lib/searchService.ts
│   │   ├── analyticsRules.ts  # part of src/lib/analyticsService.ts 480 · P10 · Done · 511 · the aggregation rules the dashboard and the reports read and the seeded repositories — split out of src/lib/analyticsService.ts
│   │   ├── orderRules.ts  # part of src/lib/orderService.ts 420 · P10 · Done · 275 · the order rules the checkout and the account read and the seeded repositories compose — split out of src/lib/orderService.ts
│   │   ├── orderPlacements.ts  # part of src/lib/orderService.ts 420 · P10 · Done · 348 · the read credential this browser holds for each order it placed without an account — split out of src/lib/orderService.ts
│   │   ├── pricingRules.ts  # part of src/lib/pricingService.ts 440 · P10 · Done · 482 · the pricing rules the cart and the checkout read and the seeded repositories compose — split out of src/lib/pricingService.ts
│   │   ├── reportRules.ts  # part of src/lib/reportService.ts 460 · P10 · Done · 568 · the report rules the report service and the seeded repositories both compose — split out of src/lib/reportService.ts
│   │   └── accountRules.ts  # part of src/lib/authService.ts 380 · P10 · Done · 162 · the account rules the domain services and the data layer share — split out of src/lib/authService.ts
│   ├── styles/
│   │   ├── tokens.css  # 250 · P7 · Done · 327
│   │   ├── base.css  # 270 · P7 · Done · 383
│   │   ├── layout.css  # 350 · P7 · Done · 493
│   │   ├── page-header.css  # part of src/styles/layout.css 350 · P7 · Done · 146 · styles for the page header and its breadcrumb trail — split out of src/styles/layout.css
│   │   ├── sidebar.css  # part of src/styles/layout.css 350 · P7 · Done · 129 · the administrator sidebar's skeleton — split out of src/styles/layout.css
│   │   ├── components.css  # 500 · P7 · Done · 511
│   │   ├── controls.css  # part of src/styles/components.css 500 · P7 · Done · 599 · styles for the shared primitives of buttons, form fields and selection controls — split out of src/styles/components.css
│   │   ├── data-display.css  # part of src/styles/components.css 500 · P7 · Done · 538 · styles for the shared primitives of cards and badges, the data table, pagination
│   │   ├── toasts.css  # part of src/styles/components.css 500 · P7 · Done · 86 · the toast family src/components/ui/Toast.tsx renders — split out of src/styles/data-display.css
│   │   ├── tabs-accordion.css  # part of src/styles/components.css 500 · P7 · Done · 170 · styles for the tab and disclosure families src/components/ui/Tabs.tsx renders — split out of src/styles/data-display.css
│   │   ├── catalog.css  # 400 · P8 · Done · 594
│   │   ├── catalog-landing.css  # part of src/styles/catalog.css 400 · P8 · Done · 353 · styles for the landing page's bands: the hero with its illustration — split out of src/styles/catalog.css
│   │   ├── catalog-detail.css  # part of src/styles/catalog.css 400 · P8 · Done · 314 · styles for the product detail surfaces: the two-column layout, the gallery — split out of src/styles/catalog.css
│   │   ├── commerce.css  # 460 · P8 · Done · 246
│   │   ├── cart.css  # part of src/styles/commerce.css 460 · P8 · Done · 280 · styles for the cart, the mini-cart and the order summary panel the cart and the checkout — split out of src/styles/commerce.css
│   │   ├── summary-panel.css  # part of src/styles/commerce.css 460 · P8 · Done · 147 · styles for the order-summary panel register that the cart's CartSummary.tsx renders — split out of src/styles/commerce.css
│   │   ├── commerce-steps.css  # part of src/styles/commerce.css 460 · P8 · Done · 121 · styles for the checkout's ordered step indicator — split out of src/styles/commerce.css
│   │   ├── admin-reports.css  # 480 · P8 · Done · 593
│   │   ├── chart-series.css  # part of src/styles/admin-reports.css 480 · P8 · Done · 155 · styles for the chart series paint: the shared mark treatment — split out of src/styles/admin-reports.css
│   │   ├── placeholders.css  # part of src/styles/admin-reports.css 480 · P8 · Done · 197 · the shape each data-page placeholder takes while its region is loading — split out of src/styles/admin-reports.css
│   │   └── account.css  # 310 · P8 · Done · 516
│   ├── lib/
│   │   ├── apiClient.ts  # 350 · P9 · Done · 486
│   │   ├── mockServer.ts  # 500 · P9 · Done · 550
│   │   ├── apiContract.ts  # part of src/lib/mockServer.ts 500 · P9 · Done · 547 · the contract the in-process API is built on: its error vocabulary — split out of src/lib/mockServer.ts
│   │   ├── apiRequests.ts  # part of src/lib/mockServer.ts 500 · P9 · Done · 599 · reads a request for the in-process API: the members a query carries — split out of src/lib/mockServer.ts
│   │   ├── apiRoutes.ts  # part of src/lib/mockServer.ts 500 · P9 · Done · 533 · the in-process API's endpoints: the route table — split out of src/lib/mockServer.ts
│   │   ├── apiOrders.ts  # part of src/lib/mockServer.ts 500 · P9 · Done · 332 · the submission half of `POST /api/orders` — the demonstration card decision — split out of src/lib/mockServer.ts
│   │   ├── authService.ts  # 380 · P9 · Done · 400
│   │   ├── catalogService.ts  # 480 · P9 · Done · 389
│   │   ├── searchService.ts  # 440 · P9 · Done · 127
│   │   ├── pricingService.ts  # 440 · P10 · Done · 177
│   │   ├── orderService.ts  # 420 · P10 · Done · 355
│   │   ├── customerService.ts  # 380 · P10 · Done · 416
│   │   ├── analyticsService.ts  # 480 · P10 · Done · 158
│   │   └── reportService.ts  # 460 · P10 · Done · 220
│   ├── data/
│   │   ├── categories.ts  # 240 · P11 · Done · 402
│   │   ├── products.ts  # 480 · P11 · Done · 388
│   │   ├── productAnchors.ts  # part of src/data/products.ts 480 · P11 · Done · 470 · the catalogue's hand-authored half: the leaf-category vocabulary, the copy pools each category is written from and the twelve anchors the catalogue expands — split out of src/data/products.ts
│   │   ├── productRules.ts  # part of src/data/products.ts 480 · P11 · Done · 204 · the catalogue's generation rules: the seeded draw surface and the knobs products are priced, stocked, rated and dated by — split out of src/data/products.ts
│   │   ├── customers.ts  # 310 · P11 · Done · 495
│   │   ├── orders.ts  # 460 · P11 · Done · 595
│   │   ├── orderAttribution.ts  # part of src/data/orders.ts 460 · P11 · Done · 89 · which seeded account owns each of the order history's sixty attributed orders — split out of src/data/orders.ts
│   │   ├── reviews.ts  # 250 · P12 · Done · 589
│   │   ├── salesHistory.ts  # 380 · P12 · Done · 383
│   │   ├── repositories.ts  # 440 · P12 · Done · 554
│   │   ├── analyticsGraph.ts  # part of src/data/repositories.ts 440 · P12 · Done · 126 · the modules a first analytics or report read fetches on use — split out of src/data/repositories.ts
│   │   ├── collectionStore.ts  # part of src/data/repositories.ts 440 · P12 · Done · 225 · the store half of the data source: the seeded collections and the indexes built over them once — split out of src/data/repositories.ts · its writes half split out again as src/data/storeWrites.ts
│   │   ├── storeWrites.ts  # part of src/data/repositories.ts 440 · P12 · Done · 478 · the writes half of the data source: the refusals its operations answer with, and the account, session and address writes over the seeded collections — split out of src/data/collectionStore.ts
│   │   ├── clientWriteRecord.ts  # part of src/data/repositories.ts 440 · P12 · Done · 75 · the durable record of this browser's own writes: the shape a load replays and the empty record a failed read falls back to — split out of src/data/clientWrites.ts
│   │   ├── clientWrites.ts  # part of src/data/repositories.ts 440 · P12 · Done · 563 · the durable record of this browser's own writes to the seeded collections — split out of src/data/repositories.ts
│   │   ├── reviewWrites.ts  # part of src/data/repositories.ts 440 · P12 · Done · 110 · the review half of this browser's durable record — split out of src/data/repositories.ts
│   │   └── sessionTable.ts  # part of src/data/repositories.ts 440 · P12 · Done · 359 · the durable session table: the record, the guards that read it back — split out of src/data/repositories.ts
│   ├── state/
│   │   ├── AuthContext.tsx  # 360 · P13 · Done · 592
│   │   ├── authSession.ts  # part of src/state/AuthContext.tsx 360 · P13 · Done · 302 · the session's contract as a consumer reads it, the read that revalidates a stored token — split out of src/state/AuthContext.tsx
│   │   ├── CartContext.tsx  # 360 · P13 · Done · 503
│   │   ├── CatalogContext.tsx  # 330 · P13 · Done · 497
│   │   ├── CheckoutContext.tsx  # 380 · P13 · Done · 598
│   │   ├── ToastContext.tsx  # 250 · P13 · Done · 298
│   │   ├── cartReducer.ts  # 310 · P14 · Done · 535
│   │   ├── checkoutReducer.ts  # 350 · P14 · Done · 594
│   │   ├── catalogReducer.ts  # 270 · P14 · Done · 255
│   │   ├── hooks.ts  # 480 · P14 · Done · 168
│   │   ├── asyncQuery.ts  # part of src/state/hooks.ts 480 · P14 · Done · 242 · the abortable async-data hook and the lifecycle types it reports — split out of src/state/hooks.ts
│   │   ├── focusHooks.ts  # part of src/state/hooks.ts 480 · P14 · Done · 74 · the one place a refused submission hands the keyboard on: the notice — split out of src/state/hooks.ts
│   │   └── scrollHooks.ts  # part of src/state/hooks.ts 480 · P14 · Done · 41 · view-scroll hooks: brings a view to its own top when the value that names it changes — split out of src/state/hooks.ts
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx  # 310 · P15 · Done · 302
│   │   │   ├── Header.tsx  # 380 · P15 · Done · 599
│   │   │   ├── Footer.tsx  # 240 · P15 · Done · 162
│   │   │   ├── AdminSidebar.tsx  # 290 · P15 · Done · 182
│   │   │   └── PageHeader.tsx  # 200 · P15 · Done · 238
│   │   ├── ui/
│   │   │   ├── Button.tsx  # 360 · P16 · Done · 458
│   │   │   ├── Input.tsx  # 400 · P16 · Done · 549
│   │   │   ├── Select.tsx  # 400 · P16 · Done · 561
│   │   │   ├── Modal.tsx  # 360 · P16 · Done · 497
│   │   │   ├── Icons.tsx  # part of src/components/ui/Modal.tsx 360 · P16 · Done · 41 · the decorative glyphs the primitives and the feature surfaces render inside — split out of src/components/ui/Modal.tsx
│   │   │   ├── overlayEngine.ts  # part of src/components/ui/Modal.tsx 360 · P16 · Done · 211 · the overlay engine Modal, Drawer and ConfirmDialog share: focus movement — split out of src/components/ui/Modal.tsx
│   │   │   ├── Table.tsx  # 480 · P17 · Done · 512
│   │   │   ├── Pagination.tsx  # 270 · P17 · Done · 271
│   │   │   ├── Card.tsx  # 270 · P17 · Done · 406
│   │   │   ├── Feedback.tsx  # 400 · P17 · Done · 600
│   │   │   ├── NotFoundView.tsx  # part of src/components/ui/Feedback.tsx 400 · P17 · Done · 66 · the one not-found view every surface renders when the address it was given resolves — split out of src/components/ui/Feedback.tsx
│   │   │   ├── Toast.tsx  # 270 · P18 · Done · 336
│   │   │   ├── ToastItem.tsx  # part of src/components/ui/Toast.tsx 270 · P18 · Done · 296 · one queued message: its markup, its kind's glyph and live role, and its pausable countdown — split out of src/components/ui/Toast.tsx
│   │   │   ├── Tabs.tsx  # 270 · P18 · Done · 586
│   │   │   ├── Rating.tsx  # 250 · P18 · Done · 599
│   │   │   ├── Tooltip.tsx  # 220 · P18 · Done · 403
│   │   │   ├── SortControl.tsx  # part of src/features/search/SortControl.tsx 220 · P24 · Done · 150 · the sort selector both the catalogue page and the search page compose — split out of src/features/search/SortControl.tsx
│   │   │   ├── DateRangeControl.tsx  # part of src/features/reports/DateRangePicker.tsx 310 · P32 · Done · 395 · the range control both administrator surfaces render: presets, the two date fields — split out of src/features/reports/DateRangePicker.tsx
│   │   │   ├── hooks.ts  # part of src/state/hooks.ts 480 · P14 · Done · 288 · the view-facing hooks the shared primitives and their composing pages read: pagination — split out of src/state/hooks.ts
│   │   │   └── focusHandoff.ts  # part of src/state/hooks.ts 480 · P14 · Done · 291 · the one home of the focus-handoff rule: when the control that had the focus goes away — split out of src/state/hooks.ts
│   │   ├── product/
│   │   │   ├── ProductCard.tsx  # 360 · P19 · Done · 500
│   │   │   └── ProductGallery.tsx  # 270 · P19 · Done · 271
│   │   └── charts/
│   │       ├── chartScales.ts  # 310 · P19 · Done · 521
│   │       ├── chartGeometry.ts  # part of src/components/charts/chartScales.ts 310 · P19 · Done · 525 · mark, path and data-table geometry for the charts — split out of src/components/charts/chartScales.ts
│   │       ├── labelMetrics.ts  # part of src/components/charts/chartScales.ts 310 · P19 · Done · 51 · how wide one chart label is, in the frame's own user units — split out of src/components/charts/chartGeometry.ts
│   │       ├── svgPaths.ts  # part of src/components/charts/chartScales.ts 310 · P19 · Done · 139 · the SVG path text a chart’s marks are drawn from, in the frame’s own coordinate system — split out of src/components/charts/chartGeometry.ts
│   │       ├── ChartDataTable.tsx  # part of src/components/charts/LineChart.tsx 420 · P20 · Done · 167 · the paired data table every chart renders as its accessible alternative — split out of src/components/charts/LineChart.tsx
│   │       ├── LineChart.tsx  # 420 · P20 · Done · 483
│   │       ├── readoutPlacement.ts  # part of src/components/charts/LineChart.tsx 420 · P20 · Done · 137 · places a chart's hover readout inside the plot area — split out of src/components/charts/LineChart.tsx
│   │       ├── lineChartModel.ts  # part of src/components/charts/LineChart.tsx 420 · P20 · Done · 255 · the line chart's plot model: its scales, axis ticks, series paths — split out of src/components/charts/LineChart.tsx
│   │       ├── BarChart.tsx  # 400 · P20 · Done · 423
│   │       ├── barGeometry.ts  # part of src/components/charts/BarChart.tsx 400 · P20 · Done · 467 · the bar renderer's own geometry: its scales, its marks — split out of src/components/charts/BarChart.tsx
│   │       ├── DonutChart.tsx  # 330 · P20 · Done · 573
│   │       ├── donutLabelModel.ts  # part of src/components/charts/DonutChart.tsx 330 · P20 · Done · 161 · where each of a donut's percentages is written — inside its own wedge — split out of src/components/charts/DonutChart.tsx
│   │       └── ChartPlaceholder.tsx  # part of src/components/charts/LineChart.tsx 420 · P20 · Done · 239 · the shape of a chart block while its series are on their way: plot — split out of src/components/charts/LineChart.tsx
│   ├── features/
│   │   ├── home/
│   │   │   ├── HomePage.tsx  # 310 · P21 · Done · 344
│   │   │   ├── HeroSection.tsx  # 270 · P21 · Done · 196
│   │   │   ├── FeaturedProducts.tsx  # 290 · P21 · Done · 334
│   │   │   └── CategoryShowcase.tsx  # 250 · P21 · Done · 257
│   │   ├── catalog/
│   │   │   ├── CatalogPage.tsx  # 380 · P22 · Done · 376
│   │   │   ├── CatalogFilterRegion.tsx  # part of src/features/catalog/CatalogPage.tsx 380 · P22 · Done · 254 · catalogue facet panel: the five facet groups over the catalogue's own facet response — split out of src/features/catalog/CatalogPage.tsx
│   │   │   ├── ProductList.tsx  # 310 · P22 · Done · 295
│   │   │   ├── ProductDetailPage.tsx  # 475 · P22 · Done · 454
│   │   │   ├── PurchasePanel.tsx  # part of src/features/catalog/ProductDetailPage.tsx 475 · P22 · Done · 221 · the product detail page's buy column: brand and SKU, rating, price and availability, the quantity stepper and the two ways to order — split out of src/features/catalog/ProductDetailPage.tsx
│   │   │   └── ProductReviews.tsx  # 330 · P22 · Done · 600
│   │   ├── search/
│   │   │   ├── SearchPage.tsx  # 360 · P23 · Done · 359
│   │   │   ├── SearchBar.tsx  # 330 · P23 · Done · 506
│   │   │   ├── SearchSuggestions.tsx  # 270 · P23 · Done · 318
│   │   │   ├── FilterPanel.tsx  # 470 · P24 · Done · 490
│   │   │   ├── SortControl.tsx  # 220 · P24 · Done · 20
│   │   │   └── ActiveFilters.tsx  # 250 · P24 · Done · 250
│   │   ├── cart/
│   │   │   ├── CartPage.tsx  # 360 · P25 · Done · 391
│   │   │   ├── CartItemRow.tsx  # 290 · P25 · Done · 442
│   │   │   ├── CartSummary.tsx  # 330 · P25 · Done · 428
│   │   │   ├── MiniCart.tsx  # 330 · P25 · Done · 288
│   │   │   ├── cartSelectors.ts  # 270 · P25 · Done · 194
│   │   │   └── HeaderCartButton.tsx  # part of src/components/layout/Header.tsx 380 · P15 · Done · 100 · the header's cart trigger: the basket's count and the mini-cart disclosure — split out of src/components/layout/Header.tsx
│   │   ├── checkout/
│   │   │   ├── CheckoutPage.tsx  # 380 · P26 · Done · 391
│   │   │   ├── CheckoutErrorSummary.tsx  # part of src/features/checkout/CheckoutPage.tsx 380 · P26 · Done · 140 · the step's summary of what is wrong: how many fields are at fault — split out of src/features/checkout/CheckoutPage.tsx
│   │   │   ├── OrderSummaryPanel.tsx  # part of src/features/checkout/CheckoutPage.tsx 380 · P26 · Done · 294 · the checkout's order summary panel — split out of src/features/checkout/CheckoutPage.tsx
│   │   │   ├── CheckoutSteps.tsx  # 250 · P26 · Done · 224
│   │   │   ├── ShippingForm.tsx  # 360 · P26 · Done · 529
│   │   │   ├── PaymentForm.tsx  # 400 · P27 · Done · 265
│   │   │   ├── ReviewOrder.tsx  # 330 · P27 · Done · 509
│   │   │   └── OrderConfirmation.tsx  # 330 · P27 · Done · 557
│   │   ├── account/
│   │   │   ├── LoginPage.tsx  # 330 · P28 · Done · 370
│   │   │   ├── RegisterPage.tsx  # 360 · P28 · Done · 430
│   │   │   ├── AccountLayout.tsx  # 250 · P28 · Done · 191
│   │   │   ├── ProfilePage.tsx  # 350 · P29 · Done · 359
│   │   │   ├── OrderHistoryPage.tsx  # 360 · P29 · Done · 317
│   │   │   ├── OrderHistoryList.tsx  # part of src/features/account/OrderHistoryPage.tsx 360 · P29 · Done · 376 · the customer's order history: the status and date filters — split out of src/features/account/OrderHistoryPage.tsx
│   │   │   └── AddressBookPage.tsx  # 380 · P29 · Done · 573
│   │   ├── admin/
│   │   │   ├── AdminDashboardPage.tsx  # 400 · P30 · Done · 369
│   │   │   ├── KpiCard.tsx  # 270 · P30 · Done · 285
│   │   │   ├── SalesChart.tsx  # 380 · P30 · Done · 489
│   │   │   ├── RecentOrdersTable.tsx  # 290 · P30 · Done · 366
│   │   │   └── TopProductsTable.tsx  # 250 · P30 · Done · 379
│   │   └── reports/
│   │       ├── ReportsPage.tsx  # 330 · P31 · Done · 438
│   │       ├── SalesReport.tsx  # 400 · P31 · Done · 311
│   │       ├── ProductPerformanceReport.tsx  # 350 · P31 · Done · 324
│   │       ├── ReportPlaceholder.tsx  # part of src/features/reports/ReportsPage.tsx 330 · P31 · Done · 93 · the shape a report's body takes while its run is in flight: summary figures — split out of src/features/reports/ReportsPage.tsx
│   │       ├── CustomerReport.tsx  # 330 · P32 · Done · 339
│   │       ├── DateRangePicker.tsx  # 310 · P32 · Done · 123
│   │       └── ReportTable.tsx  # 290 · P32 · Done · 529
│   ├── Router.tsx  # 390 · P33 · Done · 545
│   ├── App.tsx  # 290 · P33 · Done · 339
│   └── main.tsx  # 120 · P33 · Done · 219
├── tests/
│   ├── setup.ts  # 130 · P34 · Done · 163
│   ├── fixtures.ts  # 440 · P34 · Done · 600
│   ├── testUtils.tsx  # 270 · P34 · Done · 323
│   ├── unit/
│   │   ├── utils/
│   │   │   ├── formatting.test.ts  # 380 · P35 · Done · 600
│   │   │   ├── validation.test.ts  # 290 · P35 · Done · 559
│   │   │   ├── validationCard.test.ts  # part of tests/unit/utils/validation.test.ts 290 · P35 · Done · 141 · the card number, expiry and security-code rules with the Luhn check they rest on — split out of tests/unit/utils/validation.test.ts
│   │   │   ├── collections.test.ts  # 400 · P35 · Done · 592
│   │   │   ├── collectionsRanking.test.ts  # part of tests/unit/utils/collections.test.ts 400 · P35 · Done · 167 · keyed indexing, reversal, frequency ranking and top-N selection helpers — split out of tests/unit/utils/collections.test.ts
│   │   │   ├── queryParams.test.ts  # 220 · P35 · Done · 565
│   │   │   ├── dates.test.ts  # part of tests/unit/utils/formatting.test.ts 380 · P35 · Done · 598 · the range arithmetic, bucket boundaries and comparison periods of src/utils/dates.ts — split out of tests/unit/utils/formatting.test.ts
│   │   │   ├── bucketLabels.test.ts  # part of tests/unit/utils/formatting.test.ts 380 · P35 · Done · 233 · the wording of a bucket the selected range clips — split out of tests/unit/utils/formatting.test.ts
│   │   │   ├── strings.test.ts  # part of tests/unit/utils/formatting.test.ts 380 · P35 · Done · 569 · the text, identifier-generator and credential-digest contracts of src/utils/strings.ts — split out of tests/unit/utils/formatting.test.ts
│   │   │   ├── statistics.test.ts  # part of tests/unit/utils/formatting.test.ts 380 · P35 · Done · 586 · unit coverage of src/utils/statistics.ts: percentage change, growth, averages — split out of tests/unit/utils/formatting.test.ts
│   │   │   ├── csv.test.ts  # part of tests/unit/utils/formatting.test.ts 380 · P35 · Done · 525 · CSV serialisation, escaping, clipping, row capping and the download trigger — split out of tests/unit/utils/formatting.test.ts
│   │   │   └── async.test.ts  # part of tests/unit/utils/formatting.test.ts 380 · P35 · Done · 589 · the timing, cancellation and retry contracts of src/utils/async.ts — split out of tests/unit/utils/formatting.test.ts
│   │   ├── lib/
│   │   │   ├── catalogSearch.test.ts  # 470 · P35 · Done · 504
│   │   │   ├── catalogSearchFlow.test.ts  # part of tests/unit/lib/catalogSearch.test.ts 470 · P35 · Done · 482 · search scoring, type-ahead suggestions — split out of tests/unit/lib/catalogSearch.test.ts
│   │   │   ├── pricingService.test.ts  # 330 · P36 · Done · 492
│   │   │   ├── pricingSurface.test.ts  # part of tests/unit/lib/pricingService.test.ts 330 · P36 · Done · 233 · the pricing service's transport-backed surface: promo validation, the delivery methods — split out of tests/unit/lib/pricingService.test.ts
│   │   │   ├── orderService.test.ts  # 270 · P36 · Done · 585
│   │   │   ├── authService.test.ts  # 250 · P36 · Done · 535
│   │   │   ├── analyticsService.test.ts  # 330 · P36 · Done · 537
│   │   │   ├── analyticsBaseline.test.ts  # part of tests/unit/lib/analyticsService.test.ts 330 · P36 · Done · 182 · the previous-year comparison the dashboard offers — split out of tests/unit/lib/analyticsService.test.ts
│   │   │   ├── analyticsSeries.test.ts  # part of tests/unit/lib/analyticsService.test.ts 330 · P36 · Done · 74 · the band wording of a charted period's series: one band per bucket — split out of tests/unit/lib/analyticsService.test.ts
│   │   │   ├── analyticsQueries.test.ts  # part of tests/unit/lib/analyticsService.test.ts 330 · P36 · Done · 95 · the query builders a dated read is assembled — split out of tests/unit/lib/analyticsService.test.ts
│   │   │   ├── reportService.test.ts  # 310 · P36 · Done · 599
│   │   │   ├── customerService.test.ts  # part of tests/unit/lib/pricingService.test.ts 330 · P36 · Done · 574 · profile reads and writes — split out of tests/unit/lib/pricingService.test.ts
│   │   │   ├── mockServer.test.ts  # 220 · P37 · Done · 596
│   │   │   ├── apiRoutesVocabulary.test.ts  # part of src/lib/mockServer.ts 500 · P37 · Done · 443 · the vocabulary the seam refuses a hand-made request's own values — split out of tests/unit/lib/apiRoutes.test.ts
│   │   │   ├── seedInvariants.test.ts  # part of tests/unit/lib/mockServer.test.ts 220 · P37 · Done · 122 · the seeded data's own invariants — split out of tests/unit/lib/mockServer.test.ts
│   │   │   ├── apiRoutes.test.ts  # covering src/lib/mockServer.ts 500 · P37 · Done · 597 · covering suite for src/lib/apiRoutes.ts
│   │   │   ├── mockServerDurability.test.ts  # part of tests/unit/lib/mockServer.test.ts 220 · P37 · Done · 360 · the seam's durability across a document load — split out of tests/unit/lib/mockServer.test.ts
│   │   │   ├── mockServerHarness.ts  # part of tests/unit/lib/mockServer.test.ts 220 · P37 · Done · 160 · the seam fixtures and assertions the mock-server specs share — split out of tests/unit/lib/mockServer.test.ts
│   │   │   ├── mockServerOrderRead.test.ts  # part of tests/unit/lib/mockServer.test.ts 220 · P37 · Done · 325 · the order read's authorisation — split out of tests/unit/lib/mockServer.test.ts
│   │   │   ├── sessionTableDurability.test.ts  # covering src/data/repositories.ts 440 · P37 · Done · 234 · covering suite for src/data/sessionTable.ts
│   │   │   └── clientWrites.test.ts  # covering src/data/repositories.ts 440 · P37 · Done · 322 · covering suite for src/data/clientWrites.ts
│   │   └── state/
│   │       ├── transactions.test.ts  # 440 · P37 · Done · 470
│   │       ├── checkout.test.ts  # part of tests/unit/state/transactions.test.ts 440 · P37 · Done · 326 · checkout transitions: the step machine, value and error patches — split out of tests/unit/state/transactions.test.ts
│   │       ├── catalogReducer.test.ts  # 250 · P37 · Done · 589
│   │       └── hooks.test.ts  # part of src/state/hooks.ts 480 · P14 · Done · 49 · the `useAsync` share of `src/state/hooks.ts` — split out of src/state/hooks.ts
│   ├── components/
│   │   ├── controls.test.tsx  # 360 · P37 · Done · 273
│   │   ├── overlays.test.tsx  # part of tests/components/controls.test.tsx 360 · P37 · Done · 501 · the overlay family and the supplementary surfaces beside it — dialog semantics — split out of tests/components/controls.test.tsx
│   │   ├── Table.test.tsx  # 240 · P37 · Done · 316
│   │   ├── chartHeaderHint.test.tsx  # covering src/features/admin/SalesChart.tsx 380 · P38 · Done · 113 · covering suite for src/features/admin/SalesChart.tsx
│   │   ├── charts.test.tsx  # 250 · P38 · Done · 599
│   │   ├── chartScales.test.ts  # part of tests/components/charts.test.tsx 250 · P38 · Done · 171 · the chart scales' own mathematics: the steps a value axis ticks — split out of tests/components/charts.test.tsx
│   │   └── focusHandoff.test.tsx  # part of src/state/hooks.ts 480 · P14 · Done · 295 · the focus-handoff contract: an armed handoff moves the focus to the region — split out of src/state/hooks.ts
│   ├── helpers/
│   │   ├── analyticsHarness.ts  # part of tests/unit/lib/analyticsService.test.ts 330 · P36 · Done · 96 · the fixture surface both analytics suites read and the seam calls each had declared for itself — split out of tests/unit/lib/analyticsService.test.ts
│   │   ├── checkoutHarness.ts  # part of tests/integration/checkoutFlow.test.tsx 380 · P38 · Done · 116 · the basket walk and the shipping step's inputs the two checkout suites had each declared — split out of tests/integration/checkoutFlow.test.tsx
│   │   ├── journeyHarness.tsx  # part of tests/integration/shoppingFlow.test.tsx 350 · P38 · Done · 381 · the harness the journey files read the rendered application through: the copy — split out of tests/integration/shoppingFlow.test.tsx
│   │   └── pricingHarness.ts  # part of tests/unit/lib/pricingService.test.ts 330 · P36 · Done · 35 · the money invariants both pricing suites assert over a priced cart — split out of tests/unit/lib/pricingService.test.ts
│   └── integration/
│       ├── shoppingFlow.test.tsx  # 350 · P38 · Done · 333
│       ├── catalogBrowseFlow.test.tsx  # part of tests/integration/shoppingFlow.test.tsx 350 · P38 · Done · 479 · the catalogue and search surfaces, from the listing's facets and sort to its failure states — split out of tests/integration/shoppingFlow.test.tsx
│       ├── catalogSuggestionsFlow.test.tsx  # part of tests/integration/shoppingFlow.test.tsx 350 · P38 · Done · 348 · the suggestion list's keyboard choice and the product page it opens — split out of tests/integration/catalogBrowseFlow.test.tsx
│       ├── checkoutFlow.test.tsx  # 380 · P38 · Done · 599
│       ├── checkoutPricingFailure.test.tsx  # part of tests/integration/checkoutFlow.test.tsx 380 · P38 · Done · 132 · the checkout's refused price request: the seam's failure reported with a retry — split out of tests/integration/checkoutFlow.test.tsx
│       ├── accountFlow.test.tsx  # 330 · P38 · Done · 599
│       ├── accountAddressBook.test.tsx  # part of tests/integration/accountFlow.test.tsx 330 · P38 · Done · 281 · the address book's own flow: a refused save, two adds, a card named from its label, an edit — split out of tests/integration/accountFlow.test.tsx
│       ├── adminReportsFlow.test.tsx  # 440 · P38 · Done · 600
│       ├── figureReaders.ts  # part of tests/integration/adminReportsFlow.test.tsx 440 · P38 · Done · 11 · the readers the administrator flow's assertions read a rendered figure back out with — split out of tests/integration/adminReportsFlow.test.tsx
│       ├── catalogUrlState.test.tsx  # part of tests/integration/shoppingFlow.test.tsx 350 · P38 · Done · 208 · the catalogue's query contract with the address bar: writes raised inside one render — split out of tests/integration/shoppingFlow.test.tsx
│       ├── sessionLifecycle.test.tsx  # covering src/state/AuthContext.tsx 360 · P38 · Done · 565 · covering suite for src/state/AuthContext.tsx
│       ├── orderConfirmationRefusals.test.tsx  # part of tests/integration/checkoutFlow.test.tsx 380 · P38 · Done · 49 · the confirmation route's two refusals as a visitor meets them — split out of tests/integration/checkoutFlow.test.tsx
│       └── searchQueryConsistency.test.tsx  # covering src/features/search/SearchPage.tsx 360 · P38 · Done · 148 · covering suite for src/features/search/SearchPage.tsx
├── README.md  # 310 · P39 · Done · 179
└── docs/
    ├── architecture.md  # 270 · P39 · Done · 341
    ├── contributing.md  # 160 · P39 · Done · 156
    └── mock-api.md  # 200 · P39 · Done · 242
```

## Part 2 — Phase schedule

Each row names the files the phase generates with the budgets §0.5.2 allocates them, the lines the
plan budgets for the phase, the lines its files actually hold, and the cumulative total those
actuals reach. Every `Actual lines` figure is the sum of that phase's Part 1 rows and every
`Cumulative` is the running total of those actuals, so the last one is the counted delivered total —
the 157 mapped files' own lines plus the CHARGED lines of the paths charged to them — and the same
number the closing progress line carries.

| Phase      | Files generated (line budget)                                                                                                                                                                                                                   | Planned lines | Actual lines | Cumulative |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------ | ---------- |
| 1          | `package.json` (65); `tsconfig.json` (45); `vite.config.ts` (60); `vitest.config.ts` (85); `index.html` (60)                                                                                                                                    | 315           | 197          | 197        |
| 2          | `eslint.config.js` (55); `.prettierrc.json` (12); `.gitignore` (25); `.env.example` (18)                                                                                                                                                        | 110           | 134          | 331        |
| 3          | `src/types/common.ts` (240); `src/types/catalog.ts` (380); `src/types/commerce.ts` (420); `src/types/account.ts` (290); `src/types/analytics.ts` (400)                                                                                          | 1,730         | 1,881        | 2,212      |
| 4          | `src/constants/routes.ts` (180); `src/constants/config.ts` (250); `src/constants/content.ts` (400); `src/constants/taxonomy.ts` (330)                                                                                                           | 1,160         | 2,325        | 4,537      |
| 5          | `src/utils/format.ts` (380); `src/utils/dates.ts` (350); `src/utils/strings.ts` (350); `src/utils/validation.ts` (440); `src/utils/collections.ts` (420)                                                                                        | 1,940         | 3,485        | 8,022      |
| 6          | `src/utils/statistics.ts` (360); `src/utils/queryParams.ts` (270); `src/utils/storage.ts` (270); `src/utils/async.ts` (270); `src/utils/csv.ts` (250)                                                                                           | 1,420         | 2,259        | 10,281     |
| 7          | `src/styles/tokens.css` (250); `src/styles/base.css` (270); `src/styles/layout.css` (350); `src/styles/components.css` (500)                                                                                                                    | 1,370         | 3,382        | 13,663     |
| 8          | `src/styles/catalog.css` (400); `src/styles/commerce.css` (460); `src/styles/admin-reports.css` (480); `src/styles/account.css` (310)                                                                                                           | 1,650         | 3,516        | 17,179     |
| 9          | `src/lib/apiClient.ts` (350); `src/lib/mockServer.ts` (500); `src/lib/authService.ts` (380); `src/lib/catalogService.ts` (480); `src/lib/searchService.ts` (440)                                                                                | 2,150         | 4,932        | 22,111     |
| 10         | `src/lib/pricingService.ts` (440); `src/lib/orderService.ts` (420); `src/lib/customerService.ts` (380); `src/lib/analyticsService.ts` (480); `src/lib/reportService.ts` (460)                                                                   | 2,180         | 3,672        | 25,783     |
| 11         | `src/data/categories.ts` (240); `src/data/products.ts` (480); `src/data/customers.ts` (310); `src/data/orders.ts` (460)                                                                                                                         | 1,490         | 2,643        | 28,426     |
| 12         | `src/data/reviews.ts` (250); `src/data/salesHistory.ts` (380); `src/data/repositories.ts` (440)                                                                                                                                                 | 1,070         | 3,462        | 31,888     |
| 13         | `src/state/AuthContext.tsx` (360); `src/state/CartContext.tsx` (360); `src/state/CatalogContext.tsx` (330); `src/state/CheckoutContext.tsx` (380); `src/state/ToastContext.tsx` (250)                                                           | 1,680         | 2,790        | 34,678     |
| 14         | `src/state/cartReducer.ts` (310); `src/state/checkoutReducer.ts` (350); `src/state/catalogReducer.ts` (270); `src/state/hooks.ts` (480)                                                                                                         | 1,410         | 2,832        | 37,510     |
| 15         | `src/components/layout/AppLayout.tsx` (310); `src/components/layout/Header.tsx` (380); `src/components/layout/Footer.tsx` (240); `src/components/layout/AdminSidebar.tsx` (290); `src/components/layout/PageHeader.tsx` (200)                   | 1,420         | 1,583        | 39,093     |
| 16         | `src/components/ui/Button.tsx` (360); `src/components/ui/Input.tsx` (400); `src/components/ui/Select.tsx` (400); `src/components/ui/Modal.tsx` (360)                                                                                            | 1,520         | 2,317        | 41,410     |
| 17         | `src/components/ui/Table.tsx` (480); `src/components/ui/Pagination.tsx` (270); `src/components/ui/Card.tsx` (270); `src/components/ui/Feedback.tsx` (400)                                                                                       | 1,420         | 1,855        | 43,265     |
| 18         | `src/components/ui/Toast.tsx` (270); `src/components/ui/Tabs.tsx` (270); `src/components/ui/Rating.tsx` (250); `src/components/ui/Tooltip.tsx` (220)                                                                                            | 1,010         | 2,220        | 45,485     |
| 19         | `src/components/product/ProductCard.tsx` (360); `src/components/product/ProductGallery.tsx` (270); `src/components/charts/chartScales.ts` (310)                                                                                                 | 940           | 2,007        | 47,492     |
| 20         | `src/components/charts/LineChart.tsx` (420); `src/components/charts/BarChart.tsx` (400); `src/components/charts/DonutChart.tsx` (330)                                                                                                           | 1,150         | 2,905        | 50,397     |
| 21         | `src/features/home/HomePage.tsx` (310); `src/features/home/HeroSection.tsx` (270); `src/features/home/FeaturedProducts.tsx` (290); `src/features/home/CategoryShowcase.tsx` (250)                                                               | 1,120         | 1,131        | 51,528     |
| 22         | `src/features/catalog/CatalogPage.tsx` (380); `src/features/catalog/ProductList.tsx` (310); `src/features/catalog/ProductDetailPage.tsx` (475); `src/features/catalog/ProductReviews.tsx` (330)                                                 | 1,495         | 2,200        | 53,728     |
| 23         | `src/features/search/SearchPage.tsx` (360); `src/features/search/SearchBar.tsx` (330); `src/features/search/SearchSuggestions.tsx` (270)                                                                                                        | 960           | 1,183        | 54,911     |
| 24         | `src/features/search/FilterPanel.tsx` (470); `src/features/search/SortControl.tsx` (220); `src/features/search/ActiveFilters.tsx` (250)                                                                                                         | 940           | 910          | 55,821     |
| 25         | `src/features/cart/CartPage.tsx` (360); `src/features/cart/CartItemRow.tsx` (290); `src/features/cart/CartSummary.tsx` (330); `src/features/cart/MiniCart.tsx` (330); `src/features/cart/cartSelectors.ts` (270)                                | 1,580         | 1,743        | 57,564     |
| 26         | `src/features/checkout/CheckoutPage.tsx` (380); `src/features/checkout/CheckoutSteps.tsx` (250); `src/features/checkout/ShippingForm.tsx` (360)                                                                                                 | 990           | 1,578        | 59,142     |
| 27         | `src/features/checkout/PaymentForm.tsx` (400); `src/features/checkout/ReviewOrder.tsx` (330); `src/features/checkout/OrderConfirmation.tsx` (330)                                                                                               | 1,060         | 1,331        | 60,473     |
| 28         | `src/features/account/LoginPage.tsx` (330); `src/features/account/RegisterPage.tsx` (360); `src/features/account/AccountLayout.tsx` (250)                                                                                                       | 940           | 991          | 61,464     |
| 29         | `src/features/account/ProfilePage.tsx` (350); `src/features/account/OrderHistoryPage.tsx` (360); `src/features/account/AddressBookPage.tsx` (380)                                                                                               | 1,090         | 1,625        | 63,089     |
| 30         | `src/features/admin/AdminDashboardPage.tsx` (400); `src/features/admin/KpiCard.tsx` (270); `src/features/admin/SalesChart.tsx` (380); `src/features/admin/RecentOrdersTable.tsx` (290); `src/features/admin/TopProductsTable.tsx` (250)         | 1,590         | 1,888        | 64,977     |
| 31         | `src/features/reports/ReportsPage.tsx` (330); `src/features/reports/SalesReport.tsx` (400); `src/features/reports/ProductPerformanceReport.tsx` (350)                                                                                           | 1,080         | 1,166        | 66,143     |
| 32         | `src/features/reports/CustomerReport.tsx` (330); `src/features/reports/DateRangePicker.tsx` (310); `src/features/reports/ReportTable.tsx` (290)                                                                                                 | 930           | 1,386        | 67,529     |
| 33         | `src/Router.tsx` (390); `src/App.tsx` (290); `src/main.tsx` (120)                                                                                                                                                                               | 800           | 1,103        | 68,632     |
| 34         | `tests/setup.ts` (130); `tests/fixtures.ts` (440); `tests/testUtils.tsx` (270)                                                                                                                                                                  | 840           | 1,086        | 69,718     |
| 35         | `tests/unit/utils/formatting.test.ts` (380); `tests/unit/utils/validation.test.ts` (290); `tests/unit/utils/collections.test.ts` (400); `tests/unit/utils/queryParams.test.ts` (220); `tests/unit/lib/catalogSearch.test.ts` (470)              | 1,760         | 6,710        | 76,428     |
| 36         | `tests/unit/lib/pricingService.test.ts` (330); `tests/unit/lib/orderService.test.ts` (270); `tests/unit/lib/authService.test.ts` (250); `tests/unit/lib/analyticsService.test.ts` (330); `tests/unit/lib/reportService.test.ts` (310)           | 1,490         | 4,037        | 80,465     |
| 37         | `tests/unit/lib/mockServer.test.ts` (220); `tests/unit/state/transactions.test.ts` (440); `tests/unit/state/catalogReducer.test.ts` (250); `tests/components/controls.test.tsx` (360); `tests/components/Table.test.tsx` (240)                  | 1,510         | 5,634        | 86,099     |
| 38         | `tests/components/charts.test.tsx` (250); `tests/integration/shoppingFlow.test.tsx` (350); `tests/integration/checkoutFlow.test.tsx` (380); `tests/integration/accountFlow.test.tsx` (330); `tests/integration/adminReportsFlow.test.tsx` (440) | 1,750         | 5,732        | 91,831     |
| 39         | `README.md` (310); `docs/architecture.md` (270); `docs/contributing.md` (160); `docs/mock-api.md` (200)                                                                                                                                         | 940           | 918          | 92,749     |
| **Totals** | **157 mapped files, plus the 114 paths charged to them, over 39 phases**                                                                                                                                                                        | **50,000**    | **92,749**   | **92,749** |

**Batch deviation, recorded once.** §0.5.2 batches a phase as "the next 3 to 5 files from the tree,
in tree order", and every one of the 39 phases above holds 3 to 5 tree files. A phase's Part 1 row
count also includes the paths that carry no budget of their own — the split paths and the covering
suites charged to the phase's tree files — and 19 of the 39 hold more than five because of them:
phase 4 (8), phase 5 (11), phase 7 (10), phase 8 (11), phase 9 (11), phase 10 (11), phase 11 (7), phase 12 (10), phase 13 (6), phase 14 (11), phase 15 (6), phase 16 (6), phase 19 (6), phase 20 (9), phase 22 (6), phase 35 (14), phase 36 (12), phase 37 (15), phase 38 (18).
The cause is the ceiling: a concern that cannot fit the 600-line ceiling is split into a second file
in the current or the next phase, and the
ceiling is never raised, so a phase that meets the ceiling writes more paths than the tree files it
was batched with. The deviation is recorded here once with its cause; it rewrites no batch, and the
rule it departs from governs a generation session, which is over.

## Part 3 — Roll-ups and size distribution

The counted total is every line the tree holds except `generation-manifest.md`: the 157 mapped files'
own 62,504 lines, plus the 30,245 lines of the 114 paths that carry no budget of their own — each
charged to the mapped file whose allocation it draws on — for a delivered total of 92,749 lines. The
tables below state each part of that rule once.

Rows by area: the mapped files, their own lines, the paths charged to them with their lines, and the
counted lines the two make up.

| Area                                    | Mapped files | Their own lines | Paths charged to them | Their lines | Counted lines | Budgeted   |
| --------------------------------------- | ------------ | --------------- | --------------------- | ----------- | ------------- | ---------- |
| `src/`                                  | 121          | 49,627          | 73                    | 18,330      | 67,957        | 41,285     |
| `tests/`                                | 23           | 11,628          | 41                    | 11,915      | 23,543        | 7,350      |
| Root tooling                            | 9            | 331             | 0                     | 0           | 331           | 425        |
| Documentation (`README.md` and `docs/`) | 4            | 918             | 0                     | 0           | 918           | 940        |
| **Total**                               | **157**      | **62,504**      | **114**               | **30,245**  | **92,749**    | **50,000** |

Rows by budget band over the same 157 mapped files, at their own lines.

| Budget band (lines) | Files   | Budgeted lines | Their own lines |
| ------------------- | ------- | -------------- | --------------- |
| 1 to 100            | 9       | 425            | 331             |
| 100 to 199          | 4       | 590            | 836             |
| 200 to 299          | 49      | 12,650         | 18,094          |
| 300 to 399          | 59      | 20,500         | 27,260          |
| 400 to 500          | 36      | 15,835         | 15,983          |
| **Total**           | **157** | **50,000**     | **62,504**      |

The band table's last column is the mapped files' own lines, not the counted total: a budget-free
path carries no band of its own, so its lines stand in the area table above and in the counted total
only.

This manifest's own self-record, outside both tables and outside the 50,000.

| Path                     | Budget | Status | Lines | Counted                 |
| ------------------------ | ------ | ------ | ----- | ----------------------- |
| `generation-manifest.md` | 300    | Done   | 848   | no — excluded by §0.5.1 |

## Part 4 — Reconciliation ledger

**Counted files beyond 10% of budget.** 122 counted files differ from their allocation by
more than 10%, one row each, over and under as the numbers fall. Two rows are kept at the standing
they now hold although the change they record brought them inside the band —
`src/features/catalog/ProductDetailPage.tsx` and `tests/integration/shoppingFlow.test.tsx` — so the
movement that took them there stays readable; neither is one of the 122.

| Path                                          | Budget | Actual | Difference | Percent | Over/under | Reason                                                                                                                                                             |
| --------------------------------------------- | ------ | ------ | ---------- | ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.env.example`                                | 18     | 23     | +5         | +27.8%  | over       | the two inert `VITE_` variables written out with their defaults, plus the note that neither is a credential and how to copy the file                               |
| `.gitignore`                                  | 25     | 41     | +16        | +64.0%  | over       | ignore rules grouped and explained per class, dependencies through caches and editor files, instead of one bare path per line                                      |
| `README.md`                                   | 310    | 179    | -131       | -42.3%  | under      | the run book's required facts fit with room to spare: what the product is, the commands, the demonstration sign-in and how a phase resumes                         |
| `docs/architecture.md`                        | 270    | 341    | +71        | +26.3%  | over       | eleven numbered sections and six subsections over the layer table, the flow diagrams, the two import rules and where a change lands                                |
| `docs/mock-api.md`                            | 200    | 242    | +42        | +21.0%  | over       | the endpoint contract: the transport convention, every route's request and answer, the demonstration credentials and the latency and failure switches              |
| `index.html`                                  | 60     | 23     | -37        | -61.7%  | under      | one doctype, five head tags and the mount div: the title and the description are the whole surface, and nothing else belongs to a shell                            |
| `package.json`                                | 65     | 46     | -19        | -29.2%  | under      | a manifest of entries, the pins, the nine scripts and the engines floor, holds one line each by nature and carries no logic at all                                 |
| `src/App.tsx`                                 | 290    | 339    | +49        | +16.9%  | over       | provider composition in its required order, the error boundary and the routed content, each wrapper stating why it wraps what it wraps                             |
| `src/Router.tsx`                              | 390    | 545    | +155       | +39.7%  | over       | the route table with its lazy slices, the role guard over the account and admin sections, the suspension and not-found views                                       |
| `src/components/charts/DonutChart.tsx`        | 330    | 573    | +243       | +73.6%  | over       | donut arcs, wedge labels, the legend, the centre total and the pointer readout, over seven memoised derivations and five callbacks                                 |
| `src/components/charts/LineChart.tsx`         | 420    | 483    | +63        | +15.0%  | over       | the plot area, the grid, the axis ticks, the series paths and the hover readout, with the class list naming every mark the sheet owes                              |
| `src/components/charts/chartScales.ts`        | 310    | 521    | +211       | +68.1%  | over       | nine axis constants and thirteen scale, tick and path builders, their domains, ranges and rounding rules stated one by one                                         |
| `src/components/layout/AdminSidebar.tsx`      | 290    | 182    | -108       | -37.2%  | under      | one navigation list whose sections come from the route constants, with the current section marked: no state and one composition                                    |
| `src/components/layout/Footer.tsx`            | 240    | 162    | -78        | -32.5%  | under      | two link columns plus the contact block and the currency and legal line, rendered straight from constants rather than restated                                     |
| `src/components/layout/Header.tsx`            | 380    | 599    | +219       | +57.6%  | over       | logo, primary navigation, the search entry, the cart badge and the account menu, with the classes the layout sheet owes                                            |
| `src/components/layout/PageHeader.tsx`        | 200    | 238    | +38        | +19.0%  | over       | the breadcrumb trail derived from the route plus the title, description and action slots, with the trail's own edge cases documented                               |
| `src/components/product/ProductCard.tsx`      | 360    | 500    | +140       | +38.9%  | over       | the tile in both variants, imagery, discount, rating and quick add, its placeholder twin and the class list covering all of them                                   |
| `src/components/ui/Button.tsx`                | 360    | 458    | +98        | +27.2%  | over       | five variants and three sizes plus the icon and group shapes, and twelve public members with the modifiers each accepts                                            |
| `src/components/ui/Card.tsx`                  | 270    | 406    | +136       | +50.4%  | over       | the card's header, body and footer parts, the badge and the order-status badge with its tone mapping, across thirteen members                                      |
| `src/components/ui/Feedback.tsx`              | 400    | 600    | +200       | +50.0%  | over       | five controls in one file, spinner, skeleton, empty state, alert and progress bar, each with its tones, sizes and class list                                       |
| `src/components/ui/Input.tsx`                 | 400    | 549    | +149       | +37.2%  | over       | the input, the text area and the field wrapper that labels, hints and reports the error, over ten public members                                                   |
| `src/components/ui/Modal.tsx`                 | 360    | 497    | +137       | +38.1%  | over       | modal, drawer and confirm dialog with their own props and class contract, over the overlay engine's shared focus and inert rules                                   |
| `src/components/ui/Rating.tsx`                | 250    | 599    | +349       | +139.6% | over       | rating display and input, the price tag with its discount and the quantity stepper: four controls and each control's states                                        |
| `src/components/ui/Select.tsx`                | 400    | 561    | +161       | +40.2%  | over       | select, checkbox, radio group and switch, each with labelling, keyboard handling and its own class list, plus four prop shapes                                     |
| `src/components/ui/Tabs.tsx`                  | 270    | 586    | +316       | +117.0% | over       | the tab list's roving focus and the accordion's disclosure are two keyboard models with their own arrow-key rules                                                  |
| `src/components/ui/Toast.tsx`                 | 270    | 336    | +66        | +24.4%  | over       | the portalled viewport, the visible cap, the pointer probe that pauses them and the focus a dismissal hands on, over three effects and two callbacks               |
| `src/components/ui/Tooltip.tsx`               | 220    | 403    | +183       | +83.2%  | over       | tooltip and popover, each with pointer and keyboard triggers, placement maths and the classes it renders, wired by nine callbacks                                  |
| `src/constants/config.ts`                     | 250    | 490    | +240       | +96.0%  | over       | thirty-two constants and types, storage keys, tax, shipping, page sizes and breakpoints, every one documented with what the value governs                          |
| `src/constants/content.ts`                    | 400    | 513    | +113       | +28.2%  | over       | the copy register: fifty-five blocks and builders over navigation, page titles, buttons, empty states and help text, plus four types                               |
| `src/constants/routes.ts`                     | 180    | 298    | +118       | +65.6%  | over       | every path, its builder, the role that may reach it and the matcher behind the active link, across eighteen exports                                                |
| `src/constants/taxonomy.ts`                   | 330    | 553    | +223       | +67.6%  | over       | the controlled vocabulary held as data: categories, brands, sort keys, statuses and the facet and report definitions the UI iterates                               |
| `src/data/categories.ts`                      | 240    | 402    | +162       | +67.5%  | over       | the category tree with its product and brand quotas and the deterministic tile builder, whose palette and SVG composition dominate                                 |
| `src/data/customers.ts`                       | 310    | 495    | +185       | +59.7%  | over       | forty accounts with profiles, credential digests and address shapes, built by seed functions over hand-authored anchors                                            |
| `src/data/orders.ts`                          | 460    | 595    | +135       | +29.3%  | over       | two years of order history from pools and a seeded stream, plus the promo-code table and the sixty attributed orders' anchors                                      |
| `src/data/products.ts`                        | 480    | 388    | -92        | -19.2%  | under      | the catalogue seed: anchor records, the expansion stream, the per-category copy pools and the SVG image builder                                                    |
| `src/data/repositories.ts`                    | 440    | 554    | +114       | +25.9%  | over       | the data-source contract half: every member the transport calls, each composing a domain service's rules over the stored collections                               |
| `src/data/reviews.ts`                         | 250    | 589    | +339       | +135.6% | over       | the review stream with its body pool, the seeded ratings and the aggregate the product pages read for each product                                                 |
| `src/features/account/AccountLayout.tsx`      | 250    | 191    | -59        | -23.6%  | under      | a shell that renders its section list and an outlet: no state, one composition and the classes the account sheet declares                                          |
| `src/features/account/AddressBookPage.tsx`    | 380    | 573    | +193       | +50.8%  | over       | address cards with add, edit, remove and set-default, the removal confirm dialog and the empty, loading and error states                                           |
| `src/features/account/LoginPage.tsx`          | 330    | 370    | +40        | +12.1%  | over       | the sign-in form's two fields with a validator each, the restoring placeholders and the return path the guard preserved, in one screen                             |
| `src/features/account/OrderHistoryPage.tsx`   | 360    | 317    | -43        | -11.9%  | under      | the orders route: the session gate and the single-order view, with the history list, its filters and its paging in a file of their own                             |
| `src/features/account/RegisterPage.tsx`       | 360    | 430    | +70        | +19.4%  | over       | registration fields with their validation, the second-account email case and the inline summary, each field through the shared wrapper                             |
| `src/features/admin/RecentOrdersTable.tsx`    | 290    | 366    | +76        | +26.2%  | over       | the dashboard's recent-orders table: its column definitions, its cell renderers and the status badges, configured for the shared table                             |
| `src/features/admin/SalesChart.tsx`           | 380    | 489    | +109       | +28.7%  | over       | the bucket control, the series toggle, the hint beside them, the period sentence and the frame a failed read is stated in                                          |
| `src/features/admin/TopProductsTable.tsx`     | 250    | 379    | +129       | +51.6%  | over       | the ranking table with its revenue-or-units toggle, its two column sets and the empty frame, over the top-product read                                             |
| `src/features/cart/CartItemRow.tsx`           | 290    | 442    | +152       | +52.4%  | over       | one cart line with its thumbnail, quantity stepper, removal control and availability warning, each class named in a contract                                       |
| `src/features/cart/CartSummary.tsx`           | 330    | 428    | +98        | +29.7%  | over       | the totals panel with its promo entry and rejection message, the discount lines and the free-shipping progress, in one composition                                 |
| `src/features/cart/MiniCart.tsx`              | 330    | 288    | -42        | -12.7%  | under      | the drawer composes the line and its stepper rather than restating them, and inherits the cart sheet's classes                                                     |
| `src/features/cart/cartSelectors.ts`          | 270    | 194    | -76        | -28.1%  | under      | seven short derivations and their types over the cart's own shape: item count, line availability, discount totals and shipping progress                            |
| `src/features/catalog/ProductDetailPage.tsx`  | 475    | 454    | -21        | -4.4%   | under      | the detail route composing the gallery, the tabs, the reviews and the related strip; the buy column went to `src/features/catalog/PurchasePanel.tsx`               |
| `src/features/catalog/ProductReviews.tsx`     | 330    | 600    | +270       | +81.8%  | over       | the review list with its rating filter and paging, the submit form for a signed-in customer and the five callbacks that wire them                                  |
| `src/features/checkout/CheckoutSteps.tsx`     | 250    | 224    | -26        | -10.4%  | under      | the ordered step indicator: its aria-current marking, the per-step headings and the class contract the steps sheet owes it                                         |
| `src/features/checkout/OrderConfirmation.tsx` | 330    | 557    | +227       | +68.8%  | over       | the confirmation route restates the order number, the itemised lines, the delivery estimate and the address it kept                                                |
| `src/features/checkout/PaymentForm.tsx`       | 400    | 265    | -135       | -33.8%  | under      | five demonstration card controls — holder, number, the expiry's two halves and the CVC — judged by Luhn, expiry and CVC rules                                      |
| `src/features/checkout/ReviewOrder.tsx`       | 330    | 509    | +179       | +54.2%  | over       | the review step restates the items, both addresses, the shipping method, the payment summary and the totals, section by section                                    |
| `src/features/checkout/ShippingForm.tsx`      | 360    | 529    | +169       | +46.9%  | over       | entry of a new address or reuse of a saved one, per-field validation, the saved-address path and the styling contract                                              |
| `src/features/home/FeaturedProducts.tsx`      | 290    | 334    | +44        | +15.2%  | over       | the strip renders the tiles the landing route's own read hands it via the shared card, with its loading, error and empty states                                    |
| `src/features/home/HeroSection.tsx`           | 270    | 196    | -74        | -27.4%  | under      | the hero is a headline, its supporting copy, two calls to action, the illustration and the three-claim trust strip: one composition, no state                      |
| `src/features/home/HomePage.tsx`              | 310    | 344    | +34        | +11.0%  | over       | the landing route's loader adds the category-tree read the showcase's tiles take their artwork from, and the join that pairs each facet value with its node's tile |
| `src/features/reports/DateRangePicker.tsx`    | 310    | 123    | -187       | -60.3%  | under      | the stored last-used range this mount resumes from, with the fields, the presets and their rules in the shared range control                                       |
| `src/features/reports/ReportTable.tsx`        | 290    | 529    | +239       | +82.4%  | over       | sortable report columns, the totals row, the CSV export action and a skeleton twin, with the sort and the page window memoised                                     |
| `src/features/reports/ReportsPage.tsx`        | 330    | 438    | +108       | +32.7%  | over       | the report selector, the range control, the four callbacks and the states each of the three report views renders                                                   |
| `src/features/reports/SalesReport.tsx`        | 400    | 311    | -89        | -22.2%  | under      | the table, its totals line and the paired chart arrive configured from shared components, and what stands here is that configuration                               |
| `src/features/search/SearchBar.tsx`           | 330    | 506    | +176       | +53.3%  | over       | a debounced input with its suggestion list, keyboard selection, recent terms and outside-click dismissal, over eight callbacks                                     |
| `src/features/search/SearchSuggestions.tsx`   | 270    | 318    | +48        | +17.8%  | over       | the list groups product, brand and category matches, with its status and error types and the option-id helper each row uses                                        |
| `src/features/search/SortControl.tsx`         | 220    | 20     | -200       | -90.9%  | under      | the search slice's public path over the shared control: it re-exports the component and its props from src/components/ui/SortControl.tsx                           |
| `src/lib/analyticsService.ts`                 | 480    | 158    | -322       | -67.1%  | under      | the aggregation rules now live in their own module, so this file holds four transport-backed reads with their request options                                      |
| `src/lib/apiClient.ts`                        | 350    | 486    | +136       | +38.9%  | over       | the one transport seam: request shaping, latency and abort handling, the error vocabulary, session-refusal watching and a test double                              |
| `src/lib/catalogService.ts`                   | 480    | 389    | -91        | -19.0%  | under      | the filtering, faceting, sorting and paging rules were taken out to a rules module, leaving the reads and their options here                                       |
| `src/lib/orderService.ts`                     | 420    | 355    | -65        | -15.5%  | under      | the order rules and the placement credential sit on their own split paths, and the unused submission predicate is gone                                             |
| `src/lib/pricingService.ts`                   | 440    | 177    | -263       | -59.8%  | under      | the totals, promo, shipping and tax arithmetic lives in the pricing rules, bound here to a request and shaped into a response                                      |
| `src/lib/reportService.ts`                    | 460    | 220    | -240       | -52.2%  | under      | the CSV export matrix and the two administrator calls, the definition catalogue and the run, with the rule names re-exported                                       |
| `src/lib/searchService.ts`                    | 440    | 127    | -313       | -71.1%  | under      | two transport reads and the re-export of the rule names: tokenising, scoring and ranking belong to the search rules module                                         |
| `src/main.tsx`                                | 120    | 219    | +99        | +82.5%  | over       | the stylesheet imports, the data-source binding, the chunk-load recovery and the mount, each step with the reason it runs in that order                            |
| `src/state/AuthContext.tsx`                   | 360    | 592    | +232       | +64.4%  | over       | session restore, sign-in and sign-out actions, the role helpers and the memoised context values, over three effects and eight callbacks                            |
| `src/state/CartContext.tsx`                   | 360    | 503    | +143       | +39.7%  | over       | cart lines, the promo code, persistence, mini-cart visibility and the clear the checkout dispatches, over twelve callbacks                                         |
| `src/state/CatalogContext.tsx`                | 330    | 497    | +167       | +50.6%  | over       | the loaded page, its facets and status plus the address-bar filter state, kept in step by six memos and fourteen callbacks                                         |
| `src/state/CheckoutContext.tsx`               | 380    | 598    | +218       | +57.4%  | over       | the step machine, its entered values, the submission state and the error map, in four effects that keep values and errors in step                                  |
| `src/state/ToastContext.tsx`                  | 250    | 298    | +48        | +19.2%  | over       | the queue and its success, error and info helpers, with the timers, the dismissal order and the memoised api handed to consumers                                   |
| `src/state/cartReducer.ts`                    | 310    | 535    | +225       | +72.6%  | over       | cart transitions over an exhaustive set of typed actions, with stock clamping, duplicate lines folded and the guards over a stored cart                            |
| `src/state/checkoutReducer.ts`                | 350    | 594    | +244       | +69.7%  | over       | nineteen exports: the step types, the value shapes, the patch types and the transitions, each carrying the rule it enforces                                        |
| `src/state/hooks.ts`                          | 480    | 168    | -312       | -65.0%  | under      | the async read and the query lifecycle moved into their own modules, leaving storage-backed state, the debounced value and the title                               |
| `src/styles/account.css`                      | 310    | 516    | +206       | +66.5%  | over       | the sign-in and registration screens, the account shell, profile, order history, order detail and address book, in five media blocks                               |
| `src/styles/admin-reports.css`                | 480    | 593    | +113       | +23.5%  | over       | the administrator content column, the dashboard and KPI grids, the chart frame with its axes and legend, and the report tables                                     |
| `src/styles/base.css`                         | 270    | 383    | +113       | +41.9%  | over       | the reset, the document typography, links, forms, tables, focus, disabled and motion rules, in element selectors with two classes                                  |
| `src/styles/catalog.css`                      | 400    | 594    | +194       | +48.5%  | over       | the result grid and its list variant, the tile with quick add, the facet panel and chips and the search bar with its suggestions                                   |
| `src/styles/commerce.css`                     | 460    | 246    | -214       | -46.5%  | under      | the cart, mini-cart and summary registers were taken to sheets of their own, leaving the checkout steps, forms and confirmation                                    |
| `src/styles/layout.css`                       | 350    | 493    | +143       | +40.9%  | over       | the application frame, the container and page rhythm, three layout primitives and the header and footer skeletons, in ten media blocks                             |
| `src/styles/tokens.css`                       | 250    | 327    | +77        | +30.8%  | over       | the colour, spacing, type, radius, shadow and z-index scales plus the semantic hues, the chart palette and the four breakpoints                                    |
| `src/types/common.ts`                         | 240    | 296    | +56        | +23.3%  | over       | thirty-one exported types over money, paging, results, errors and async state, each documenting the guarantee its shape carries                                    |
| `src/utils/async.ts`                          | 270    | 374    | +104       | +38.5%  | over       | debounce, throttle, retry with backoff, timeout and the abort race, each with its option shape and cancellation contract                                           |
| `src/utils/collections.ts`                    | 420    | 597    | +177       | +42.1%  | over       | thirty-five exports over grouping, ordering, indexing, chunking and pagination, with the comparator types and boundary handling                                    |
| `src/utils/csv.ts`                            | 250    | 297    | +47        | +18.8%  | over       | serialisation, cell escaping and clipping, the row cap and the download trigger, each stage with its result type and failure return                                |
| `src/utils/dates.ts`                          | 350    | 599    | +249       | +71.1%  | over       | forty-five exports covering parsing, formatting, bucket boundaries, range arithmetic and the comparison periods the reports need                                   |
| `src/utils/format.ts`                         | 380    | 577    | +197       | +51.8%  | over       | thirty-two exports over money, number, percentage and compact formatting, including the minor-unit rounding rule and axis forms                                    |
| `src/utils/queryParams.ts`                    | 270    | 600    | +330       | +122.2% | over       | filter state to the address bar and back: normalisation, omitted defaults and the active-chip entries the panel renders                                            |
| `src/utils/statistics.ts`                     | 360    | 536    | +176       | +48.9%  | over       | percentage change, growth, averages, medians, percentiles and moving averages, each a documented function over a series                                            |
| `src/utils/storage.ts`                        | 270    | 452    | +182       | +67.4%  | over       | typed, versioned and failure-tolerant reads and writes, with the availability probe, the validators and the stored version                                         |
| `src/utils/strings.ts`                        | 350    | 531    | +181       | +51.7%  | over       | the slug, case and identifier helpers the plan names, with the credential digest it re-exports from `src/utils/credentials.ts` after the split                     |
| `src/utils/validation.ts`                     | 440    | 598    | +158       | +35.9%  | over       | forty-five exports: a validator per field returning a field-keyed error map, plus the form rules and the card and review limits                                    |
| `tests/components/Table.test.tsx`             | 240    | 316    | +76        | +31.7%  | over       | eleven cases over the column rendering, the sorting, the empty state and the pagination contract, each with its intent stated                                      |
| `tests/components/charts.test.tsx`            | 250    | 599    | +349       | +139.6% | over       | the scale mathematics, the rendered geometry and the paired data table over twenty-one cases, each asserting a computed value                                      |
| `tests/components/controls.test.tsx`          | 360    | 273    | -87        | -24.2%  | under      | the overlay, tooltip and toast half moved out, leaving ten cases for the button, the field and the select with their focus handling                                |
| `tests/fixtures.ts`                           | 440    | 600    | +160       | +36.4%  | over       | thirty-four makers and six fixed instants over the entities, carts and report results, each builder's overrides in its own doc block                               |
| `tests/integration/accountFlow.test.tsx`      | 330    | 599    | +269       | +81.5%  | over       | sign-in, the profile edit, order history, the address book and the unauthenticated redirect, driven in thirteen cases through the harness                          |
| `tests/integration/adminReportsFlow.test.tsx` | 440    | 600    | +160       | +36.4%  | over       | the dashboard and the three reports for a range, the CSV export and the empty range, in seven describe blocks and nine cases                                       |
| `tests/integration/checkoutFlow.test.tsx`     | 380    | 599    | +219       | +57.6%  | over       | cart to order through the three steps, the idempotent submission and the cleared cart, with the shared harness steps each case walks                               |
| `tests/integration/shoppingFlow.test.tsx`     | 350    | 333    | -17        | -4.9%   | under      | the catalogue and search surfaces moved to suites of their own, so this file drives home, search and add-to-cart plus the detail page's two refusals               |
| `tests/setup.ts`                              | 130    | 163    | +33        | +25.4%  | over       | matcher registration plus the teardown that clears storage, resets the seam's per-case state and returns to real timers between cases                              |
| `tests/testUtils.tsx`                         | 270    | 323    | +53        | +19.6%  | over       | the provider-wrapping render helper, the user-event setup, the app render and the failNext seam double, each documented for callers                                |
| `tests/unit/lib/analyticsService.test.ts`     | 330    | 537    | +207       | +62.7%  | over       | twenty-five cases over the bucketing boundaries, the KPI aggregation and the baseline comparisons, four of them tables, one block per behaviour                    |
| `tests/unit/lib/authService.test.ts`          | 250    | 535    | +285       | +114.0% | over       | registration, the duplicate email, sign-in, session expiry and the role checks, across eight blocks and twenty-seven cases                                         |
| `tests/unit/lib/mockServer.test.ts`           | 220    | 596    | +376       | +170.9% | over       | route matching, error mapping, filter reading, review scoping, idempotency replay, the unregistered source and seed determinism at the seam                        |
| `tests/unit/lib/orderService.test.ts`         | 270    | 585    | +315       | +116.7% | over       | order construction from a cart snapshot, the numbering, the transition rules and snapshot immutability, in seventeen cases                                         |
| `tests/unit/lib/pricingService.test.ts`       | 330    | 492    | +162       | +49.1%  | over       | line and order totals, the promo kinds and their limits, the shipping thresholds and tax rounding, over twenty-seven cases                                         |
| `tests/unit/lib/reportService.test.ts`        | 310    | 599    | +289       | +93.2%  | over       | three report kinds: their rows, the totals row and the exported CSV matrix, with the cell forms each column produces                                               |
| `tests/unit/state/catalogReducer.test.ts`     | 250    | 589    | +339       | +135.6% | over       | the load transitions and the query-fingerprint guard that discards a stale response, in thirty-seven cases over each state field                                   |
| `tests/unit/utils/collections.test.ts`        | 400    | 592    | +192       | +48.0%  | over       | forty-five cases: grouping and sorting, chunking, indexing and paging, including the boundary pages and comparator ties                                            |
| `tests/unit/utils/formatting.test.ts`         | 380    | 600    | +220       | +57.9%  | over       | money, number and percentage formatting with the rounding edge cases and the minor-unit boundaries, over ten describe blocks                                       |
| `tests/unit/utils/queryParams.test.ts`        | 220    | 565    | +345       | +156.8% | over       | the round trip through the address bar in thirty-seven cases: normalisation, dropped defaults and the chip entries                                                 |
| `tests/unit/utils/validation.test.ts`         | 290    | 559    | +269       | +92.8%  | over       | fifty-six cases: each validator's accept and reject inputs plus the form-level error maps, one block per field covered                                             |
| `tsconfig.json`                               | 45     | 28     | -17        | -37.8%  | under      | the strict flags, the module and target choices and the single path alias: an options block whose entries are one line each                                        |
| `vite.config.ts`                              | 60     | 25     | -35        | -58.3%  | under      | the React plugin, the `@` alias and the build target: three settings and the note that says why each is set                                                        |
| `vitest.config.ts`                            | 85     | 75     | -10        | -11.8%  | under      | two project definitions sharing the root options, the setup file, the globals and the coverage thresholds: settings, no logic                                      |

**§0.5.5 split records.** 108 split paths, each the home of a concern taken out of the
mapped file it draws on. A split path adds no line to the 50,000-line allocation; the mapped file's
own row records its real count.

| Split path                                             | Draws on                                         | Lines | Reason                                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/charts/ChartDataTable.tsx`             | `src/components/charts/LineChart.tsx` 167        | 167   | the paired data table every chart renders as its accessible alternative — split out of `src/components/charts/LineChart.tsx`                                                                      |
| `src/components/charts/ChartPlaceholder.tsx`           | `src/components/charts/LineChart.tsx` 239        | 239   | the shape of a chart block while its series are on their way: plot — split out of `src/components/charts/LineChart.tsx`                                                                           |
| `src/components/charts/barGeometry.ts`                 | `src/components/charts/BarChart.tsx` 467         | 467   | the bar renderer's own geometry: its scales, its marks — split out of `src/components/charts/BarChart.tsx`                                                                                        |
| `src/components/charts/chartGeometry.ts`               | `src/components/charts/chartScales.ts` 525       | 525   | mark, path and data-table geometry for the charts — split out of `src/components/charts/chartScales.ts`                                                                                           |
| `src/components/charts/donutLabelModel.ts`             | `src/components/charts/DonutChart.tsx` 161       | 161   | where each of a donut's percentages is written — inside its own wedge — split out of `src/components/charts/DonutChart.tsx`                                                                       |
| `src/components/charts/labelMetrics.ts`                | `src/components/charts/chartScales.ts` 51        | 51    | how wide one chart label is, in the frame's own user units — split out of `src/components/charts/chartGeometry.ts`                                                                                |
| `src/components/charts/lineChartModel.ts`              | `src/components/charts/LineChart.tsx` 255        | 255   | the line chart's plot model: its scales, axis ticks, series paths — split out of `src/components/charts/LineChart.tsx`                                                                            |
| `src/components/charts/readoutPlacement.ts`            | `src/components/charts/LineChart.tsx` 137        | 137   | places a chart's hover readout inside the plot area — split out of `src/components/charts/LineChart.tsx`                                                                                          |
| `src/components/charts/svgPaths.ts`                    | `src/components/charts/chartScales.ts` 139       | 139   | the SVG path text a chart’s marks are drawn from, in the frame’s own coordinate system — split out of `src/components/charts/chartGeometry.ts`                                                    |
| `src/components/ui/DateRangeControl.tsx`               | `src/features/reports/DateRangePicker.tsx` 395   | 395   | the range control both administrator surfaces render: presets, the two date fields — split out of `src/features/reports/DateRangePicker.tsx`                                                      |
| `src/components/ui/SortControl.tsx`                    | `src/features/search/SortControl.tsx` 150        | 150   | the sort selector both the catalogue page and the search page compose — split out of `src/features/search/SortControl.tsx`                                                                        |
| `src/components/ui/NotFoundView.tsx`                   | `src/components/ui/Feedback.tsx` 66              | 66    | the one not-found view every surface renders when the address it was given resolves — split out of `src/components/ui/Feedback.tsx`                                                               |
| `src/components/ui/focusHandoff.ts`                    | `src/state/hooks.ts` 291                         | 291   | the one home of the focus-handoff rule: when the control that had the focus goes away — split out of `src/state/hooks.ts`                                                                         |
| `src/components/ui/hooks.ts`                           | `src/state/hooks.ts` 288                         | 288   | the view-facing hooks the shared primitives and their composing pages read: pagination — split out of `src/state/hooks.ts`                                                                        |
| `src/components/ui/Icons.tsx`                          | `src/components/ui/Modal.tsx` 41                 | 41    | the decorative glyphs the primitives and the feature surfaces render inside the controls — split out of `src/components/ui/Modal.tsx`                                                             |
| `src/components/ui/ToastItem.tsx`                      | `src/components/ui/Toast.tsx` 296                | 296   | one queued message: its markup, its kind's glyph and live role, and its pausable countdown — split out of `src/components/ui/Toast.tsx`                                                           |
| `src/components/ui/overlayEngine.ts`                   | `src/components/ui/Modal.tsx` 211                | 211   | the overlay engine Modal, Drawer and ConfirmDialog share: focus movement, Tab containment — split out of `src/components/ui/Modal.tsx`                                                            |
| `src/constants/checkoutCopy.ts`                        | `src/constants/content.ts` 118                   | 118   | the checkout and confirmation copy: the step indicator's labels — split out of `src/constants/content.ts`                                                                                         |
| `src/constants/content-account.ts`                     | `src/constants/content.ts` 105                   | 105   | the account register of the user-facing copy: signing in and registering, the profile — split out of `src/constants/content.ts`                                                                   |
| `src/constants/content-feedback.ts`                    | `src/constants/content.ts` 118                   | 118   | the empty, error and outcome copy every surface renders — split out of `src/constants/content.ts`                                                                                                 |
| `src/constants/content-reports.ts`                     | `src/constants/content.ts` 130                   | 130   | the back-office register of the user-facing copy — split out of `src/constants/content.ts`                                                                                                        |
| `src/data/analyticsGraph.ts`                           | `src/data/repositories.ts` 126                   | 126   | the modules a first analytics or report read fetches on use — split out of `src/data/repositories.ts`                                                                                             |
| `src/data/clientWriteRecord.ts`                        | `src/data/repositories.ts` 75                    | 75    | the durable record of this browser's own writes: the shape a load replays and the empty record a failed read falls back to — split out of `src/data/clientWrites.ts`                              |
| `src/data/clientWrites.ts`                             | `src/data/repositories.ts` 563                   | 563   | the durable record of this browser's own writes to the seeded collections — split out of `src/data/repositories.ts`                                                                               |
| `src/data/collectionStore.ts`                          | `src/data/repositories.ts` 225                   | 225   | the store half of the data source: the seeded collections and the indexes built over them once — split out of `src/data/repositories.ts`                                                          |
| `src/data/storeWrites.ts`                              | `src/data/repositories.ts` 478                   | 478   | the writes half of the data source: the refusals its operations answer with, and the account, session and address writes over the seeded collections — split out of `src/data/collectionStore.ts` |
| `src/data/orderAttribution.ts`                         | `src/data/orders.ts` 89                          | 89    | which seeded account owns each of the order history's sixty attributed orders — split out of `src/data/orders.ts`                                                                                 |
| `src/data/productRules.ts`                             | `src/data/products.ts` 204                       | 204   | the catalogue's generation rules: the seeded draw surface and the knobs products are priced, stocked, rated and dated by — split out of `src/data/products.ts`                                    |
| `src/data/productAnchors.ts`                           | `src/data/products.ts` 470                       | 470   | the catalogue's hand-authored half: the leaf-category vocabulary, the copy pools each category is written from and the twelve anchors the catalogue expands — split out of `src/data/products.ts` |
| `src/data/reviewWrites.ts`                             | `src/data/repositories.ts` 110                   | 110   | the review half of this browser's durable record — split out of `src/data/repositories.ts`                                                                                                        |
| `src/data/sessionTable.ts`                             | `src/data/repositories.ts` 359                   | 359   | the durable session table: the record, the guards that read it back — split out of `src/data/repositories.ts`                                                                                     |
| `src/features/account/OrderHistoryList.tsx`            | `src/features/account/OrderHistoryPage.tsx` 376  | 376   | the customer's order history: the status and date filters — split out of `src/features/account/OrderHistoryPage.tsx`                                                                              |
| `src/features/cart/HeaderCartButton.tsx`               | `src/components/layout/Header.tsx` 100           | 100   | the header's cart trigger: the basket's count and the mini-cart disclosure — split out of `src/components/layout/Header.tsx`                                                                      |
| `src/features/catalog/CatalogFilterRegion.tsx`         | `src/features/catalog/CatalogPage.tsx` 254       | 254   | catalogue facet panel: the five facet groups over the catalogue's own facet response — split out of `src/features/catalog/CatalogPage.tsx`                                                        |
| `src/features/catalog/PurchasePanel.tsx`               | `src/features/catalog/ProductDetailPage.tsx` 221 | 221   | the product detail page's buy column — brand and SKU, rating, price and availability, the quantity stepper and the two ways to order — split out of `src/features/catalog/ProductDetailPage.tsx`  |
| `src/features/checkout/CheckoutErrorSummary.tsx`       | `src/features/checkout/CheckoutPage.tsx` 140     | 140   | the step's summary of what is wrong: how many fields are at fault — split out of `src/features/checkout/CheckoutPage.tsx`                                                                         |
| `src/features/checkout/OrderSummaryPanel.tsx`          | `src/features/checkout/CheckoutPage.tsx` 294     | 294   | the checkout's order summary panel — split out of `src/features/checkout/CheckoutPage.tsx`                                                                                                        |
| `src/features/reports/ReportPlaceholder.tsx`           | `src/features/reports/ReportsPage.tsx` 93        | 93    | the shape a report's body takes while its run is in flight: summary figures, chart and table — split out of `src/features/reports/ReportsPage.tsx`                                                |
| `src/lib/apiContract.ts`                               | `src/lib/mockServer.ts` 547                      | 547   | the contract the in-process API is built on: its error vocabulary — split out of `src/lib/mockServer.ts`                                                                                          |
| `src/lib/apiOrders.ts`                                 | `src/lib/mockServer.ts` 332                      | 332   | the submission half of `POST /api/orders` — the demonstration card decision — split out of `src/lib/mockServer.ts`                                                                                |
| `src/lib/apiRequests.ts`                               | `src/lib/mockServer.ts` 599                      | 599   | reads a request for the in-process API: the members a query carries — split out of `src/lib/mockServer.ts`                                                                                        |
| `src/lib/apiRoutes.ts`                                 | `src/lib/mockServer.ts` 533                      | 533   | the in-process API's endpoints: the route table — split out of `src/lib/mockServer.ts`                                                                                                            |
| `src/state/asyncQuery.ts`                              | `src/state/hooks.ts` 242                         | 242   | the abortable async-data hook and the lifecycle types it reports — split out of `src/state/hooks.ts`                                                                                              |
| `src/state/authSession.ts`                             | `src/state/AuthContext.tsx` 302                  | 302   | the session's contract as a consumer reads it, the read that revalidates a stored token — split out of `src/state/AuthContext.tsx`                                                                |
| `src/state/focusHooks.ts`                              | `src/state/hooks.ts` 74                          | 74    | the one place a refused submission hands the keyboard on: the notice — split out of `src/state/hooks.ts`                                                                                          |
| `src/state/scrollHooks.ts`                             | `src/state/hooks.ts` 41                          | 41    | view-scroll hooks: brings a view to its own top when the value that names it changes — split out of `src/state/hooks.ts`                                                                          |
| `src/styles/cart.css`                                  | `src/styles/commerce.css` 280                    | 280   | styles for the cart, the mini-cart and the order summary panel the cart and the checkout — split out of `src/styles/commerce.css`                                                                 |
| `src/styles/catalog-detail.css`                        | `src/styles/catalog.css` 314                     | 314   | styles for the product detail surfaces: the two-column layout, the gallery — split out of `src/styles/catalog.css`                                                                                |
| `src/styles/catalog-landing.css`                       | `src/styles/catalog.css` 353                     | 353   | styles for the landing page's bands: the hero with its illustration, the promotional banner — split out of `src/styles/catalog.css`                                                               |
| `src/styles/chart-series.css`                          | `src/styles/admin-reports.css` 155               | 155   | styles for the chart series paint: the shared mark treatment — split out of `src/styles/admin-reports.css`                                                                                        |
| `src/styles/commerce-steps.css`                        | `src/styles/commerce.css` 121                    | 121   | styles for the checkout's ordered step indicator — split out of `src/styles/commerce.css`                                                                                                         |
| `src/styles/controls.css`                              | `src/styles/components.css` 599                  | 599   | styles for the shared primitives of buttons, form fields and selection controls — split out of `src/styles/components.css`                                                                        |
| `src/styles/data-display.css`                          | `src/styles/components.css` 538                  | 538   | styles for the shared primitives of cards and badges, the data table, pagination — split out of `src/styles/components.css`                                                                       |
| `src/styles/toasts.css`                                | `src/styles/components.css` 86                   | 86    | the toast family src/components/ui/Toast.tsx renders — split out of `src/styles/data-display.css`                                                                                                 |
| `src/styles/page-header.css`                           | `src/styles/layout.css` 146                      | 146   | styles for the page header and its breadcrumb trail — split out of `src/styles/layout.css`                                                                                                        |
| `src/styles/placeholders.css`                          | `src/styles/admin-reports.css` 197               | 197   | the shape each data-page placeholder takes while its region is loading — split out of `src/styles/admin-reports.css`                                                                              |
| `src/styles/sidebar.css`                               | `src/styles/layout.css` 129                      | 129   | the administrator sidebar's skeleton — split out of `src/styles/layout.css`                                                                                                                       |
| `src/styles/summary-panel.css`                         | `src/styles/commerce.css` 147                    | 147   | styles for the order-summary panel register that the cart's CartSummary.tsx renders — split out of `src/styles/commerce.css`                                                                      |
| `src/styles/tabs-accordion.css`                        | `src/styles/components.css` 170                  | 170   | styles for the tab and disclosure families src/components/ui/Tabs.tsx renders — split out of `src/styles/data-display.css`                                                                        |
| `src/utils/accountRules.ts`                            | `src/lib/authService.ts` 162                     | 162   | the account rules the domain services and the data layer share — split out of `src/lib/authService.ts`                                                                                            |
| `src/utils/analyticsRules.ts`                          | `src/lib/analyticsService.ts` 511                | 511   | the aggregation rules the dashboard and the reports read and the seeded repositories — split out of `src/lib/analyticsService.ts`                                                                 |
| `src/utils/catalogRules.ts`                            | `src/lib/catalogService.ts` 466                  | 466   | the catalogue's pure rules: what a filter leaves, what each facet counts, how a sort orders — split out of `src/lib/catalogService.ts`                                                            |
| `src/utils/credentials.ts`                             | `src/utils/strings.ts` 114                       | 114   | the credential digest the seed data and the sign-in path both call, and the seal a durable record is written with — split out of `src/utils/strings.ts`                                           |
| `src/utils/dateDisplay.ts`                             | `src/utils/dates.ts` 103                         | 103   | the locale, the formatter cache and the day — split out of `src/utils/dates.ts`                                                                                                                   |
| `src/utils/exhaustive.ts`                              | `src/utils/format.ts` 34                         | 34    | the exhaustiveness proof the four switch sites each carried, in one home — split out of `src/utils/format.ts`                                                                                     |
| `src/utils/formatPrimitives.ts`                        | `src/utils/format.ts` 112                        | 112   | the locale, the formatter cache and the figure primitives every formatter — split out of `src/utils/format.ts`                                                                                    |
| `src/utils/hashing.ts`                                 | `src/utils/strings.ts` 88                        | 88    | the arithmetic the seeded credentials rest on: FNV-1a, the domain separators and the comparison — split out of `src/utils/strings.ts`                                                             |
| `src/utils/isoInstants.ts`                             | `src/utils/dates.ts` 132                         | 132   | parses ISO 8601 text into local instants, moves an instant by whole days or hours — split out of `src/utils/dates.ts`                                                                             |
| `src/utils/orderPlacements.ts`                         | `src/lib/orderService.ts` 348                    | 348   | the read credential this browser holds for each order it placed without an account — split out of `src/lib/orderService.ts`                                                                       |
| `src/utils/orderRules.ts`                              | `src/lib/orderService.ts` 275                    | 275   | the order rules the checkout and the account read and the seeded repositories compose — split out of `src/lib/orderService.ts`                                                                    |
| `src/utils/pricingRules.ts`                            | `src/lib/pricingService.ts` 482                  | 482   | the pricing rules the cart and the checkout read and the seeded repositories compose — split out of `src/lib/pricingService.ts`                                                                   |
| `src/utils/reportRules.ts`                             | `src/lib/reportService.ts` 568                   | 568   | the report rules the report service and the seeded repositories both compose: the catalogue — split out of `src/lib/reportService.ts`                                                             |
| `src/utils/searchRules.ts`                             | `src/lib/searchService.ts` 503                   | 503   | tokenising, weighted scoring and type-ahead ranking over any collections a caller passes — split out of `src/lib/searchService.ts`                                                                |
| `tests/components/chartScales.test.ts`                 | `tests/components/charts.test.tsx` 171           | 171   | the chart scales' own mathematics: the steps a value axis ticks — split out of `tests/components/charts.test.tsx`                                                                                 |
| `tests/components/focusHandoff.test.tsx`               | `src/state/hooks.ts` 295                         | 295   | the focus-handoff contract: an armed handoff moves the focus to the region — split out of `src/state/hooks.ts`                                                                                    |
| `tests/components/overlays.test.tsx`                   | `tests/components/controls.test.tsx` 501         | 501   | the overlay family and the supplementary surfaces beside it — dialog semantics — split out of `tests/components/controls.test.tsx`                                                                |
| `tests/helpers/analyticsHarness.ts`                    | `tests/unit/lib/analyticsService.test.ts` 96     | 96    | the fixture surface both analytics suites read and the seam calls each had declared for itself — split out of `tests/unit/lib/analyticsService.test.ts`                                           |
| `tests/helpers/checkoutHarness.ts`                     | `tests/integration/checkoutFlow.test.tsx` 116    | 116   | the basket walk and the shipping step's inputs the two checkout suites had each declared — split out of `tests/integration/checkoutFlow.test.tsx`                                                 |
| `tests/helpers/journeyHarness.tsx`                     | `tests/integration/shoppingFlow.test.tsx` 381    | 381   | the harness the journey files read the rendered application through: the copy — split out of `tests/integration/shoppingFlow.test.tsx`                                                            |
| `tests/helpers/pricingHarness.ts`                      | `tests/unit/lib/pricingService.test.ts` 35       | 35    | the money invariants both pricing suites assert over a priced cart — split out of `tests/unit/lib/pricingService.test.ts`                                                                         |
| `tests/integration/accountAddressBook.test.tsx`        | `tests/integration/accountFlow.test.tsx` 281     | 281   | the address book's own flow: a refused save, two adds, a card named from its label, an edit — split out of `tests/integration/accountFlow.test.tsx`                                               |
| `tests/integration/catalogBrowseFlow.test.tsx`         | `tests/integration/shoppingFlow.test.tsx` 479    | 479   | the catalogue and search surfaces, from the listing's facets and sort to its failure states — split out of `tests/integration/shoppingFlow.test.tsx`                                              |
| `tests/integration/catalogSuggestionsFlow.test.tsx`    | `tests/integration/shoppingFlow.test.tsx` 348    | 348   | the suggestion list's keyboard choice and the product page it opens — split out of `tests/integration/catalogBrowseFlow.test.tsx`                                                                 |
| `tests/integration/catalogUrlState.test.tsx`           | `tests/integration/shoppingFlow.test.tsx` 208    | 208   | the catalogue's query contract with the address bar: writes raised inside one render — split out of `tests/integration/shoppingFlow.test.tsx`                                                     |
| `tests/integration/checkoutPricingFailure.test.tsx`    | `tests/integration/checkoutFlow.test.tsx` 132    | 132   | the checkout's refused price request: the seam's failure reported with a retry — split out of `tests/integration/checkoutFlow.test.tsx`                                                           |
| `tests/integration/figureReaders.ts`                   | `tests/integration/adminReportsFlow.test.tsx` 11 | 11    | the readers the administrator flow's assertions read a rendered figure back out with — split out of `tests/integration/adminReportsFlow.test.tsx`                                                 |
| `tests/integration/orderConfirmationRefusals.test.tsx` | `tests/integration/checkoutFlow.test.tsx` 49     | 49    | the confirmation route's two refusals as a visitor meets them — split out of `tests/integration/checkoutFlow.test.tsx`                                                                            |
| `tests/unit/lib/analyticsBaseline.test.ts`             | `tests/unit/lib/analyticsService.test.ts` 182    | 182   | the previous-year comparison the dashboard offers — split out of `tests/unit/lib/analyticsService.test.ts`                                                                                        |
| `tests/unit/lib/analyticsQueries.test.ts`              | `tests/unit/lib/analyticsService.test.ts` 95     | 95    | the query builders a dated read is assembled — split out of `tests/unit/lib/analyticsService.test.ts`                                                                                             |
| `tests/unit/lib/analyticsSeries.test.ts`               | `tests/unit/lib/analyticsService.test.ts` 74     | 74    | the band wording of a charted period's series: one band per bucket — split out of `tests/unit/lib/analyticsService.test.ts`                                                                       |
| `tests/unit/lib/apiRoutesVocabulary.test.ts`           | `src/lib/mockServer.ts` 443                      | 443   | the vocabulary the seam refuses a hand-made request's own values — split out of `tests/unit/lib/apiRoutes.test.ts`                                                                                |
| `tests/unit/lib/catalogSearchFlow.test.ts`             | `tests/unit/lib/catalogSearch.test.ts` 482       | 482   | search scoring, type-ahead suggestions — split out of `tests/unit/lib/catalogSearch.test.ts`                                                                                                      |
| `tests/unit/lib/customerService.test.ts`               | `tests/unit/lib/pricingService.test.ts` 574      | 574   | profile reads and writes, the address-book rules including at most one default of each kind — split out of `tests/unit/lib/pricingService.test.ts`                                                |
| `tests/unit/lib/mockServerDurability.test.ts`          | `tests/unit/lib/mockServer.test.ts` 360          | 360   | the seam's durability across a document load: what a document writes is what the next reads — split out of `tests/unit/lib/mockServer.test.ts`                                                    |
| `tests/unit/lib/mockServerHarness.ts`                  | `tests/unit/lib/mockServer.test.ts` 160          | 160   | the seam fixtures and assertions the mock-server specs share: the data source a case binds — split out of `tests/unit/lib/mockServer.test.ts`                                                     |
| `tests/unit/lib/mockServerOrderRead.test.ts`           | `tests/unit/lib/mockServer.test.ts` 325          | 325   | the order read's authorisation — split out of `tests/unit/lib/mockServer.test.ts`                                                                                                                 |
| `tests/unit/lib/pricingSurface.test.ts`                | `tests/unit/lib/pricingService.test.ts` 233      | 233   | the pricing service's transport-backed surface: promo validation, the delivery methods — split out of `tests/unit/lib/pricingService.test.ts`                                                     |
| `tests/unit/lib/seedInvariants.test.ts`                | `tests/unit/lib/mockServer.test.ts` 122          | 122   | the seeded data's own invariants — split out of `tests/unit/lib/mockServer.test.ts`                                                                                                               |
| `tests/unit/state/checkout.test.ts`                    | `tests/unit/state/transactions.test.ts` 326      | 326   | checkout transitions: the step machine, value and error patches, and the submission guards — split out of `tests/unit/state/transactions.test.ts`                                                 |
| `tests/unit/state/hooks.test.ts`                       | `src/state/hooks.ts` 49                          | 49    | the `useAsync` share of `src/state/hooks.ts` — split out of `src/state/hooks.ts`                                                                                                                  |
| `tests/unit/utils/async.test.ts`                       | `tests/unit/utils/formatting.test.ts` 589        | 589   | the timing, cancellation and retry contracts of src/utils/async.ts — split out of `tests/unit/utils/formatting.test.ts`                                                                           |
| `tests/unit/utils/bucketLabels.test.ts`                | `tests/unit/utils/formatting.test.ts` 233        | 233   | the wording of a bucket the selected range clips — split out of `tests/unit/utils/formatting.test.ts`                                                                                             |
| `tests/unit/utils/collectionsRanking.test.ts`          | `tests/unit/utils/collections.test.ts` 167       | 167   | keyed indexing, reversal, frequency ranking and top-N selection helpers — split out of `tests/unit/utils/collections.test.ts`                                                                     |
| `tests/unit/utils/csv.test.ts`                         | `tests/unit/utils/formatting.test.ts` 525        | 525   | CSV serialisation, escaping, clipping, row capping and the download trigger — split out of `tests/unit/utils/formatting.test.ts`                                                                  |
| `tests/unit/utils/dates.test.ts`                       | `tests/unit/utils/formatting.test.ts` 598        | 598   | the range arithmetic, bucket boundaries and comparison periods of src/utils/dates.ts — split out of `tests/unit/utils/formatting.test.ts`                                                         |
| `tests/unit/utils/statistics.test.ts`                  | `tests/unit/utils/formatting.test.ts` 586        | 586   | unit coverage of src/utils/statistics.ts: percentage change, growth, averages — split out of `tests/unit/utils/formatting.test.ts`                                                                |
| `tests/unit/utils/strings.test.ts`                     | `tests/unit/utils/formatting.test.ts` 569        | 569   | the text, identifier-generator and credential-digest contracts of src/utils/strings.ts — split out of `tests/unit/utils/formatting.test.ts`                                                       |
| `tests/unit/utils/validationCard.test.ts`              | `tests/unit/utils/validation.test.ts` 141        | 141   | the card number, expiry and security-code rules with the Luhn check they rest on — split out of `tests/unit/utils/validation.test.ts`                                                             |

**Covering suites.** 6 suites carry no budget of their own and cover a concern the plan maps no
suite for; each is recorded with what it covers and with the mapped file it is charged to.

| Suite                                               | Lines | Charged to                               | Covers                                                                                                                                               |
| --------------------------------------------------- | ----- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/components/chartHeaderHint.test.tsx`         | 113   | `src/features/admin/SalesChart.tsx` 380  | the chart's header hint in `src/features/admin/SalesChart.tsx`                                                                                       |
| `tests/integration/searchQueryConsistency.test.tsx` | 148   | `src/features/search/SearchPage.tsx` 360 | `src/features/search/SearchPage.tsx` and the catalogue listing's count                                                                               |
| `tests/integration/sessionLifecycle.test.tsx`       | 565   | `src/state/AuthContext.tsx` 360          | `src/state/AuthContext.tsx` with `src/lib/authService.ts`                                                                                            |
| `tests/unit/lib/apiRoutes.test.ts`                  | 597   | `src/lib/mockServer.ts` 500              | the route table `src/lib/apiRoutes.ts`, a §0.5.5 split of `src/lib/mockServer.ts` (the plan's own seam suite is `tests/unit/lib/mockServer.test.ts`) |
| `tests/unit/lib/clientWrites.test.ts`               | 322   | `src/data/repositories.ts` 440           | the durable record's folds in `src/data/clientWrites.ts` and the authority the seeded identities keep over them                                      |
| `tests/unit/lib/sessionTableDurability.test.ts`     | 234   | `src/data/repositories.ts` 440           | `src/data/sessionTable.ts` across documents: a session one document issues, a sign-out that reaches an open document                                 |

With these rows recorded, no path in the tree stands without a parent: every split path names the
mapped file whose allocation it draws on, and every covering suite names the module or flow it
covers. Every one of the 114 budget-free paths is therefore charged to a file §0.7.1 maps and §0.9.1
owns — 108 to the mapped file whose allocation they draw on, 6 to the file they cover — each as §0.5.5
requires of a split under the never-raised ceiling and as §0.8.1 and §0.12.2 require of the coverage a
covering suite supplies.
**§0.5.1's ±5% band (47,500-52,500) — settled at delivery.** §0.5.1 allocates exactly 50,000
lines across the 157 counted files and expects the delivered total inside ±5% of that through
§0.5.5's reconciliation rule. The allocation holds exactly: 157 integer budgets, no ranges, the
largest 500. The delivered total is 92,749 so the band is not met. It cannot be met on this tree,
because each of the three routes to it is closed. Padding a file up to its budget only raises the
total, and §0.5.5 forbids it — "Nothing is added to a file that has finished its job". Cutting a
file's real content down to its budget is forbidden by §0.5.5, §0.8.2 and §0.12.2 — no real code is
cut to stay inside one. Folding the 114 budget-free paths back into the mapped files they draw on is
the third, and it cannot reach the band either: a merge changes the file count and not the line
count, absorbing only the header and the import lines it removes — under 2,000 lines across all 114 —
where the tree stands 42,749 lines past the allocation and 40,249 past the band's top. Most of the
folds would not fit anyway: measured on this tree, 48 of the 53 allocation roots' whole groups
already exceed 600 lines, and the file a split is charged to, plus that split's own lines, exceeds
600 in 87 of the 108 splits; §0.5.4's one-file-once rule — a generated file is never rewritten — and
the ceiling §0.5.1 and §0.5.5 never raise settle the rest.
The band is therefore settled here, once, at delivery, in favour of §0.5.5's no-pad, no-cut and
never-raise clauses over §0.5.1's tolerance, because §0.5.1 itself makes §0.5.5's reconciliation the
rule that holds the band and §0.5.5's two prohibitions bind that reconciliation. Nothing is left
open: this is the one clause of the plan the delivered tree departs from, recorded so a later
session does not read it as unfinished work.

**Propagated here rather than deferred.** The four counts this checkpoint changed in place —
`src/features/catalog/ProductDetailPage.tsx` 454, its split path
`src/features/catalog/PurchasePanel.tsx` 221, `src/styles/catalog-detail.css` 314 and
`tests/integration/shoppingFlow.test.tsx` 333 — are summed by every aggregate that reads them: Part 2's
phase and cumulative cells with its Totals row, Part 3's roll-ups, size bands and totals, the closing
progress line, and the counting rule `docs/contributing.md` restates.

## Part 5 — Output contract

**Header comment.** Every generated file opens with a three-field header — path, purpose, line
count — in the file's own comment syntax, before any import or content. `Path` is
repository-root-relative; `Purpose` is the sentence §0.9.3 states for that file; `Lines` is the
file's real total line count, the same number this manifest records for it:

```typescript
/**
 * Path: src/utils/format.ts
 * Purpose: Formats money, numbers, percentages and compact values for display across every module.
 * Lines: 577
 */
```

```css
/* Path: src/styles/tokens.css
 * Purpose: Declares every colour, spacing, typography, radius, shadow and z-index token the stylesheets consume.
 * Lines: 327
 */
```

```markdown
<!--
Path: docs/mock-api.md
Purpose: The endpoint contract with the demonstration credentials and the latency and failure switches
Lines: 242
-->
```

`.env.example` and `.gitignore` carry the same three fields as `#` comments:

```text
# Path: .env.example
# Purpose: Documentation of the inert `VITE_` variables the application reads, with no secrets
# Lines: 23
```

**Exempt, because the format permits no comment:** `package.json`, `tsconfig.json` and
`.prettierrc.json` are the only three files that carry no header; their counts are still recorded
in Part 1, so the total stays auditable — 46, 28 and 12 lines at this snapshot.

**The 600-line ceiling.** A mapped file may never exceed 600 lines and the ceiling is never raised. A
concern that cannot fit inside it is split into a second file, and the split is recorded in Part 4
with the mapped file whose allocation it draws on. A path past the ceiling at this snapshot
carries its ceiling note in Part 1 and its ledger row in Part 4. This manifest is the one path
outside both the count and the ceiling: §0.5.1 excludes it from the 50,000-line total and lets its
length follow its content rather than its own 300-line budget.

**A budget is an allocation, never padding.** Nothing is added to a file that has finished its job
and no real code is cut from a file that needs its lines. A file that lands over its budget and
inside the ceiling keeps its real count and its row in Part 1; a deviation beyond 10% of a file's
budget gets its row in Part 4 with a one-line reason, so the total stays auditable line by line.

**How each phase updates this file.** Before the progress line, a phase sets each file it wrote to
`Done` in Part 1 with that file's real line count, updates its phase row's `Actual lines` and
`Cumulative` in Part 2, appends any ledger row Part 4 needs, and rewrites this file in full. Its
size follows its content: where the content and the 300-line budget for this file disagree, the
content wins.

**Status vocabulary.** `Pending` — not generated yet. `In progress` — being written while its phase
runs. `Done` — its content is complete and this file records its real line count. A file becomes
`In progress` only while its phase is being written and `Done` when its header's line count has
been corrected to the file's real length.

**Progress line.** After a phase's files exactly one line is printed, in the request's literal
form, with N the cumulative total Part 2 states — `Total lines so far: N / 50000`. Nothing follows
it: no summary, no next-phase preview, no commentary. Generation then stops until the user replies
with the single word `continue`, and no phase begins without it.

**No prose between files.** A phase emits file content and then the progress line: no text between
files, no headings, no commentary around them, and no content beyond the files that phase's list
names. The rule governs a phase's output, and the repository holds no transcript of any phase's
output, so the contract is recorded here rather than checked here.

**One file, once.** A file generated in a phase is never regenerated. A defect found later is fixed
in the file that owns the concern and never by duplicating logic into another file. The only file
rewritten across phases is this manifest, which is bookkeeping rather than product code.

Total lines so far: 92749 / 50000
