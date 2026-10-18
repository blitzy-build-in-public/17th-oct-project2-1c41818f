/**
 * Path: src/features/checkout/CheckoutSteps.tsx
 * Purpose: The ordered step indicator with aria-current and per-step headings
 * Lines: 220
 */

import type { ReactElement } from "react";

import { Button } from "@/components/ui/Button";
import { CHECKOUT_COPY, CHECKOUT_STEP_TITLES, stepIndicatorStatusLabel } from "@/constants/content";
import { CHECKOUT_FORM_STEPS, stepIndex } from "@/state/checkoutReducer";
import type { StepIndicatorStatus } from "@/constants/content";
import type { CheckoutStep } from "@/state/checkoutReducer";

/*
 * Class contract. `src/styles/commerce.css` is the sole definition site of this family, and no file
 * under `src/features/**` may import a stylesheet — `src/main.tsx` is the only importer of
 * `src/styles/**` — so every class below is consumed by name, and this comment is the list that sheet
 * owes the file: `sp-steps` for the ordered list; `sp-steps__item` for one step, with
 * `sp-steps__item--current` and `sp-steps__item--done` for the two marked states, the sheet styling
 * the current item by that modifier and by the `[aria-current="true"]` attribute this component sets,
 * exactly as `src/components/layout/PageHeader.tsx` pairs a crumb's modifier with its attribute;
 * `sp-steps__marker` for the disc that holds the position number or the tick, whose size and line
 * weight the sheet sets on its `> svg` child; `sp-steps__label` for the step's name, which the sheet
 * paints on every step at every width, so the row wraps onto a second line rather than losing a name
 * to the viewport; `sp-steps__connector` for the rule between two markers; and `sp-steps__status` for
 * the hidden state wording, a hook the sheet names and leaves to `.sp-visually-hidden` in base.css to
 * hide.
 *
 * The return control borrows controls.css's link variant, because the step contract declares no
 * interactive class of its own: `.sp-btn--link` drops the padding and the minimum height, and
 * `sp-steps__label` supplies the box — the label's typography, its place in the row, and the
 * block padding that puts the control on the touch-target floor its action's only hit area takes
 * — because commerce.css loads after controls.css and wins every property both declare. The
 * variant contributes the transparent hairline border, the pointer and the hover underline that
 * give a returnable step the affordance an inert label would not have.
 */

/**
 * One of the three steps that own a form, derived from the list the reducer declares rather than
 * restated here. The confirmation is not one of them: it is where a placed order lands, not a step a
 * shopper works through.
 */
export type CheckoutFormStep = (typeof CHECKOUT_FORM_STEPS)[number];

/** What names one step, in the two places the checkout shows it. */
export interface CheckoutStepCopy {
  /** The step's short name, from `CHECKOUT_STEP_TITLES` — what the indicator labels it with. */
  readonly title: string;
  /** The step's own heading, which the step shell renders above the step's form. */
  readonly heading: string;
  /** The one-line explanation the step shell renders under that heading. */
  readonly supporting: string;
}

/**
 * The heading and the supporting line of each form step, in the order `CHECKOUT_FORM_STEPS` declares.
 *
 * The table is positional rather than keyed by step name, which is the contract `CHECKOUT_STEP_TITLES`
 * already keeps in `src/constants/content.ts`: the step order has exactly one home — the reducer's
 * list — and a table keyed by the names would be a second one that a reordering could contradict.
 */
const STEP_COPY: readonly { readonly heading: string; readonly supporting: string }[] = [
  {
    heading: CHECKOUT_COPY.SHIPPING_STEP_HEADING,
    supporting: CHECKOUT_COPY.SHIPPING_STEP_SUPPORTING,
  },
  {
    heading: CHECKOUT_COPY.PAYMENT_STEP_HEADING,
    supporting: CHECKOUT_COPY.PAYMENT_STEP_SUPPORTING,
  },
  {
    heading: CHECKOUT_COPY.REVIEW_STEP_HEADING,
    supporting: CHECKOUT_COPY.REVIEW_STEP_SUPPORTING,
  },
];

/**
 * The copy that names `step`, read by the step's position in `CHECKOUT_FORM_STEPS` — the same
 * positional contract `CHECKOUT_STEP_TITLES` follows, so the two tables and the reducer's list move
 * together.
 *
 * The step shell reads this for the heading it renders above the current step's form, so the mapping
 * from a step to its own words exists once in the slice rather than once per file.
 *
 * @param step - One of the three steps that own a form.
 * @returns The step's title, heading and supporting line.
 */
export function checkoutStepCopy(step: CheckoutFormStep): CheckoutStepCopy {
  const position = CHECKOUT_FORM_STEPS.indexOf(step);
  const lines = STEP_COPY[position];
  return {
    title: CHECKOUT_STEP_TITLES[position],
    heading: lines.heading,
    supporting: lines.supporting,
  };
}

/** The classes one step carries, by the state it is drawn in; an upcoming step carries no modifier. */
const ITEM_CLASSES: Readonly<Record<StepIndicatorStatus, string>> = {
  current: "sp-steps__item sp-steps__item--current",
  completed: "sp-steps__item sp-steps__item--done",
  upcoming: "sp-steps__item",
};

