import { create } from "zustand";

import type { OutboxItem } from "@/features/submissions/outbox";

interface OutboxState {
  /** Everything still waiting to reach the API, oldest first. */
  items: OutboxItem[];

  /** True while the queue is working through it. */
  isProcessing: boolean;

  /** The item being sent right now, and how far its photos have gone. */
  activeItemId: string | null;
  activeProgress: { uploaded: number; total: number } | null;

  setItems: (items: OutboxItem[]) => void;
  setProcessing: (isProcessing: boolean) => void;
  setActive: (
    activeItemId: string | null,
    activeProgress: { uploaded: number; total: number } | null,
  ) => void;
}

/**
 * What the queue looks like from the screens' point of view.
 *
 * State lives here rather than inside the queue module because the queue runs
 * from places that are not React — a NetInfo callback, an AppState listener,
 * the boot sequence. This store is the bridge, the same way `connection-store`
 * is for `apiClient`.
 */
const useOutboxStore = create<OutboxState>((set) => ({
  items: [],
  isProcessing: false,
  activeItemId: null,
  activeProgress: null,

  setItems: (items) => set({ items }),
  setProcessing: (isProcessing) => set({ isProcessing }),
  setActive: (activeItemId, activeProgress) =>
    set({ activeItemId, activeProgress }),
}));

/** Waiting to be sent, or waiting to be retried. */
const selectPendingCount = (state: OutboxState): number =>
  state.items.filter((item) => item.status === "pending").length;

/** Rejected for a reason retrying will not fix — these need a person. */
const selectFailedCount = (state: OutboxState): number =>
  state.items.filter((item) => item.status === "failed").length;

export { useOutboxStore, selectPendingCount, selectFailedCount };
export type { OutboxState };
