import { create } from "zustand";

import { classifyOwnership } from "@/features/submissions/outbox-rules";
import { getSubmissionOwner } from "@/features/submissions/submission-owner";

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

/**
 * The counts below all ask about ownership, because `items` holds two kinds of
 * thing: this driver's queue, and submissions left by an older version of the
 * app that never recorded whose they were. Only the first will ever leave on
 * its own, so only the first may be described as waiting for a connection.
 *
 * Reading the owner from outside the store is safe here: it only ever changes
 * alongside a `setItems`, so every selector re-runs when it does.
 */
const isOwn = (item: OutboxItem): boolean =>
  classifyOwnership(item, getSubmissionOwner()) === "own";

/** Waiting to be sent, or waiting to be retried. */
const selectPendingCount = (state: OutboxState): number =>
  state.items.filter((item) => isOwn(item) && item.status === "pending").length;

/** Rejected for a reason retrying will not fix — these need a person. */
const selectFailedCount = (state: OutboxState): number =>
  state.items.filter((item) => isOwn(item) && item.status === "failed").length;

/**
 * Queued before the app recorded ownership. Nothing will send these until
 * somebody says they are theirs, so they need a person just as a failure does.
 */
const selectUnclaimedCount = (state: OutboxState): number =>
  state.items.filter(
    (item) => classifyOwnership(item, getSubmissionOwner()) === "unclaimed",
  ).length;

/**
 * Refused because the company switched a module off. Neither waiting for a
 * connection nor rejected on the merits: they go out by themselves once the
 * module is back, and until then the driver has to be able to see them —
 * they used to be counted nowhere (MOB-03).
 */
const selectParkedCount = (state: OutboxState): number =>
  state.items.filter((item) => isOwn(item) && item.status === "parked").length;

/**
 * Everything that will not leave on its own with a connection: rejected,
 * unclaimed or parked. What a "needs attention" strip should count.
 */
const selectNeedsAttentionCount = (state: OutboxState): number =>
  selectFailedCount(state) +
  selectUnclaimedCount(state) +
  selectParkedCount(state);

export {
  useOutboxStore,
  selectFailedCount,
  selectNeedsAttentionCount,
  selectParkedCount,
  selectPendingCount,
  selectUnclaimedCount,
};
export type { OutboxState };