/**
 * The mark a completed step carries in place of its position number: a tick whose shape survives a
 * greyscale rendering or a colour-blind reader, so the state never rests on the disc's colour alone.
 *
 * The stroke is `currentColor` and the sheet sizes the element and sets its line weight from
 * `--border-width-thick`, so the glyph is geometry only — no design value is written into this file.
 */
function CompletedTick(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
      <path d="M3.2 8.4 6.3 11.5 12.8 4.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The state one step is drawn in, read from the flow order the reducer declares.
 *
 * The confirmation leaves every form step behind it, which is why a comparison of positions rather
 * than of the two steps answers the completed case: an order placed at the confirmation has all three
 * of the form steps completed and none of them current.
 *
 * @param step - The step being drawn.
 * @param currentStep - The step the shopper is on, from the checkout state.
 * @returns `current` for the step in hand, `completed` for one already visited, `upcoming` otherwise.
 */
function statusOf(step: CheckoutFormStep, currentStep: CheckoutStep): StepIndicatorStatus {
  if (step === currentStep) {
    return "current";
  }
  return stepIndex(step) < stepIndex(currentStep) ? "completed" : "upcoming";
}

/** Everything {@link CheckoutSteps} accepts. */
export interface CheckoutStepsProps {
  /** The step the shopper is on, read from the checkout state by the checkout route. */
  readonly currentStep: CheckoutStep;
  /**
   * Returns to a step already completed, so an earlier step is reachable without retyping what it
   * holds: the checkout keeps every group of values as it was entered and moving back changes no
   * group, so this only names the step. The checkout route owns the transition and passes its own
   * `setStep`; the indicator dispatches nothing and validates nothing. Omit it — or stand on the
   * confirmation, where a placed order leaves the three steps as progress marks with nothing left to
   * return to — and the indicator is the read-only progress display the step shell's own back
   * control complements.
   */
  readonly onStepSelect?: (step: CheckoutFormStep) => void;
}

/**
 * The checkout's step indicator: the three steps that own a form, in the order the reducer declares
 * them, each marked with the state it is in.
 *
 * It is an ordered list, so a screen reader announces the position as it announces the words, and the
 * current step carries `aria-current="true"`. The sheet strips the list markers, so the element
 * carries `role="list"` as well — the pairing `src/styles/base.css` documents as what keeps the list
 * semantics once `list-style` is removed. Every state is conveyed twice over — by the marker's
 * filled disc and tick, and by the hidden status wording `stepIndicatorStatusLabel` words — so
 * nothing here rests on colour, and a greyscale rendering reads the same sequence.
 *
 * It holds no state and runs no effect: the current step arrives as a prop and the completed run is
 * derived from it on every render. Announcing a step change belongs to the step shell in
 * `src/features/checkout/CheckoutPage.tsx`, which owns the new step's heading and moves the keyboard to
 * it — the return control here is unmounted by the very move it asks for, so a hand-off of its own would
 * be a second announcement of one change, onto a marker rather than onto the step's own words. This
 * indicator only requests the move. It reads no context, because the step it needs is one the route
 * already holds, and it never advances or submits the checkout — those are the checkout context's
 * transitions, run from the step's own actions.
 *
 * @param props - The current step and the optional return handler.
 * @returns The ordered step list.
 */
export function CheckoutSteps({ currentStep, onStepSelect }: CheckoutStepsProps): ReactElement {
  const lastStep = CHECKOUT_FORM_STEPS[CHECKOUT_FORM_STEPS.length - 1];

  /**
   * Whether the shopper still has a step to work on. A return control follows the reducer's own
   * rule — a direct move reaches an earlier form step only — so at the confirmation, which is
   * no form step and which `checkout/set-step` will not leave, every step is a progress mark rather
   * than a destination and no control is offered for a move the state machine refuses.
   */
  const isFlowLive = CHECKOUT_FORM_STEPS.some((formStep) => formStep === currentStep);

  return (
    <ol className="sp-steps" role="list">
      {CHECKOUT_FORM_STEPS.map((step, position) => {
        const status = statusOf(step, currentStep);
        const isReturnable = onStepSelect !== undefined && isFlowLive && status === "completed";

        return (
          <li
            key={step}
            className={ITEM_CLASSES[status]}
            aria-current={status === "current" ? "true" : undefined}
          >
            <span className="sp-steps__marker">
              {status === "completed" ? <CompletedTick /> : position + 1}
            </span>
            {isReturnable ? (
              <Button variant="link" className="sp-steps__label" onClick={() => onStepSelect(step)}>
                {CHECKOUT_STEP_TITLES[position]}
              </Button>
            ) : (
              <span className="sp-steps__label">{CHECKOUT_STEP_TITLES[position]}</span>
            )}
            <span className="sp-steps__status sp-visually-hidden">
              {stepIndicatorStatusLabel(status)}
            </span>
            {step === lastStep ? null : <span className="sp-steps__connector" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
