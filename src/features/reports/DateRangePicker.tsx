/**
 * Path: src/features/reports/DateRangePicker.tsx
 * Purpose: The report range control with presets, validation and the persisted last-used range
 * Lines: 426
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";

import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { MAX_REPORT_RANGE_DAYS, STORAGE_KEYS } from "@/constants/config";
import {
  ADMIN_COPY,
  DATE_RANGE_COPY,
  VALIDATION_MESSAGES,
  lastDaysLabel,
  rangeTooLongMessage,
  resolvedRangeLabel,
} from "@/constants/content";
import { BASELINE_OPTIONS } from "@/constants/taxonomy";
import { useLocalStorage } from "@/state/hooks";
import {
  defaultReportRange,
  formatDate,
  formatDateRange,
  fromDateInputValue,
  reportRangePresets,
  resolveBaselineRange,
  toDateInputValue,
  toFieldErrors,
  validateDateRange,
} from "@/utils/dates";
import type { BaselineKind } from "@/types/analytics";
import type { DateRange, FieldErrors } from "@/types/common";
import type { DateRangeErrorCode, DateRangeErrorField, ReportRangePreset } from "@/utils/dates";

/*
 * Class contract. `src/styles/admin-reports.css` is the sole definition site of this control, and no file
 * under `src/features/**` may import a stylesheet — `src/main.tsx` is the only importer of `src/styles/**`
 * — so every class below is consumed by name, and this comment is the list that sheet owes the file:
 * `sp-date-range` for the control, a column the sheet spaces; `sp-date-range__presets` for the row of
 * presets, each of which composes `.sp-btn--secondary` and `.sp-btn--sm` from controls.css and takes the
 * pill shape the sheet names here; `sp-date-range__fields` for the two date fields, one column below the
 * small stop and two above it; `sp-date-range__summary` for a range stated in words, under the applied
 * range and again under the baseline; `sp-date-range__error` for the alert that reports a problem belonging
 * to the range rather than to one of its ends; `sp-date-range__baseline` for the named comparison control
 * and the period it resolves to; and `sp-range-note` for the sentence stating whose days a period boundary
 * falls on.
 *
 * State is carried by attributes and by the primitives, never by a second class: a preset's active state is
 * the `[aria-pressed="true"]` the sheet fills, and the fields, the alert and the select carry the wiring
 * their own components own in `src/components/ui/`.
 */

// The control's own vocabulary --------------------------------------------------------------------

/**
 * The names the two date fields carry: the field keys `toFieldErrors` returns for the ends of a
 * `DateRange`, so each field finds its own message through `errors[name]`. Annotating them with the
 * validator's `DateRangeErrorField` is what makes a change to that vocabulary fail to compile here rather
 * than leave a field reading a key nothing writes.
 */
const FROM_FIELD: DateRangeErrorField = "from";
/** The end date's field name; see {@link FROM_FIELD}. */
const TO_FIELD: DateRangeErrorField = "to";
/**
 * The field key a problem belonging to the range rather than to one of its ends is reported under — the
 * inverted and too-long cases. No field renders it, so it is what the alert below reads.
 */
const RANGE_FIELD: DateRangeErrorField = "range";

/**
 * The wording of every rule `validateDateRange` can break, in the field-independent form the validator's
 * problem codes select: an unparsable end is the shared required wording, the inverted and future cases say
 * what to correct, and the span is stated against the cap `src/constants/config.ts` owns rather than against
 * a number written out here. A rule added to the validator needs its sentence in the copy module and its
 * entry here, which is what keeps the rules free of user-facing words.
 */
const RANGE_MESSAGES: Readonly<Record<DateRangeErrorCode, string>> = {
  "date-invalid": VALIDATION_MESSAGES.REQUIRED,
  "range-inverted": DATE_RANGE_COPY.RANGE_INVERTED_MESSAGE,
  "range-in-future": DATE_RANGE_COPY.RANGE_IN_FUTURE_MESSAGE,
  "range-too-long": rangeTooLongMessage(MAX_REPORT_RANGE_DAYS),
};

/**
 * The baseline a control that is not told which one to show opens on: the first offered choice, the
 * equal-length period before the range. It is read from the options rather than written as a value here, so
 * the closed select always shows one of the choices it offers and the comparison is named from the first
 * render, never left to be inferred.
 */
const DEFAULT_BASELINE: BaselineKind = BASELINE_OPTIONS[0].value;

// Private helpers ---------------------------------------------------------------------------------

