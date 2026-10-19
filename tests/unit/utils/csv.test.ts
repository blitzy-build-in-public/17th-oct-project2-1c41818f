/**
 * Path: tests/unit/utils/csv.test.ts
 * Purpose: CSV serialisation, escaping, clipping, row capping and the download trigger, at and over every documented boundary
 * Lines: 525
 */

// The unit project runs in node, so this file asks for jsdom: `downloadCsv`'s one side effect needs
// a document, and tests/setup.ts installs its Blob, object-URL and anchor-click stubs only where a
// window exists. The suite reads those documented stubs rather than standing up a second set.
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { CSV_MAX_CELL_LENGTH, CSV_MAX_ROWS } from "@/constants/config";
import type { CsvMatrix } from "@/types/analytics";
import * as csv from "@/utils/csv";

// Test data -------------------------------------------------------------------------------------

/**
 * A three-column matrix in the shape `reportService.toCsvMatrix` produces: the header and two body
 * rows, every value already the text the report table rendered. One cell carries the field
 * separator, so the default serialisation has to quote it.
 */
const SALES_MATRIX: CsvMatrix = {
  header: ["Region", "Units", "Revenue"],
  rows: [
    ["North", "12", "1,250.00"],
    ["South", "3", "84.50"],
  ],
};

/** What the module writes for {@link SALES_MATRIX} under its documented defaults. */
const SALES_MATRIX_TEXT = ["Region,Units,Revenue", 'North,12,"1,250.00"', "South,3,84.50"].join(
  csv.CSV_LINE_ENDING,
);

/** The same matrix under a semicolon separator, where no cell carries the separator any more. */
const SEMICOLON_MATRIX_TEXT = ["Region;Units;Revenue", "North;12;1,250.00", "South;3;84.50"].join(
  csv.CSV_LINE_ENDING,
);

/** The same matrix under a bare line feed, the row ending a caller may ask for. */
const LINE_FEED_MATRIX_TEXT = ["Region,Units,Revenue", 'North,12,"1,250.00"', "South,3,84.50"].join(
  "\n",
);

/** The same matrix cut to its first body row, what a cap of one leaves behind. */
const CAPPED_MATRIX_TEXT = ["Region,Units,Revenue", 'North,12,"1,250.00"'].join(
  csv.CSV_LINE_ENDING,
);

/** A matrix with no body rows: a header alone is still a file. */
const HEADER_ONLY_MATRIX: CsvMatrix = { header: ["Region"], rows: [] };

/** Five row keys, enough for a cap to bite and for the loss to be counted. */
const CAP_ROWS: readonly string[] = ["r1", "r2", "r3", "r4", "r5"];

/** Two rows more than the configured cap allows, so the fallback is observable as a drop. */
const OVER_CAP_ROWS: readonly string[] = Array.from(
  { length: CSV_MAX_ROWS + 2 },
  (_unused, index) => `row-${index}`,
);

/** More characters than a cell may carry, so an absent cell limit is observable as a cut. */
const OVERLONG_TEXT = "x".repeat(CSV_MAX_CELL_LENGTH + 5);

/** The surrogate pair no cut may separate, and the text that carries it mid-string. */
const GRINNING_FACE = "😀";
const TEXT_WITH_FACE = `a${GRINNING_FACE}b`;

// Constants and field escaping ------------------------------------------------------------------

describe("CSV_DELIMITER and CSV_LINE_ENDING: the separators every export defaults to", () => {
  it("carries the comma and the CRLF pair the module documents", () => {
    expect(csv.CSV_DELIMITER).toBe(",");
    expect(csv.CSV_LINE_ENDING).toBe("\r\n");
  });
});

/** Numeric cells: the renderings a locale-aware or grouping writer would not produce. */
const NUMBER_CELLS: readonly [value: number, expected: string][] = [
  [0, "0"],
  [12, "12"],
  [1234567.5, "1234567.5"],
  [-12.5, "-12.5"],
];

