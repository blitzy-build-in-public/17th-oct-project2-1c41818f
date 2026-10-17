<!--
Path: generation-manifest.md
Purpose: The authoritative build manifest: tree, budgets, actual counts, phase schedule, cumulative total and status ledger — the one file excluded from the 50,000, written in Phase 0 before any of the above.
Lines: 372
-->

# SalesPro — generation manifest

**Phase 0 deliverable · 300-line budget (a target, not a cap) · excluded from the 50,000-line total · rewritten in full at the end of every phase**

The single source of truth for what exists in this repository: every path with its line budget, actual count and status, the phase schedule, the cumulative total and the reconciliation ledger. A resuming session needs nothing but this file and the plan, and its next batch is always the first 3 to 5 `Pending` rows of Part 1 in tree order.

| Fact                                        | Value                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Paths in the repository tree                | 158                                                                                                      |
| Counted in the 50,000-line total            | 157                                                                                                      |
| Excluded from it                            | 1 — this manifest, the only file whose own lines are never counted                                       |
| Budgeted total                              | exactly 50,000 lines, held to ±5% (47,500 – 52,500) by Part 4's ledger                                   |
| Gated outputs                               | Phase 0 plus 39 phases, each producing 3 to 5 files                                                      |
| Largest per-file budget                     | 500 lines, inside the request's 600-line ceiling                                                         |
| Generation phases complete at this snapshot | none — so the progress line is still `Total lines so far: 0 / 50000`, and it becomes non-zero at phase 1 |

## How a session resumes

1. `npm install` if `node_modules/` is absent (never `npm cache clean` — the host cache is shared), then `npm run typecheck` and `npm test`, and confirm both are green before generating anything. `npm test` exits zero with no test files present because `vitest.config.ts` sets `passWithNoTests: true`, so the same gate holds from phase 1 until the suite exists in phases 35–38.
2. Select the next batch: the first 3 to 5 `Pending` rows of Part 1, in tree order, never skipping one, never from memory of an earlier session.
3. Write those files against what the earlier phases produced. If a phase finds that an earlier file cannot support it, stop and report the conflict rather than duplicating the missing behaviour into the new files.
4. Before the progress line, work through the per-phase update procedure in Part 5 and rewrite this manifest in full.
5. Print exactly one line — `Total lines so far: N / 50000` — and then stop until the user replies `continue`.

If this manifest and the working tree disagree — a file present but `Pending`, or recorded `Done` but absent — **the file on disk wins**, and this manifest is corrected to match before any new file is generated. Part 1 therefore records the content the repository's setup commit already placed on disk, so a resuming session never regenerates a path that exists.

## Part 1 — File tree in generation order, with budgets, status and actual counts

Flattening this tree top to bottom reproduces the phase schedule of Part 2 exactly. One line per file: `# <budget> · P<phase> · <status> · <actual>`. Never add a path the plan does not map, never drop one it does, and never write a `Done` file again.

Legend · `# <budget>` budgeted lines (an allocation, never padding) · `P<n>` the phase that generates the file · `Done` the plan's content is complete at that path · `Pending · —` nothing of the plan's content is written yet · `Pending · <n> on disk` content is already on disk from the setup commit and its owning phase completes it in place, never duplicating or resetting it.

