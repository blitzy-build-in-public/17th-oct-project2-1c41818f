/**
 * Path: src/features/admin/KpiCard.tsx
 * Purpose: One KPI with its value, named comparison baseline and change indicator
 * Lines: 239
 */

import { useId } from "react";
import type { ElementType, ReactElement } from "react";

import { Card } from "@/components/ui/Card";
import { ADMIN_COPY, FEEDBACK_COPY } from "@/constants/content";
import { describeBaseline } from "@/lib/analyticsService";
import type { KpiBaseline } from "@/types/analytics";
import {
  formatInteger,
  formatMoneyCompact,
  formatScaledPercent,
  type ChangeDirection,
} from "@/utils/format";
import { changeDirection } from "@/utils/statistics";

/*
 * Class contract. `src/styles/admin-reports.css` is the sole definition site of the KPI family and no file
 * under `src/features/**` may import a stylesheet, so every class below is adopted by name: `sp-kpi-card`
 * is the frame and the grid the card's four parts sit in, `sp-kpi-card__label` names the figure,
 * `sp-kpi-card__value` states it, `sp-kpi-card__delta` carries the change with its `--up`/`--down` colour
 * reinforcement, and `sp-kpi-card__baseline` words the comparison the change is measured against.
 *
 * The frame is composed without the card primitive's header and body regions: the KPI sheet lays the four
 * parts out itself, and those two regions would add a second padding and a rule between them.
 *
 * The delta's arrow is sized in `em` because the sheet declares no rule for it and this file imports none,
 * so the arrow follows the delta's own token-driven font size instead of a pixel width written here.
 *
 * The change itself is written by the formatter that owns scaled percentages and is never assembled here: a
 * sign concatenated in this file would be this file formatting a figure, and a decline already prints its
 * own minus.
 */

/** Whether a KPI's figure is money in minor units or a plain count, which is the one thing that decides
 *  how it renders: a money figure never goes through the count formatter or the other way round. */
type KpiUnit = "money" | "count";

/**
 * The four headline figures the dashboard states, one per KPI card: the period's revenue, its order count,
 * the units those orders sold, and the average value of an order.
 *
 * The name is the identity of the figure rather than its unit or its formatting, because one identity
 * settles all three: it selects the figure's format and the change figure it is measured by, so the change
 * a card shows cannot belong to a different KPI than the one it states. It is deliberately not
 * `src/types/analytics.ts`'s `Metric`, which ranks products by revenue or units in the top-products
 * ranking and answers a different question.
 */
export type KpiKind = "revenue" | "orders" | "units" | "average-order-value";

/** The change figure of a comparison that one KPI is measured by, named by the field `KpiBaseline` carries
 *  it in — the comparison itself supplies the four figures and the card reads the one belonging to it. */
type KpiChangeField =
  | "revenueChangePercent"
  | "ordersChangePercent"
  | "unitsChangePercent"
  | "averageOrderValueChangePercent";

/** What one KPI needs to be stated: the name it goes by, how its figure renders, and which change figure
 *  measures it. */
interface KpiKindSpec {
  readonly label: string;
  readonly unit: KpiUnit;
  readonly changeField: KpiChangeField;
}

/**
 * The catalogue of KPIs, one entry per figure the dashboard states, and the single place a figure is tied
 * to its name and to the comparison that measures it.
 *
 * It reads the summary's figures rather than producing any: revenue and average order value are minor units
 * rendered by `src/utils/format.ts`, orders and units are plain counts, each name is the dashboard's own
 * copy from `src/constants/content.ts`, and each KPI is measured by the comparison's own change figure.
 */
const KPI_KINDS: Readonly<Record<KpiKind, KpiKindSpec>> = {
  revenue: {
    label: ADMIN_COPY.KPI_REVENUE_LABEL,
    unit: "money",
    changeField: "revenueChangePercent",
  },
  orders: {
    label: ADMIN_COPY.KPI_ORDERS_LABEL,
    unit: "count",
    changeField: "ordersChangePercent",
  },
  units: { label: ADMIN_COPY.KPI_UNITS_LABEL, unit: "count", changeField: "unitsChangePercent" },
  "average-order-value": {
    label: ADMIN_COPY.KPI_AVERAGE_ORDER_VALUE_LABEL,
    unit: "money",
    changeField: "averageOrderValueChangePercent",
  },
};

/** Every class this file puts on the page, written once so a rename is one edit. */
const CLASSES = {
  card: "sp-kpi-card",
  label: "sp-kpi-card__label",
  value: "sp-kpi-card__value",
  delta: "sp-kpi-card__delta",
  deltaUp: "sp-kpi-card__delta--up",
  deltaDown: "sp-kpi-card__delta--down",
  baseline: "sp-kpi-card__baseline",
} as const;

/** The heading element each level the caller may ask for renders as, so the label joins the outline at the
 *  level its page needs rather than at one this component picks. */
const HEADING_ELEMENTS: Readonly<Record<2 | 3 | 4, ElementType>> = { 2: "h2", 3: "h3", 4: "h4" };

/**
 * The colour reinforcement each direction adds to the change line, as the sheet's two modifiers.
 *
 * A flat comparison and one that could not be made add none, so neither is coloured: the direction reaches
 * the reader through the arrow and the signed change text, and the colour only repeats what they say.
 */