/** Cells that force quoting, with the field text each one becomes. */
const QUOTED_CELLS: readonly [value: string, expected: string][] = [
  ["Orbital, Lamp", '"Orbital, Lamp"'],
  ["Orbital\nLamp", '"Orbital\nLamp"'],
  ["Orbital\r\nLamp", '"Orbital\r\nLamp"'],
  ['Orbital "Lamp"', '"Orbital ""Lamp"""'],
  ['Orbital, "Lamp"', '"Orbital, ""Lamp"""'],
];

/** Cells whose first character a spreadsheet reads as a formula, and the guarded text each becomes. */
const GUARDED_CELLS: readonly [value: string, expected: string][] = [
  ["=1+1", "'=1+1"],
  ["+1+1", "'+1+1"],
  ["-2*3", "'-2*3"],
  ["@SUM(A1:A3)", "'@SUM(A1:A3)"],
  ["\tTotals", "'\tTotals"],
];

/** Plain signed decimals: the documented exception, left unguarded so a spreadsheet can sum them. */
const PLAIN_DECIMALS: readonly string[] = ["-12.5", "+3", "-0.75", "42", "-0"];

/** Cells that are both guarded and quoted, where the two rules have to hold at once. */
const GUARDED_AND_QUOTED_CELLS: readonly [value: string, expected: string][] = [
  ["=A1,B2", `"'=A1,B2"`],
  ['=IF(A1="x",1,0)', `"'=IF(A1=""x"",1,0)"`],
  ["-1,250.00", `"'-1,250.00"`],
];

describe("escapeCsvCell: the field text one cell becomes", () => {
  it("writes an absent cell as empty text", () => {
    expect(csv.escapeCsvCell(null)).toBe("");
    expect(csv.escapeCsvCell(undefined)).toBe("");
  });

  it.each(NUMBER_CELLS)(
    "writes the number %s locale-independently, with no grouping",
    (value, expected) => {
      expect(csv.escapeCsvCell(value)).toBe(expected);
    },
  );

  it("writes a cell carrying none of the special characters bare", () => {
    expect(csv.escapeCsvCell("Orbital Lamp")).toBe("Orbital Lamp");
    expect(csv.escapeCsvCell("")).toBe("");
  });

  it.each(QUOTED_CELLS)("quotes %j and doubles the quotes inside it", (value, expected) => {
    expect(csv.escapeCsvCell(value)).toBe(expected);
  });

  it.each(GUARDED_CELLS)("guards %j with one apostrophe", (value, expected) => {
    expect(csv.escapeCsvCell(value)).toBe(expected);
  });

  it("quotes a guarded cell that also carries a carriage return, so the guard survives the parse", () => {
    expect(csv.escapeCsvCell("\rTotals")).toBe('"\'\rTotals"');
  });

  it.each(PLAIN_DECIMALS)(
    "leaves the plain signed decimal %s unguarded so a spreadsheet still sums it",
    (value) => {
      expect(csv.escapeCsvCell(value)).toBe(value);
    },
  );

  it.each(GUARDED_AND_QUOTED_CELLS)("combines the guard with quoting for %s", (value, expected) => {
    expect(csv.escapeCsvCell(value)).toBe(expected);
  });

  it("honours a custom separator and refuses one it could not write with", () => {
    expect(csv.escapeCsvCell("Orbital; Lamp", ";")).toBe('"Orbital; Lamp"');
    expect(csv.escapeCsvCell("Orbital, Lamp", ";")).toBe("Orbital, Lamp");
    expect(csv.escapeCsvCell("Orbital, Lamp", '"')).toBe('"Orbital, Lamp"');
    expect(csv.escapeCsvCell("Orbital, Lamp", "\n")).toBe('"Orbital, Lamp"');
    expect(csv.escapeCsvCell("Orbital, Lamp", "")).toBe('"Orbital, Lamp"');
  });

  it("drops a control character from a cell and keeps the tab, CR and LF the format quotes", () => {
    const matrix: CsvMatrix = {
      header: ["Label", "Note"],
      rows: [
        ["Da\u0000na", "one\u0001two"],
        ["Tabbed", "a\tb"],
        ["Broken", "first\r\nsecond"],
      ],
    };
    expect(csv.serialiseCsv(matrix)).toBe(
      ["Label,Note", "Dana,onetwo", "Tabbed,a\tb", 'Broken,"first\r\nsecond"'].join(
        csv.CSV_LINE_ENDING,
      ),
    );
  });
});

