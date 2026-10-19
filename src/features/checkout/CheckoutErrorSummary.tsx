/**
 * Path: src/features/checkout/CheckoutErrorSummary.tsx
 * Purpose: The step's summary of what is wrong: how many fields are at fault and which, each naming its field
 * Lines: 140
 */

import { useRef } from "react";
import type { ReactElement, RefObject } from "react";

import { Alert } from "@/components/ui/Feedback";
import {
  CHECKOUT_COPY,
  errorSummaryCountLabel,
  errorSummaryFieldAnchor,
} from "@/constants/checkoutCopy";
import { useRefusalFocus } from "@/state/focusHooks";
import type { FieldErrors } from "@/types/common";

/*
 * Class contract. `src/styles/commerce.css` owns this register:
 * `sp-step__errors` sets the summary's smaller type and spans the title and the body across the alert's own
 * grid, so the class is what keeps the count, the list and the links inside one full-width column.
 */

/**
 * The mark between a field's name and what is wrong with it: notation rather than wording, the way
 * `ShippingForm.tsx` states the mark between the parts of a delivery row.
 */
const ENTRY_SEPARATOR = " — ";

/** The class the sheet styles this summary through, which the alert itself carries. */
const STEP_ERRORS_CLASS = "sp-step__errors";

/** One message of the summary, with the name of the control it belongs to already resolved. */
interface SummaryEntry {
  /** The key the flow filed the message under, which is also the fragment the entry's link carries. */
  readonly field: string;
  /** The label of the control that carries the field; an entry is not listed unless this resolves. */
  readonly label: string;
  /** What is wrong with the field, worded by `src/utils/validation.ts`. */
  readonly message: string;
}

/** Everything {@link CheckoutErrorSummary} renders from. */
export interface CheckoutErrorSummaryProps {
  /** What is wrong with the flow's values, keyed by the field each message belongs to. */
  readonly errors: FieldErrors;
  /**
   * The label of a field's own control, or `undefined` for a key no control of the step in hand carries. This
   * is what keeps a failure that names no control — the flow files one under the form-level key — out of the
   * summary: nothing in the step could be pointed at for it.
   */
  readonly fieldLabel: (field: string) => string | undefined;
  /**
   * The step's own region, which the messages fall back to when a refusal leaves this summary without a
   * notice to take the keyboard: the first control marked as at fault inside it is the one focused.
   */
  readonly stepRef: RefObject<HTMLElement | null>;
  /**
   * How many advances the flow has refused, read from the checkout's view. It is what a refusal hands the
   * keyboard over for: the count is a fresh identity on every refusal, so a step sent with the same faults a
   * second time takes the keyboard to this summary again, while the error map it lists and the correction of a
   * field change nothing.
   */
  readonly refusals: number;
  /** Puts the keyboard on the control a message names; returns whether it found one. */
  readonly onJumpToField: (field: string) => boolean;
}

/**
 * What is wrong with the step in hand, stated once above it: how many fields need attention, then a named link
 * per field that reaches the control it belongs to.
 *
 * Each entry is composed from the field's own label and its message, so the seven fields a refused shipping
 * step reports read as seven different complaints rather than seven copies of the required-field sentence, and
 * the count states the size of the job before the list states it field by field. A message the step's label
 * resolver does not answer for is not listed at all, which is what leaves a failure naming no control to the
 * one region that reports the submission itself — the payment panel for a refused card, the review step for a
 * refused order — instead of being read twice for one submit.
 *
 * A message is a link to the field it names. The controls carry the id the flow's error map keys them by, so
 * the fragment resolves and the browser can follow it; the click moves the keyboard to the control itself all
 * the same, and follows the fragment only where no control matched.
 *
 * The summary is what a refusal hands the keyboard to, through {@link useRefusalFocus}, which it is told about
 * by the flow's count of refusals: it mounts above the step body, so on a form taller than the viewport an
 * off-screen refusal would otherwise be reported to nobody, and a step sent again with the same faults — the
 * shopper at the top of a long form pressing the advance control a second time — is a refusal as well.
 *
 * @param props - The error map, the step's label resolver, the step's region, the flow's refusal count and the
 *   move the messages perform.
 * @returns The summary, or nothing when no field of this step is at fault.
 */
export function CheckoutErrorSummary({
  errors,
  fieldLabel,
  onJumpToField,
  refusals,
  stepRef,
}: CheckoutErrorSummaryProps): ReactElement | null {
  const noticeRef = useRef<HTMLDivElement | null>(null);

  /** The entries the summary lists: the error map's pairs, each with the label its control answers for. */
  const entries: readonly SummaryEntry[] = Object.entries(errors).flatMap(([field, message]) => {
    const label = fieldLabel(field);
    return label === undefined ? [] : [{ field, label, message }];
  });

  useRefusalFocus(refusals, noticeRef, stepRef);

  if (entries.length === 0) return null;

  return (
    // The wrapper takes the focus and the scroll that a refusal needs, and it carries no class because the
    // sheet styles the alert inside it: an unstyled element is what a focus target should be.
    <div ref={noticeRef} tabIndex={-1}>
      <Alert
        className={STEP_ERRORS_CLASS}
        title={CHECKOUT_COPY.ERROR_SUMMARY_HEADING}
        tone="danger"
      >
        <p>{errorSummaryCountLabel(entries.length)}</p>
        <ul>
          {entries.map((entry) => (
            <li key={entry.field}>
              <a
                href={errorSummaryFieldAnchor(entry.field)}
                onClick={(event) => {
                  if (onJumpToField(entry.field)) event.preventDefault();
                }}
              >
                {`${entry.label}${ENTRY_SEPARATOR}${entry.message}`}
              </a>
            </li>
          ))}
        </ul>
      </Alert>
    </div>
  );
}
