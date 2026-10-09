import { useRef, useState, useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

import { formRefreshOf, type FormRefresh } from "./occurrence-queue-rules";

/** The day's refetch (react-query's: resolves with the error, never throws). */
type Refetch = () => Promise<{ isError: boolean }>;

interface FormRefreshTracker {
  /** Reread the day for the current form. */
  request: () => void;

  /** The latest request as its refetch settled: never "offline". */
  current: () => FormRefresh;

  subscribe: (listener: () => void) => () => void;
}

/**
 * The reread that brings the current form after a refusal, framework-free.
 * Only the latest request speaks: an older one settling late (a paused fetch
 * resumed, a refetch cancelled by the next) does not overwrite it.
 */
function createFormRefreshTracker(refetch: Refetch): FormRefreshTracker {
  let requested: FormRefresh = "idle";
  let latest = 0;

  const listeners = new Set<() => void>();

  const settle = (ticket: number, next: FormRefresh) => {
    if (ticket !== latest || requested === next) return;

    requested = next;
    listeners.forEach((listener) => listener());
  };

  return {
    request: () => {
      latest += 1;
      const ticket = latest;

      settle(ticket, "loading");

      refetch().then(
        (result) => settle(ticket, result.isError ? "failed" : "done"),
        () => settle(ticket, "failed"),
      );
    },
    current: () => requested,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// The network as react-query sees it (NetInfo, wired in the query provider):
// the same reading that pauses the fetch.
const subscribeOnline = (listener: () => void) => onlineManager.subscribe(() => listener());
const isOnline = () => onlineManager.isOnline();

/**
 * The form refresh as the report screen shows it. Offline, react-query
 * pauses the refetch and its promise stays pending until the network is
 * back: the screen shows "offline" and lets the driver send (the report is
 * queued, and returns for review if the form changed), and the paused fetch
 * resumes by itself on reconnect.
 */
function useFormRefresh(input: { refetch: Refetch; listLoading: boolean }): {
  refresh: FormRefresh;
  request: () => void;
} {
  // The latest refetch, read when a request is made: the tracker lives as
  // long as the screen.
  const refetch = useRef(input.refetch);
  refetch.current = input.refetch;

  const [tracker] = useState(() => createFormRefreshTracker(() => refetch.current()));

  const requested = useSyncExternalStore(tracker.subscribe, tracker.current);
  const online = useSyncExternalStore(subscribeOnline, isOnline);

  return {
    refresh: formRefreshOf({ requested, listLoading: input.listLoading, online }),
    request: tracker.request,
  };
}

export { createFormRefreshTracker, useFormRefresh };
export type { FormRefreshTracker };
