import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A logout clears the proof warnings (decision 2.6).
 *
 * The store keeps warning texts, with recipients' names, on disk per driver
 * and company. Nothing removed them at logout, and pruning runs only on a
 * write. `clearProofFeedbackStore` is the one call the logout makes (next to
 * `clearQueryCache()`); the store is real, the disk is a Map whose reads can
 * be held to put a hydration in flight.
 */
const disk = new Map<string, string>();

let holdReads = false;
let releaseRead: () => void = () => undefined;

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => {
      // Read now, delivered when released: a read in flight already holds
      // what was on disk.
      const value = disk.get(key) ?? null;

      if (holdReads) {
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
      }

      return value;
    },
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
  },
}));

type Store = typeof import("@/features/notifications/proof-feedback-store");

const KEY = "@trajetto:proof-feedback:v1";
const DELIVERY = "0192b1c4-0000-4000-8000-000000000001";
const SCOPE = "user-driver:business-1";

const MESSAGE =
  "Entrega para Mercado Central. A leitura automática apontou: não foi encontrada assinatura. Se ainda estiver no local, confira o canhoto com o destinatário. A equipe vai revisar o comprovante.";

const warning = () => ({
  deliveryId: DELIVERY,
  title: "Comprovante com possível problema",
  message: MESSAGE,
  at: new Date(Date.now() - 60_000).toISOString(),
  notificationId: "notification-1",
  live: false,
});

const flush = async () => {
  for (let tick = 0; tick < 10; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/** A fresh store module, as after an app start: nothing read from disk yet. */
async function freshStore(): Promise<Store> {
  vi.resetModules();

  return import("@/features/notifications/proof-feedback-store");
}

beforeEach(() => {
  disk.clear();
  holdReads = false;
});

describe("clearing the proof warnings at logout", () => {
  it("forgets every warning and mark, in memory and on disk", async () => {
    const store = await freshStore();

    await store.hydrateProofFeedbackStore();
    store.useProofFeedbackStore.getState().record(SCOPE, warning());
    await store.markDeliveryProofSubmitted(DELIVERY, Date.now());
    await flush();

    expect(disk.get(KEY)).toContain("Mercado Central");

    await store.clearProofFeedbackStore();

    const state = store.useProofFeedbackStore.getState();

    expect(state.byScope).toEqual({});
    expect(state.newProofs).toEqual({});
    expect(disk.has(KEY)).toBe(false);

    // The next session starts from nothing, and still works.
    await store.hydrateProofFeedbackStore();
    store.useProofFeedbackStore.getState().record("user-next:business-1", warning());

    expect(Object.keys(store.useProofFeedbackStore.getState().byScope)).toEqual([
      "user-next:business-1",
    ]);
  });

  it("does not let a disk read still in flight bring them back", async () => {
    // What a previous session left on disk.
    disk.set(
      KEY,
      JSON.stringify({
        state: {
          byScope: { [SCOPE]: { [DELIVERY]: { ...warning(), receivedAt: Date.now() } } },
          newProofs: {},
        },
        version: 0,
      }),
    );

    const store = await freshStore();

    // The app starts reading the disk; the driver logs out before it lands.
    holdReads = true;
    void store.hydrateProofFeedbackStore();
    await flush();

    const cleared = store.clearProofFeedbackStore();
    await flush();

    releaseRead();
    await cleared;
    await flush();

    expect(store.useProofFeedbackStore.getState().byScope).toEqual({});
    expect(disk.has(KEY)).toBe(false);
  });
});
