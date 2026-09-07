"use client";

// useAsyncAction — small wrapper that bundles isLoading + error for an
// async action. Designed for Astryx Button/Selector/Switch's `isLoading`
// and `isDisabled` props, and for the toast/banner error surface.
//
// Returned `run` is a stable callback (useCallback). It never throws —
// caught errors land in `state.error` and (optionally) `onError`. The
// caller is responsible for surfacing the message via Toast/Banner.

import { useCallback, useState } from "react";
import { toUserMessage } from "./auth";

export type AsyncState =
  | { status: "idle"; error: null }
  | { status: "pending"; error: null }
  | { status: "error"; error: string };

export function useAsyncAction<TArgs extends unknown[], TRet>(
  fn: (...args: TArgs) => Promise<TRet>,
  onError?: (message: string) => void,
): [(...args: TArgs) => Promise<TRet | undefined>, AsyncState] {
  const [state, setState] = useState<AsyncState>({ status: "idle", error: null });
  const run = useCallback(
    async (...args: TArgs) => {
      setState({ status: "pending", error: null });
      try {
        const result = await fn(...args);
        setState({ status: "idle", error: null });
        return result;
      } catch (e) {
        const msg = toUserMessage(e, "Something went wrong.");
        setState({ status: "error", error: msg });
        onError?.(msg);
        return undefined;
      }
    },
    [fn, onError],
  );
  return [run, state];
}
