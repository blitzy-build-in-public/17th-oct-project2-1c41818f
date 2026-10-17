/**
 * Path: src/utils/async.ts
 * Purpose: Debounce, throttle, retry with backoff and timeout helpers
 * Lines: 374
 */

/**
 * Delivery flags shared by {@link debounce} and {@link throttle}. At least one has to stay enabled:
 * disabling both is rejected with a `TypeError` when the wrapper is built, because the wrapper would
 * otherwise never invoke the function it wraps.
 */
export interface RateLimitOptions {
  /** Run the wrapped function when a call opens a window: debounce defaults to `false`, throttle `true`. */
  readonly leading?: boolean;
  /** Run it once more when a window ends if calls arrived during it. Defaults to `true`. */
  readonly trailing?: boolean;
}

/**
 * A debounced wrapper: the wrapped signature plus `cancel` and `flush`; the result is `R | undefined`
 * because a trailing invocation has no caller left to return to.
 */
export interface Debounced<A extends readonly unknown[], R> {
  (...args: A): R | undefined;
  /** Drops the pending trailing invocation and its arguments. */
  cancel(): void;
  /** Delivers the pending trailing invocation now; a no-op when nothing is pending or `trailing` is off. */
  flush(): void;
}

/** A throttled wrapper: the wrapped signature plus `cancel`. */
export interface Throttled<A extends readonly unknown[], R> {
  (...args: A): R | undefined;
  /** Ends an open window, dropping the call collapsed into it. The next call opens a new window. */
  cancel(): void;
}

/**
 * Creates the error every aborted operation here settles with: a plain `Error` named `"AbortError"`,
 * which {@link isAbortError} recognises, so callers never match on message text.
 *
 * @param message - Human-readable reason; defaults to a generic abort message.
 * @returns A new error instance, never a shared singleton.
 */
export function createAbortError(message = "The operation was aborted."): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

/**
 * Reports whether a value is a cancellation, whether this module produced it or the platform did: an
 * aborted `fetch` rejects with a `DOMException` carrying the same name.
 *
 * @param error - The value caught from a rejected promise.
 * @returns `true` for an abort-shaped error, `false` for anything else, a `TypeError` included.
 */
export function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (error as { readonly name?: unknown }).name === "AbortError";
}

/** Builds the rejection for a cancelled call, keeping the signal's string or error `reason` as its message. */
function abortErrorFrom(signal: AbortSignal | undefined): Error {
  if (signal === undefined) return createAbortError();
  const reason: unknown = (signal as { readonly reason?: unknown }).reason;
  if (typeof reason === "string" && reason.length > 0) return createAbortError(reason);
  if (reason instanceof Error && reason.message.length > 0) return createAbortError(reason.message);
  return createAbortError();
}

/** Throws the abort failure when the signal has already aborted, so a caller stops before doing work. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortErrorFrom(signal);
}

/** Normalises a rejection so a promise observed here always rejects with an `Error`, never a bare value. */
function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  const error = new Error("The operation rejected with a non-Error value.");
  error.cause = value;
  return error;
}

/**
 * Waits `ms` milliseconds, or rejects with an `AbortError` as soon as `signal` aborts; a negative `ms`
 * is treated as `0`, which still defers to the next macrotask rather than resolving synchronously.
 *
 * @param ms - Delay in milliseconds.
 * @param signal - Optional cancellation, honoured before any timer exists and while waiting.
 * @returns A promise that settles once, clearing its timer and removing its abort listener either way.
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.max(0, ms),
    );
    function onAbort(): void {
      clearTimeout(timer);
      reject(abortErrorFrom(signal));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Settles with `promise`, or earlier when the signal aborts or the timer elapses: the shared core of
 * {@link raceAbort} and {@link withTimeout}, so both clear the timer and remove the abort listener on
 * every settle path, and neither cancels the underlying work.
 */