/** Joins the classes the control's root carries, leaving out an absent one so no stray space is written. */
function composeClassName(...names: readonly (string | undefined)[]): string {
  return names.filter((name): name is string => name !== undefined && name.trim() !== "").join(" ");
}

/** Whether two ranges cover the same two days: what marks a preset active and what gives Apply work to do. */
function isSameRange(left: DateRange, right: DateRange): boolean {
  return left.from === right.from && left.to === right.to;
}

/**
 * Proves a payload read back from the store is a range before either end is parsed. It checks the shape
 * alone, because a payload that is not one of these is what the storage hook discards in favour of the
 * caller's fallback, and whether the days it names are usable is the range rule's answer, asked by
 * {@link initialRangeOf}, so no rule is restated here.
 */
function isStoredRange(value: unknown): value is DateRange {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly from?: unknown; readonly to?: unknown };
  return typeof candidate.from === "string" && typeof candidate.to === "string";
}

/**
 * The range a mount opens on: the stored one while it still satisfies every range rule, and the trailing
 * window otherwise. A payload that is absent, one written by an older build, and one whose days have since
 * become inverted, future-dated or longer than the cap all resolve to the same window.
 */
function initialRangeOf(stored: DateRange, fallback: DateRange): DateRange {
  return validateDateRange(stored.from, stored.to).valid ? stored : fallback;
}

/**
 * The wording of one preset, chosen by the key `src/utils/dates.ts` derives it under: the month-to-date and
 * year-to-date presets have their own names in the copy module, and every trailing preset is named for the
 * number of days it reaches back, so no preset label is composed here.
 */
function presetLabel(preset: ReportRangePreset): string {
  switch (preset.key) {
    case "this-month":
      return DATE_RANGE_COPY.THIS_MONTH_PRESET_LABEL;
    case "this-year":
      return DATE_RANGE_COPY.THIS_YEAR_PRESET_LABEL;
    default:
      return lastDaysLabel(preset.days);
  }
}

/**
 * The baseline a select reported, or `null` for a value outside the offered choices. The lookup is what
 * keeps a string from reaching the page as a baseline the comparison cannot resolve.
 */
