/**
 * Path: src/components/ui/DateRangeControl.tsx
 * Purpose: The range control both administrator surfaces render: presets, the two date fields, the range rules' wording and the named comparison
 * Lines: 395
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";

import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { MAX_REPORT_RANGE_DAYS } from "@/constants/config";
import { VALIDATION_MESSAGES } from "@/constants/content";
import {
  ADMIN_COPY,
  DATE_RANGE_COPY,
  lastDaysLabel,
  rangeTooLongMessage,
  resolvedRangeLabel,
} from "@/constants/content-reports";
import { BASELINE_OPTIONS } from "@/constants/taxonomy";
import type { BaselineKind } from "@/types/analytics";
import type { DateRange, FieldErrors } from "@/types/common";
import {
  formatDate,
  formatDateRange,
  fromDateInputValue,
  reportRangePresets,
  resolveBaselineRange,
  toDateInputValue,
  toFieldErrors,
  validateDateRange,
} from "@/utils/dates";
import type { DateRangeErrorCode, DateRangeErrorField, ReportRangePreset } from "@/utils/dates";

/*
 * Class contract. `src/styles/admin-reports.css` is the sole definition site of this control. No stylesheet is
 * imported here, so every class below is consumed by name, and this comment is the list that sheet owes the control:
 * `sp-date-range` for the control, a column the sheet spaces; `sp-date-range__presets` for the row of
 * presets, each of which composes `.sp-btn--secondary` and `.sp-btn--sm` from controls.css and takes the pill
 * shape the sheet names here; `sp-date-range__fields` for the two date fields, one column below the small stop
 * and two above it; `sp-date-range__summary` for a range stated in words, under the applied range and again
 * under the baseline; `sp-date-range__error` for the alert that reports a problem belonging to the range rather
 * than to one of its ends; `sp-date-range__baseline` for the named comparison control and the period it
 * resolves to; and `sp-range-note` for the sentence stating whose days a period boundary falls on.
 *
 * State is carried by attributes and by the primitives, never by a second class: a preset's active state is the
 * `[aria-pressed="true"]` the sheet fills, and the fields, the alert and the select carry the wiring their own
 * components own in this directory.
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
 * entry here, which is what keeps the rules free of user-facing words. One map serves both surfaces this
 * control is rendered on, so a range is worded the same way whichever screen reports it.
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
 * keeps a string from reaching a page as a baseline the comparison cannot resolve.
 */
