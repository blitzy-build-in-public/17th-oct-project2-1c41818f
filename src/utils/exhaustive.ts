/**
 * Path: src/utils/exhaustive.ts
 * Purpose: The one exhaustiveness proof every switch over a closed union ends on
 * Lines: 34
 */

/**
 * Why the guard has one home rather than a copy in each file whose switch needs it: the proof it
 * carries is the same wherever it stands — that every member of the union reaching the switch was
 * handled above it — so a second copy adds no proof, only a second sentence about an unhandled
 * member to keep in step with the first. The subject is the one part that differs and the call
 * site is where it is known, so the guard takes it as an argument and every switch imports the
 * proof rather than restating it.
 */

/**
 * Fails to compile when a member of the union a switch reads went unhandled, and fails loudly at
 * run time if such a member arrives anyway.
 *
 * It is the whole body of the switch's default arm: the value is typed `never`, so that arm
 * compiles only while every member is handled above it, and a member added to the union later
 * breaks the build at every switch that reads it rather than falling through to a silent default.
 * The throw answers the value the types cannot see — one deserialised, or one this build did not
 * mint — so an unhandled member is reported instead of coming back as though it had been handled.
 *
 * @param value - The member no arm handled; the union's own narrowing has left it as `never`.
 * @param subject - What that member named, in the words its reader knows it by — `"cart action"`,
 *   `"checkout step"` — so the message says which switch went unhandled.
 * @returns Nothing: the signature is `never`, so no value leaves the branch that calls this and
 *   the surrounding switch stays exhaustive to the compiler.
 */
export function assertNever(value: never, subject: string): never {
  throw new Error(`Unhandled ${subject}: ${JSON.stringify(value)}`);
}
