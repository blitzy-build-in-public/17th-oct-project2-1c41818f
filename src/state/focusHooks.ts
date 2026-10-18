/**
 * Path: src/state/focusHooks.ts
 * Purpose: The one place a refused submission hands the keyboard on: the notice, or the first control at fault
 * Lines: 74
 */

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Where a refused submission puts the keyboard, in one implementation, so every form that can refuse one
 * behaves alike: the checkout's step summary, the review step's refusal, the sign-in and registration screens
 * and the address dialog all call this hook rather than each moving focus their own way.
 *
 * A §0.5.5 split of `src/state/hooks.ts`'s shared-hook concern — that file stood at 599 lines of the 600 the
 * request allows when this behaviour was needed, so the concern was split rather than the ceiling raised, and
 * it holds nothing else: no state, no storage, no request, and no import but React.
 */

/** How a control that a rule has refused marks itself, which is how this hook finds the first one at fault. */
const INVALID_CONTROL_SELECTOR = '[aria-invalid="true"]';

/**
 * The identity a refusal is compared against before the form has refused anything: a value that reports no
 * refusal and that no caller passes for one, so a form which mounts already reporting a refusal hands the
 * keyboard over on that first render as it always did.
 */
const NO_REFUSAL = false;

/**
 * Hands the keyboard to what a refusal is about, once per refusal: the notice where the form has one, and
 * otherwise the first control marked as at fault, and otherwise the form's own region.
 *
 * The trigger is an identity rather than a flag, so a step that refuses the same way twice hands the keyboard
 * over twice. `refusal` is whatever the caller knows changes when a refusal lands — the checkout's count of the
 * advances it has refused, the `ApiError` a refused submission answered with, or plainly whether a form is
 * reporting field errors — and the move happens as that identity changes to a value that reports a refusal. A
 * value that reports none (`false`, `0`, `null`, `undefined`, `""`) leaves the keyboard where it is, and a
 * repeated identity moves nothing, because the shopper is answering that refusal from the moment it appears: a
 * re-render that re-focused the notice would take the keyboard out of the field they had just reached, and a
 * keystroke in a field at fault changes no identity at all. Focusing is also what scrolls the target into view,
 * so a notice that sits above the viewport when a tall form is refused arrives on screen with the keyboard on
 * it.
 *
 * @param refusal - The identity of the refusal in force, or a value reporting none while the form is not
 *   refusing. The move happens as it changes to a reporting value; two refusals that a caller marks with a
 *   fresh identity each move the keyboard again, while a value that stays equal does not move it twice.
 * @param noticeRef - The region that states the refusal, focused when it is in the document. It is the element a
 *   caller wraps its alert in, because the alert itself is rendered by a component and cannot be pointed at.
 * @param formRef - The region the refused fields live in, searched for the first control at fault and focused
 *   itself when no control is marked. Omitted where the notice is the only thing a refusal can be about, and a
 *   refusal with neither a notice in the document nor a region to search moves nothing rather than throwing.
 */
export function useRefusalFocus(
  refusal: unknown,
  noticeRef: RefObject<HTMLElement | null>,
  formRef?: RefObject<HTMLElement | null>,
): void {
  const lastRefusalRef = useRef<unknown>(NO_REFUSAL);

  useEffect(() => {
    const previous = lastRefusalRef.current;
    lastRefusalRef.current = refusal;
    if (!refusal || Object.is(previous, refusal)) return;
    const notice = noticeRef.current;
    if (notice !== null && notice.isConnected) {
      notice.focus();
      return;
    }
    const form = formRef?.current ?? null;
    const atFault = form?.querySelector<HTMLElement>(INVALID_CONTROL_SELECTOR) ?? null;
    (atFault ?? form)?.focus();
  }, [formRef, noticeRef, refusal]);
}
