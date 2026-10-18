/**
 * Path: tests/integration/figureReaders.ts
 * Purpose: The readers the administrator flow's assertions read a rendered figure back out with.
 * Lines: 11
 */

/** Money, count, share and a KPI's stated change as the product renders them, for reading a figure back out. */
export const MONEY_TEXT = /^\$[\d,]+(\.\d+)?[KMB]?$/;
export const COUNT_TEXT = /^[\d,]+$/;
export const PERCENT_TEXT = /^-?\d+(\.\d+)?%$/;
export const KPI_DELTA_TEXT = /^-?\d+(\.\d+)?% (up|down|no change)$/;
