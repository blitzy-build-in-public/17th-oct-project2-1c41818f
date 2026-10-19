/**
 * Path: tests/unit/state/focusHooks.test.ts
 * Purpose: `useRefusalFocus` in src/state/focusHooks.ts: where a refused submission puts the keyboard, and what a refusal with nowhere to go moves
 * Lines: 182
 *
 * @vitest-environment jsdom
 */

import { render } from "@testing-library/react";
import { createElement, createRef, type ReactElement, type RefObject } from "react";
import { describe, expect, it } from "vitest";

import { useRefusalFocus } from "@/state/focusHooks";

/*
 * Why this file asks for a DOM. What the hook does is move the keyboard, so every case mounts a form and reads
 * `document.activeElement` — the one fact a reader of the screen would notice. Focus needs real elements in the
 * document, which is what the jsdom project provides; the form is built with `createElement` rather than JSX
 * because this file's neighbours under `tests/unit/**` are TypeScript modules.
 *
 * Why the cases exist. A refused submission has to put the keyboard somewhere the shopper can act from: the
 * checkout's step summary, the review step's refusal, the sign-in and registration screens and the address
 * dialog all read this hook. The cases cover each place it can land — the notice, the first control a rule has
 * marked as at fault, the region the fields live in — and the refusal with nowhere to land at all.
 */

/** The message the notice renders, so a case reads it as a region rather than as anonymous text. */
const REFUSAL_NOTICE = "Review the fields the form refused.";

/** A refusal identity, as the consumers pass it: a count of refused advances, or a fresh value per refusal. */
const NO_REFUSAL = 0;
const FIRST_REFUSAL = 1;
const SECOND_REFUSAL = 2;

/** What the form renders, so one parameterised host covers every arm a refusal can take. */
interface RefusingFormProps {
  /** The identity of the refusal in force; a value reporting none leaves the keyboard where it is. */
  readonly refusal: unknown;
  /** The region a refusal is stated in; rendered, and so attached, only where the case asks for a notice. */
  readonly noticeRef: RefObject<HTMLDivElement | null>;
  /** The region the hook searches for a control at fault; omitted where the case has no such region. */
  readonly formRef?: RefObject<HTMLFormElement | null>;
  /** Whether the form states its refusal in a notice of its own. */
  readonly hasNotice?: boolean;
  /** Whether a control the form holds has been marked as the one at fault. */
  readonly hasFaultyControl?: boolean;
}

/**
 * The form a case refuses: a notice region, a form region the hook may search, and two controls, the second of
 * which a case may mark as at fault. Every arm the hook can take is a different prop of this one host, which is
 * why the form is built once and each case varies its props.
 */
function RefusingForm({
  refusal,
  noticeRef,
  formRef,
  hasNotice = false,
  hasFaultyControl = false,
}: RefusingFormProps): ReactElement {
  useRefusalFocus(refusal, noticeRef, formRef);
  return createElement(
    "div",
    null,
    hasNotice
      ? createElement("div", { ref: noticeRef, role: "alert", tabIndex: -1 }, REFUSAL_NOTICE)
      : null,
    // A form region is focusable only where the page makes it so, which is what `tabIndex` stands in for.
    formRef === undefined
      ? null
      : createElement(
          "form",
          { ref: formRef, "aria-label": "Payment", tabIndex: -1 },
          createElement("input", { name: "card", "aria-label": "Card number" }),
          createElement("input", {
            name: "postcode",
            "aria-label": "Postcode",
            "aria-invalid": hasFaultyControl ? "true" : undefined,
          }),
        ),
  );
}

/** A refusal with neither a notice in the document nor a region to search, beside a control it must leave be. */
function RefusalWithoutRegion({
  refusal,
  noticeRef,
}: {
  readonly refusal: unknown;
  readonly noticeRef: RefObject<HTMLDivElement | null>;
}): ReactElement {
  useRefusalFocus(refusal, noticeRef);
  return createElement("input", { name: "elsewhere", "aria-label": "Search" });
}

/** The control a case names; its absence is a mistake in the host rather than an outcome of the hook. */
function controlNamed(name: string): HTMLInputElement {
  const control = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (control === null) throw new Error(`The host renders a control named ${name}.`);
  return control;
}

describe("useRefusalFocus", () => {
  it("hands the keyboard to the notice a refusal is about, once per refusal", () => {
    const noticeRef = createRef<HTMLDivElement>();
    const formRef = createRef<HTMLFormElement>();
    const refusing = (refusal: unknown): ReactElement =>
      createElement(RefusingForm, {
        refusal,
        noticeRef,
        formRef,
        hasNotice: true,
        hasFaultyControl: true,
      });

    const { rerender } = render(refusing(NO_REFUSAL));
    // A form that is refusing nothing takes nothing away from the reader arriving on it.
    expect(document.activeElement).toBe(document.body);

    // A refusal with an identity of its own moves the keyboard to what states it.
    rerender(refusing(FIRST_REFUSAL));
    expect(noticeRef.current).toHaveFocus();

    // The shopper is answering that refusal from the field they reached, so a re-render of the same refusal
    // takes nothing away from them: the identity, not the render, is what moves the keyboard.
    const card = controlNamed("card");
    card.focus();
    rerender(refusing(FIRST_REFUSAL));
    expect(card).toHaveFocus();

    // A second refusal is a second identity, so the keyboard is handed on again.
    rerender(refusing(SECOND_REFUSAL));
    expect(noticeRef.current).toHaveFocus();
  });

  it("hands the keyboard to the first control a refusal marks where the form states no notice", () => {
    const noticeRef = createRef<HTMLDivElement>();
    const formRef = createRef<HTMLFormElement>();
    const refusing = (refusal: unknown): ReactElement =>
      createElement(RefusingForm, {
        refusal,
        noticeRef,
        formRef,
        hasFaultyControl: true,
      });

    const { rerender } = render(refusing(NO_REFUSAL));
    expect(document.activeElement).toBe(document.body);

    // The control the rule marked is where the shopper can do something about the refusal.
    rerender(refusing(FIRST_REFUSAL));
    expect(controlNamed("postcode")).toHaveFocus();
    expect(controlNamed("card")).not.toHaveFocus();
  });

  it("hands the keyboard to the form region itself where nothing in it is marked", () => {
    const noticeRef = createRef<HTMLDivElement>();
    const formRef = createRef<HTMLFormElement>();
    const refusing = (refusal: unknown): ReactElement =>
      createElement(RefusingForm, { refusal, noticeRef, formRef });

    // A refusal a form reports without marking a field — an order-level failure, a summary — still lands here.
    const { rerender } = render(refusing(NO_REFUSAL));
    rerender(refusing(FIRST_REFUSAL));

    expect(formRef.current).toHaveFocus();
  });

  it("moves nothing where the refusal names no notice and the hook has no region to search", () => {
    const noticeRef = createRef<HTMLDivElement>();
    const refusing = (refusal: unknown): ReactElement =>
      createElement(RefusalWithoutRegion, { refusal, noticeRef });

    const { rerender } = render(refusing(NO_REFUSAL));
    const elsewhere = controlNamed("elsewhere");
    elsewhere.focus();

    // A refusal with nowhere to land is answered rather than raised: the keyboard is left where it was.
    rerender(refusing(FIRST_REFUSAL));
    expect(elsewhere).toHaveFocus();
  });
});