function toBaselineKind(value: string): BaselineKind | null {
  return BASELINE_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/** Everything {@link DateRangeControl} accepts. */
export interface DateRangeControlProps {
  /**
   * The applied range, owned by the surface that renders the control: the days every figure below it covers.
   * The control never holds it — it reads the two ends it is given and reports the range a reader applies —
   * so the range a preset, a hand-edited pair of dates and a reload each end in is one value in one place.
   */
  readonly value: DateRange;
  /**
   * Reports an applied range: a preset the reader pressed, or a pair of dates the fields hold that the range
   * rules accept. An invalid range is never reported here — it is shown to the reader instead — so a caller
   * may take whatever arrives as the range to run its reads over. It also carries the mount report of
   * {@link DateRangeControlProps.restoredRange}, which is a range those same rules already accepted.
   */
  readonly onChange: (range: DateRange) => void;
  /**
   * The named comparison baseline in force, when the surface compares periods. Omit it and the select shows
   * the first offered choice while nothing changes: a report is run over a range and compares nothing, while
   * a KPI is measured against a period this control names from {@link DateRangeControlProps.onBaselineChange}.
   */
  readonly baseline?: BaselineKind;
  /**
   * Reports the baseline the reader chose. The baseline block renders only alongside it, because a select
   * whose choice reaches nothing is a control that does nothing.
   */
  readonly onBaselineChange?: (baseline: BaselineKind) => void;
  /** Renders every control in the disabled state, for a surface that is not ready to take a range. */
  readonly isDisabled?: boolean;
  /** Class names added to the control's own, for the layout the caller places it in. */
  readonly className?: string;
  /**
   * The range this mount opens on, reported upward once when it differs from the range in force, so a surface
   * resuming from a stored range adopts it. Omitted, the control opens on the range it is given and reports
   * nothing: a surface whose range is its own live state has nothing to restore from.
   */
  readonly restoredRange?: DateRange;
}

/**
 * The reporting range control: the presets, the two date fields, the range they resolve to in words, and the
 * named comparison baseline a surface measuring changes may offer.
 *
 * It lives in the shared presentation layer because two surfaces render it — the administrator dashboard and
 * the reports picker — and one range rule belongs in one module: the preset vocabulary, the draft the fields
 * are edited into, the range rules' wording and the baseline comparison are written once here and promoted,
 * rather than copied into each feature slice. Neither slice imports the other, and each keeps only what is
 * its own: the reports picker adds the persisted last-used range, and the dashboard adds the readings it takes
 * over whatever range this control reports.
 *
 * Two invariants hold it together, and both are about who owns what. **The caller owns the applied range.**
 * The control keeps only the draft the fields are being edited into — `null` while they show the applied range
 * — and reports a range only when one is applied, so the range every figure on the screen was computed from
 * exists in exactly one component. **The baseline affordance is the caller's to give.** The comparison block
 * renders only when {@link DateRangeControlProps.onBaselineChange} is passed, so a surface that compares
 * nothing renders no select, and a surface that compares carries the choice upward.
 *
 * The range rules are not here either. `validateDateRange` in `src/utils/dates.ts` is the single home of "both
 * ends are real dates, `from` is not after `to`, neither end is after today, and the span is within the cap",
 * and this control renders the wording that validator's problem codes select from `src/constants/content.ts`.
 * An inverted range is rejected rather than swapped — unlike the price bounds of a catalogue filter, two dates
 * a reader typed the wrong way round are theirs to correct — and nothing is applied until the rules accept it.
 * A problem one end carries is rendered by that end's field, wired to it by the field's own `aria-invalid` and
 * `aria-describedby`; one belonging to the range as a whole is rendered as an alert, because it belongs to
 * neither end alone.
 *
 * It keeps no stored state, keeps no URL state, reads no query parameter and fetches nothing: the applied
 * range and the baseline are the caller's, and the caller owns the reads it runs over them.
 *
 * @param props - The applied range, the two callbacks, the optional baseline, the caller's layout and the
 *   range a resuming surface opens on.
 * @returns The range control.
 */
export function DateRangeControl({
  value,
  onChange,
  baseline,
  onBaselineChange,
  isDisabled = false,
  className,
  restoredRange,
}: DateRangeControlProps): ReactElement {
  // The preset list is taken once per mount, from one reading of the clock: a control re-deriving "today" on
  // every render would move a preset out from under the reader who just pressed it.
  const presets = useMemo<readonly ReportRangePreset[]>(() => reportRangePresets(), []);

  // What the reader is typing, or `null` while the fields show the applied range. This is the only range state
  // the control keeps; the applied range stays the caller's.
  const [draft, setDraft] = useState<DateRange | null>(null);
  // Whether a refusal has been shown. A half-typed date is not an error yet, so the fields' messages appear
  // once the reader has asked to apply what they hold, and go again as soon as they change it.
  const [showErrors, setShowErrors] = useState(false);

  // The range the caller held at mount, and the two callbacks it handed over, read through refs: a caller
  // passing new functions on every render must not make the restore fire twice, nor make a preset's own
  // handler a new function on every keystroke.
  const rangeAtMount = useRef<DateRange>(value);
  const onChangeRef = useRef(onChange);
  const onBaselineChangeRef = useRef(onBaselineChange);

  useEffect(() => {
    onChangeRef.current = onChange;
    onBaselineChangeRef.current = onBaselineChange;
  }, [onBaselineChange, onChange]);

  // The restore: the range a resuming surface opened on reaches it once, and only when it differs from the
  // range that surface already holds, so a first visit and a resumed one take the same path through this
  // control. A control given no such range reports nothing here.
  useEffect(() => {
    if (restoredRange === undefined) return;
    if (isSameRange(restoredRange, rangeAtMount.current)) return;
    onChangeRef.current(restoredRange);
  }, [restoredRange]);

  // The fields show the draft while it exists and the applied range when it does not, so a range the caller
  // changed from outside this control — a reset, or another control taking the range over — is what they read,
  // with no effect mirroring a prop back into state.
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

  // Applying a range: the caller is told from this one handler, and the draft ends here because the fields
  // then show the applied range. The handler is stable, so a preset's own handler is built once.
  const applyRange = useCallback((next: DateRange): void => {
    setDraft(null);
    setShowErrors(false);
    onChangeRef.current(next);
  }, []);

  /** Applies what the fields hold, or shows the rule it broke: the validator owns the rule, so a refused pair
   *  never reaches the caller as a range to display. */
  const commitDraft = useCallback((): void => {
    if (draft === null) return;
    if (!validation.valid) {
      setShowErrors(true);
      return;
    }
    applyRange(draft);
  }, [applyRange, draft, validation]);

  // One field's half of the draft, keeping the other end as it stands — the draft the reader is working on when
  // there is one, the applied range otherwise, so editing one end never discards the other.
  const changeFrom = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const parsed = fromDateInputValue(event.target.value);
      setDraft((previous) => ({ from: parsed, to: previous?.to ?? value.to }));
      setShowErrors(false);
    },
    [value.to],
  );

  /** The end date's half of the draft; see {@link changeFrom}. */
  const changeTo = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const parsed = fromDateInputValue(event.target.value);
      setDraft((previous) => ({ from: previous?.from ?? value.from, to: parsed }));
      setShowErrors(false);
    },
    [value.from],
  );

  /** Reports the comparison the reader chose, ignoring a value outside the offered choices. */
  const changeBaseline = useCallback((event: ChangeEvent<HTMLSelectElement>): void => {
    const kind = toBaselineKind(event.target.value);
    if (kind === null) return;
    onBaselineChangeRef.current?.(kind);
  }, []);

  // One key, one label and one handler per preset, built once: the handler is then stable for the life of the
  // mount, and the row renders in the order `reportRangePresets` declares its presets in.
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
  // Resolved for the period the chosen baseline names, so the comparison is a pair of dates on screen and not
  // an adjective: the same two choices are a period-over-period claim and a year-over-year one.
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
