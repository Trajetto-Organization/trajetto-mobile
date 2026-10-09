import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The logout's draft cleanup, and the one submission it must not touch.
 *
 * A 401 that cannot be refreshed logs the driver out from INSIDE the request,
 * before the error reaches `submitOrQueue` — and the logout deletes every
 * draft photo on the phone. The checklist being sent at that moment reads its
 * photos from exactly those files, so by the time the queue tried to copy
 * them there was nothing left to copy (MOB-07).
 *
 * The filesystem here is an in-memory tree with the same `Directory` surface
 * `submission-id` uses.
 */
const tree = new Set<string>();

vi.mock("expo-file-system", () => {
  class Directory {
    readonly uri: string;

    constructor(...parts: (string | Directory)[]) {
      this.uri = parts
        .map((part) => (typeof part === "string" ? part : part.uri))
        .join("/");
    }

    get name(): string {
      return this.uri.split("/").pop() ?? "";
    }

    get exists(): boolean {
      return tree.has(this.uri);
    }

    delete(): void {
      for (const path of [...tree]) {
        if (path === this.uri || path.startsWith(`${this.uri}/`)) {
          tree.delete(path);
        }
      }
    }

    list(): Directory[] {
      const depth = this.uri.split("/").length + 1;

      return [...tree]
        .filter(
          (path) =>
            path.startsWith(`${this.uri}/`) && path.split("/").length === depth,
        )
        .map((path) => new Directory(path));
    }
  }

  return { Directory, Paths: { document: "doc" } };
});

vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getAllKeys: async () => [...storage.keys()],
    multiRemove: async (keys: string[]) => keys.forEach((k) => storage.delete(k)),
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => void storage.set(key, value),
    removeItem: async (key: string) => void storage.delete(key),
  },
}));

vi.mock("@/features/submissions/outbox", () => ({ detachOutbox: () => {} }));

const { clearAllSubmissionData, holdSubmissionDrafts } = await import(
  "@/features/submissions/submission-id"
);

const draft = (kind: string, id: string) => `doc/trajetto-drafts/${kind}/${id}`;

const seed = () => {
  tree.clear();
  tree.add("doc/trajetto-drafts");
  tree.add("doc/trajetto-drafts/checklist");
  tree.add("doc/trajetto-drafts/fuel");
  tree.add(draft("checklist", "sending"));
  tree.add(`${draft("checklist", "sending")}/pneus-1.jpg`);
  tree.add(draft("checklist", "half-filled"));
  tree.add(draft("fuel", "other"));

  storage.clear();
  storage.set("@trajetto:submission:checklist:u:b:v", "sending");
};

beforeEach(seed);

describe("the logout's draft cleanup", () => {
  it("still deletes every draft when nothing is being sent", async () => {
    await clearAllSubmissionData();

    expect(tree.has("doc/trajetto-drafts")).toBe(false);
    expect(storage.size).toBe(0);
  });

  it("spares the photos of a submission in flight, and only those", async () => {
    const release = holdSubmissionDrafts("sending");

    await clearAllSubmissionData();

    expect(tree.has(`${draft("checklist", "sending")}/pneus-1.jpg`)).toBe(true);
    expect(tree.has(draft("checklist", "half-filled"))).toBe(false);
    expect(tree.has(draft("fuel", "other"))).toBe(false);

    // The form's keys still go: the session that owned them is over.
    expect(storage.size).toBe(0);

    release();
  });

  it("lets go once the submission is settled, so the next logout takes the rest", async () => {
    const release = holdSubmissionDrafts("sending");
    release();

    await clearAllSubmissionData();

    expect(tree.has("doc/trajetto-drafts")).toBe(false);
  });

  it("keeps a draft held twice until both holders let go", async () => {
    const first = holdSubmissionDrafts("sending");
    const second = holdSubmissionDrafts("sending");

    first();
    first(); // releasing twice must not drop the other holder's claim

    await clearAllSubmissionData();
    expect(tree.has(draft("checklist", "sending"))).toBe(true);

    second();
    await clearAllSubmissionData();
    expect(tree.has("doc/trajetto-drafts")).toBe(false);
  });
});
