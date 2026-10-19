/**
 * Path: tests/unit/state/asyncQuery.test.ts
 * Purpose: The abortable async-data contract of src/state/asyncQuery.ts: what a run reports when it is superseded, cancelled or thrown out of, and what the options each default to
 * Lines: 344
 *
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FEEDBACK_COPY } from "@/constants/content";
import { useAsync } from "@/state/asyncQuery";
import { createAbortError } from "@/utils/async";
import { makeApiError, makeFailureResult, makeResult } from "../../fixtures";

import type { ApiError, Result } from "@/types/common";

/*
 * Why this file asks for a DOM. `useAsync` exists to be rendered: every fact it reports is a hook return value,
 * and the runs it starts are effects, so each case mounts a component and observes what it renders.
 *
 * Why the cases exist. `src/state/asyncQuery.ts` is the single home of the async-data concern the catalogue, the
 * cart, the dashboard and the reports all read through `src/state/hooks.ts`, and what a page renders — a
 * placeholder, a payload, a failure, a retry — is exactly the four states this hook publishes. The cases below
 * drive the paths no screen can be reached through without one: a run that is superseded, one cancelled by its
 * own consumer, one that throws, and the options a caller leaves out.
 */

// Everything the cases hold still between two runs is a promise a case settles by hand, so a race is observed
// while the request it belongs to is still in flight rather than after both have settled.

/** A promise a case settles itself, so an in-flight run is observed before its answer exists. */
interface Deferred<TValue> {
  readonly promise: Promise<TValue>;
  resolve(value: TValue): void;
  reject(reason: unknown): void;
}

/** Builds a promise nothing settles until the case that owns it does. */
function createDeferred<TValue>(): Deferred<TValue> {
  let settle: (value: TValue) => void = () => undefined;
  let fail: (reason: unknown) => void = () => undefined;
  const promise = new Promise<TValue>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, resolve: (value) => settle(value), reject: (reason) => fail(reason) };
}

/**
 * A promise rejecting with the value a case hands it: the bare failures a run may throw out with, which no
 * `Promise.reject` call may carry without wrapping them in an `Error` first.
 */
async function rejectsWith(failure: unknown): Promise<never> {
  await Promise.resolve();
  throw failure;
}

/** The payload a successful run answers with, named so the assertions read a value rather than a union member. */
const PAYLOAD_VALUE = "Aurora Desk Lamp";

/** The success a run answers with, built by the fixtures so no case invents a payload shape. */
const PAYLOAD: Result<string> = makeResult(PAYLOAD_VALUE);

/** The failure the transport itself shapes, which a run hands back rather than throwing. */
const TRANSPORT_FAILURE = makeApiError({
  status: 404,
  code: "not-found",
  message: "That product is no longer listed.",
});

/** What the hook reports for a rejection that carries no failure of its own. */
const UNEXPECTED_FAILURE: ApiError = {
  status: 500,
  code: "unexpected-error",
  message: FEEDBACK_COPY.ERROR_STATE_BODY,
};

/**
 * Rejections a run may throw out with, and the failure the hook reports for each. The first is the failure the
 * seam itself shapes — the fields of an `ApiError` on the thrown value — and the rest are the shapes
 * `failureFrom` has to turn into one: an `Error`, an `Error` with no message, and values that are not errors and
 * only partly resemble one.
 */
const THROWN_FAILURES: readonly [string, unknown, ApiError][] = [
  ["a failure that already carries the transport's fields", TRANSPORT_FAILURE, TRANSPORT_FAILURE],
  [
    "an error carrying its own message",
    new Error("The request could not be completed."),
    { ...UNEXPECTED_FAILURE, message: "The request could not be completed." },
  ],
  ["an error carrying no message", new Error(""), UNEXPECTED_FAILURE],
  ["a bare value that is not an error at all", "The request failed.", UNEXPECTED_FAILURE],
  ["nothing at all", null, UNEXPECTED_FAILURE],
  [
    "an object whose status is not a number",
    { status: "500", code: "unexpected-error", message: "The request failed." },
    UNEXPECTED_FAILURE,
  ],
  [
    "an object whose code is not text",
    { status: 500, code: 500, message: "The request failed." },
    UNEXPECTED_FAILURE,
  ],
  ["an object with no message", { status: 500, code: "unexpected-error" }, UNEXPECTED_FAILURE],
];