```text
/  (repository root)
├── generation-manifest.md  # 300 · P0 · Done · 359 · excluded from the 50,000-line total
├── package.json  # 65 · P1 · Done · 46
├── tsconfig.json  # 45 · P1 · Done · 27
├── vite.config.ts  # 60 · P1 · Pending · 21 on disk
├── vitest.config.ts  # 85 · P1 · Pending · 50 on disk
├── index.html  # 60 · P1 · Pending · —
├── eslint.config.js  # 55 · P2 · Done · 58
├── .prettierrc.json  # 12 · P2 · Done · 8
├── .gitignore  # 25 · P2 · Pending · 37 on disk
├── .env.example  # 18 · P2 · Pending · —
├── src/
│   ├── types/
│   │   ├── common.ts  # 240 · P3 · Pending · —
│   │   ├── catalog.ts  # 380 · P3 · Pending · —
│   │   ├── commerce.ts  # 420 · P3 · Pending · —
│   │   ├── account.ts  # 290 · P3 · Pending · —
│   │   └── analytics.ts  # 400 · P3 · Pending · —
│   ├── constants/
│   │   ├── routes.ts  # 180 · P4 · Pending · —
│   │   ├── config.ts  # 250 · P4 · Pending · —
│   │   ├── content.ts  # 400 · P4 · Done · 596
│   │   └── taxonomy.ts  # 330 · P4 · Done · 405
│   ├── utils/
│   │   ├── format.ts  # 380 · P5 · Done · 583
│   │   ├── dates.ts  # 350 · P5 · Done · 597
│   │   ├── strings.ts  # 350 · P5 · Done · 541
│   │   ├── validation.ts  # 440 · P5 · Done · 586
│   │   ├── collections.ts  # 420 · P5 · Pending · —
│   │   ├── statistics.ts  # 360 · P6 · Pending · —
│   │   ├── queryParams.ts  # 270 · P6 · Pending · —
│   │   ├── storage.ts  # 270 · P6 · Done · 288
│   │   ├── async.ts  # 270 · P6 · Pending · —
│   │   └── csv.ts  # 250 · P6 · Done · 273
│   ├── styles/
│   │   ├── tokens.css  # 250 · P7 · Pending · —
│   │   ├── base.css  # 270 · P7 · Done · 362
│   │   ├── layout.css  # 350 · P7 · Pending · —
│   │   ├── components.css  # 500 · P7 · Pending · —
│   │   ├── catalog.css  # 400 · P8 · Pending · —
│   │   ├── commerce.css  # 460 · P8 · Pending · —
│   │   ├── admin-reports.css  # 480 · P8 · Pending · —
│   │   └── account.css  # 310 · P8 · Pending · —
│   ├── lib/
│   │   ├── apiClient.ts  # 350 · P9 · Pending · —
│   │   ├── mockServer.ts  # 500 · P9 · Pending · —
│   │   ├── authService.ts  # 380 · P9 · Pending · —
│   │   ├── catalogService.ts  # 480 · P9 · Pending · —
│   │   ├── searchService.ts  # 440 · P9 · Pending · —
│   │   ├── pricingService.ts  # 440 · P10 · Pending · —
│   │   ├── orderService.ts  # 420 · P10 · Pending · —
│   │   ├── customerService.ts  # 380 · P10 · Pending · —
│   │   ├── analyticsService.ts  # 480 · P10 · Pending · —
│   │   └── reportService.ts  # 460 · P10 · Pending · —
│   ├── data/
│   │   ├── categories.ts  # 240 · P11 · Pending · —
│   │   ├── products.ts  # 480 · P11 · Pending · —
│   │   ├── customers.ts  # 310 · P11 · Pending · —
│   │   ├── orders.ts  # 460 · P11 · Pending · —
│   │   ├── reviews.ts  # 250 · P12 · Pending · —
│   │   ├── salesHistory.ts  # 380 · P12 · Pending · —
│   │   └── repositories.ts  # 440 · P12 · Pending · —
│   ├── state/
│   │   ├── AuthContext.tsx  # 360 · P13 · Pending · —
│   │   ├── CartContext.tsx  # 360 · P13 · Pending · —
│   │   ├── CatalogContext.tsx  # 330 · P13 · Pending · —
│   │   ├── CheckoutContext.tsx  # 380 · P13 · Pending · —
│   │   ├── ToastContext.tsx  # 250 · P13 · Pending · —
│   │   ├── cartReducer.ts  # 310 · P14 · Pending · —
│   │   ├── checkoutReducer.ts  # 350 · P14 · Done · 538
│   │   ├── catalogReducer.ts  # 270 · P14 · Pending · —
│   │   └── hooks.ts  # 480 · P14 · Done · 592
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx  # 310 · P15 · Pending · —
│   │   │   ├── Header.tsx  # 380 · P15 · Pending · —
│   │   │   ├── Footer.tsx  # 240 · P15 · Pending · —
│   │   │   ├── AdminSidebar.tsx  # 290 · P15 · Done · 165
│   │   │   └── PageHeader.tsx  # 200 · P15 · Pending · —
│   │   ├── ui/
│   │   │   ├── Button.tsx  # 360 · P16 · Pending · —
│   │   │   ├── Input.tsx  # 400 · P16 · Pending · —
│   │   │   ├── Select.tsx  # 400 · P16 · Pending · —
│   │   │   ├── Modal.tsx  # 360 · P16 · Pending · —
│   │   │   ├── Table.tsx  # 480 · P17 · Pending · —
│   │   │   ├── Pagination.tsx  # 270 · P17 · Pending · —
│   │   │   ├── Card.tsx  # 270 · P17 · Pending · —
│   │   │   ├── Feedback.tsx  # 400 · P17 · Pending · —
│   │   │   ├── Toast.tsx  # 270 · P18 · Pending · —
│   │   │   ├── Tabs.tsx  # 270 · P18 · Pending · —
│   │   │   ├── Rating.tsx  # 250 · P18 · Pending · —
│   │   │   └── Tooltip.tsx  # 220 · P18 · Pending · —
│   │   ├── product/
│   │   │   ├── ProductCard.tsx  # 360 · P19 · Pending · —
│   │   │   └── ProductGallery.tsx  # 270 · P19 · Pending · —
│   │   └── charts/
│   │       ├── chartScales.ts  # 310 · P19 · Pending · —
│   │       ├── LineChart.tsx  # 420 · P20 · Pending · —
│   │       ├── BarChart.tsx  # 400 · P20 · Pending · —
│   │       └── DonutChart.tsx  # 330 · P20 · Pending · —
│   ├── features/
│   │   ├── home/
│   │   │   ├── HomePage.tsx  # 310 · P21 · Pending · —
│   │   │   ├── HeroSection.tsx  # 270 · P21 · Done · 197
│   │   │   ├── FeaturedProducts.tsx  # 290 · P21 · Pending · —
│   │   │   └── CategoryShowcase.tsx  # 250 · P21 · Pending · —
│   │   ├── catalog/
│   │   │   ├── CatalogPage.tsx  # 380 · P22 · Pending · —
│   │   │   ├── ProductList.tsx  # 310 · P22 · Pending · —
│   │   │   ├── ProductDetailPage.tsx  # 475 · P22 · Pending · —
│   │   │   └── ProductReviews.tsx  # 330 · P22 · Pending · —
│   │   ├── search/
│   │   │   ├── SearchPage.tsx  # 360 · P23 · Pending · —
│   │   │   ├── SearchBar.tsx  # 330 · P23 · Pending · —
│   │   │   ├── SearchSuggestions.tsx  # 270 · P23 · Pending · —
│   │   │   ├── FilterPanel.tsx  # 470 · P24 · Pending · —
│   │   │   ├── SortControl.tsx  # 220 · P24 · Pending · —
│   │   │   └── ActiveFilters.tsx  # 250 · P24 · Pending · —
│   │   ├── cart/
│   │   │   ├── CartPage.tsx  # 360 · P25 · Pending · —
│   │   │   ├── CartItemRow.tsx  # 290 · P25 · Pending · —
│   │   │   ├── CartSummary.tsx  # 330 · P25 · Pending · —
│   │   │   ├── MiniCart.tsx  # 330 · P25 · Pending · —
│   │   │   └── cartSelectors.ts  # 270 · P25 · Pending · —
│   │   ├── checkout/
│   │   │   ├── CheckoutPage.tsx  # 380 · P26 · Pending · —
│   │   │   ├── CheckoutSteps.tsx  # 250 · P26 · Pending · —
│   │   │   ├── ShippingForm.tsx  # 360 · P26 · Pending · —
│   │   │   ├── PaymentForm.tsx  # 400 · P27 · Pending · —
│   │   │   ├── ReviewOrder.tsx  # 330 · P27 · Pending · —
│   │   │   └── OrderConfirmation.tsx  # 330 · P27 · Pending · —
│   │   ├── account/
│   │   │   ├── LoginPage.tsx  # 330 · P28 · Pending · —
│   │   │   ├── RegisterPage.tsx  # 360 · P28 · Pending · —
│   │   │   ├── AccountLayout.tsx  # 250 · P28 · Pending · —
│   │   │   ├── ProfilePage.tsx  # 350 · P29 · Pending · —
│   │   │   ├── OrderHistoryPage.tsx  # 360 · P29 · Pending · —
│   │   │   └── AddressBookPage.tsx  # 380 · P29 · Pending · —
│   │   ├── admin/
│   │   │   ├── AdminDashboardPage.tsx  # 400 · P30 · Pending · —
│   │   │   ├── KpiCard.tsx  # 270 · P30 · Pending · —
│   │   │   ├── SalesChart.tsx  # 380 · P30 · Pending · —
│   │   │   ├── RecentOrdersTable.tsx  # 290 · P30 · Pending · —
│   │   │   └── TopProductsTable.tsx  # 250 · P30 · Pending · —
│   │   └── reports/
│   │       ├── ReportsPage.tsx  # 330 · P31 · Pending · —
│   │       ├── SalesReport.tsx  # 400 · P31 · Pending · —
│   │       ├── ProductPerformanceReport.tsx  # 350 · P31 · Pending · —
│   │       ├── CustomerReport.tsx  # 330 · P32 · Pending · —
│   │       ├── DateRangePicker.tsx  # 310 · P32 · Pending · —
│   │       └── ReportTable.tsx  # 290 · P32 · Pending · —
│   ├── Router.tsx  # 390 · P33 · Pending · —
│   ├── App.tsx  # 290 · P33 · Pending · —
│   └── main.tsx  # 120 · P33 · Pending · —
├── tests/
│   ├── setup.ts  # 130 · P34 · Pending · —
│   ├── fixtures.ts  # 440 · P34 · Done · 599
│   ├── testUtils.tsx  # 270 · P34 · Pending · —
│   ├── unit/
│   │   ├── utils/
│   │   │   ├── formatting.test.ts  # 380 · P35 · Pending · —
│   │   │   ├── validation.test.ts  # 290 · P35 · Pending · —
│   │   │   ├── collections.test.ts  # 400 · P35 · Pending · —
│   │   │   └── queryParams.test.ts  # 220 · P35 · Pending · —
│   │   ├── lib/
│   │   │   ├── catalogSearch.test.ts  # 470 · P35 · Pending · —
│   │   │   ├── pricingService.test.ts  # 330 · P36 · Pending · —
│   │   │   ├── orderService.test.ts  # 270 · P36 · Pending · —
│   │   │   ├── authService.test.ts  # 250 · P36 · Pending · —
│   │   │   ├── analyticsService.test.ts  # 330 · P36 · Pending · —
│   │   │   ├── reportService.test.ts  # 310 · P36 · Pending · —
│   │   │   └── mockServer.test.ts  # 220 · P37 · Pending · —
│   │   └── state/
│   │       ├── transactions.test.ts  # 440 · P37 · Pending · —
│   │       └── catalogReducer.test.ts  # 250 · P37 · Pending · —
│   ├── components/
│   │   ├── controls.test.tsx  # 360 · P37 · Pending · —
│   │   ├── Table.test.tsx  # 240 · P37 · Pending · —
│   │   └── charts.test.tsx  # 250 · P38 · Pending · —
│   └── integration/
│       ├── shoppingFlow.test.tsx  # 350 · P38 · Pending · —
│       ├── checkoutFlow.test.tsx  # 380 · P38 · Pending · —
│       ├── accountFlow.test.tsx  # 330 · P38 · Pending · —
│       └── adminReportsFlow.test.tsx  # 440 · P38 · Pending · —
├── README.md  # 310 · P39 · Pending · 2 setup placeholder
└── docs/
    ├── architecture.md  # 270 · P39 · Pending · —
    ├── contributing.md  # 160 · P39 · Pending · —
    └── mock-api.md  # 200 · P39 · Pending · —
```

