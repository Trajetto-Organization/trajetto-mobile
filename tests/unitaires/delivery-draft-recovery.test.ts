import { beforeEach, describe, expect, it, vi } from "vitest";

// Compiled here, at collection, which has no time budget. `launchApp` below
// re-imports these after `vi.resetModules()`, and that only re-evaluates the
// cached transform. Without this, the first case also paid the one-off
// compile of the whole graph inside its 5 s: 140 ms alone, 3.0-3.4 s with
// three suites sharing the host, and past 5 s on a busy machine. None of these
// modules does anything on import, so the instances loaded here are unused.
import "@/features/submissions/submission-id";
import "@/features/deliveries/delivery-draft";
import "@/features/deliveries/delivery-draft-rules";
import "@/features/media/pending-capture";
import "@/features/submissions/logout-rules";

/**
 * A proof survives the app being killed (MOB-12).
 *
 * The stub photo, the signature and "Quem recebeu" lived only in React
 * state. On an entry-level phone Android often kills the app while the
 * camera is open: everything was lost, and the camera's picture came back to
 * an app that no longer had the screen that asked for it.
 *
 * Driven through the real draft store, submission ids and pending-capture
 * marker, with AsyncStorage and the filesystem kept in memory across a
 * simulated process death (`vi.resetModules`), and the picker's pending
 * result stubbed.
 */

const local = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => local.get(key) ?? null,
    setItem: async (key: string, value: string) => void local.set(key, value),
    removeItem: async (key: string) => void local.delete(key),
    multiRemove: async (keys: string[]) => keys.forEach((key) => local.delete(key)),
    getAllKeys: async () => [...local.keys()],
  },
}));

/** The device's files: uri → size. Survives the "process death" below. */
const files = new Map<string, number>();
const directories = new Set<string>();

vi.mock("expo-file-system", () => {
  const uriOf = (base: string | { uri: string }) =>
    typeof base === "string" ? base : base.uri;

  class Directory {
    uri: string;

    constructor(base: string | { uri: string }, ...names: string[]) {
      const root = uriOf(base).replace(/\/?$/, "/");
      this.uri = `${root}${names.join("/")}/`.replace(/\/+$/, "/");
    }

    create() {
      directories.add(this.uri);
    }

    get exists() {
      return (
        directories.has(this.uri) ||
        [...files.keys()].some((uri) => uri.startsWith(this.uri))
      );
    }

    delete() {
      for (const uri of [...files.keys()]) {
        if (uri.startsWith(this.uri)) files.delete(uri);
      }
      for (const uri of [...directories]) {
        if (uri.startsWith(this.uri)) directories.delete(uri);
      }
    }
  }

  class File {
    uri: string;

    constructor(base: string | { uri: string }, name?: string) {
      this.uri = name === undefined ? uriOf(base) : `${uriOf(base)}${name}`;
    }

    get exists() {
      return files.has(this.uri);
    }

    get name() {
      return this.uri.split("/").pop() ?? "";
    }

    get size() {
      return files.get(this.uri) ?? null;
    }

    copy(destination: File) {
      files.set(destination.uri, files.get(this.uri) ?? 0);
    }

    delete() {
      files.delete(this.uri);
    }
  }

  return {
    Directory,
    File,
    Paths: {
      document: { uri: "file:///data/documents/" },
      cache: { uri: "file:///data/cache/" },
    },
  };
});

let uuidCounter = 0;

vi.mock("expo-crypto", () => ({
  randomUUID: () =>
    `00000000-0000-4000-8000-${String((uuidCounter += 1)).padStart(12, "0")}`,
}));

const pendingResult = {
  value: null as unknown,
  asked: 0,
};

vi.mock("expo-image-picker", () => ({
  getPendingResultAsync: async () => {
    pendingResult.asked += 1;

    const value = pendingResult.value;
    pendingResult.value = null;

    return value;
  },
}));

vi.mock("react-native-toast-message", () => ({ default: { show: () => undefined } }));

// Re-encoding is native; it returns the photo it was given here.
vi.mock("@/features/media/prepare-image", () => ({
  prepareUploadImage: async (asset: unknown) => asset,
  getImageValidationError: () => null,
}));

// `submission-id` detaches the queue on logout; the queue is not under test.
vi.mock("@/features/submissions/outbox", () => ({ detachOutbox: () => undefined }));

const USER = "driver-a";
const TARGET = {
  kind: "delivery-proof" as const,
  businessId: "business-1",
  deliveryId: "delivery-1",
};

const cameraShot = {
  uri: "file:///data/cache/ImagePicker/shot.jpg",
  width: 1200,
  height: 900,
  fileName: "shot.jpg",
  fileSize: 2048,
  mimeType: "image/jpeg",
};

/** A fresh JavaScript context over the same device: what a relaunch is. */
async function launchApp() {
  vi.resetModules();

  const submissionId = await import("@/features/submissions/submission-id");
  submissionId.enableSubmissionPersistence(USER);

  return {
    submissionId,
    draft: await import("@/features/deliveries/delivery-draft"),
    rules: await import("@/features/deliveries/delivery-draft-rules"),
    pending: await import("@/features/media/pending-capture"),
    logoutRules: await import("@/features/submissions/logout-rules"),
  };
}

beforeEach(() => {
  local.clear();
  files.clear();
  directories.clear();
  pendingResult.value = null;
  pendingResult.asked = 0;
});

