/**
 * Path: src/features/checkout/PaymentForm.tsx
 * Purpose: The payment step: demonstration card entry with Luhn, expiry and CVC validation
 * Lines: 265
 */

import type { ChangeEvent, FormEvent, ReactElement } from "react";

import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import { CHECKOUT_COPY, demoPaymentNote } from "@/constants/checkoutCopy";
import { DEMO_CARD_NUMBERS } from "@/constants/config";
import { COMMON_ACTIONS } from "@/constants/content";
import { useCheckout } from "@/state/CheckoutContext";

/*
 * Class contract. These are the classes the sheets owe the file. `src/styles/commerce.css` owns the
 * payment family: `sp-payment` for the form itself, the step body's own grid and rhythm;
 * `sp-payment__note` for the demonstration notice, which the markup composes with
 * `.sp-alert .sp-alert--info` and which the sheet holds to the prose measure; `sp-payment__card` for
 * the panel the card controls sit on; `sp-payment__row` for the field grid the address form and the
 * confirmation's meta block also use — one column on a phone, two from --breakpoint-md;
 * `sp-step__actions` for the row the step's two controls take, which the sheet swaps at
 * --breakpoint-md so the first control in the DOM sits on the right and the second on the left, while
 * a phone stacks them in that same DOM order; and `sp-summary__note`, the muted caption register the
 * submitting line reads in, which `src/styles/summary-panel.css` owns. Earlier sheets supply the rest,
 * reached through the components rather than written here: `sp-field` with its `__label`, `__control`,
 * `__hint` and `__error` parts, and `sp-input`, all from `src/styles/controls.css`.
 *
 * Two boundaries hold this file to collecting and judging, and neither is stated here: the card's own
 * rules are `src/utils/validation.ts`', run by the checkout context when the step is left, and the
 * demonstration outcome is the seam's answer in `src/lib/mockServer.ts`, which reduces the number to a
 * brand, a last four and a decision before anything is stored. So the panel offers no capability the
 * product does not have — no payment SDK, no wallet, no saved-card store and no method choice, because
 * the flow prices and submits a card and nothing else — and the card as typed lives in the flow's own
 * values for the length of the checkout, reaching no store, no log and no payload.
 */

/** The card members the payment rule keys its complaints by, spelled exactly as the values spell them. */
type CardFieldName = "number" | "nameOnCard" | "expiryMonth" | "expiryYear" | "cvc";

/** One change to those values, in the shape the flow's `updateValues` takes. */
type CardPatch = { readonly payment: Partial<Record<CardFieldName, string>> };

/** One card control as this form binds it. */
interface CardField {
  /** The member of the flow's payment values this control writes and is judged as. */
  readonly member: CardFieldName;
  /** The control's label, from `src/constants/checkoutCopy.ts`. */
  readonly label: string;
  /** A supporting line under the control, where the copy library holds one for it. */
  readonly hint?: string;
  /** The platform's autofill token for what this control holds. */
  readonly autoComplete: string;
  /** The keypad a touch device offers: digits for everything but the holder's name. */
  readonly inputMode: "text" | "numeric";
  /** The platform type the control takes: `password` masks the two members never echoed back. */
  readonly type: "text" | "password";
}

/**
 * The card controls, in the order a card is read: the holder, the number, the expiry's two halves and
 * the security code.
 *
 * The member names are `CardInput`'s, which are also the names `src/utils/validation.ts` keys the card
 * rules by, and that is what makes a complaint the flow holds land on the control that caused it —
 * `updateValues` clears the error of each field its patch names, so binding a control to its member is
 * also what takes that control's message off the screen as it is corrected.
 *
 * The expiry takes two controls because the values hold two halves, which the copy library names rather
 * than a card's notation, and the rule files a fault on the half in fault: a blank half is required on
 * its own control, while a pair that has already passed is the year's. Every control is required — a
 * card is judged by its holder's name, its number, its expiry and its security code together.
 *
 * The number and the security code are masked as they are typed, so neither is echoed back to the
 * screen: the number's own hint promises the data is validated in the browser and then discarded, and
 * only the last four digits survive into the order's payment summary. The holder's name and the
 * expiry's two halves are ordinary text.
 */
const CARD_FIELDS: readonly CardField[] = [
  {
    member: "nameOnCard",
    label: CHECKOUT_COPY.NAME_ON_CARD_LABEL,
    autoComplete: "cc-name",
    inputMode: "text",
    type: "text",
  },
  {
    member: "number",
    label: CHECKOUT_COPY.CARD_NUMBER_LABEL,
    hint: CHECKOUT_COPY.CARD_NUMBER_HINT,
    autoComplete: "cc-number",
    inputMode: "numeric",
    type: "password",
  },
  {
    member: "expiryMonth",
    label: CHECKOUT_COPY.CARD_EXPIRY_MONTH_LABEL,
    autoComplete: "cc-exp-month",
    inputMode: "numeric",
    type: "text",
  },
  {
    member: "expiryYear",
    label: CHECKOUT_COPY.CARD_EXPIRY_YEAR_LABEL,
    autoComplete: "cc-exp-year",
    inputMode: "numeric",
    type: "text",
  },
  {
    member: "cvc",
    label: CHECKOUT_COPY.CARD_SECURITY_CODE_LABEL,
    hint: CHECKOUT_COPY.CARD_SECURITY_CODE_HINT,
    autoComplete: "cc-csc",
    inputMode: "numeric",
    type: "password",
  },
];

