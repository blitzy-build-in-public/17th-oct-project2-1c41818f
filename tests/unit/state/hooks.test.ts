/**
 * Path: tests/unit/state/hooks.test.ts
 * Purpose: The `useAsync` share of `src/state/hooks.ts`: disabling the hook cancels the run it has in flight
 * Lines: 49
 *
 * @vitest-environment jsdom
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useAsync } from "@/state/hooks";

import type { Result } from "@/types/common";

/*
 * Why this file asks for a DOM. The rest of this folder is a pure call into a reducer and runs in the state
 * project's own `node` environment, but a hook is exercised by rendering it, and the abort this case asserts
 * is raised by an effect — which only runs against a mounted component. The directive in the header is
 * therefore the one environment change this case needs, and nothing else about it differs from its
 * neighbours.
 *
 * Why the case exists. No screen shows the difference it asserts: a consumer that disables the hook discards
 * the answer either way, so the only observable fact is whether the request was cancelled or left to settle
 * — the signal the run was handed. `src/features/search/SearchBar.tsx` is the consumer that depends on it,
 * blanking the field while the debounced suggestion request is still in the air.
 */

describe("useAsync", () => {
  it("aborts a run in flight when its consumer disables the hook", async () => {
    const signals: AbortSignal[] = [];
    // The run settles on nothing of its own, so the abort under test is the only thing that can end it.
    const load = (signal: AbortSignal): Promise<Result<number>> => {
      signals.push(signal);
      return new Promise<Result<number>>(() => undefined);
    };

    const { rerender } = renderHook(
      ({ enabled }: { readonly enabled: boolean }) => useAsync(load, [], { enabled }),
      { initialProps: { enabled: true } },
    );
    // The run starts from the hook's own microtask, so the first awaited expectation is what finds it.
    await waitFor(() => expect(signals.map((signal) => signal.aborted)).toEqual([false]));

    rerender({ enabled: false });

    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
  });
});
