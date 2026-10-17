/**
 * Path: src/utils/csv.ts
 * Purpose: Serialises rows to CSV with escaping, a row cap and a download trigger
 * Lines: 294
 */

import { CSV_MAX_CELL_LENGTH, CSV_MAX_ROWS } from "@/constants/config";
import type { CsvMatrix, ReportCellValue } from "@/types/analytics";

/** The field separator every export uses: one comma, per RFC 4180, and the fallback for any other. */
export const CSV_DELIMITER = ",";

/** The row ending every export uses: CRLF, per RFC 4180; none follows the last field of a file. */
export const CSV_LINE_ENDING = "\r\n";

/** The type the downloaded blob is declared with, so a browser writes the bytes this module produced. */
const CSV_MIME_TYPE = "text/csv;charset=utf-8";
/** The extension a sanitised file name always ends with, so a reader opens the export as a table. */
const CSV_FILE_EXTENSION = ".csv";
/** The name used when a caller's suggested file name sanitises down to nothing usable. */
const CSV_FILE_NAME_FALLBACK = "salespro-export";
/** The longest file name kept, leaving a filesystem room for the extension. */
const CSV_FILE_NAME_MAX_LENGTH = 120;
/** The quoting character RFC 4180 wraps a field in, and doubles inside such a field. */
const CSV_QUOTE = '"';
/** A quote or either line break: what forces quoting, and what no field separator may hold. */
const CSV_SPECIAL_CHARS = /["\r\n]/;
/** The apostrophe that marks a cell as text: Excel, Sheets and LibreOffice read it, and hide it. */
const CSV_TEXT_GUARD = "'";
/** The first characters a spreadsheet reads as a formula: `=`, `+`, `-`, `@`, a tab and a carriage return. */
const CSV_FORMULA_LEAD = /^[=+\-@\t\r]/;
/** A plain signed decimal, the one formula lead left bare so a spreadsheet still sums the figure. */
const CSV_PLAIN_DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;
/** Path separators and the Windows-illegal characters: each is replaced by a hyphen. */
const CSV_UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|]/g;
/** Control characters, DEL included: replaced by a hyphen; a property escape, not a literal class, as lint requires. */
const CSV_CONTROL_CHARS = /\p{Cc}/gu;

/** The dials a serialisation call may turn; each has a default, so `{}` is a complete request. */
export interface CsvSerialisationOptions {
  /** Field separator; defaults to {@link CSV_DELIMITER}. */
  readonly delimiter?: string;
  /** Row ending; defaults to {@link CSV_LINE_ENDING}; an empty string is refused in its favour. */
  readonly lineEnding?: string;
  /** Most body rows written, the header excluded; defaults to `CSV_MAX_ROWS`. */
  readonly maxRows?: number;
  /** Longest cell text written, in code units; defaults to `CSV_MAX_CELL_LENGTH`. */
  readonly maxCellLength?: number;
  /** A caller's preferred file name, sanitised into {@link CsvBuildResult.fileNameSuggestion}. */
  readonly fileName?: string;
}

/** What {@link enforceRowCap} reports: the rows that survived the cap, and what the cap cost. */
export interface CsvRowCapResult<T> {
  /** The kept rows: the input itself when nothing was dropped, else its first `maxRows` entries. */
  readonly rows: readonly T[];
  readonly droppedRowCount: number;
  readonly truncated: boolean;
}

/** What {@link buildCsvResult} reports: the CSV text an export writes, and how short it fell. */
export interface CsvBuildResult {
  readonly text: string;
  readonly rowCount: number;
  readonly droppedRowCount: number;
  readonly truncated: boolean;
  /** The sanitised file name, present exactly when the caller offered one. */
  readonly fileNameSuggestion?: string;
}

/** Why a download could not start: no document, no `Blob`, no object-URL support, or a refused click. */
export type CsvDownloadFailure =
  | "no-document"
  | "no-blob-support"
  | "no-object-url-support"
  | "download-rejected";

/**
 * What {@link downloadCsv} reports: the sanitised name it used, whether the export started, and on failure
 * why — the browser's message as a developer diagnostic rather than copy for a reader.
 */
export type CsvDownloadResult =
  | { readonly ok: true; readonly fileName: string }
  | {
      readonly ok: false;
      readonly fileName: string;
      readonly reason: CsvDownloadFailure;
      readonly detail?: string;
    };

/** Resolves the separator, refusing a value carrying a quote or a line break no reader could parse. */
function resolveDelimiter(delimiter: string | undefined): string {
  if (delimiter === undefined || delimiter.length === 0) return CSV_DELIMITER;
  return CSV_SPECIAL_CHARS.test(delimiter) ? CSV_DELIMITER : delimiter;
}

/** Resolves the row ending, keeping CRLF when none or an empty string is given. */
function resolveLineEnding(lineEnding: string | undefined): string {
  return lineEnding === undefined || lineEnding.length === 0 ? CSV_LINE_ENDING : lineEnding;
}

