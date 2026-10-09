import { create } from "zustand";

import type { LocationAccess } from "./location-access-rules";

/**
 * What the position tracking knows that a screen should show.
 *
 * The tracking hook is mounted once, above every screen, and returns nothing;
 * this store is how the deliveries screens learn that the route is running
 * without the tower seeing it (MOB-TRK-5), and how they ask the hook to try
 * again after the driver fixes the permission.
 */
interface TrackingStatusState {
  /** A route of the driver's is IN_PROGRESS. */
  wanted: boolean;

  access: LocationAccess;

  /** Bumped to make the tracking hook start over (permission granted). */
  retryToken: number;

  report: (status: { wanted?: boolean; access?: LocationAccess }) => void;
  retry: () => void;
  reset: () => void;
}

const useTrackingStatus = create<TrackingStatusState>((set) => ({
  wanted: false,
  access: "unknown",
  retryToken: 0,

  report: (status) => set(status),
  retry: () => set((state) => ({ retryToken: state.retryToken + 1 })),
  reset: () => set({ wanted: false, access: "unknown" }),
}));

export { useTrackingStatus };
export type { TrackingStatusState };