function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number | null,
): Promise<T> {
  if (signal?.aborted === true) return Promise.reject(abortErrorFrom(signal));
  if (signal === undefined && timeoutMs === null) return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function finish(): boolean {
      if (settled) return false;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      signal?.removeEventListener("abort", onAbort);
      return true;
    }
    function onAbort(): void {
      if (finish()) reject(abortErrorFrom(signal));
    }
    if (timeoutMs !== null) {
      timer = setTimeout(() => {
        if (!finish()) return;
        const error = new Error(`The operation did not settle within ${timeoutMs} ms.`);
        error.name = "TimeoutError";
        reject(error);
      }, timeoutMs);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        if (finish()) resolve(value);
      },
      (error: unknown) => {
        if (finish()) reject(asError(error));
      },
    );
  });
}

/**
 * Settles with `promise`, or rejects with an `AbortError` as soon as `signal` aborts: how a component
 * stops caring about a promise it cannot hand a signal to, because the work keeps running while its
 * result can no longer reach the caller. Pass the signal into the operation too (as `apiClient` does)
 * when the work must stop rather than be ignored.
 *
 * @param promise - The operation to observe; returned unchanged when there is no signal.
 * @param signal - Optional cancellation.
 * @returns A promise that removes its abort listener as soon as either side settles.
 */
export function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  return raceWithSignal(promise, signal, null);
}

/**
 * Bounds `promise` with a time budget, rejecting with an error named `"TimeoutError"` when it outlives
 * `ms`, so a caller can tell a slow call from a failed one without reading message text.
 *
 * @param promise - The operation to bound; a timeout does not cancel it.
 * @param ms - Budget in milliseconds; a negative value is treated as `0`.
 * @param signal - Optional cancellation, which wins over the timer.
 * @returns The value of `promise` when it settles in time, otherwise the timeout or abort rejection.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return raceWithSignal(promise, signal, Math.max(0, ms));
}

/**
 * Wraps `fn` so a burst of calls collapses into one invocation, holding a single timer and the latest
 * arguments rather than a timer per call, so a debounced search input cannot leak a timer per keystroke.
 * Defaults are `trailing: true, leading: false`: `fn` runs once, `waitMs` after the last call, with the
 * most recent arguments; with `leading: true` the call that opens a burst runs at once and returns its
 * value; with both flags set the trailing call is delivered only if a call arrived during the wait. An
 * error `fn` throws from a trailing call reaches the timer callback, because no caller remains to
 * receive it. State lives in the wrapper's closure, so create one wrapper per consumer and keep it
 * stable across renders (`React.useMemo`): a wrapper built on every render debounces nothing.
 *
 * @param fn - The function to debounce, invoked without a receiver, so `this` is not forwarded.
 * @param waitMs - Quiet period in milliseconds; `0` defers to the next macrotask.
 * @param options - Leading and trailing delivery flags.
 * @returns The wrapped function, with `cancel()` and `flush()` attached.
 */
export function debounce<A extends readonly unknown[], R>(
  fn: (...args: A) => R,
  waitMs: number,
  options: RateLimitOptions = {},
): Debounced<A, R> {
  const leading = options.leading ?? false;
  const trailing = options.trailing ?? true;
  if (!leading && !trailing)
    throw new TypeError("debounce needs leading or trailing delivery enabled.");
  const wait = Math.max(0, waitMs);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const stopTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const invoke = (args: A): R => {
    pending = null;
    return fn(...args);
  };
  const onWindowEnd = (): void => {
    timer = null;
    const args = pending;
    pending = null;
    if (trailing && args !== null) invoke(args);
  };

  return Object.assign(
    (...args: A): R | undefined => {
      const opening = timer === null;
      stopTimer();
      pending = args;
      timer = setTimeout(onWindowEnd, wait);
      return opening && leading ? invoke(args) : undefined;
    },
    {
      cancel: (): void => {
        stopTimer();
        pending = null;
      },
      flush: (): void => {
        if (pending === null || !trailing) return;
        const args = pending;
        stopTimer();
        invoke(args);
      },
    },
  );
}

/**
 * Wraps `fn` so it runs at most once per `waitMs` window, holding one timer at a time. Defaults are
 * `leading: true, trailing: true`: the first call opens a window and runs `fn` at once, returning its
 * value; calls made while the window is open collapse to their latest arguments; when the window closes,
 * `fn` runs once more with those arguments and that call opens the next window, so a sustained stream
 * produces one call per window. With `leading: false` the first call schedules a single trailing
 * invocation instead, and with `trailing: false` calls inside an open window are dropped. One timer is
 * held at a time: the window a trailing delivery opens closes itself once no further call arrives.
 *
 * @param fn - The function to throttle, invoked without a receiver, so `this` is not forwarded.
 * @param waitMs - Window length in milliseconds; `0` still needs a macrotask to close the window.
 * @param options - Leading and trailing delivery flags.
 * @returns The wrapped function, with `cancel()` attached.
 */