function toBaselineKind(value: string): BaselineKind | null {
  return BASELINE_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/** Everything {@link DateRangePicker} accepts. */
export interface DateRangePickerProps {
  /**
   * The applied range, owned by the page: the days every figure below the control covers. This control never
   * holds it — it reads the two ends it is given and reports the range a reader applies — so the range a
   * preset, a hand-edited pair of dates and a reload each end in is one value in one place.
   */
  readonly value: DateRange;
  /**
   * Reports an applied range: a preset the reader pressed, or a pair of dates the fields hold that the range
   * rules accept. An invalid range is never reported here — it is shown to the reader instead — so a caller
   * may take whatever arrives as the range to run its report over.
   */
  readonly onChange: (range: DateRange) => void;
  /**
   * The named comparison baseline in force, when the view compares periods. Omit it and no baseline control
   * is rendered: a report is run over a range and compares nothing, while a KPI is measured against a period
   * this control names.
   */
  readonly baseline?: BaselineKind;
  /**
   * Reports the baseline the reader chose. The baseline control renders only alongside it, because a select
   * whose choice reaches nothing is a control that does nothing.
   */
  readonly onBaselineChange?: (baseline: BaselineKind) => void;
  /** Renders every control in the disabled state, for a view that is not ready to take a range. */
  readonly isDisabled?: boolean;
  /** Class names added to the control's own, for the layout the page places it in. */
  readonly className?: string;
}

/**
 * The reporting range control: the presets, the two date fields, the range they resolve to in words, and the
 * named comparison baseline a view measuring changes may offer.
 *
 * Two invariants hold it together, and both are about who owns what. **The page owns the applied range.**
 * This control keeps only the draft the fields are being edited into — `null` while they show the applied
 * range — and reports a range only when one is applied, so the range every figure on the screen was computed
 * from exists in exactly one component. **This control owns the stored range**, being the product's only
 * feature-layer consumer of `src/utils/storage.ts`: the key comes from `STORAGE_KEYS` in
 * `src/constants/config.ts`, and both the read and the write go through `useLocalStorage` in
 * `src/state/hooks.ts`, which owns the versioned envelope and the degradation. Nothing here touches
 * `window.localStorage`, no key is written out, and no other file needs to know the range is persisted.
 *
 * That is what the restore is for. On mount the stored range is read once, checked against the range rules —
 * a payload may predate the cap, or the rules that accept it — and reported upward exactly once so the page
 * adopts it, falling back to the trailing window `defaultReportRange()` computes. A mount whose page already
 * holds those same two days reports nothing, so a page is neither re-rendered nor asked to run its report
 * again for a range it already had. Every range applied afterwards is written to the store from the handler
 * that reports it, which is what lets the next visit resume where this one finished: persistence rides the
 * event, rather than an effect mirroring the range into storage on a later render.
 *
 * The range rules are not here. `validateDateRange` in `src/utils/dates.ts` is the single home of "both ends
 * are real dates, `from` is not after `to`, neither end is after today, and the span is within the cap", and
 * this control renders the wording that validator's problem codes select from `src/constants/content.ts`. An
 * inverted range is rejected rather than swapped — unlike the price bounds of a catalogue filter, two dates a
 * reader typed the wrong way round are theirs to correct — and nothing is applied until the rules accept it.
 * A problem one end carries is rendered by that end's field, wired to it by the field's own `aria-invalid`
 * and `aria-describedby`; one belonging to the range as a whole is rendered as an alert, because it belongs
 * to neither end alone.
 *
 * It keeps no URL state, reads no query parameter and fetches nothing: the range is page state plus one
 * stored key, and the view that mounts this control owns the report it runs over the range it is handed.
 *
 * @param props - The applied range, the two callbacks, the optional baseline and the caller's layout.
 * @returns The range control.
 */
export function DateRangePicker({
  value,
  onChange,
  baseline,
  onBaselineChange,
  isDisabled = false,
  className,
}: DateRangePickerProps): ReactElement {
  // The trailing window and the preset list are taken once per mount, each from one reading of the clock:
  // both accept the instant they are computed against, and a control re-deriving "today" on every render
  // would move a preset out from under the reader who just pressed it.
  const fallbackRange = useMemo<DateRange>(() => defaultReportRange(), []);
  const presets = useMemo<readonly ReportRangePreset[]>(() => reportRangePresets(), []);

  // The last-used range, and the only stored entry this file knows. The hook reads the store once, in the
  // initialiser of its first render, so a payload another tab rewrites later cannot rewind it.
  const [storedRange, setStoredRange] = useLocalStorage<DateRange>(
    STORAGE_KEYS.REPORT_RANGE,
    fallbackRange,
    { validate: isStoredRange },
  );

  // The range this mount opened on, frozen for the life of the mount: it is what the page is told to adopt,
  // and a later change to the page's own range must not re-derive it or report it a second time.
  const [restoredRange] = useState<DateRange>(() => initialRangeOf(storedRange, fallbackRange));
  // What the reader is typing, or `null` while the fields show the applied range. This is the only range
  // state the control keeps; the applied range stays the page's.
  const [draft, setDraft] = useState<DateRange | null>(null);
  // Whether a refusal has been shown. A half-typed date is not an error yet, so the fields' messages appear
  // once the reader has asked to apply what they hold, and go again as soon as they change it.
  const [showErrors, setShowErrors] = useState(false);

  // The range the page held at mount, and the two callbacks it handed over, read through refs: a caller
  // passing new functions on every render must not make the restore fire twice, nor make a preset's own
  // handler a new function on every keystroke.
  const pageRangeAtMount = useRef<DateRange>(value);
  const onChangeRef = useRef(onChange);
  const onBaselineChangeRef = useRef(onBaselineChange);

  useEffect(() => {
    onChangeRef.current = onChange;
    onBaselineChangeRef.current = onBaselineChange;
  }, [onBaselineChange, onChange]);

  // The restore: the stored range reaches the page once, and only when it differs from what the page already
  // holds, so a first visit and a resumed one take the same path through this control.
  useEffect(() => {
    if (isSameRange(restoredRange, pageRangeAtMount.current)) return;
    onChangeRef.current(restoredRange);
  }, [restoredRange]);

  // The fields show the draft while it exists and the applied range when it does not, so a range the page
  // changed from outside this control — a reset, or another control taking the range over — is what they
  // read, with no effect mirroring a prop back into state.
  const fieldRange = draft ?? value;
  const validation = useMemo(
    () => validateDateRange(fieldRange.from, fieldRange.to),
    [fieldRange.from, fieldRange.to],
  );
  const fieldErrors = useMemo<FieldErrors>(
    () => (showErrors ? toFieldErrors(validation, RANGE_MESSAGES) : {}),
    [showErrors, validation],
  );
  const rangeError = fieldErrors[RANGE_FIELD];
  /** Whether the fields hold days the applied range does not: the one case the Apply control commits. */
  const hasPendingDraft = draft !== null && !isSameRange(draft, value);

  // Applying a range: the page is told and the store is written from this one handler, so the two cannot
  // disagree about what was last used, and the draft ends here because the fields show the applied range.
  const applyRange = useCallback(
    (next: DateRange): void => {
      setDraft(null);
      setShowErrors(false);
      setStoredRange(next);
      onChangeRef.current(next);
    },
    [setStoredRange],
  );

  // Applying what the fields hold. The rule is the validator's, and a range it refuses is shown to the
  // reader rather than clamped, swapped, or reported upwards as something the page should display.
  const commitDraft = useCallback((): void => {
    if (draft === null) return;
    if (!validation.valid) {
      setShowErrors(true);
      return;
    }
    applyRange(draft);
  }, [applyRange, draft, validation]);

  // One field's half of the draft, keeping the other end as it stands — the draft the reader is working on
  // when there is one, the applied range otherwise, so editing one end never discards the other.
  const changeFrom = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const parsed = fromDateInputValue(event.target.value);
      setDraft((previous) => ({ from: parsed, to: previous?.to ?? value.to }));
      setShowErrors(false);
    },
    [value.to],
  );

  const changeTo = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const parsed = fromDateInputValue(event.target.value);
      setDraft((previous) => ({ from: previous?.from ?? value.from, to: parsed }));
      setShowErrors(false);
    },
    [value.from],
  );

  const changeBaseline = useCallback((event: ChangeEvent<HTMLSelectElement>): void => {
    const kind = toBaselineKind(event.target.value);
    if (kind === null) return;
    onBaselineChangeRef.current?.(kind);
  }, []);

  // One key, one label and one handler per preset, built once: the handler is then stable for the life of
  // the mount, and the row renders in the order `reportRangePresets` declares its presets in.
  const presetActions = useMemo(
    () =>
      presets.map((preset) => ({
        key: preset.key,
        label: presetLabel(preset),
        range: preset.range,
        apply: (): void => {
          applyRange(preset.range);
        },
      })),
    [applyRange, presets],
  );

  const baselineKind = baseline ?? DEFAULT_BASELINE;
  // Resolved for the period the chosen baseline names, so the comparison is a pair of dates on screen and
  // not an adjective: the same two choices are a period-over-period claim and a year-over-year one.
  const comparisonRange = resolveBaselineRange({ from: value.from, to: value.to }, baselineKind);

  return (
    <div
      className={composeClassName("sp-date-range", className)}
      role="group"
      aria-label={DATE_RANGE_COPY.LABEL}
    >
      <div className="sp-date-range__presets">
        {presetActions.map((preset) => (
          <Button
            key={preset.key}
            variant="secondary"
            size="sm"
            className="sp-date-range__preset"
            aria-pressed={isSameRange(preset.range, value)}
            onClick={preset.apply}
            disabled={isDisabled}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <div className="sp-date-range__fields">
        <Input
          type="date"
          name={FROM_FIELD}
          label={DATE_RANGE_COPY.FROM_LABEL}
          value={toDateInputValue(fieldRange.from)}
          onChange={changeFrom}
          errors={fieldErrors}
          isDisabled={isDisabled}
        />
        <Input
          type="date"
          name={TO_FIELD}
          label={DATE_RANGE_COPY.TO_LABEL}
          value={toDateInputValue(fieldRange.to)}
          onChange={changeTo}
          errors={fieldErrors}
          isDisabled={isDisabled}
        />
      </div>
      <Button variant="secondary" onClick={commitDraft} disabled={isDisabled || !hasPendingDraft}>
        {DATE_RANGE_COPY.APPLY_LABEL}
      </Button>
      <p className="sp-date-range__summary" aria-live="polite">
        {formatDateRange(value.from, value.to)}
      </p>
      {rangeError === undefined ? null : (
        <Alert tone="danger" className="sp-date-range__error">
          {rangeError}
        </Alert>
      )}
      {onBaselineChange === undefined ? null : (
        <div className="sp-date-range__baseline">
          <Select
            label={ADMIN_COPY.BASELINE_CONTROL_LABEL}
            value={baselineKind}
            options={BASELINE_OPTIONS}
            onChange={changeBaseline}
            isDisabled={isDisabled}
          />
          <p className="sp-date-range__summary">
            {resolvedRangeLabel(formatDate(comparisonRange.from), formatDate(comparisonRange.to))}
          </p>
        </div>
      )}
      <p className="sp-range-note">{DATE_RANGE_COPY.LOCAL_TIME_NOTE}</p>
    </div>
  );
}