## Part 2 — Phase schedule

Phase 0 is the first gated output: its visible content is the tree above with a budget per file and no file contents, and its only written file is this manifest, which is excluded from the total. Every later phase emits its files in the order they appear above and then one progress line. A phase's `Files` column names its run by its first and last path; its members are the Part 1 rows carrying the same `P<n>`. A phase may hold fewer than 3 files only when the manifest shows fewer than three `Pending` files remaining.

| Phase | Files                                                                                            | Planned lines | Actual lines | Cumulative |
| ----- | ------------------------------------------------------------------------------------------------ | ------------- | ------------ | ---------- |
| 0     | 1 (excluded) · `generation-manifest.md`                                                          | — excluded    | —            | 0          |
| 1     | 5 · `package.json` → `index.html`                                                                | 315           | —            | 315        |
| 2     | 4 · `eslint.config.js` → `.env.example`                                                          | 110           | —            | 425        |
| 3     | 5 · `src/types/common.ts` → `src/types/analytics.ts`                                             | 1,730         | —            | 2,155      |
| 4     | 4 · `src/constants/routes.ts` → `src/constants/taxonomy.ts`                                      | 1,160         | —            | 3,315      |
| 5     | 5 · `src/utils/format.ts` → `src/utils/collections.ts`                                           | 1,940         | —            | 5,255      |
| 6     | 5 · `src/utils/statistics.ts` → `src/utils/csv.ts`                                               | 1,420         | —            | 6,675      |
| 7     | 4 · `src/styles/tokens.css` → `src/styles/components.css`                                        | 1,370         | —            | 8,045      |
| 8     | 4 · `src/styles/catalog.css` → `src/styles/account.css`                                          | 1,650         | —            | 9,695      |
| 9     | 5 · `src/lib/apiClient.ts` → `src/lib/searchService.ts`                                          | 2,150         | —            | 11,845     |
| 10    | 5 · `src/lib/pricingService.ts` → `src/lib/reportService.ts`                                     | 2,180         | —            | 14,025     |
| 11    | 4 · `src/data/categories.ts` → `src/data/orders.ts`                                              | 1,490         | —            | 15,515     |
| 12    | 3 · `src/data/reviews.ts` → `src/data/repositories.ts`                                           | 1,070         | —            | 16,585     |
| 13    | 5 · `src/state/AuthContext.tsx` → `src/state/ToastContext.tsx`                                   | 1,680         | —            | 18,265     |
| 14    | 4 · `src/state/cartReducer.ts` → `src/state/hooks.ts`                                            | 1,410         | —            | 19,675     |
| 15    | 5 · `src/components/layout/AppLayout.tsx` → `src/components/layout/PageHeader.tsx`               | 1,420         | —            | 21,095     |
| 16    | 4 · `src/components/ui/Button.tsx` → `src/components/ui/Modal.tsx`                               | 1,520         | —            | 22,615     |
| 17    | 4 · `src/components/ui/Table.tsx` → `src/components/ui/Feedback.tsx`                             | 1,420         | —            | 24,035     |
| 18    | 4 · `src/components/ui/Toast.tsx` → `src/components/ui/Tooltip.tsx`                              | 1,010         | —            | 25,045     |
| 19    | 3 · `src/components/product/ProductCard.tsx` → `src/components/charts/chartScales.ts`            | 940           | —            | 25,985     |
| 20    | 3 · `src/components/charts/LineChart.tsx` → `src/components/charts/DonutChart.tsx`               | 1,150         | —            | 27,135     |
| 21    | 4 · `src/features/home/HomePage.tsx` → `src/features/home/CategoryShowcase.tsx`                  | 1,120         | —            | 28,255     |
| 22    | 4 · `src/features/catalog/CatalogPage.tsx` → `src/features/catalog/ProductReviews.tsx`           | 1,495         | —            | 29,750     |
| 23    | 3 · `src/features/search/SearchPage.tsx` → `src/features/search/SearchSuggestions.tsx`           | 960           | —            | 30,710     |
| 24    | 3 · `src/features/search/FilterPanel.tsx` → `src/features/search/ActiveFilters.tsx`              | 940           | —            | 31,650     |
| 25    | 5 · `src/features/cart/CartPage.tsx` → `src/features/cart/cartSelectors.ts`                      | 1,580         | —            | 33,230     |
| 26    | 3 · `src/features/checkout/CheckoutPage.tsx` → `src/features/checkout/ShippingForm.tsx`          | 990           | —            | 34,220     |
| 27    | 3 · `src/features/checkout/PaymentForm.tsx` → `src/features/checkout/OrderConfirmation.tsx`      | 1,060         | —            | 35,280     |
| 28    | 3 · `src/features/account/LoginPage.tsx` → `src/features/account/AccountLayout.tsx`              | 940           | —            | 36,220     |
| 29    | 3 · `src/features/account/ProfilePage.tsx` → `src/features/account/AddressBookPage.tsx`          | 1,090         | —            | 37,310     |
| 30    | 5 · `src/features/admin/AdminDashboardPage.tsx` → `src/features/admin/TopProductsTable.tsx`      | 1,590         | —            | 38,900     |
| 31    | 3 · `src/features/reports/ReportsPage.tsx` → `src/features/reports/ProductPerformanceReport.tsx` | 1,080         | —            | 39,980     |
| 32    | 3 · `src/features/reports/CustomerReport.tsx` → `src/features/reports/ReportTable.tsx`           | 930           | —            | 40,910     |
| 33    | 3 · `src/Router.tsx` → `src/main.tsx`                                                            | 800           | —            | 41,710     |
| 34    | 3 · `tests/setup.ts` → `tests/testUtils.tsx`                                                     | 840           | —            | 42,550     |
| 35    | 5 · `tests/unit/utils/formatting.test.ts` → `tests/unit/lib/catalogSearch.test.ts`               | 1,760         | —            | 44,310     |
| 36    | 5 · `tests/unit/lib/pricingService.test.ts` → `tests/unit/lib/reportService.test.ts`             | 1,490         | —            | 45,800     |
| 37    | 5 · `tests/unit/lib/mockServer.test.ts` → `tests/components/Table.test.tsx`                      | 1,510         | —            | 47,310     |
| 38    | 5 · `tests/components/charts.test.tsx` → `tests/integration/adminReportsFlow.test.tsx`           | 1,750         | —            | 49,060     |
| 39    | 4 · `README.md` → `docs/mock-api.md`                                                             | 940           | —            | 50,000     |