/** Resolves one of the two count limits: an absent or non-finite request takes `fallback`. */
function resolveLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

/**
 * Whether a cell's text has to be guarded: its first character is one a spreadsheet reads as the start of a
 * formula, and the whole text is not a plain signed decimal. Pure.
 *
 * @param text - The cell text, already stringified.
 * @returns True when {@link escapeCsvCell} must prefix the text with {@link CSV_TEXT_GUARD}.
 */
function needsFormulaGuard(text: string): boolean {
  return CSV_FORMULA_LEAD.test(text) && !CSV_PLAIN_DECIMAL.test(text);
}

/**
 * Renders one cell as CSV field text: quoted, with its inner quotes doubled, when the value carries the
 * separator, a quote or either line break, and bare when it carries none. Text whose first character is `=`,
 * `+`, `-`, `@`, a tab or a carriage return is prefixed with one apostrophe, which Excel, Sheets and
 * LibreOffice read as "this is text" rather than as a formula, do not display, and leave the reader the
 * characters the table showed; a plain signed decimal is the exception, left unguarded so a negative money
 * or percent figure stays the number a spreadsheet can sum. A `null` or `undefined` cell is empty, and a
 * number is written by locale-independent `String()` with no `Intl` call. Pure.
 *
 * @param value - The cell's raw value.
 * @param delimiter - The field separator; defaults to {@link CSV_DELIMITER}.
 * @returns The field text, unclipped: {@link buildCsvResult} clips each value before it escapes.
 */
export function escapeCsvCell(
  value: ReportCellValue | undefined,
  delimiter = CSV_DELIMITER,
): string {
  const text = value === null || value === undefined ? "" : String(value);
  const separator = resolveDelimiter(delimiter);
  const field = needsFormulaGuard(text) ? CSV_TEXT_GUARD + text : text;
  const mustQuote = field.includes(separator) || CSV_SPECIAL_CHARS.test(field);
  if (!mustQuote) return field;
  return `${CSV_QUOTE}${field.replaceAll(CSV_QUOTE, CSV_QUOTE + CSV_QUOTE)}${CSV_QUOTE}`;
}

/**
 * Clips cell text to `CSV_MAX_CELL_LENGTH` in `src/constants/config.ts`, before the value is escaped:
 * escaped text cut inside a doubled quote is a field no reader can close. The cut counts UTF-16 code units
 * and never splits a surrogate pair, so a clipped emoji is dropped whole. Pure.
 *
 * @param text - The cell text; `maxLength` overrides the limit, and an absent or non-finite one falls back
 * to `CSV_MAX_CELL_LENGTH`; at or below zero yields an empty string.
 * @returns `text` itself when it fits, otherwise its first `maxLength` code units.
 */
export function clipCellText(text: string, maxLength = CSV_MAX_CELL_LENGTH): string {
  const limit = resolveLimit(maxLength, CSV_MAX_CELL_LENGTH);
  if (text.length <= limit) return text;
  if (limit === 0) return "";
  const clipped = text.slice(0, limit);
  const lastCode = clipped.charCodeAt(clipped.length - 1);
  const nextCode = text.charCodeAt(limit);
  const splitsSurrogatePair =
    lastCode >= 0xd800 && lastCode <= 0xdbff && nextCode >= 0xdc00 && nextCode <= 0xdfff;
  return splitsSurrogatePair ? clipped.slice(0, -1) : clipped;
}

/**
 * Applies the export's row cap, `CSV_MAX_ROWS` in `src/constants/config.ts`: the first `maxRows` rows are
 * kept and the excess dropped, and the result reports the loss so a caller can tell the reader their export
 * is short instead of quietly exporting less. Pure.
 *
 * @param rows - The body rows, header excluded, in the order they are to be written.
 * @param maxRows - Most rows kept; an absent or non-finite value falls back to `CSV_MAX_ROWS`, and one at
 * or below zero keeps none.
 * @returns The kept rows — the input itself when nothing was dropped — with the loss reported.
 */
export function enforceRowCap<T>(rows: readonly T[], maxRows = CSV_MAX_ROWS): CsvRowCapResult<T> {
  const cap = resolveLimit(maxRows, CSV_MAX_ROWS);
  if (rows.length <= cap) return { rows, droppedRowCount: 0, truncated: false };
  return { rows: rows.slice(0, cap), droppedRowCount: rows.length - cap, truncated: true };
}

/**
 * Serialises a matrix and reports what the export holds, so a caller can tell the reader that a long report
 * was capped rather than leaving them to notice a short file. Pure: one pass builds the text and the counts
 * together, so the flag a caller reads cannot disagree with the file, and the matrix comes from
 * `reportService.toCsvMatrix`, built from the rows the report table renders.
 *
 * @param matrix - The header row and the body rows, every value already a string.
 * @param options - Separator, row ending, the two limit overrides and the caller's file name.
 * @returns The text, its body-row count, the dropped-row count, the truncation flag and, when a name was
 * offered, the sanitised suggestion for it.
 */
