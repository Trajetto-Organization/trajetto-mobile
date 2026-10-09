import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the phone remembers across the app being killed (decision 6.1: the
 * pause survives the app dying; decision 6.4: a confirmed "a caminho" outlives
 * the queue letting go of it). A "cold start" here is a fresh module
 * instance reading the same disk.
 */

const disk = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
  },
}));

const SCOPE = "user-a:business-1";

const coldStart = async () => {
  vi.resetModules();

  const pauses = await import("@/features/pauses/pause-store");
  const marks = await import("@/features/deliveries/on-the-way-store");

  await pauses.hydratePauseStore();
  await marks.hydrateOnTheWayStore();

  return { pauses, marks };
};

beforeEach(() => {
  disk.clear();
});

describe("after the app is killed", () => {
  it("the open pause is still there, with the key its end needs", async () => {
    const before = await coldStart();

    before.pauses.usePauseStore.getState().setOpen(SCOPE, {
      startSubmissionId: "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01",
      kind: "MEAL",
      startedAt: "2026-09-29T15:00:00.000Z",
      note: "Almoço",
      latitude: null,
      longitude: null,
    });

    // Nothing in memory survives; only the disk does.
    const after = await coldStart();

    expect(after.pauses.usePauseStore.getState().byScope[SCOPE]?.open).toMatchObject({
      startSubmissionId: "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01",
      startedAt: "2026-09-29T15:00:00.000Z",
    });

    // A gesture mid-send is not remembered as mid-send.
    expect(after.pauses.usePauseStore.getState().sending).toEqual({});
  });

  it("a confirmed 'a caminho' is still there", async () => {
    const before = await coldStart();

    before.marks.useOnTheWayStore
      .getState()
      .confirm(SCOPE, "stop-1", { routeId: "route-1", at: "2026-09-29T15:02:07.000Z" });

    const after = await coldStart();

    expect(after.marks.useOnTheWayStore.getState().byScope[SCOPE]?.["stop-1"]).toMatchObject({
      routeId: "route-1",
      at: "2026-09-29T15:02:07.000Z",
    });
  });

  it("a late answer for an older tap never moves a stop's mark back in time", async () => {
    const { marks } = await coldStart();
    const confirm = marks.useOnTheWayStore.getState().confirm;

    confirm(SCOPE, "stop-1", { routeId: "route-1", at: "2026-09-29T15:30:00.000Z" });
    confirm(SCOPE, "stop-1", { routeId: "route-1", at: "2026-09-29T15:00:00.000Z" });

    expect(marks.useOnTheWayStore.getState().byScope[SCOPE]["stop-1"].at).toBe(
      "2026-09-29T15:30:00.000Z",
    );
  });

  it("another driver on the same phone sees none of it", async () => {
    const before = await coldStart();

    before.pauses.usePauseStore.getState().setOpen(SCOPE, {
      startSubmissionId: "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01",
      kind: "REST",
      startedAt: "2026-09-29T15:00:00.000Z",
      note: null,
      latitude: null,
      longitude: null,
    });

    const after = await coldStart();

    expect(after.pauses.usePauseStore.getState().byScope["user-b:business-1"]).toBeUndefined();
  });
});