/** The two inputs the searches below read: the term in the box and the sort selected beside it. */
interface SearchInputs {
  readonly query: string;
  readonly sort: string | null;
}

/** The inputs the first render of a two-input case holds: a term, and no sort selected yet. */
const SEARCHED_ONCE: SearchInputs = { query: "lamp", sort: null };

describe("useAsync", () => {
  it.each(THROWN_FAILURES)(
    "shapes %s into the failure a page renders",
    async (_label, thrown, expected) => {
      const { result } = renderHook(() => useAsync<string>(() => rejectsWith(thrown), []));

      await waitFor(() => expect(result.current.status).toBe("error"));
      expect(result.current.error).toEqual(expected);
      // A failed run reports no payload, whatever it was handed before.
      expect(result.current.data).toBeNull();
      // A rejection the seam already shaped is surfaced unchanged, not rebuilt from its message.
      if (expected === TRANSPORT_FAILURE) expect(result.current.error).toBe(thrown);
    },
  );

  it("reports a request the transport failed with the failure it answered", async () => {
    const { result } = renderHook(() =>
      useAsync<string>(() => Promise.resolve(makeFailureResult<string>(TRANSPORT_FAILURE)), []),
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toEqual(TRANSPORT_FAILURE);
    // A failed run reports no payload, so a region answering with its error state shows nothing of its own.
    expect(result.current.data).toBeNull();
  });

  it("reports nothing when the run itself rejects the cancellation it was handed", async () => {
    const cancellation = createAbortError("The request was cancelled.");
    const { result } = renderHook(() => useAsync<string>(() => Promise.reject(cancellation), []));

    // A cancelled run is not a failure to show a reader: no state is published for it, so the hook stays on the
    // state the run that cancelled it left behind — here, the loading snapshot.
    await waitFor(() => expect(result.current.status).toBe("loading"));
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
  });

  it("ignores a failure that arrives after the run was cancelled", async () => {
    const pending = createDeferred<Result<string>>();
    const { result } = renderHook(() => useAsync<string>(() => pending.promise, []));
    await waitFor(() => expect(result.current.status).toBe("loading"));

    act(() => result.current.cancel());
    // The run answers anyway, because a request already in the air cannot be stopped — only ignored.
    await act(async (): Promise<void> => {
      pending.reject(new Error("The request failed after the cancellation."));
      await Promise.resolve();
    });

    expect(result.current.status).toBe("loading");
    expect(result.current.error).toBeNull();
  });

  it("aborts the run a newer one supersedes and discards the answer that arrives after it", async () => {
    const signals: AbortSignal[] = [];
    const pending: Deferred<Result<string>>[] = [];
    const run = (signal: AbortSignal): Promise<Result<string>> => {
      signals.push(signal);
      const next = createDeferred<Result<string>>();
      pending.push(next);
      return next.promise;
    };

    const { result, rerender } = renderHook(
      ({ query }: { readonly query: string }) => useAsync<string>(run, [query]),
      { initialProps: { query: "lamp" } },
    );
    await waitFor(() => expect(signals).toHaveLength(1));

    rerender({ query: "kettle" });
    await waitFor(() => expect(signals).toHaveLength(2));
    // The superseded request is stopped, not merely ignored, which is what forwarding the signal buys.
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    // Its answer is discarded, so the state in force belongs to the run the reader is waiting for.
    await act(async (): Promise<void> => {
      pending[0].resolve(makeResult("the superseded answer"));
      await Promise.resolve();
    });
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();

    await act(async (): Promise<void> => {
      pending[1].resolve(makeResult("the answer in force"));
      await Promise.resolve();
    });
    expect(result.current.status).toBe("success");
    expect(result.current.data).toBe("the answer in force");
  });

  it("cancels a run whose loading snapshot has not landed yet", async () => {
    const run = vi.fn(() => Promise.resolve(PAYLOAD));
    const { result } = renderHook(() => useAsync<string>(run, []));

    // The loading snapshot is published from a microtask, so a cancellation in the same tick reaches the run
    // before it starts: the transport is never asked and the state stays where it began.
    act(() => result.current.cancel());
    await act(async (): Promise<void> => {
      await Promise.resolve();
    });

    expect(run).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeNull();
  });

  it("returns to idle and discards what it held when the caller resets", async () => {
    const pending = createDeferred<Result<string>>();
    const { result } = renderHook(() => useAsync<string>(() => pending.promise, []));
    await waitFor(() => expect(result.current.status).toBe("loading"));

    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    // The run that was in flight is stopped, so its answer cannot put the state back where reset took it from.
    await act(async (): Promise<void> => {
      pending.resolve(makeResult("the answer nobody is waiting for"));
      await Promise.resolve();
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeNull();
  });

  it("keeps the payload on screen while a newer run is in flight when the caller asks it to", async () => {
    const pending: Deferred<Result<string>>[] = [];
    const run = (): Promise<Result<string>> => {
      const next = createDeferred<Result<string>>();
      pending.push(next);
      return next.promise;
    };
    const { result } = renderHook(() => useAsync<string>(run, [], { keepPreviousData: true }));
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async (): Promise<void> => {
      pending[0].resolve(makeResult("the answer on screen"));
      await Promise.resolve();
    });
    expect(result.current.status).toBe("success");

    // A region refreshing content already on screen renders it rather than its placeholder, and reports the
    // wait through its own busy state.
    act(() => result.current.reload());
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBe("the answer on screen");
  });

  it("waits for reload to run when the caller asks it not to run on mount", async () => {
    const run = vi.fn(() => Promise.resolve(PAYLOAD));
    const { result } = renderHook(() => useAsync<string>(run, [], { immediate: false }));

    // A screen that fetches only on demand — a detail panel opened by an action — makes no empty first call.
    expect(run).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe(PAYLOAD_VALUE);
  });

  it("keeps the run it holds when a render hands it an equal dependency list", async () => {
    const run = vi.fn(() => Promise.resolve(PAYLOAD));
    const { result, rerender } = renderHook(
      ({ query }: { readonly query: string }) => useAsync<string>(run, [query]),
      { initialProps: { query: "lamp" } },
    );
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(run).toHaveBeenCalledTimes(1);

    // The list is rebuilt on every render, so the elements are what decides whether a load is owed.
    rerender({ query: "lamp" });
    await act(async (): Promise<void> => {
      await Promise.resolve();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe(PAYLOAD_VALUE);
  });

  it("runs again when the dependency list changes length", async () => {
    const run = vi.fn(() => Promise.resolve(PAYLOAD));
    const { rerender } = renderHook(
      ({ query, sort }: SearchInputs) =>
        useAsync<string>(run, sort === null ? [query] : [query, sort]),
      { initialProps: SEARCHED_ONCE },
    );
    await act(async (): Promise<void> => {
      await Promise.resolve();
    });
    expect(run).toHaveBeenCalledTimes(1);

    // An input the request reads has joined the list, so the request it changes is made again.
    rerender({ query: "lamp", sort: "price-ascending" });
    await act(async (): Promise<void> => {
      await Promise.resolve();
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs on mount and drops its payload for the next run when the caller leaves the options out", async () => {
    const pending: Deferred<Result<string>>[] = [];
    const run = (): Promise<Result<string>> => {
      const next = createDeferred<Result<string>>();
      pending.push(next);
      return next.promise;
    };
    const { result } = renderHook(() => useAsync<string>(run, []));
    await waitFor(() => expect(pending).toHaveLength(1));

    await act(async (): Promise<void> => {
      pending[0].resolve(makeResult("the first answer"));
      await Promise.resolve();
    });
    expect(result.current.status).toBe("success");
    expect(result.current.data).toBe("the first answer");

    // The default is not to keep the payload, so a region whose content is a function of it alone renders its
    // placeholder while the next run is in flight rather than showing what the last one answered.
    act(() => result.current.reload());
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