export function buildCsvResult(
  matrix: CsvMatrix,
  options: CsvSerialisationOptions = {},
): CsvBuildResult {
  const delimiter = resolveDelimiter(options.delimiter);
  const cellLimit = resolveLimit(options.maxCellLength, CSV_MAX_CELL_LENGTH);
  const capped = enforceRowCap(matrix.rows, resolveLimit(options.maxRows, CSV_MAX_ROWS));
  const field = (value: string): string => escapeCsvCell(clipCellText(value, cellLimit), delimiter);
  const text = [
    matrix.header.map(field).join(delimiter),
    ...capped.rows.map((row) => row.map(field).join(delimiter)),
  ].join(resolveLineEnding(options.lineEnding));
  const result: CsvBuildResult = {
    text,
    rowCount: capped.rows.length,
    droppedRowCount: capped.droppedRowCount,
    truncated: capped.truncated,
  };
  return options.fileName === undefined
    ? result
    : { ...result, fileNameSuggestion: sanitiseCsvFileName(options.fileName) };
}

/**
 * Serialises a matrix to CSV text: CRLF between lines, no ending after the last field, no byte-order mark.
 * Pure, and the text is the one {@link buildCsvResult} produced from a single pass, so the file a reader
 * opens and the result a caller inspects always agree. Over the row cap the excess rows are dropped, so a
 * caller that has to say so calls {@link buildCsvResult} instead.
 *
 * @param matrix - The header row and the body rows, every value already a string.
 * @param options - Separator, row ending and the two limit overrides.
 * @returns The finished CSV text.
 */
export function serialiseCsv(matrix: CsvMatrix, options: CsvSerialisationOptions = {}): string {
  return buildCsvResult(matrix, options).text;
}

/**
 * Makes a caller's file name safe to hand a browser: path separators, quotes, Windows-illegal and control
 * characters become hyphens, whitespace collapses, leading and trailing dots and hyphens go, and the stem is
 * capped at 120 characters. A name that sanitises to nothing becomes `salespro-export.csv`; only the name is
 * sanitised, so no directory is added and an export cannot be steered at a path the caller did not name.
 *
 * @param fileName - The caller's suggested name, with or without its extension.
 * @returns A non-empty name ending in `.csv`.
 */
export function sanitiseCsvFileName(fileName: string): string {
  const cleaned = fileName
    .replace(CSV_UNSAFE_FILE_NAME_CHARS, "-")
    .replace(CSV_CONTROL_CHARS, "-")
    .replace(/\s+/g, " ")
    .trim();
  const stem = cleaned.replace(/^[.-]+/, "").replace(/[.\s-]+$/, "");
  const base = stem === "" ? CSV_FILE_NAME_FALLBACK : stem.slice(0, CSV_FILE_NAME_MAX_LENGTH);
  // `base` never begins with a full stop, so removing an extension from it cannot empty it.
  const bare = base.toLowerCase().endsWith(CSV_FILE_EXTENSION)
    ? base.slice(0, -CSV_FILE_EXTENSION.length)
    : base;
  return `${bare}${CSV_FILE_EXTENSION}`;
}

/**
 * Starts a download of `text` as a CSV file: the only side effect in this module, and the only reason it is
 * not wholly pure. The browser path builds a blob, gives it an object URL, appends a hidden anchor, clicks
 * it, then removes the anchor and revokes the URL in a `finally` block, so the document keeps no leftover
 * node and no live URL however the call ended. Nothing is thrown: a missing document, `Blob` or object-URL
 * support answers with the matching {@link CsvDownloadFailure} and a refused click with `download-rejected`.
 * Reader-facing wording for a failed export comes from `src/constants/content.ts`, not from here.
 *
 * @param fileName - The suggested file name, sanitised by {@link sanitiseCsvFileName} before use.
 * @param text - The CSV text to write, as {@link serialiseCsv} or {@link buildCsvResult} produced it.
 * @returns Whether the download started and the name it used, or why it could not start.
 */
export function downloadCsv(fileName: string, text: string): CsvDownloadResult {
  const safeFileName = sanitiseCsvFileName(fileName);
  if (typeof document === "undefined" || document.body === null) {
    return { ok: false, fileName: safeFileName, reason: "no-document" };
  }
  if (typeof Blob !== "function") {
    return { ok: false, fileName: safeFileName, reason: "no-blob-support" };
  }
  if (typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
    return { ok: false, fileName: safeFileName, reason: "no-object-url-support" };
  }
  let objectUrl: string | null = null;
  let anchor: HTMLAnchorElement | null = null;
  try {
    objectUrl = URL.createObjectURL(new Blob([text], { type: CSV_MIME_TYPE }));
    anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = safeFileName;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    return { ok: true, fileName: safeFileName };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    return { ok: false, fileName: safeFileName, reason: "download-rejected", detail };
  } finally {
    anchor?.remove();
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
  }
}
