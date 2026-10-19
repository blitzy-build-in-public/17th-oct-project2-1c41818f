/**
 * Path: src/features/search/SortControl.tsx
 * Purpose: The sort selector that writes the chosen key to the URL
 * Lines: 20
 */

/**
 * The search slice's public path to the sort selector, whose one home is `src/components/ui/SortControl.tsx`
 * in the shared presentation layer. Every name a consumer imports stays at this path, so a component that
 * imports `@/features/search/SortControl` resolves the same control the shared file implements.
 *
 * The catalogue page composes that same shared control rather than a second wiring of its own, because no
 * feature slice may import another and both surfaces sort a listing the same way: one vocabulary list, one
 * arrangement class and one setter call, all in the one file. Nothing about the control is duplicated by the
 * two surfaces sharing it, and this file carries no behaviour of its own — it neither reads the query nor
 * writes the address bar.
 */

export { SortControl } from "@/components/ui/SortControl";
export type { SortControlProps } from "@/components/ui/SortControl";