Totals: 39 generation phases plus Phase 0, 157 counted files, 50,000 planned lines, no phase with fewer than 3 or more than 5 files. `Actual lines` stays blank and `Cumulative` stays at the planned figure until that phase's files are written, at which point both are replaced with the real counts and the running total is carried forward.

## Part 3 — Roll-ups and size distribution

| Area                                                      | Files   | Budgeted lines |
| --------------------------------------------------------- | ------- | -------------- |
| `src/` including `Router.tsx`, `App.tsx` and `main.tsx`   | 121     | 41,285         |
| of which the eight feature slices                         | 42      | 13,775         |
| of which shared foundations, data, state and presentation | 79      | 27,510         |
| `tests/`                                                  | 23      | 7,350          |
| Root tooling and configuration                            | 9       | 425            |
| Documents (`README.md` and `docs/`)                       | 4       | 940            |
| **Counted total**                                         | **157** | **50,000**     |
| This manifest, excluded from the total                    | 1       | 300 target     |

| Budget band (lines) | Files   | Lines      | What sits there                                                                                                              |
| ------------------- | ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1–99                | 9       | 425        | root tooling and configuration                                                                                               |
| 100–199             | 4       | 590        | entry point, test setup, route constants and the contribution guide                                                          |
| 200–299             | 49      | 12,650     | small primitives, contexts, seed collections, page sections, unit tests and docs                                             |
| 300–399             | 59      | 20,500     | utilities, services, layout components, feature pages and most test files                                                    |
| 400–500             | 36      | 15,835     | the largest services and seed generators, the shared table and form primitives, filter and detail pages, the big test suites |
| **1–500**           | **157** | **50,000** | mean 318 lines, largest 500 lines, none above the 600-line ceiling                                                           |