// Cell clipping ---------------------------------------------------------------------------------

/** Text at or under its limit: each one has to come back exactly as handed in. */
const CLIP_UNCHANGED_CASES: readonly [text: string, limit: number][] = [
  ["abc", 3],
  ["abc", 8],
  ["", 0],
];

/** Text over its limit, with the code units that fit and the limit that decides them. */
const CLIP_CUT_CASES: readonly [text: string, limit: number, expected: string][] = [
  ["abcdef", 3, "abc"],
  ["abcdef", 1, "a"],
  ["abcdef", 2.9, "ab"],
];

/** Limits that are not a usable count, every one of which falls back to the configured maximum. */
const UNUSABLE_LIMITS: readonly number[] = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];

describe("clipCellText: the cell limit applied before a value is escaped", () => {
  it.each(CLIP_UNCHANGED_CASES)("returns %j unchanged under its limit %s", (text, limit) => {
    expect(csv.clipCellText(text, limit)).toBe(text);
  });

  it.each(CLIP_CUT_CASES)(
    "cuts %j to the code units that fit under the limit %s",
    (text, limit, expected) => {
      expect(csv.clipCellText(text, limit)).toBe(expected);
    },
  );

  it("falls back to CSV_MAX_CELL_LENGTH when no limit is given", () => {
    expect(csv.clipCellText(OVERLONG_TEXT)).toHaveLength(CSV_MAX_CELL_LENGTH);
  });

  it.each(UNUSABLE_LIMITS)("falls back to CSV_MAX_CELL_LENGTH for the limit %s", (limit) => {
    expect(csv.clipCellText(OVERLONG_TEXT, limit)).toHaveLength(CSV_MAX_CELL_LENGTH);
  });

  it.each([0, -1, -0.5, -25.7])("keeps no text at all when the limit is %s or below", (limit) => {
    expect(csv.clipCellText("abc", limit)).toBe("");
    expect(csv.clipCellText(OVERLONG_TEXT, limit)).toBe("");
  });

  it("drops a surrogate pair whole instead of splitting it at the cut", () => {
    expect(csv.clipCellText(GRINNING_FACE + GRINNING_FACE, 3)).toBe(GRINNING_FACE);
    expect(csv.clipCellText(GRINNING_FACE + GRINNING_FACE, 2)).toBe(GRINNING_FACE);
    expect(csv.clipCellText(TEXT_WITH_FACE, 2)).toBe("a");
    expect(csv.clipCellText(TEXT_WITH_FACE, 3)).toBe(`a${GRINNING_FACE}`);
  });
});

// Row capping -----------------------------------------------------------------------------------

/** Caps that cannot bite on {@link CAP_ROWS}: the last one is the exact boundary. */
const CAPS_THAT_FIT: readonly number[] = [CAP_ROWS.length, CAP_ROWS.length + 1, 99];

/** Caps at or below zero, which keep none of the rows they are handed. */
const CAPS_THAT_KEEP_NOTHING: readonly number[] = [0, -2, -0.5];

/** Caps that are not a usable count, every one of which falls back to the configured maximum. */
const UNUSABLE_CAPS: readonly number[] = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];

