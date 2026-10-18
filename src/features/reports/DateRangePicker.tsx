/**
 * Path: src/features/reports/DateRangePicker.tsx
 * Purpose: The report range control with presets, validation and the persisted last-used range
 * Lines: 154
 */

import { useCallback, useMemo, useState } from "react";
import type { ReactElement } from "react";

import { DateRangeControl } from "@/components/ui/DateRangeControl";
import { STORAGE_KEYS } from "@/constants/config";
import { useLocalStorage } from "@/state/hooks";
import { defaultReportRange, validateDateRange } from "@/utils/dates";
import type { BaselineKind } from "@/types/analytics";
import type { DateRange } from "@/types/common";

/*
 * Class contract. This file renders no class of its own: the control's classes — `sp-date-range` for the
 * control, its `__presets`, `__fields`, `__summary`, `__error` and `__baseline` regions, and `sp-range-note`
 * for the sentence beneath them — and their single definition site, `src/styles/admin-reports.css`, are
 * documented in the shared control this slice adopts, `src/components/ui/DateRangeControl.tsx`. A `className`
 * a caller passes is forwarded to that control's root, which composes it with the control's own.
 */

// The picker's own concern ------------------------------------------------------------------------

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
   * may take whatever arrives as the range to run its report over. It also carries the mount report of the
   * range stored from the last visit, a pair the same rules already accepted.
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
 * The reports slice's range control: the shared range control, told which range this mount resumes from.
 *
 * The rendering, the preset vocabulary, the draft the fields are edited into, the wording of the range rules
 * and the named comparison all belong to `src/components/ui/DateRangeControl.tsx`, promoted there so the
 * dashboard and this picker cannot drift apart on what a range means. What is left here is persistence, and it
 * is this slice's own: **this file owns the stored range**, being the product's only feature-layer consumer of
 * `src/utils/storage.ts` — the key comes from `STORAGE_KEYS` in `src/constants/config.ts`, and both the read
 * and the write go through `useLocalStorage` in `src/state/hooks.ts`, which owns the versioned envelope and the
 * degradation. Nothing here touches `window.localStorage`, no key is written out, and no other file needs to
 * know the range is persisted.
 *
 * That is what the restore is for. On mount the stored range is read once, checked against the range rules —
 * a payload may predate the cap, or the rules that accept it — and handed to the shared control as the range
 * this mount opens on, which reports it upward exactly once so the page adopts it, falling back to the trailing
 * window `defaultReportRange()` computes. A mount whose page already holds those same two days reports nothing,
 * so a page is neither re-rendered nor asked to run its report again for a range it already had. Every range
 * applied afterwards is written to the store from the one handler that reports it upward, which is what lets
 * the next visit resume where this one finished: persistence rides the event, rather than an effect mirroring
 * the range into storage on a later render.
 *
 * It keeps no URL state, reads no query parameter and fetches nothing: the range is page state plus one stored
 * key, and the view that mounts this control owns the report it runs over the range it is handed.
 *
 * @param props - The applied range, the two callbacks, the optional baseline and the caller's layout.
 * @returns The range control, over the range last used on this slice.
 */
export function DateRangePicker({
  value,
  onChange,
  baseline,
  onBaselineChange,
  isDisabled = false,
  className,
}: DateRangePickerProps): ReactElement {
  // The trailing window is taken once per mount, from one reading of the clock: it is what an unusable stored
  // payload falls back to, and a control re-deriving "today" on every render would move it under the reader.
  const fallbackRange = useMemo<DateRange>(() => defaultReportRange(), []);

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

  // The fields, the range they resolve to in words, the rules' wording and the baseline comparison are the
  // shared control's; this file adds the store to what it reports. A range the control resolved is the range
  // now in force, and on the restore path the payload written is the one just read, so the write is
  // content-identical and the store and the page cannot disagree about what was last used.
  const changeRange = useCallback(
    (next: DateRange): void => {
      setStoredRange(next);
      onChange(next);
    },
    [onChange, setStoredRange],
  );

  return (
    <DateRangeControl
      value={value}
      onChange={changeRange}
      baseline={baseline}
      onBaselineChange={onBaselineChange}
      isDisabled={isDisabled}
      className={className}
      restoredRange={restoredRange}
    />
  );
}
