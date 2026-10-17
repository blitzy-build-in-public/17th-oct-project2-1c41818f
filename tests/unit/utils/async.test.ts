/**
 * Path: tests/unit/utils/async.test.ts
 * Purpose: The timing, cancellation and retry contracts of src/utils/async.ts, asserted against a fake clock
 * Lines: 589
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as async from "@/utils/async";

// Every case is measured against the fake clock, so none waits on real time or on the wall clock, and
// each one ends with no timer pending and no rejection left unhandled.

/** The quiet period and backoff base every case uses, so no assertion depends on a chosen number. */
const WAIT_MS = 100;
/** The generic message `createAbortError` supplies when the signal carries no usable reason. */
const GENERIC_ABORT_MESSAGE = "The operation was aborted.";
// Helpers ---------------------------------------------------------------------------------------

/** A promise a case settles by hand, so a race is observed while its operation still runs. */
interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let settle: (value: T) => void = () => undefined;
  let fail: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, resolve: (value) => settle(value), reject: (reason) => fail(reason) };
}

/** An operation that never settles, so only a signal or a deadline can settle the race around it. */
const NEVER_SETTLES = new Promise<string>(() => undefined);

/** The rejection of a promise as an `Error`, which is what this module contracts to reject with. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof Error) return error;
    throw new Error(`The promise rejected with a non-Error value: ${String(error)}`);
  }
  throw new Error("The promise resolved where the case expects a rejection.");
}

/** A promise rejecting with the value a case hands it: the bare failure a race has to wrap. */
async function rejectsWith(failure: unknown): Promise<never> {
  await Promise.resolve();
  throw failure;
}

/** Abort reasons, the message each one surfaces, and whether the signal aborts before the wait. */
const ABORT_REASONS = [
  { reason: new Error("Request cancelled"), message: "Request cancelled", pre: true },
  { reason: "no longer needed", message: "no longer needed", pre: false },
  { reason: new Error(""), message: GENERIC_ABORT_MESSAGE, pre: false },
  { reason: 42, message: GENERIC_ABORT_MESSAGE, pre: false },
];
/** A failure shaped like the API client's: an `Error` whose `status` decides whether it is retried. */
function failureWith(status: number | string): Error {
  return Object.assign(new Error(`Failed with ${String(status)}.`), { status });
}

/** The failure shape the default predicate's 4xx rule reads, and the timeout name it retries. */
function timeoutFailure(): Error {
  return Object.assign(new Error("Timed out."), { name: "TimeoutError" });
}