describe("the app killed while the camera is open", () => {
  it("puts the picture into the proof it was taken for, with what was typed", async () => {
    let app = await launchApp();

    const key = app.rules.deliveryDraftKey(
      "delivery-proof",
      USER,
      TARGET.businessId,
      TARGET.deliveryId,
    );

    // The driver typed a name, then opened the camera.
    const id = await app.submissionId.getOrCreateSubmissionId(key);
    await app.draft.saveProofDraft(key, {
      submissionId: id,
      photo: null,
      signature: null,
      receivedBy: "Maria",
      updatedAt: new Date().toISOString(),
    });
    await app.pending.markPendingCapture({ ownerId: USER, target: TARGET });

    // Android kills the app; the camera saves its picture and the OS keeps
    // the result for the next launch.
    files.set(cameraShot.uri, cameraShot.fileSize);
    pendingResult.value = { canceled: false, assets: [cameraShot] };

    app = await launchApp();

    const recovered = await app.draft.recoverDeliveryCapture(USER);
    expect(recovered).toEqual(TARGET);

    const restored = await app.draft.loadProofDraft(key);

    expect(restored?.receivedBy).toBe("Maria");
    expect(restored?.submissionId).toBe(id);

    // Out of the evictable cache, into the draft's own directory.
    expect(restored?.photo?.uri).toContain(
      `/trajetto-drafts/delivery-proof/${id}/`,
    );
    expect(files.has(restored!.photo!.uri)).toBe(true);
    expect(files.has(cameraShot.uri)).toBe(false);

    // Taken once: a second launch finds nothing to recover.
    expect(local.has("@trajetto:submission:pending-capture")).toBe(false);
    expect(await app.draft.recoverDeliveryCapture(USER)).toBeNull();
  });

  it("never takes the picker's pending result for a capture it did not start", async () => {
    const app = await launchApp();

    pendingResult.value = { canceled: false, assets: [cameraShot] };

    expect(await app.draft.recoverDeliveryCapture(USER)).toBeNull();
    expect(pendingResult.asked).toBe(0);
  });

  it("drops a picture another driver was taking", async () => {
    let app = await launchApp();

    await app.pending.markPendingCapture({ ownerId: "driver-b", target: TARGET });
    files.set(cameraShot.uri, cameraShot.fileSize);
    pendingResult.value = { canceled: false, assets: [cameraShot] };

    app = await launchApp();

    expect(await app.draft.recoverDeliveryCapture(USER)).toBeNull();
    expect([...local.keys()].some((key) => key.endsWith(":draft"))).toBe(false);
  });

  it("a cancelled camera leaves the draft as it was", async () => {
    let app = await launchApp();

    await app.pending.markPendingCapture({ ownerId: USER, target: TARGET });
    pendingResult.value = { canceled: true, assets: null };

    app = await launchApp();

    expect(await app.draft.recoverDeliveryCapture(USER)).toBeNull();
    expect(local.has("@trajetto:submission:pending-capture")).toBe(false);
  });
});

describe("a proof draft on disk", () => {
  it("comes back after a relaunch, without a photo whose file is gone", async () => {
    let app = await launchApp();

    const key = app.rules.deliveryDraftKey("delivery-proof", USER, "b", "d");
    const id = await app.submissionId.getOrCreateSubmissionId(key);

    files.set("file:///data/cache/sig.png", 10);
    const signature = app.draft.persistDeliveryDraftFile(
      "delivery-proof",
      { uri: "file:///data/cache/sig.png", fileName: "sig.png", mimeType: "image/png" },
      id,
      "signature",
    );

    await app.draft.saveProofDraft(key, {
      submissionId: id,
      photo: { uri: "file:///data/documents/trajetto-drafts/delivery-proof/gone.jpg" },
      signature,
      receivedBy: "João",
      updatedAt: new Date().toISOString(),
    });

    app = await launchApp();

    const restored = await app.draft.loadProofDraft(key);

    expect(restored?.photo).toBeNull();
    expect(restored?.signature?.uri).toBe(signature.uri);
    expect(restored?.receivedBy).toBe("João");
  });

  it("is counted by the logout warning and removed by the logout", async () => {
    const app = await launchApp();

    const key = app.rules.deliveryDraftKey("delivery-occurrence", USER, "b", "d");
    const id = await app.submissionId.getOrCreateSubmissionId(key);

    await app.draft.saveOccurrenceDraft(key, {
      submissionId: id,
      occurrenceTypeId: "type-1",
      description: "Portão fechado",
      photo: null,
      updatedAt: new Date().toISOString(),
    });

    expect(app.logoutRules.countOpenDrafts([...local.keys()], USER)).toBe(1);

    await app.submissionId.clearAllSubmissionData();

    expect([...local.keys()].filter((entry) => entry.startsWith("@trajetto:submission:"))).toEqual([]);
  });

  it("is gone, files and id, once the proof was handed off", async () => {
    const app = await launchApp();

    const key = app.rules.deliveryDraftKey("delivery-proof", USER, "b", "d");
    const id = await app.submissionId.getOrCreateSubmissionId(key);

    files.set("file:///data/cache/shot.jpg", 5);
    const photo = app.draft.persistDeliveryDraftFile(
      "delivery-proof",
      { uri: "file:///data/cache/shot.jpg", fileName: "shot.jpg" },
      id,
      "photo",
    );

    await app.draft.saveProofDraft(key, {
      submissionId: id,
      photo,
      signature: null,
      receivedBy: "",
      updatedAt: new Date().toISOString(),
    });

    await app.draft.clearDeliveryDraft("delivery-proof", key, id);

    expect(await app.draft.loadProofDraft(key)).toBeNull();
    expect(files.has(photo.uri)).toBe(false);

    // A new proof for the same delivery gets a new submission id.
    expect(await app.submissionId.getOrCreateSubmissionId(key)).not.toBe(id);
  });
});