describe("enforceRowCap: the export's row cap and the loss it reports", () => {
  it.each(CAPS_THAT_FIT)(
    "returns the array it was handed and reports no loss under the cap %s",
    (cap) => {
      const capped = csv.enforceRowCap(CAP_ROWS, cap);
      expect(capped.rows).toBe(CAP_ROWS);
      expect(capped.droppedRowCount).toBe(0);
      expect(capped.truncated).toBe(false);
    },
  );

  it("keeps the first rows and reports the count it dropped when the cap bites", () => {
    const capped = csv.enforceRowCap(CAP_ROWS, 2);
    expect(capped.rows).toEqual(["r1", "r2"]);
    expect(capped.rows).not.toBe(CAP_ROWS);
    expect(capped.droppedRowCount).toBe(CAP_ROWS.length - 2);
    expect(capped.truncated).toBe(true);
  });

  it("floors a fractional cap", () => {
    expect(csv.enforceRowCap(CAP_ROWS, 1.9).rows).toEqual(["r1"]);
  });

  it.each(CAPS_THAT_KEEP_NOTHING)("keeps no row when the cap is %s or below", (cap) => {
    expect(csv.enforceRowCap(CAP_ROWS, cap)).toEqual({
      rows: [],
      droppedRowCount: CAP_ROWS.length,
      truncated: true,
    });
  });

  it("falls back to CSV_MAX_ROWS when no cap is given", () => {
    const capped = csv.enforceRowCap(OVER_CAP_ROWS);
    expect(capped.rows).toHaveLength(CSV_MAX_ROWS);
    expect(capped.droppedRowCount).toBe(OVER_CAP_ROWS.length - CSV_MAX_ROWS);
    expect(capped.truncated).toBe(true);
  });

  it.each(UNUSABLE_CAPS)("falls back to CSV_MAX_ROWS for the cap %s", (cap) => {
    const capped = csv.enforceRowCap(OVER_CAP_ROWS, cap);
    expect(capped.rows).toHaveLength(CSV_MAX_ROWS);
    expect(capped.droppedRowCount).toBe(OVER_CAP_ROWS.length - CSV_MAX_ROWS);
    expect(capped.truncated).toBe(true);
  });
});

// Results and serialisation ---------------------------------------------------------------------

/** A single cell that carries a quote, the separator and a formula lead, cut to six code units. */
const CLIP_THEN_ESCAPE_MATRIX: CsvMatrix = { header: ["Note"], rows: [['=A1"B,CD']] };

describe("buildCsvResult: the text and the counts one export reports", () => {
  it("returns the text, the body-row count, no loss and the sanitised file name", () => {
    expect(csv.buildCsvResult(SALES_MATRIX, { fileName: "Q3 / sales report" })).toEqual({
      text: SALES_MATRIX_TEXT,
      rowCount: SALES_MATRIX.rows.length,
      droppedRowCount: 0,
      truncated: false,
      fileNameSuggestion: "Q3 - sales report.csv",
    });
  });

  it("omits the file-name suggestion when the caller offered no name", () => {
    const built = csv.buildCsvResult(SALES_MATRIX);
    expect(Object.hasOwn(built, "fileNameSuggestion")).toBe(false);
    expect(built.text).toBe(SALES_MATRIX_TEXT);
  });

  it("clips each cell before it escapes it, so no field is cut inside a doubled quote", () => {
    const built = csv.buildCsvResult(CLIP_THEN_ESCAPE_MATRIX, { maxCellLength: 6 });
    expect(built.text).toBe(`Note${csv.CSV_LINE_ENDING}"'=A1""B,"`);
  });

  it("caps the body rows and reports the drop in the text and the counts together", () => {
    const built = csv.buildCsvResult(SALES_MATRIX, { maxRows: 1 });
    expect(built.text).toBe(CAPPED_MATRIX_TEXT);
    expect(built.rowCount).toBe(1);
    expect(built.droppedRowCount).toBe(SALES_MATRIX.rows.length - 1);
    expect(built.truncated).toBe(true);
    expect(built.text.split(csv.CSV_LINE_ENDING)).toHaveLength(built.rowCount + 1);
  });

  it("writes the header alone when the matrix has no body rows", () => {
    const built = csv.buildCsvResult(HEADER_ONLY_MATRIX);
    expect(built.text).toBe("Region");
    expect(built.rowCount).toBe(0);
    expect(built.droppedRowCount).toBe(0);
    expect(built.truncated).toBe(false);
  });
});

