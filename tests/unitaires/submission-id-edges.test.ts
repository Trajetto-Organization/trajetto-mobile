import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The submission id store's edges left alive by the 06/10 mutation run: a
 * session ending while an id is being read or written, a storage failure, the
 * epoch that tells a late answer from the current session, and the logout's
 * cleanup around keys and files that are not drafts.
 *
 * Only the natives are stand-ins: AsyncStorage is a Map, the file system an
 * in-memory tree (directories and files), and expo-crypto a counter of
 * valid v4 UUIDs. The module under test is the real one.
 */
const tree = new Set<string>();

vi.mock("expo-file-system", () => {
  class Entry {
    readonly uri: string;

    constructor(...parts: (string | Entry)[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
    }

    get name(): string {
      return this.uri.split("/").pop() ?? "";
    }

    get exists(): boolean {
      return tree.has(this.uri);
    }

    delete(): void {
      for (const path of [...tree]) {
        if (path === this.uri || path.startsWith(`${this.uri}/`)) tree.delete(path);
      }
    }
  }

  class File extends Entry {}

  class Directory extends Entry {
    list(): Entry[] {
      // Stand-in rule: a missing directory cannot be listed.
      if (!this.exists) throw new Error(`missing directory ${this.uri}`);

      const depth = this.uri.split("/").length + 1;

      return [...tree]
        .filter((path) => path.startsWith(`${this.uri}/`) && path.split("/").length === depth)
        .map((path) => (path.split("/").pop()?.includes(".") ? new File(path) : new Directory(path)));
    }
  }

  return { Directory, File, Paths: { document: "doc" } };
});

let uuidCount = 0;
vi.mock("expo-crypto", () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCount).padStart(12, "0")}`,
}));

const storage = new Map<string, string>();
const hooks = vi.hoisted(() => ({
  onGet: null as null | (() => void),
  onSet: null as null | (() => void),
  failGet: false,
}));
const calls = { get: 0, set: 0, multiRemove: 0 };

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getAllKeys: async () => [...storage.keys()],
    multiRemove: async (keys: string[]) => {
      calls.multiRemove += 1;
      keys.forEach((key) => storage.delete(key));
    },
    getItem: async (key: string) => {
      calls.get += 1;
      if (hooks.failGet) {
        hooks.failGet = false;
        throw new Error("storage unavailable");
      }
      hooks.onGet?.();
      return storage.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      calls.set += 1;
      storage.set(key, value);
      hooks.onSet?.();
    },
    removeItem: async (key: string) => void storage.delete(key),
  },
}));

vi.mock("@/features/submissions/outbox", () => ({ detachOutbox: () => {} }));

const {
  clearAllSubmissionData,
  countOpenSubmissionDrafts,
  disableSubmissionPersistence,
  enableSubmissionPersistence,
  getOrCreateSubmissionId,
  getSubmissionPersistenceEpoch,
  holdSubmissionDrafts,
  isSubmissionPersistenceActive,
} = await import("@/features/submissions/submission-id");

const KEY = "@trajetto:submission:checklist:u:b:v";

// Read at import, before any test opens a session.
const activeBeforeAnySession = isSubmissionPersistenceActive(getSubmissionPersistenceEpoch());

beforeEach(() => {
  storage.clear();
  tree.clear();
  hooks.onGet = null;
  hooks.onSet = null;
  hooks.failGet = false;
  calls.get = 0;
  calls.set = 0;
  calls.multiRemove = 0;
  // A fresh session: a settled id stays cached per key until the logout.
  disableSubmissionPersistence();
  enableSubmissionPersistence("u");
});

describe("getOrCreateSubmissionId", () => {
  it("refuses with an AbortError once the session ended", async () => {
    disableSubmissionPersistence();

    await expect(getOrCreateSubmissionId(KEY)).rejects.toMatchObject({
      name: "AbortError",
      message: "Submission persistence is disabled",
    });
    expect(calls.get).toBe(0);
  });

  it("does not read storage for a request whose session ended before it ran", async () => {
    const pending = getOrCreateSubmissionId(KEY);
    disableSubmissionPersistence();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.get).toBe(0);
  });

  it("does not write an id when the session ends during the read", async () => {
    hooks.onGet = () => disableSubmissionPersistence();

    await expect(getOrCreateSubmissionId(KEY)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.set).toBe(0);
  });

  it("takes back the id it wrote when the session ends during the write", async () => {
    hooks.onSet = () => disableSubmissionPersistence();

    await expect(getOrCreateSubmissionId(KEY)).rejects.toMatchObject({ name: "AbortError" });
    expect(storage.has(KEY)).toBe(false);
  });

  it("replaces a stored UUID with anything before or after it", async () => {
    const uuid = "00000000-0000-4000-8000-0000000000aa";

    for (const stored of [`x${uuid}`, `${uuid}x`]) {
      disableSubmissionPersistence();
      enableSubmissionPersistence("u");
      storage.set(KEY, stored);

      expect(await getOrCreateSubmissionId(KEY)).not.toBe(stored);
    }
  });

  it("replaces a stored value that is not a v4 UUID", async () => {
    storage.set(KEY, "not-a-uuid");

    const id = await getOrCreateSubmissionId(KEY);

    expect(id).not.toBe("not-a-uuid");
    expect(storage.get(KEY)).toBe(id);
  });

  it("shares one request between concurrent callers of the same key", () => {
    const first = getOrCreateSubmissionId(KEY);
    const second = getOrCreateSubmissionId(KEY);

    expect(second).toBe(first);
    return first;
  });

  it("retries after a storage failure instead of replaying it", async () => {
    hooks.failGet = true;
    const failed = getOrCreateSubmissionId(KEY);
    await expect(failed).rejects.toThrow("storage unavailable");

    const retried = getOrCreateSubmissionId(KEY);

    expect(retried).not.toBe(failed);
    await expect(retried).resolves.toMatch(/^00000000-0000-4000-8000-/);
  });
});

describe("the session epoch", () => {
  it("starts with persistence closed until a session opens it", () => {
    expect(activeBeforeAnySession).toBe(false);
  });

  it("moves on with every logout, and only the current session is active", () => {
    const before = getSubmissionPersistenceEpoch();

    disableSubmissionPersistence();
    expect(getSubmissionPersistenceEpoch()).toBe(before + 1);
    expect(isSubmissionPersistenceActive(before + 1)).toBe(false);

    enableSubmissionPersistence("u");
    expect(isSubmissionPersistenceActive(before)).toBe(false);
    expect(isSubmissionPersistenceActive(before + 1)).toBe(true);
  });
});

describe("countOpenSubmissionDrafts", () => {
  it("answers zero when storage cannot be read", async () => {
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    const spy = vi.spyOn(AsyncStorage, "getAllKeys").mockRejectedValueOnce(new Error("busy"));

    await expect(countOpenSubmissionDrafts("u")).resolves.toBe(0);
    spy.mockRestore();
  });
});

describe("clearAllSubmissionData", () => {
  it("removes only the submission keys, and skips the call when there are none", async () => {
    storage.set("other-app-key", "x");

    await clearAllSubmissionData();
    expect(storage.get("other-app-key")).toBe("x");
    expect(calls.multiRemove).toBe(0);

    enableSubmissionPersistence("u");
    storage.set(KEY, "id");
    await clearAllSubmissionData();
    expect(storage.has(KEY)).toBe(false);
    expect(calls.multiRemove).toBe(1);
  });

  it("deletes a stray file in the drafts root while a draft is held", async () => {
    tree.add("doc/trajetto-drafts");
    tree.add("doc/trajetto-drafts/stray.json");
    tree.add("doc/trajetto-drafts/checklist");
    tree.add("doc/trajetto-drafts/checklist/held");
    const release = holdSubmissionDrafts("held");

    await clearAllSubmissionData();

    expect(tree.has("doc/trajetto-drafts/stray.json")).toBe(false);
    expect(tree.has("doc/trajetto-drafts/checklist/held")).toBe(true);
    release();
  });

  it("leaves a missing drafts root alone", async () => {
    const release = holdSubmissionDrafts("held");

    await expect(clearAllSubmissionData()).resolves.toBeUndefined();
    release();
  });
});
