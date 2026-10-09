import AsyncStorage from "@react-native-async-storage/async-storage";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

import {
  markDeliveryProven,
  recordProofFeedback,
  type NewProofMark,
  type ProofFeedback,
  type ProofFeedbackState,
  type StoredProofFeedback,
} from "./proof-feedback-rules";

/**
 * The proof warnings heard, per driver and company, on disk (decision 6.9).
 *
 * On disk because the delivery shows its warning after the push was tapped
 * away and after the app was killed; scoped because a shared phone must not
 * show one driver's warnings to the next.
 */

interface ProofFeedbackStoreState {
  /** The warnings, per driver and company. */
  byScope: Record<string, ProofFeedbackState["byDelivery"]>;

  /**
   * The latest proof of each delivery tapped on this phone. Not scoped: a
   * delivery id is unique, and the proof action knows the company but not
   * the session's user.
   */
  newProofs: ProofFeedbackState["newProofs"];

  record: (scope: string, feedback: ProofFeedback, now?: number) => void;

  /** Marks the tap; returns the mark it replaced, for `unmarkProven`. */
  markProven: (
    deliveryId: string,
    tappedAt: number,
    now?: number,
  ) => NewProofMark | undefined;

  /** Takes back the tap's mark (the proof never left), if still the latest. */
  unmarkProven: (
    deliveryId: string,
    tappedAt: number,
    previous: NewProofMark | undefined,
  ) => void;
}

/**
 * The warning a delivery held when the driver tapped, whichever session heard
 * it: the marks are not scoped, so neither is what they replace.
 */
function heldAtTap(
  byScope: ProofFeedbackStoreState["byScope"],
  deliveryId: string,
  tappedAt: number,
): StoredProofFeedback | undefined {
  return Object.values(byScope)
    .map((byDelivery) => byDelivery[deliveryId])
    .filter(
      (entry): entry is StoredProofFeedback =>
        entry !== undefined && entry.receivedAt <= tappedAt,
    )
    .sort((left, right) => right.receivedAt - left.receivedAt)[0];
}

/**
 * Storage that never throws: a disk that refuses a write costs the warning
 * its persistence, not an unhandled rejection in the middle of a socket
 * handler.
 */
const safeStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return await AsyncStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: async (name, value) => {
    try {
      await AsyncStorage.setItem(name, value);
    } catch {
      // Kept in memory for this session.
    }
  },
  removeItem: async (name) => {
    try {
      await AsyncStorage.removeItem(name);
    } catch {
      // Nothing to undo.
    }
  },
};

const useProofFeedbackStore = create<ProofFeedbackStoreState>()(
  persist(
    (set, get) => ({
      byScope: {},
      newProofs: {},

      record: (scope, feedback, now = Date.now()) =>
        set((state) => {
          const next = recordProofFeedback(
            { byDelivery: state.byScope[scope] ?? {}, newProofs: state.newProofs },
            feedback,
            now,
          );

          return {
            byScope: { ...state.byScope, [scope]: next.byDelivery },
            newProofs: next.newProofs,
          };
        }),

      markProven: (deliveryId, tappedAt, now = Date.now()) => {
        const previous = get().newProofs[deliveryId];

        set((state) => {
          const held = heldAtTap(state.byScope, deliveryId, tappedAt);

          return {
            newProofs: markDeliveryProven(
              {
                byDelivery: held ? { [deliveryId]: held } : {},
                newProofs: state.newProofs,
              },
              deliveryId,
              tappedAt,
              now,
            ).newProofs,
          };
        });

        return previous;
      },

      unmarkProven: (deliveryId, tappedAt, previous) =>
        set((state) => {
          // A newer tap since owns the mark now.
          if (state.newProofs[deliveryId]?.tappedAt !== tappedAt) return state;

          const { [deliveryId]: _undone, ...others } = state.newProofs;

          return {
            newProofs: previous ? { ...others, [deliveryId]: previous } : others,
          };
        }),
    }),
    {
      name: "@trajetto:proof-feedback:v1",
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({
        byScope: state.byScope,
        newProofs: state.newProofs,
      }),

      // Hydrated on demand, never at import: a write before the disk was
      // read would replace what is on it.
      skipHydration: true,
    },
  ),
);

let hydration: Promise<void> | null = null;

function hydrateProofFeedbackStore(): Promise<void> {
  if (useProofFeedbackStore.persist.hasHydrated()) return Promise.resolve();

  hydration ??= Promise.resolve(useProofFeedbackStore.persist.rehydrate()).catch(
    () => undefined,
  );

  return hydration;
}

/**
 * Forgets every warning and mark, in memory and on disk (decision 2.6: a
 * logout clears the stores). Waits for a hydration in flight: a disk read
 * landing after the clear would bring the warnings back.
 */
async function clearProofFeedbackStore(): Promise<void> {
  await hydration;

  useProofFeedbackStore.setState({ byScope: {}, newProofs: {} });

  await useProofFeedbackStore.persist.clearStorage();
}

/** One driver, one company. */
const proofFeedbackScope = (userId: string, businessId: string): string =>
  `${userId}:${businessId}`;

/** The warnings of one scope, readable by the pure rules. */
function scopedProofFeedback(
  state: Pick<ProofFeedbackStoreState, "byScope" | "newProofs">,
  scope: string,
): ProofFeedbackState {
  return { byDelivery: state.byScope[scope] ?? {}, newProofs: state.newProofs };
}

/**
 * The driver tapped "Comprovar" on this delivery: the warning about the photo
 * the new proof replaces stops showing, including when the inbox brings it
 * back later. Resolves to the undo, for a proof that never leaves the phone
 * (refused on its merits): the old photo stands, and so does its warning.
 *
 * Marked at the tap (phone clock), before the send: a warning about the new
 * photo that lands while the send is in flight must meet the mark, or it is
 * taken for a copy of the old one and merged into it.
 */
async function markDeliveryProofSubmitted(
  deliveryId: string,
  tappedAt: number,
): Promise<() => void> {
  await hydrateProofFeedbackStore();

  const previous = useProofFeedbackStore.getState().markProven(deliveryId, tappedAt);

  return () =>
    useProofFeedbackStore.getState().unmarkProven(deliveryId, tappedAt, previous);
}

export {
  clearProofFeedbackStore,
  hydrateProofFeedbackStore,
  markDeliveryProofSubmitted,
  proofFeedbackScope,
  scopedProofFeedback,
  useProofFeedbackStore,
};