const DIRECTION_CLASSES: Readonly<Record<ChangeDirection, string>> = {
  up: CLASSES.deltaUp,
  down: CLASSES.deltaDown,
  flat: "",
  unknown: "",
};

/** The filled arrow each known direction is drawn with, in a 16-unit square. `unknown` has no entry: a
 *  comparison that could not be made has no direction, and a shape for it would claim one. */
const GLYPH_PATHS: Readonly<Record<"up" | "down" | "flat", string>> = {
  up: "M8 3.5 L12.5 8.5 H9.5 V12.5 H6.5 V8.5 H3.5 Z",
  down: "M8 12.5 L3.5 7.5 H6.5 V3.5 H9.5 V7.5 H12.5 Z",
  flat: "M3.5 7.25 H12.5 V8.75 H3.5 Z",
};

/** The change line's classes for one direction: the line's own, then the modifier when it has one. */
function deltaClassName(direction: ChangeDirection): string {
  const modifier = DIRECTION_CLASSES[direction];
  return modifier === "" ? CLASSES.delta : `${CLASSES.delta} ${modifier}`;
}

/**
 * The arrow drawn beside a KPI's change, one per direction the comparison can report.
 *
 * It is hidden from assistive technology because the change text beside it states the same difference: the
 * percentage carries its magnitude and keeps the minus a decline is written with, so the arrow is the
 * sighted reader's shortcut to that difference rather than a second, exclusive reading of it. Its paint
 * comes from the change line's own colour through `currentColor`, so no colour is written here.
 *
 * @param props - The direction the comparison moved, or could not be established.
 * @returns The arrow, or `null` when there is no direction to draw.
 */
function DeltaGlyph({ direction }: { readonly direction: ChangeDirection }): ReactElement | null {
  if (direction === "unknown") return null;
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="1em" height="1em">
      <path d={GLYPH_PATHS[direction]} fill="currentColor" />
    </svg>
  );
}

/** Everything {@link KpiCard} accepts. */
export interface KpiCardProps {
  /** Which headline figure the card states, which settles both its format and the change that measures it. */
  readonly kpi: KpiKind;
  /** The card's name, rendered as the card's heading. The KPI's own label from the dashboard copy is used
   *  when it is omitted, so the four names have one home and a caller states one only to differ from it. */
  readonly label?: string;
  /** The period's figure as the summary reports it: integer minor units for a money KPI such as revenue or
   *  average order value, and a plain count for orders or units. It is rendered, never recomputed. */
  readonly value: number;
  /** The comparison the change is measured against, taken from the summary as it stands: the card names it
   *  from the comparison's own kind and dates, and reads the change figure belonging to its KPI. */
  readonly baseline: KpiBaseline;
  /** The heading level the label renders at, defaulted to 3 so four cards inside one section keep the
   *  document outline in order. The size is the card label's at every level. */
  readonly headingLevel?: 2 | 3 | 4;
  /** Whether the page is still loading the range's summary, which states the card as busy and holds back
   *  the change and its comparison until there are figures to compare. Defaults to false. */
  readonly isLoading?: boolean;
}

/**
 * One headline figure of the sales dashboard: its name, its value, how it moved against a named comparison,
 * and the wording of that comparison.
 *
 * It is a display surface and nothing more. The value arrives already aggregated by
 * `src/lib/analyticsService.ts` and is formatted here only through `src/utils/format.ts`, so money stays in
 * integer minor units all the way to this component and is never divided here; the change is the figure
 * `KpiSummary.baseline` carries and its direction is classified by `src/utils/statistics.ts`; and the
 * comparison is named by `describeBaseline`, so a reader is told what the change is measured against
 * instead of being left to assume. A comparison whose baseline is zero states the documented flat result
 * and one that reports no percentage shows the placeholder, so no card renders `NaN`.
 *
 * The label carries the section's name through `aria-labelledby`; the change writes its own magnitude and
 * the minus a decline keeps, the arrow beside it states which way the figure moved, and the two colour
 * modifiers only reinforce what the pair already says, so nothing about the card depends on colour.
 *
 * @param props - The KPI, its label and figure, the comparison, the heading level and the loading flag.
 * @returns The KPI card as a labelled section.
 */
export function KpiCard({
  kpi,
  label,
  value,
  baseline,
  headingLevel = 3,
  isLoading = false,
}: KpiCardProps): ReactElement {
  const labelId = useId();
  const spec = KPI_KINDS[kpi];
  const Heading = HEADING_ELEMENTS[headingLevel];
  const change = baseline[spec.changeField];
  const direction = changeDirection(change);
  const valueText = spec.unit === "money" ? formatMoneyCompact(value) : formatInteger(value);
  const heading = label ?? spec.label;

  return (
    <Card
      as="section"
      className={CLASSES.card}
      aria-labelledby={labelId}
      {...(isLoading ? { "aria-busy": true } : {})}
    >
      <Heading id={labelId} className={CLASSES.label}>
        {heading}
      </Heading>
      <p className={CLASSES.value}>{isLoading ? FEEDBACK_COPY.LOADING : valueText}</p>
      {isLoading ? null : (
        <>
          <p className={deltaClassName(direction)}>
            <DeltaGlyph direction={direction} />
            {formatScaledPercent(change)}
          </p>
          <p className={CLASSES.baseline}>{describeBaseline(baseline.kind, baseline)}</p>
        </>
      )}
    </Card>
  );
}
