import fs from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pre-check wired into the app (decision 14.2): the proof actions carry
 * it in the body the queue freezes, the native module is the bundled ML Kit
 * model, and the APK profiles keep only phone ABIs. The native side cannot
 * run here, so it is held by what its build files say.
 */

const ROOT = resolve(__dirname, "..", "..");
const read = (file: string) => fs.readFileSync(join(ROOT, file), "utf8");

// A hook outside React: state is inert here, the actions are what is tested.
vi.mock("react", () => ({
  useState: <T,>(initial: T) => [initial, () => undefined],
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01",
}));
vi.mock("expo-haptics", () => ({
  impactAsync: async () => undefined,
  ImpactFeedbackStyle: { Light: "light" },
}));
vi.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
  getCurrentPositionAsync: async () => ({ coords: { latitude: -23.55, longitude: -46.63 } }),
  getLastKnownPositionAsync: async () => null,
  Accuracy: { Balanced: 3 },
  PermissionStatus: { GRANTED: "granted" },
}));
vi.mock("react-native-toast-message", () => ({ default: { show: () => undefined } }));
vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries: async () => undefined, setQueryData: () => undefined },
}));
vi.mock("@/features/notifications/proof-feedback-store", () => ({
  markDeliveryProofSubmitted: async () => () => undefined,
}));

const submitOrQueue = vi.fn(
  async (_input: { endpoint: string; body: Record<string, unknown> }) => "queued" as const,
);

vi.mock("@/features/submissions/submit-or-queue", () => ({
  submitOrQueue: (input: { endpoint: string; body: Record<string, unknown> }) =>
    submitOrQueue(input),
}));

let useDeliveryActions: typeof import("@/features/deliveries/hooks/use-delivery-actions").useDeliveryActions;

beforeAll(async () => {
  ({ useDeliveryActions } = await import("@/features/deliveries/hooks/use-delivery-actions"));
});

const TAP = new Date("2026-10-05T13:20:00.000Z");

beforeEach(() => {
  submitOrQueue.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TAP);
});

afterEach(() => {
  vi.useRealTimers();
});

const photo = {
  uri: "file:///canhoto.jpg",
  fileName: "canhoto.jpg",
  fileSize: 1024,
  mimeType: "image/jpeg",
};

const precheck = {
  engine: "mlkit-text-v2-latin" as const,
  engine_version: "16.0.1",
  rules_version: 1,
  ran_at: TAP.toISOString(),
  duration_ms: 400,
  kind: "proof" as const,
  invoice_number_found: false,
  date_out_of_window: null,
  typed_mileage_found: null,
  outcome: "warned" as const,
  driver_overrode: true,
};

const deliveredType = {
  id: "type-1",
  name: "Entrega normal",
  category: "DELIVERED",
  requires_receipt_photo: true,
  requires_signature: false,
  requires_photo: false,
  requires_authorization: false,
  form_fields: null,
  form_version: 1,
};

const lastBody = () => submitOrQueue.mock.calls.at(-1)![0].body;

describe("the proof actions", () => {
  it("carry the pre-check in the delivered report's body", async () => {
    await useDeliveryActions("business-1").submitDelivered({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      type: deliveredType as never,
      receiptPhoto: photo,
      signature: null,
      photos: [],
      devicePrecheck: precheck,
    });

    expect(lastBody().device_precheck).toEqual(precheck);
  });

  it("send none without a receipt photo, or when there was no check", async () => {
    await useDeliveryActions("business-1").submitDelivered({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      type: { ...deliveredType, requires_receipt_photo: false } as never,
      receiptPhoto: null,
      signature: null,
      photos: [],
      devicePrecheck: precheck,
    });

    expect(lastBody()).not.toHaveProperty("device_precheck");

    await useDeliveryActions("business-1").submitDelivered({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      type: deliveredType as never,
      receiptPhoto: photo,
      signature: null,
      photos: [],
    });

    expect(lastBody()).not.toHaveProperty("device_precheck");
  });

  it("carry it in the legacy proof's body too", async () => {
    await useDeliveryActions("business-1").submitProof({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      photo,
      devicePrecheck: precheck,
    });

    expect(lastBody().device_precheck).toEqual(precheck);
  });
});

describe("the native module", () => {
  it("is a local Expo module of the Android app, autolinked from ./modules", () => {
    const config = JSON.parse(read("modules/text-reader/expo-module.config.json"));

    expect(config).toEqual({
      platforms: ["android"],
      android: { modules: ["expo.modules.textreader.TextReaderModule"] },
    });
    expect(read("modules/text-reader/android/src/main/java/expo/modules/textreader/TextReaderModule.kt"))
      .toContain('Name("TextReader")');
  });

  it("uses the BUNDLED Latin model, pinned, never the one downloaded later", () => {
    const gradle = read("modules/text-reader/android/build.gradle");

    const dependencies = gradle
      .split("\n")
      .filter((line) => /^\s*(implementation|api)\b/.test(line));

    expect(dependencies).toEqual(['  implementation "com.google.mlkit:text-recognition:16.0.1"']);
    expect(read("modules/text-reader/index.ts")).toContain('TEXT_READER_ENGINE_VERSION = "16.0.1"');
  });

  it("asks for no new permission", () => {
    expect(read("modules/text-reader/android/src/main/AndroidManifest.xml")).not.toMatch(
      /uses-permission/,
    );
  });
});

describe("the ABI filter of the APK profiles", () => {
  const plugin = createRequire(join(ROOT, "package.json"))(
    join(ROOT, "plugins/with-preview-abis.js"),
  ) as {
    architecturesFor: (profile: string | undefined) => string | null;
    withArchitectures: (
      properties: Array<{ type: string; key?: string; value?: string }>,
      architectures: string | null,
    ) => Array<{ type: string; key?: string; value?: string }>;
  };

  it("keeps only phone ABIs on preview and staging, and leaves the rest alone", () => {
    expect(plugin.architecturesFor("preview")).toBe("arm64-v8a,armeabi-v7a");
    expect(plugin.architecturesFor("staging")).toBe("arm64-v8a,armeabi-v7a");
    // Production is an AAB (the Play splits it); the emulator E2E needs x86_64.
    expect(plugin.architecturesFor("production")).toBeNull();
    expect(plugin.architecturesFor("development")).toBeNull();
    expect(plugin.architecturesFor(undefined)).toBeNull();
  });

  it("replaces the property instead of adding a second one", () => {
    const base = [
      { type: "comment", value: "x" },
      { type: "property", key: "reactNativeArchitectures", value: "armeabi-v7a,arm64-v8a,x86,x86_64" },
      { type: "property", key: "newArchEnabled", value: "true" },
    ];

    const filtered = plugin.withArchitectures(base, "arm64-v8a,armeabi-v7a");

    expect(filtered.filter((entry) => entry.key === "reactNativeArchitectures")).toEqual([
      { type: "property", key: "reactNativeArchitectures", value: "arm64-v8a,armeabi-v7a" },
    ]);
    expect(plugin.withArchitectures(base, null)).toBe(base);
  });

  it("is registered in app.json", () => {
    expect(JSON.parse(read("app.json")).expo.plugins).toContain("./plugins/with-preview-abis");
  });
});