## Part 4 — Reconciliation ledger

A budget is an allocation, not a commitment to a number. The rules this ledger enforces:

- A file is never padded to reach its budget, and real code is never cut to stay inside one. An underrun returns its lines to the remainder; an overrun is absorbed by the budgets of files not yet generated, recorded here with a line naming what grew.
- A deviation beyond 10% of a file's budget is listed below with its reason, so the total stays auditable line by line.
- If a file cannot fit the 600-line ceiling, its concern is split into a second file — recorded here and generated in the current or the next phase. **The ceiling is never raised.**
- Content already on disk is recorded at its real count the moment it is read, so the ledger never disagrees with the working tree.

| File               | Budget | Actual | Difference   | Reason                                                                                                                                                                                                                                  |
| ------------------ | ------ | ------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`     | 65     | 46     | -19 (-29.2%) | every field the plan specifies is declared compactly — 22 pinned packages, the nine scripts, `type: module` and the engines range — and there is nothing further to add, so the unused lines return to the remainder                    |
| `tsconfig.json`    | 45     | 27     | -18 (-40.0%) | the required compiler posture (strict, react-jsx, bundler resolution, verbatimModuleSyntax, erasableSyntaxOnly, noEmit, the `@/*` alias) fits in 27 lines with no option omitted                                                        |
| `.prettierrc.json` | 12     | 8      | -4 (-33.3%)  | six formatting options cover the specified posture, and the JSON format permits no comment                                                                                                                                              |
| `vite.config.ts`   | 60     | 21     | -39 (-65.0%) | provisional: the setup baseline (React plugin, `@` alias, build target and output, preview port) with the three-field header still to come; the owning phase completes it in place and re-records the count                             |
| `vitest.config.ts` | 85     | 50     | -35 (-41.2%) | provisional: the two-project configuration, setup file, globals, `passWithNoTests` and the V8 thresholds are all present, with the header still to come                                                                                 |
| `eslint.config.js` | 55     | 58     | +3 (+5.5%)   | the composition the plan names — ignore block, recommended JavaScript rules, type-checked TypeScript rules, the hooks flat preset, the scoped `languageOptions` and the self-scoped JavaScript block — plus the three-field header and the three `react-hooks` advisory rules raised from warn to error, because the plan's style gate requires lint to pass with no warnings and `package.json`'s plain `eslint .` cannot fail on one; three lines over budget, taken from the remainder |
| `.gitignore`       | 25     | 37     | +12 (+48.0%) | provisional: the setup baseline enumerates every documented ignore group — dependencies, build output, test and coverage output, environment files, tooling caches, logs and editor files; the owning phase completes and re-records it |
| `src/utils/strings.ts` | 350 | 541 | +191 (+54.6%) | the file's specified surface is 22 exported members — the 7 text helpers, the generic `prefixedId` and `sequenceId`, the 10 per-entity generators and the `createSalt` / `createCredentialDigest` / `verifyCredential` trio — each carrying the purpose, parameter, return and throw documentation §0.12.2 requires, on top of the single FNV-1a digest implementation the identifier generators and the credential helpers share and the JSDoc stating the rules its callers rest on (the generators' determinism, the session token's opacity, the demonstration-only credential boundary the seed layer and the transport both call); no line is padding, no required capability was cut, and 541 lines stays well inside the 600-line ceiling, with the overrun taken from the remainder |
| `src/constants/content.ts` | 400 | 596 | +196 (+49.0%) | the file's specified surface is 71 exported members — the copy group for every surface the plan names (identity, page titles, navigation, home, catalogue and product detail, search and filters, cart, checkout, account, admin and reports, empty and error states, accessibility labels) plus the parameterised builders that keep every threshold, money amount and date out of the sentences and the shared pluraliser so no message writes its own plural — each member carrying the documentation §0.12.2 requires; no line is padding, no required capability was cut, and 596 lines stays 4 lines inside the 600-line ceiling, with the overrun taken from the remainder; the free-delivery copy names no delivery service, because which method is free belongs to `SHIPPING_METHODS` and `FREE_SHIPPING_METHOD_ID` in `src/constants/config.ts` and the copy takes the formatted threshold from its caller |
| `src/state/checkoutReducer.ts` | 350 | 538 | +188 (+53.7%) | the specified surface is 19 exported members — the step union with its two ordered constants, the three value groups with their patch types, the state and its factory, the 11-member action union with its creators, the reducer and the five shared step helpers — plus the six private helpers the guards, the patch merge and the touched-field error clearing need, every export carrying the purpose-and-invariant documentation §0.12.2 requires (no cart lines in this state, the single-submission guard, the idempotency key retained across a failure so a retry replays, the demonstration card blanked on success and on reset, and the two terminal ends of the step graph); the alternative was to keep two request-assembly converters the plan places with the caller, which were dropped rather than spending lines on them; four further lines left the file once `src/utils/validation.ts` existed: the private `hasErrors` predicate was replaced by the shared helper that owns that rule, so `canAdvanceFrom` and the two reducer branches read one implementation and nothing user-facing changed; no line is padding and no required capability was cut, so the overrun is taken from the remainder and the file stays 62 lines inside the 600-line ceiling |
| `src/constants/taxonomy.ts` | 330 | 405 | +75 (+22.7%) | the file's specified surface is 11 exported vocabularies — the 5 badge variants, the 20 categories (8 parents in showcase order, 12 children), the 12 brands, the 6 sort keys, the 7 order statuses with their badge variants, the 5 facet definitions carrying 9 option records (five contiguous price bands in minor units, three rating floors, the availability toggle), the 3 report definitions carrying 18 typed report columns, the 3 granularities, the 2 baselines, the promo-kind labels and the 5 countries with their postal patterns — each carrying the purpose-and-consumer documentation §0.12.2 requires; 7 of the 18 report columns cannot fit one line inside Prettier's 100-character width because all six declared `ReportColumn` fields are required, so each wraps to a block, and no line is padding, no required capability was cut and no vocabulary literal was shortened to reach the budget; the overrun is taken from the remainder and the file stays 195 lines inside the 600-line ceiling |
| `src/components/layout/AdminSidebar.tsx` | 290 | 165 | -125 (-43.1%) | the file is a navigation landmark with no behaviour to compute: the `<aside>`, its heading, the `<nav>` it names, the two data-driven `NavLink` items and the storefront return link are its whole surface, and the router applies `aria-current="page"` itself, so the state, the route guard and the repeated markup the plan places elsewhere are deliberately absent; the 125 unused lines return to the remainder and nothing the file's specification requires is missing |
| `src/utils/dates.ts` | 350 | 597 | +247 (+70.6%) | the file's specified surface is 43 exported members — the six parse-and-emit helpers, the six display formatters with their cached `Intl` formatters, the sixteen range-arithmetic helpers, the bucketing group (`bucketKey`, `bucketStart`, `bucketEnd`, `eachBucket`, `bucketCount`), the six range-and-baseline helpers, and the validator with its typed problems and `toFieldErrors` adapter — plus the nine local types the plan's `src/types` modules do not carry and the 20 private helpers the local-time parsing, ISO week maths and bounded bucket walk need, each public member carrying the purpose, parameter, return and assumption documentation §0.12.2 requires; three deliberate reductions kept it inside the ceiling rather than over it: the doc blocks are written at one or two lines each, `sortByIsoAsc`/`sortByIsoDesc` became the single `sortByIso(items, select, direction)` comparator factory the plan allows as their alternative (one ordering implementation, invalid values last either way), and the internal local-date parser is one function whose round trip rejects impossible days; no line is padding and no required capability was cut, so the overrun is taken from the remainder and the file stays 3 lines inside the 600-line ceiling |
| `src/features/home/HeroSection.tsx` | 270 | 197 | -73 (-27.0%) | the section is deliberately small and stays so: the landing hero's eyebrow, the route's single `h1`, the supporting paragraph and the two call-to-action `Link`s, a decorative inline SVG illustration and the trust strip mapped from the three `HOME_COPY` claims, with every coordinate of the drawing carried as path geometry instead of a design value and the class contract stated once in a comment rather than repeated per element; no line is padding and no required behaviour was cut, and the landing page's other bands (featured products, category showcase, promotional banner) belong to sibling files, so the 73 unused lines return to the remainder |
| `src/utils/format.ts` | 380 | 583 | +203 (+53.4%) | the file's specified surface is 25 exported functions plus 2 placeholder constants and 7 exported types — the single rounding rule with its two conversion helpers, the five money formatters (display, compact, the form-field round trip, the parser and the free-shipping remainder), the five number formatters, the five percentage and change formatters, the five domain display values (rating value and its parts, review count, discount, availability) and the two report-cell dispatches — each carrying the purpose, parameter, return and edge-input documentation §0.12.2 requires, on top of the boundary note stating which sibling owns dates, text helpers, CSV escaping and every sentence; the rounding rule, the minor/major factor of 100 and the cached `Intl` formatters each exist once, every import is on the dependency whitelist and every exported member has a named consumer, so no line is padding and no required capability was cut; the overrun is taken from the remainder and the file stays 17 lines inside the 600-line ceiling |
| `src/utils/validation.ts` | 440 | 586 | +146 (+33.2%) | the specified surface is 30 exported functions and guards plus 9 exported types and constants — the 15 primitive field rules with the `isLuhnValid` checksum and the `isRatingValue` guard, the 7 form rules, the 7 error-map helpers and the value shapes the checkout's own generated types require (`CardValidationInput` accepts each expiry half as the number `CardInput` declares or as the digits in text, because `src/state/checkoutReducer.ts` holds what was typed and the card errors must key by exactly `CardInput`'s member names) — each carrying the purpose, parameter, return and assumption documentation §0.12.2 requires, on top of the private helpers the rule collection, blank reading, digit counting and country lookup need and the parameterised messages `src/constants/content.ts` owns; six reductions kept it clear of the 600-line ceiling instead of against it: the documentation was rewritten twice from 778 and then 749 lines to a two-to-four line block per export, the rule-collection and merge bodies are plain loops because the filter and `Object.fromEntries` forms lost their type narrowing, the single-use optional-field wrapper was inlined into `validatePhone`, the postal-code compiler's try/catch fallback was dropped in favour of a loud load-time failure, the `isSupportedCountry` export was removed because the address rule checks the configured set itself, and the boundary run found and fixed one real defect (`isLuhnValid` threw on a non-string, now guarded); no line is padding and no required capability was cut, so the overrun is taken from the remainder and the file stays 14 lines inside the 600-line ceiling |
| `tests/fixtures.ts` | 440 | 599 | +159 (+36.1%) | the file's specified surface is the six determinism constants, 27 entity builders, the 5 envelope builders, 2 composites, the `PricedCartInput` override type and 8 private helpers; its defaults are required field-by-field literals — roughly 220 properties across the builders, every one a `readonly` member of an interface in `src/types`, so none can be dropped — each export carries a one-line JSDoc naming what it builds, its defaults and what an override is for, and the eight dependency modules are imported as namespaces because naming each of the sixty symbols by hand would add about forty import lines. No line is padding and no required capability was cut; 599 lines stays 1 line inside the 600-line ceiling, and the plan maps no second file to split the builders into, so the overrun is taken from the remainder |
| `src/state/hooks.ts` | 480 | 592 | +112 (+23.3%) | the file's specified surface is 18 exported members — the 8 hooks (`useLocalStorage`, `useDebouncedValue`, `usePagination`, `useMediaQuery`, `useBreakpoint`, `useAsync`, `useDocumentTitle`, `useOnClickOutside`) and the 10 types and options records they declare — each carrying the purpose, parameter, return and assumption documentation §0.12.2 requires, on top of the 6 private helpers the dependency comparison, the error narrowing, the storage-key namespacing, the updater detection and the media-query read need; every rule the hooks apply is delegated rather than reimplemented — reads, writes and removals to `src/utils/storage.ts`, the settling burst to `debounce` in `src/utils/async.ts`, the page window and its clamps to `src/utils/collections.ts`, the responsive stops to `BREAKPOINTS` in `src/constants/config.ts` — and the abortable request keys its effect on the caller's deps and never on the fetcher's identity, so one rule keeps one home; no line is padding and no required capability was cut, so the overrun is taken from the remainder and the file stays 8 lines inside the 600-line ceiling |
| `src/styles/base.css` | 270 | 362 | +92 (+34.1%) | the file's specified surface — the reset, the document baseline, the typographic defaults and the visible focus treatment — is delivered as 15 commented sections (box model, block elements, document, typography, links, replaced content, forms, tables, hidden, focus, disabled, the two global utilities, in-page targets and the motion pair); every rule that resets an element is wrapped in `:where()` so its specificity stays 0 and a component or an area sheet overrides it by declaring the property once, with the two deliberate exceptions that must win wherever they are applied (`.sp-visually-hidden` and `.sp-skip-link`); every length and colour is read from a `tokens.css` custom property — all 54 the sheet consumes are declared there — and the two `prefers-reduced-motion` blocks state why the reducing one is the stylesheet's single `!important`; no line is padding and no required capability was cut, so the overrun is taken from the remainder and the file stays 238 lines inside the 600-line ceiling |

Remainder carried forward at Phase 0: **+111 lines** freed for files not yet generated (-19 - 18 - 4 - 39 - 35 - 8 + 12), pending the four provisional counts above, which are replaced with final figures when their phases complete. `README.md` is not listed: the two lines at that path are a setup placeholder rather than the 310-line phase-39 deliverable, so no deviation is recorded against its budget. The repository is otherwise empty of the plan's content, so the remaining 150 counted files have no actual count yet.


## Part 5 — Output contract

Every phase follows this contract exactly; it is reproduced here so a fresh session needs nothing but this file.

**Header comment.** Every generated file opens, before any import or content, with a three-field header carrying `Path` (repository-root-relative, exactly as Part 1 lists it), `Purpose` (the file's one-sentence purpose from the plan) and `Lines` (the file's own final line count, the header included).

| File kind                    | Header form                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `.ts`, `.tsx`                | `/** Path: … Purpose: … Lines: … */`                                                                                                   |
| `.css`                       | `/* Path: … * Purpose: … * Lines: … */`                                                                                                |
| `.md`                        | `<!-- Path: … Purpose: … Lines: … -->`                                                                                                 |
| `.gitignore`, `.env.example` | `# Path: …` then `# Purpose: …` then `# Lines: …`                                                                                      |
| Exempt                       | `package.json`, `tsconfig.json`, `.prettierrc.json` — the format permits no comment; each is still audited by the line count in Part 1 |