/** An operation for the retry cases: it records each attempt and fails until `succeedOn` succeeds. */
function makeOperation(attempts: number[], succeedOn = 0): (attempt: number) => Promise<string> {
  return (attempt) => {
    attempts.push(attempt);
    if (succeedOn > 0 && attempt >= succeedOn) return Promise.resolve(`value ${String(attempt)}`);
    return Promise.reject(new Error(`attempt ${String(attempt)} failed`));
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
// Cancellation primitives -----------------------------------------------------------------------
describe("createAbortError: the failure every cancelled operation settles with", () => {
  it("builds an Error named AbortError, carrying the generic message unless given one", () => {
    const error = async.createAbortError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AbortError");
    expect(error.message).toBe(GENERIC_ABORT_MESSAGE);
    expect(async.createAbortError("Request cancelled").message).toBe("Request cancelled");
  });
  it("hands back a new instance rather than one shared error", () => {
    expect(async.createAbortError()).not.toBe(async.createAbortError());
  });
});
describe("isAbortError: recognising a cancellation", () => {
  it.each([
    { expected: true, label: "the module's own error", value: async.createAbortError() },
    { expected: true, label: "a DOMException", value: new DOMException("Gone.", "AbortError") },
    { expected: true, label: "an API error", value: { name: "AbortError", status: 0 } },
    { expected: false, label: "a plain Error", value: new Error("AbortError") },
    { expected: false, label: "another class", value: new TypeError("nope") },
    { expected: false, label: "the name as a string", value: "AbortError" },
    { expected: false, label: "a lowercase name", value: { name: "aborterror" } },
    { expected: false, label: "null", value: null },
    { expected: false, label: "undefined", value: undefined },
  ])("answers $expected for $label", ({ expected, value }) => {
    expect(async.isAbortError(value)).toBe(expected);
  });
});
// Waiting and cancelling ------------------------------------------------------------------------
describe("delay: waiting a fixed time, or until the signal aborts", () => {
  it("resolves once the requested time has passed, and ignores an abort arriving after", async () => {
    const controller = new AbortController();
    let settled = false;
    const waiting = async.delay(WAIT_MS, controller.signal).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(WAIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(settled).toBe(true);
    controller.abort(new Error("too late"));
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([0, -1])("defers a wait of %s ms to the next macrotask", async (ms) => {
    let settled = false;
    const waiting = async.delay(ms).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    await waiting;
    expect(settled).toBe(true);
  });
  it.each(ABORT_REASONS)("rejects a wait aborted by $message", async ({ reason, message, pre }) => {
    const controller = new AbortController();
    if (pre) controller.abort(reason);
    const observed = rejectionOf(async.delay(WAIT_MS, controller.signal));
    if (!pre) {
      await vi.advanceTimersByTimeAsync(WAIT_MS / 2);
      controller.abort(reason);
    }
    const error = await observed;
    expect(error.name).toBe("AbortError");
    expect(error.message).toBe(message);
    expect(vi.getTimerCount()).toBe(0);
  });
});
describe("raceAbort: settling with the operation, or with its signal", () => {
  it("returns the promise unchanged with no signal, and its value when the signal stays silent", async () => {
    const promise = Promise.resolve("value");
    expect(async.raceAbort(promise)).toBe(promise);
    await expect(async.raceAbort(promise, new AbortController().signal)).resolves.toBe("value");
  });
  it("rejects as soon as the signal aborts, while the operation keeps running", async () => {
    const controller = new AbortController();
    const deferred = createDeferred<string>();
    const observed = rejectionOf(async.raceAbort(deferred.promise, controller.signal));
    controller.abort("no longer needed");
    const error = await observed;
    expect(error.name).toBe("AbortError");
    expect(error.message).toBe("no longer needed");
    deferred.resolve("too late"); // the work finishes, but its result reaches no caller
    await vi.advanceTimersByTimeAsync(0);
  });
  it("rejects an already-aborted signal without waiting for the operation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Request cancelled"));
    const error = await rejectionOf(async.raceAbort(NEVER_SETTLES, controller.signal));
    expect(error.name).toBe("AbortError");
    expect(error.message).toBe("Request cancelled");
  });
  it("surfaces the operation's own failure, wrapping a value that is not an Error", async () => {
    const failure = new Error("Upstream is down.");
    await expect(async.raceAbort(Promise.reject(failure))).rejects.toBe(failure);
    const signal = new AbortController().signal;
    const error = await rejectionOf(async.raceAbort(rejectsWith("boom"), signal));
    expect(error.message).toBe("The operation rejected with a non-Error value.");
    expect(error.cause).toBe("boom");
  });
  it("leaves no rejection unhandled when the operation fails after the abort", async () => {
    const controller = new AbortController();
    const deferred = createDeferred<string>();
    const observed = rejectionOf(async.raceAbort(deferred.promise, controller.signal));
    controller.abort("no longer needed");
    expect((await observed).message).toBe("no longer needed");
    deferred.reject(new Error("Upstream gave up.")); // handled inside the race, so it surfaces nowhere
    await vi.advanceTimersByTimeAsync(0);
  });
});
describe("withTimeout: bounding an operation with a time budget", () => {
  it("resolves with a value that arrives inside the budget and clears the deadline", async () => {
    const deferred = createDeferred<string>();
    const bounded = async.withTimeout(deferred.promise, WAIT_MS);
    await vi.advanceTimersByTimeAsync(WAIT_MS / 2);
    deferred.resolve("value");
    await expect(bounded).resolves.toBe("value");
    const failure = new Error("Upstream is down.");
    await expect(async.withTimeout(Promise.reject(failure), WAIT_MS)).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([[WAIT_MS], [-5]])("rejects with a TimeoutError once the budget elapses", async (ms) => {
    const budget = Math.max(0, ms);
    const observed = rejectionOf(async.withTimeout(NEVER_SETTLES, ms));
    if (budget > 0) {
      await vi.advanceTimersByTimeAsync(budget - 1);
      expect(vi.getTimerCount()).toBe(1); // the deadline is armed, and has not fired yet
    }
    await vi.advanceTimersByTimeAsync(budget);
    const error = await observed;
    expect(error.name).toBe("TimeoutError");
    expect(error.message).toBe(`The operation did not settle within ${String(budget)} ms.`);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    { label: "before the call", at: 0, name: "AbortError" },
    { label: "inside the budget", at: WAIT_MS / 2, name: "AbortError" },
    { label: "after the budget", at: WAIT_MS, name: "TimeoutError" },
  ])("settles with whichever side wins when the signal aborts $label", async ({ at, name }) => {
    const controller = new AbortController();
    if (at === 0) controller.abort("no longer needed");
    const observed = rejectionOf(async.withTimeout(NEVER_SETTLES, WAIT_MS, controller.signal));
    if (at > 0) {
      await vi.advanceTimersByTimeAsync(at);
      controller.abort("no longer needed");
    }
    const error = await observed;
    expect(error.name).toBe(name);
    expect(vi.getTimerCount()).toBe(0);
  });
});
// Rate limiting ---------------------------------------------------------------------------------
describe("debounce: one invocation per burst, a quiet period after the last call", () => {
  it("runs once, a quiet period after the last call, with that call's arguments", async () => {
    const work = vi.fn((value: string): string => value);
    const debounced = async.debounce(work, WAIT_MS);
    expect(debounced("first")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(WAIT_MS / 2);
    expect(debounced("second")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(WAIT_MS / 2);
    expect(work).not.toHaveBeenCalled(); // the second call restarted the quiet period
    await vi.advanceTimersByTimeAsync(WAIT_MS / 2);
    expect(work.mock.calls).toEqual([["second"]]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("collapses a burst, and a zero quiet period, into one invocation each", async () => {
    const work = vi.fn((value: string): string => value);
    const debounced = async.debounce(work, WAIT_MS);
    for (const value of ["a", "b", "c", "d"]) debounced(value);
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(work.mock.calls).toEqual([["d"]]);
    const immediate = async.debounce(work, 0);
    immediate("now");
    expect(work).toHaveBeenCalledTimes(1); // a zero quiet period still waits for the next macrotask
    await vi.advanceTimersByTimeAsync(0);
    expect(work.mock.calls).toEqual([["d"], ["now"]]);
  });
  it("runs the opening call at once, and returns its value, with leading delivery", async () => {
    const work = vi.fn((value: number): number => value * 2);
    const debounced = async.debounce(work, WAIT_MS, { leading: true, trailing: false });
    expect(debounced(21)).toBe(42);
    expect(debounced(22)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(work.mock.calls).toEqual([[21]]); // trailing delivery is off, so the rest is dropped
    expect(vi.getTimerCount()).toBe(0);
  });
  it("adds a trailing call only when a call arrived during the window", async () => {
    const work = vi.fn((value: string): string => value);
    const debounced = async.debounce(work, WAIT_MS, { leading: true });
    expect(debounced("only")).toBe("only");
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(work.mock.calls).toEqual([["only"]]); // nothing arrived, so nothing is repeated
    expect(debounced("first")).toBe("first");
    debounced("second");
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(work.mock.calls).toEqual([["only"], ["first"], ["second"]]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("drops what is pending on cancel and keeps what a window already ran", async () => {
    const work = vi.fn((value: string): string => value);
    const trailing = async.debounce(work, WAIT_MS);
    trailing("dropped");
    trailing.cancel();
    expect(vi.getTimerCount()).toBe(0);
    const leading = async.debounce(work, WAIT_MS, { leading: true });
    leading("first");
    leading("second");
    leading.cancel();
    await vi.advanceTimersByTimeAsync(WAIT_MS * 3);
    expect(work.mock.calls).toEqual([["first"]]);
  });
  it("delivers a pending call on flush, and nothing once the window has settled", async () => {
    const work = vi.fn((value: string): string => value);
    const debounced = async.debounce(work, WAIT_MS);
    debounced("first");
    debounced("second");
    debounced.flush();
    expect(work.mock.calls).toEqual([["second"]]);
    expect(vi.getTimerCount()).toBe(0);
    debounced.flush(); // nothing pending
    debounced.cancel(); // and nothing to drop
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(work.mock.calls).toEqual([["second"]]);
  });
  it("leaves the pending call alone when flush runs with trailing delivery off", async () => {
    const work = vi.fn((value: string): string => value);
    const debounced = async.debounce(work, WAIT_MS, { leading: true, trailing: false });
    debounced("first");
    debounced("second");
    debounced.flush();
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(work.mock.calls).toEqual([["first"]]);
  });
  it("refuses a wrapper that could never invoke the function", () => {
    const build = (): unknown =>
      async.debounce((): void => undefined, WAIT_MS, { leading: false, trailing: false });
    expect(build).toThrow(TypeError);
    expect(build).toThrow("debounce needs leading or trailing delivery enabled.");
  });
  it("reports an error the wrapped function throws from the call flush delivers", () => {
    const failure = new Error("The handler failed.");
    const debounced = async.debounce((): never => {
      throw failure;
    }, WAIT_MS);
    debounced();
    expect(() => debounced.flush()).toThrow(failure);
  });
  it("invokes the wrapped function without a receiver", async () => {
    const receivers: unknown[] = [];
    const owner = {
      value: "owner",
      run: async.debounce(function (this: unknown): void {
        receivers.push(this);
      }, WAIT_MS),
    };
    owner.run();
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(receivers).toEqual([undefined]);
  });
});
describe("throttle: one invocation per window, the first and the last call", () => {
  it("runs the opening call at once and the window's last call when it closes", async () => {
    const work = vi.fn((value: string): string => value);
    const throttled = async.throttle(work, WAIT_MS);
    expect(throttled("first")).toBe("first");
    expect(throttled("second")).toBeUndefined(); // inside the window the call is collapsed
    await vi.advanceTimersByTimeAsync(WAIT_MS - 1);
    expect(work.mock.calls).toEqual([["first"]]);
    await vi.advanceTimersByTimeAsync(1);
    expect(work.mock.calls).toEqual([["first"], ["second"]]);
    await vi.advanceTimersByTimeAsync(WAIT_MS); // the window the trailing call opened closes silently
    expect(work.mock.calls).toEqual([["first"], ["second"]]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("collapses a burst into one call per window", async () => {
    const work = vi.fn((value: string): string => value);
    const throttled = async.throttle(work, WAIT_MS);
    for (const value of ["a", "b", "c", "d", "e"]) throttled(value);
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(work.mock.calls).toEqual([["a"], ["e"]]);
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(work).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("makes one call per window while calls keep arriving", async () => {
    const work = vi.fn((value: string): string => value);
    const throttled = async.throttle(work, WAIT_MS);
    throttled("a");
    await vi.advanceTimersByTimeAsync(WAIT_MS / 2);
    throttled("b");
    await vi.advanceTimersByTimeAsync(WAIT_MS / 2); // the first window closes on "b"
    await vi.advanceTimersByTimeAsync(WAIT_MS / 2);
    throttled("c");
    await vi.advanceTimersByTimeAsync(WAIT_MS / 2); // the second window closes on "c"
    await vi.advanceTimersByTimeAsync(WAIT_MS); // the third window finds nothing to deliver
    expect(work.mock.calls).toEqual([["a"], ["b"], ["c"]]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    { leading: true, trailing: false, label: "trailing delivery is off" },
    { leading: false, trailing: true, label: "leading delivery is off" },
  ])("honours the one delivery mode it is left with when $label", async ({ leading, trailing }) => {
    const work = vi.fn((value: string): string => value);
    const throttled = async.throttle(work, WAIT_MS, { leading, trailing });
    expect(throttled("first")).toBe(leading ? "first" : undefined);
    expect(throttled("second")).toBeUndefined();
    if (!leading) expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(work.mock.calls).toEqual([leading ? ["first"] : ["second"]]);
    await vi.advanceTimersByTimeAsync(WAIT_MS); // the window the trailing call opened closes silently
    expect(work.mock.calls).toEqual([leading ? ["first"] : ["second"]]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("closes a window of zero length on the next macrotask", async () => {
    const work = vi.fn((value: string): string => value);
    const throttled = async.throttle(work, 0, { leading: false });
    throttled("now");
    expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(work.mock.calls).toEqual([["now"]]);
    await vi.advanceTimersByTimeAsync(1); // the window the trailing call opened closes with nothing in it
    expect(work).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses a wrapper that could never invoke the function", () => {
    const build = (): unknown =>
      async.throttle((): void => undefined, WAIT_MS, { leading: false, trailing: false });
    expect(build).toThrow(TypeError);
    expect(build).toThrow("throttle needs leading or trailing delivery enabled.");
  });
  it("ends the open window on cancel, dropping what it held, and starts a fresh one after", async () => {
    const work = vi.fn((value: string): string => value);
    const throttled = async.throttle(work, WAIT_MS);
    throttled("first");
    throttled("second");
    throttled.cancel();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(WAIT_MS * 3);
    expect(work.mock.calls).toEqual([["first"]]);
    const waiting = async.throttle(work, WAIT_MS, { leading: false });
    waiting("dropped");
    waiting.cancel();
    await vi.advanceTimersByTimeAsync(WAIT_MS * 3);
    expect(work.mock.calls).toEqual([["first"]]);
    expect(throttled("third")).toBe("third");
    await vi.advanceTimersByTimeAsync(WAIT_MS);
  });
});
// Retry with backoff ----------------------------------------------------------------------------
describe("retry: another attempt after a failure, with exponential backoff", () => {
  it("returns the first attempt's value, calling it once, whether it answers or promises", async () => {
    const attempts: number[] = [];
    const outcome = async.retry(makeOperation(attempts, 1), { attempts: 3, baseDelayMs: WAIT_MS });
    await expect(outcome).resolves.toBe("value 1");
    await expect(async.retry(() => "plain", { attempts: 1, baseDelayMs: 0 })).resolves.toBe(
      "plain",
    );
    await vi.advanceTimersByTimeAsync(WAIT_MS * 4); // a success schedules nothing further
    expect(attempts).toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retries until an attempt succeeds, handing each attempt its 1-based number", async () => {
    const attempts: number[] = [];
    const outcome = async.retry(makeOperation(attempts, 3), { attempts: 4, baseDelayMs: WAIT_MS });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toEqual([1]);
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(attempts).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(WAIT_MS * 2 - 1);
    expect(attempts).toEqual([1, 2]); // the second wait is the doubled one, so it has not elapsed yet
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toBe("value 3");
    expect(attempts).toEqual([1, 2, 3]);
  });
  it("surfaces the last failure once its attempts are exhausted, and stops there", async () => {
    const attempts: number[] = [];
    const observed = rejectionOf(
      async.retry(makeOperation(attempts), { attempts: 3, baseDelayMs: WAIT_MS }),
    );
    await vi.advanceTimersByTimeAsync(WAIT_MS * 3);
    expect((await observed).message).toBe("attempt 3 failed");
    await vi.advanceTimersByTimeAsync(WAIT_MS * 10);
    expect(attempts).toEqual([1, 2, 3]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    { configured: 0, expected: "1" },
    { configured: -3, expected: "1" },
    { configured: 2.9, expected: "2" },
  ])("normalises $configured attempts to $expected call(s)", async ({ configured, expected }) => {
    const attempts: number[] = [];
    const observed = rejectionOf(
      async.retry(makeOperation(attempts), { attempts: configured, baseDelayMs: 0 }),
    );
    for (let step = 0; step < 3; step += 1) await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toHaveLength(Number(expected));
    expect((await observed).message).toBe(`attempt ${expected} failed`);
  });
  it("waits baseDelayMs * 2 ** (n - 1) between attempts, capped by maxDelayMs", async () => {
    const attempts: number[] = [];
    const observed = rejectionOf(
      async.retry(makeOperation(attempts), { attempts: 4, baseDelayMs: WAIT_MS, maxDelayMs: 250 }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toEqual([1]);
    // Each step is a time to advance and the attempts that exist once it has: the three waits are
    // 100 ms, the doubled 200 ms, and 400 ms capped to 250 ms.
    const schedule: readonly (readonly [number, number])[] = [
      [WAIT_MS - 1, 1],
      [1, 2],
      [WAIT_MS * 2 - 1, 2],
      [1, 3],
      [249, 3],
      [1, 4],
    ];
    for (const [after, calls] of schedule) {
      await vi.advanceTimersByTimeAsync(after);
      expect(attempts).toHaveLength(calls);
    }
    expect((await observed).message).toBe("attempt 4 failed");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stops at once when shouldRetry says no, handing it each failure and its attempt number", async () => {
    const attempts: number[] = [];
    const seen: { readonly attempt: number; readonly error: unknown }[] = [];
    const observed = rejectionOf(
      async.retry(makeOperation(attempts, 3), {
        attempts: 3,
        baseDelayMs: WAIT_MS,
        shouldRetry: (error: unknown, attempt: number) => {
          seen.push({ error, attempt });
          return attempt < 2;
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect((await observed).message).toBe("attempt 2 failed"); // the refusal ends the retries at once
    expect(attempts).toEqual([1, 2]);
    expect(seen).toEqual([
      { error: new Error("attempt 1 failed"), attempt: 1 },
      { error: new Error("attempt 2 failed"), attempt: 2 },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    { label: "a 404", failure: failureWith(404), retried: false },
    { label: "a 499", failure: failureWith(499), retried: false },
    { label: "an abort", failure: async.createAbortError("Request cancelled"), retried: false },
    { label: "a 503", failure: failureWith(503), retried: true },
    { label: "a non-numeric status", failure: failureWith("500"), retried: true },
    { label: "a timeout error", failure: timeoutFailure(), retried: true },
    { label: "a value that is not an Error", failure: "gone wrong", retried: true },
  ])("treats $label as $retried under the default predicate", async ({ failure, retried }) => {
    const attempts: number[] = [];
    const operation = (attempt: number): Promise<string> => {
      attempts.push(attempt);
      return attempt < 3 ? rejectsWith(failure) : Promise.resolve("value");
    };
    // Observed at once, so a refusal that rejects before the clock runs is never left unhandled.
    const settled = async.retry(operation, { attempts: 3, baseDelayMs: WAIT_MS }).then(
      (value) => ({ ok: true, value }),
      (error: unknown) => ({ ok: false, error }),
    );
    await vi.advanceTimersByTimeAsync(WAIT_MS * 3);
    const result = await settled;
    if (retried) {
      expect(result).toEqual({ ok: true, value: "value" });
      expect(attempts).toEqual([1, 2, 3]);
      return;
    }
    expect(result).toEqual({ ok: false, error: failure });
    expect(attempts).toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    { label: "before the first attempt", during: false, message: "Request cancelled" },
    { label: "during a backoff wait", during: true, message: "no longer needed" },
  ])(
    "rejects $label when the signal aborts, and calls nothing further",
    async ({ during, message }) => {
      const controller = new AbortController();
      const attempts: number[] = [];
      if (!during) controller.abort(new Error(message));
      const observed = rejectionOf(
        async.retry(makeOperation(attempts), {
          attempts: 3,
          baseDelayMs: WAIT_MS,
          signal: controller.signal,
        }),
      );
      if (during) {
        await vi.advanceTimersByTimeAsync(WAIT_MS / 2);
        controller.abort(message);
      }
      const error = await observed;
      expect(error.name).toBe("AbortError");
      expect(error.message).toBe(message);
      await vi.advanceTimersByTimeAsync(WAIT_MS * 10);
      expect(attempts).toHaveLength(during ? 1 : 0); // the first attempt ran, or none did, and neither retried
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