describe("serialiseCsv: the finished text an export writes", () => {
  it("writes the header then each body row, joined by CRLF and not ended by one", () => {
    const text = csv.serialiseCsv(SALES_MATRIX);
    expect(text).toBe(SALES_MATRIX_TEXT);
    expect(text.split(csv.CSV_LINE_ENDING)).toHaveLength(SALES_MATRIX.rows.length + 1);
    expect(text.endsWith(csv.CSV_LINE_ENDING)).toBe(false);
  });

  it("writes the header alone when the matrix has no body rows", () => {
    expect(csv.serialiseCsv(HEADER_ONLY_MATRIX)).toBe("Region");
  });

  it("honours the separator and the row ending a caller asks for", () => {
    expect(csv.serialiseCsv(SALES_MATRIX, { delimiter: ";" })).toBe(SEMICOLON_MATRIX_TEXT);
    expect(csv.serialiseCsv(SALES_MATRIX, { lineEnding: "\n" })).toBe(LINE_FEED_MATRIX_TEXT);
  });

  it("refuses an empty row ending in favour of the documented one", () => {
    expect(csv.serialiseCsv(SALES_MATRIX, { lineEnding: "" })).toBe(SALES_MATRIX_TEXT);
  });

  it("drops the rows over the cap, leaving the loss to be reported elsewhere", () => {
    expect(csv.serialiseCsv(SALES_MATRIX, { maxRows: 1 })).toBe(CAPPED_MATRIX_TEXT);
  });
});

// File names ------------------------------------------------------------------------------------

/** Suggested names with the one this module makes of each: printable, pathless and always `.csv`. */
const FILE_NAME_CASES: readonly [fileName: string, expected: string][] = [
  ["sales-report", "sales-report.csv"],
  ["sales-report.csv", "sales-report.csv"],
  ["REPORT.CSV", "REPORT.csv"],
  ["reports/2025/q3.csv", "reports-2025-q3.csv"],
  ["quarterly\\sales report.csv", "quarterly-sales report.csv"],
  ["q3 sales*.csv", "q3 sales-.csv"],
  ["sales\u0007report.csv", "sales-report.csv"],
  ["sales\treport.csv", "sales-report.csv"],
  ["report.txt", "report.txt.csv"],
  ["  .hidden report  ", "hidden report.csv"],
  ["...", "salespro-export.csv"],
  ["/", "salespro-export.csv"],
  ["", "salespro-export.csv"],
  ["   ", "salespro-export.csv"],
];

describe("sanitiseCsvFileName: a name safe to hand a browser", () => {
  it.each(FILE_NAME_CASES)("turns %j into %j", (fileName, expected) => {
    expect(csv.sanitiseCsvFileName(fileName)).toBe(expected);
  });

  it("bounds an over-long stem, leaving the extension it appends inside the limit", () => {
    const longStem = "x".repeat(200);
    const named = csv.sanitiseCsvFileName(`${longStem}.csv`);
    expect(named).toBe(`${"x".repeat(120)}.csv`);
    expect(named).toHaveLength(124);
    expect(csv.sanitiseCsvFileName(longStem)).toBe(`${"x".repeat(120)}.csv`);
  });
});

// Downloads -------------------------------------------------------------------------------------