export function throttle<A extends readonly unknown[], R>(
  fn: (...args: A) => R,
  waitMs: number,
  options: RateLimitOptions = {},
): Throttled<A, R> {
  const leading = options.leading ?? true;
  const trailing = options.trailing ?? true;
  if (!leading && !trailing)
    throw new TypeError("throttle needs leading or trailing delivery enabled.");
  const wait = Math.max(0, waitMs);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const openWindow = (): void => {
    timer = setTimeout(onWindowEnd, wait);
  };
  const onWindowEnd = (): void => {
    timer = null;
    const args = pending;
    pending = null;
    if (!trailing || args === null) return;
    fn(...args);
    openWindow();
  };

  return Object.assign(
    (...args: A): R | undefined => {
      if (timer !== null) {
        pending = args;
        return undefined;
      }
      const leadingResult = leading ? fn(...args) : undefined;
      if (!leading) pending = args;
      openWindow();
      return leadingResult;
    },
    {
      cancel: (): void => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        pending = null;
      },
    },
  );
}

/** Configuration for {@link retry}. */
export interface RetryOptions {
  /** Total number of attempts, normalised to an integer of at least 1. */
  readonly attempts: number;
  /** Backoff base in milliseconds: the wait before attempt n + 1 is `baseDelayMs * 2 ** (n - 1)`. */
  readonly baseDelayMs: number;
  /** Ceiling for one backoff wait, applied after doubling. Defaults to no ceiling. */
  readonly maxDelayMs?: number;
  /** Cancellation: an aborted signal stops the retries and surfaces the abort failure. */
  readonly signal?: AbortSignal;
  /** Decides whether a failure is worth another attempt; see {@link retry} for the default. */
  readonly shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/**
 * Runs `operation`, retrying a failed attempt with exponential backoff, and surfaces the last failure
 * rather than swallowing it. The wait before attempt n + 1 is `baseDelayMs * 2 ** (n - 1)` capped by
 * `maxDelayMs`, so `{ attempts: 3, baseDelayMs: 200 }` means at most three calls with waits of 200 ms
 * then 400 ms between them. `shouldRetry` defaults to a predicate that never retries an `AbortError`
 * and never retries an error carrying a `status` from 400 to 499, because a request the endpoint has
 * already rejected will be rejected again, while a timeout error is transient and is retried. An
 * aborted `signal` stops the retries before an attempt and between attempts.
 *
 * @param operation - Called with the 1-based attempt number; may be asynchronous.
 * @param options - Attempt count, backoff base and optional cap, signal and retry predicate.
 * @returns The value of the first successful attempt.
 * @throws The final failure, or the abort failure when the signal aborts before or between attempts.
 */
export async function retry<T>(
  operation: (attempt: number) => T | Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts));
  const baseDelayMs = Math.max(0, options.baseDelayMs);
  const cap = options.maxDelayMs ?? Number.POSITIVE_INFINITY;
  const shouldRetry = options.shouldRetry ?? isRetryableFailure;
  let lastFailure: unknown;
  let attempt = 0;

  while (attempt < attempts) {
    throwIfAborted(options.signal);
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (error: unknown) {
      lastFailure = error;
      if (attempt >= attempts || !shouldRetry(error, attempt)) throw error;
      await delay(Math.min(baseDelayMs * 2 ** (attempt - 1), cap), options.signal);
    }
  }
  throw lastFailure; // Unreachable: the final iteration either returns or throws.
}

/**
 * The default retry predicate: everything is worth another attempt except a cancellation and a failure
 * carrying a 4xx `status` — the error shape `src/lib/apiClient.ts` and the mock server produce — because
 * repeating a request the endpoint has already rejected cannot succeed.
 */
function isRetryableFailure(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (typeof error !== "object" || error === null) return true;
  const status: unknown = (error as { readonly status?: unknown }).status;
  return !(typeof status === "number" && status >= 400 && status < 500);
}