`Lines` always equals the file's real length, and the same number is written into Part 1 as the file's actual count. This manifest's own `Lines` field is updated on every rewrite.

**Progress line.** A phase's output ends with exactly one line, in the request's literal form, `N` being the cumulative total from Part 2: `Total lines so far: N / 50000`.

**Continuation token.** Generation stops after that line until the user replies `continue`. No phase begins without it.

**No prose between files.** A phase emits its files' content and then the progress line — no headings, commentary, summaries or previews around them.

**One file, once.** A generated file is never regenerated. A defect is fixed in the file that owns the concern, never by duplicating the logic into the file that found it; this manifest is the only file rewritten across phases, and only as bookkeeping.

**Status vocabulary.** `Pending` — the plan's content is not yet written at that path. `In progress` — the phase that owns the file is writing it. `Done` — the content is complete and its header's `Lines` value matches the file's real length.

**Per-phase update procedure**, performed before the progress line and before this file is committed:

1. Read this manifest and take the next 3 to 5 `Pending` files from Part 1 in tree order, never skipping one.
2. Set each written file's status to `Done` and record its real line count, correcting the `Lines` field in its header to match.
3. Fill that phase's real `Actual lines` in Part 2 and carry the new cumulative total forward.
4. Append any deviation beyond 10% to Part 4 with its reason, and update the remainder; split a concern into a new file rather than exceeding 600 lines.
5. Rewrite this manifest in full, print the single progress line, and stop for `continue`.

**Snapshot at Phase 0.** Every file the plan maps is `Pending` except the three header-exempt toolchain files whose content is already complete, and no generation phase has finished; the ledger's provisional entries are the counts read from the working tree. The closing line below is this snapshot's progress line and the document's last line; a phase's own output ends the same way, with its files' content and then one progress line and nothing after it.

Total lines so far: 0 / 50000