/**
 * The stubs tests/setup.ts installs are read through `vi.spyOn`, as that file documents: spying on a
 * mock returns that mock, so the handle carries the stub's own call history, and a bare
 * `expect(URL.createObjectURL)` would trip unbound-method. Each download case takes its own handles
 * rather than sharing one taken here, because the setup file's teardown reinstalls the stubs for
 * every test — a handle captured at import would name a mock the export no longer reaches.
 */

/** The CSV text the download assertions hand over, so no assertion depends on another module. */
const DOWNLOAD_TEXT = "Region,Units\r\nNorth,12";

/**
 * Reads a blob back as text, so the bytes the module handed the browser are observed rather than
 * assumed: jsdom's blob carries no reader of its own, and this is the platform's.
 */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string));
    reader.addEventListener("error", () => reject(new Error("the blob could not be read")));
    reader.readAsText(blob);
  });
}

describe("downloadCsv: starting the download, and the reason it did not start", () => {
  afterEach(() => {
    // The setup file's teardown clears the stubs and reinstalls them for the next test; this undoes
    // only the global replacements the cases below make, before that teardown runs.
    vi.unstubAllGlobals();
  });

  it("writes the text as a CSV blob, clicks a hidden anchor and reports the sanitised name", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL");
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const append = vi.spyOn(document.body, "append");

    const result = csv.downloadCsv("Q3 / sales report", DOWNLOAD_TEXT);

    expect(result).toEqual({ ok: true, fileName: "Q3 - sales report.csv" });
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    const blob = createObjectUrl.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    const written = blob as Blob;
    expect(written.type).toBe("text/csv;charset=utf-8");
    expect(await readBlobText(written)).toBe(DOWNLOAD_TEXT);

    // The anchor is read off the click the export makes, so the node's own attributes are observed
    // rather than a copy of them.
    const anchor = anchorClick.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.tagName).toBe("A");
    expect(anchor.href).toMatch(/^blob:/);
    expect(anchor.download).toBe("Q3 - sales report.csv");
    expect(anchor.hidden).toBe(true);
    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    // The object URL the anchor carried is the one revoked, and the finally block takes the node
    // back out of the document.
    expect(revokeObjectUrl).toHaveBeenCalledWith(anchor.href);
    expect(document.body.querySelectorAll("a").length).toBe(0);
  });

  it("reports download-rejected and keeps no node or live URL when the click is refused", () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL");
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click");
    anchorClick.mockImplementation(() => {
      throw new Error("click refused");
    });
    const append = vi.spyOn(document.body, "append");

    const result = csv.downloadCsv("sales report", DOWNLOAD_TEXT);

    expect(result).toEqual({
      ok: false,
      fileName: "sales report.csv",
      reason: "download-rejected",
      detail: "click refused",
    });
    expect(append).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl.mock.calls[0]?.[0]).toMatch(/^blob:/);
    expect(document.body.querySelectorAll("a").length).toBe(0);
  });

  it.each([
    ["absent", undefined],
    ["present without a body", { body: null }],
  ])("reports no-document when the document is %s", (_shape, stubbedDocument) => {
    vi.stubGlobal("document", stubbedDocument);

    expect(csv.downloadCsv("sales report", DOWNLOAD_TEXT)).toEqual({
      ok: false,
      fileName: "sales report.csv",
      reason: "no-document",
    });
  });

  it("reports no-blob-support when the environment has no Blob", () => {
    vi.stubGlobal("Blob", undefined);

    expect(csv.downloadCsv("sales report", DOWNLOAD_TEXT)).toEqual({
      ok: false,
      fileName: "sales report.csv",
      reason: "no-blob-support",
    });
  });

  it("reports no-object-url-support when the environment has no object-URL pair", () => {
    vi.stubGlobal("URL", {});

    expect(csv.downloadCsv("sales report", DOWNLOAD_TEXT)).toEqual({
      ok: false,
      fileName: "sales report.csv",
      reason: "no-object-url-support",
    });
  });
});