/**
 * The label of the control a message from the payment step belongs to, so the step's error summary can name the
 * field each message is about instead of stating the sentence alone.
 * A key none of the five card controls carries — the form-level one the seam files a refused card under, or a
 * field of another step — answers nothing, which is what leaves a refusal that names no control to the panel's
 * own alert rather than reading it twice for one submit.
 *
 * @param field - The key a message is filed under, as the flow's error map holds it.
 * @returns The label of the control carrying that member, or `undefined` for a key this step judges none for.
 */
export function paymentFieldLabel(field: string): string | undefined {
  return CARD_FIELDS.find((spec) => spec.member === field)?.label;
}

/**
 * One card member as the patch the flow writes it with.
 *
 * A patch per member rather than one object holding all five, so a keystroke writes the member that
 * was typed in and no other, and the switch is exhaustive over the members: a member added to the
 * values stops this file compiling until a control is bound to it.
 *
 * @param member - The member the edited control writes.
 * @param value - The text the control now holds.
 * @returns The patch writing that member alone.
 */
function cardPatch(member: CardFieldName, value: string): CardPatch {
  switch (member) {
    case "number":
      return { payment: { number: value } };
    case "nameOnCard":
      return { payment: { nameOnCard: value } };
    case "expiryMonth":
      return { payment: { expiryMonth: value } };
    case "expiryYear":
      return { payment: { expiryYear: value } };
    case "cvc":
      return { payment: { cvc: value } };
  }
}

/*
 * The last attempt's failure is not shown here. A submission begins and ends on the review step, which
 * states the failure the attempt answered with, and the flow withdraws that failure as soon as it moves
 * or a value changes — so a panel here could only report a request that is already settled, and for a
 * refusal that named no field it would report one in the shared error-state wording rather than in
 * anything about the card.
 */

/**
 * The payment step: the demonstration notice, the card's five controls, and the way on.
 *
 * It collects and it does not submit. Two things follow from that, and both are the flow's rather than
 * this file's: the step's fields are judged by the checkout context when the shopper leaves the step,
 * through the card rules `src/utils/validation.ts` exports — so a control is marked from the error map
 * the flow holds and no rule is restated here — and the order itself is placed from the review step,
 * which is why pressing the primary control moves the shopper to the review rather than creating
 * anything.
 *
 * Nothing entered is held here: every control renders the flow's own value and writes every change
 * back through `updateValues`, so a step change, a return to this step and the card's blanking after a
 * placed order all read the same single source.
 *
 * @returns The payment step's form, complete with its notice and its actions.
 */
export function PaymentForm(): ReactElement {
  const { values, errors, isSubmitting, actions } = useCheckout();

  // The sentence that states what this panel is — no payment is processed, and which two numbers produce
  // which outcome — read from the two configured numbers and held nowhere.
  const notice = demoPaymentNote(DEMO_CARD_NUMBERS.APPROVED, DEMO_CARD_NUMBERS.DECLINED);

  /**
   * Writes one card member as it is typed. `updateValues` clears that member's complaint on the way,
   * so a message leaves the screen when the value it was about is corrected rather than when the step
   * is next left.
   */
  const changeCardField =
    (member: CardFieldName) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      actions.updateValues(cardPatch(member, event.target.value));
    };

  return (
    <form
      className="sp-payment"
      noValidate
      onSubmit={(event: FormEvent<HTMLFormElement>): void => {
        // `noValidate` leaves the judging to `src/utils/validation.ts` rather than to the browser, and
        // Enter in any control arrives here, so the keyboard path and the button leave the step the
        // same way: `next` runs the payment rules and moves on only when they pass.
        event.preventDefault();
        actions.next();
      }}
    >
      {/* The demonstration note is visible text and not a placeholder or a tooltip: what is charged, and
          the two numbers whose outcome a reader can reproduce, are on the screen before anything is
          typed. */}
      <Alert className="sp-payment__note" tone="info">
        {notice}
      </Alert>
      <div className="sp-payment__card">
        <div className="sp-payment__row">
          {CARD_FIELDS.map((field) => (
            <Input
              key={field.member}
              autoComplete={field.autoComplete}
              errors={errors}
              hint={field.hint}
              id={field.member}
              inputMode={field.inputMode}
              label={field.label}
              name={field.member}
              onChange={changeCardField(field.member)}
              required
              type={field.type}
              value={values.payment[field.member]}
            />
          ))}
        </div>
      </div>
      {/* An order being placed has frozen the flow wherever it stands: the two controls below refuse
          while it is in flight, and this line is the reason, announced politely rather than left for a
          reader to infer from a greyed control. */}
      {isSubmitting ? (
        <p className="sp-summary__note" role="status">
          {CHECKOUT_COPY.SUBMITTING_LABEL}
        </p>
      ) : null}
      <div className="sp-step__actions">
        <Button disabled={isSubmitting} type="submit" variant="primary">
          {CHECKOUT_COPY.CONTINUE_TO_REVIEW_LABEL}
        </Button>
        <Button
          disabled={isSubmitting}
          onClick={(): void => {
            actions.back();
          }}
          variant="secondary"
        >
          {COMMON_ACTIONS.BACK}
        </Button>
      </div>
    </form>
  );
}
