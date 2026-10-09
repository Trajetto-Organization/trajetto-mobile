import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The phone and the photo instant a proof carries (proof design §4.2, §8):
 * `device_id` (Android ID, else an installation UUID kept in the secure
 * store) and `photo_taken_at` (when the camera returned, never after the tap).
 */

const native = vi.hoisted(() => ({
  os: "android" as string,
  androidId: "23be03c084165505" as string | (() => string),
  store: new Map<string, string>(),
  uuid: "8f0c6a8e-2f5b-4d7e-9a51-3c2b1d0e4f6a",
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return native.os;
    },
  },
}));

vi.mock("expo-application", () => ({
  getAndroidId: () =>
    typeof native.androidId === "function" ? native.androidId() : native.androidId,
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => native.uuid }));

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => native.store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    native.store.set(key, value);
  },
}));

import {
  acceptedDeviceId,
  chooseDeviceId,
  photoTakenAtFor,
} from "@/features/device/device-identity-rules";
import {
  INSTALLATION_ID_KEY,
  deviceIdentity,
  resetDeviceIdentity,
} from "@/features/device/device-identity";

beforeEach(() => {
  native.os = "android";
  native.androidId = "23be03c084165505";
  native.store.clear();
  resetDeviceIdentity();
});

describe("acceptedDeviceId", () => {
  it("keeps the shapes the API keeps", () => {
    expect(acceptedDeviceId("23be03c084165505")).toBe("23be03c084165505");
    expect(acceptedDeviceId(native.uuid)).toBe(native.uuid);
  });

  it("refuses anything else", () => {
    for (const value of ["", "23be03c08416550", "zzbe03c084165505", "abc", null, 42]) {
      expect(acceptedDeviceId(value)).toBeNull();
    }
  });
});

describe("chooseDeviceId", () => {
  it("prefers the Android ID and falls back to the installation id", () => {
    expect(chooseDeviceId("23be03c084165505", native.uuid)).toBe("23be03c084165505");
    expect(chooseDeviceId("", native.uuid)).toBe(native.uuid);
    expect(chooseDeviceId("0000000000000000", native.uuid)).toBe(native.uuid);
    expect(chooseDeviceId(null, null)).toBeNull();
  });
});

describe("photoTakenAtFor", () => {
  const tap = "2026-09-30T16:30:26.000Z";

  it("is the camera's instant when it precedes the tap", () => {
    expect(photoTakenAtFor("2026-09-30T16:30:08.000Z", tap)).toBe(
      "2026-09-30T16:30:08.000Z",
    );
  });

  it("is capped at the tap", () => {
    expect(photoTakenAtFor("2026-09-30T16:31:00.000Z", tap)).toBe(tap);
  });

  it("is absent without a readable instant", () => {
    expect(photoTakenAtFor(undefined, tap)).toBeUndefined();
    expect(photoTakenAtFor(null, tap)).toBeUndefined();
    expect(photoTakenAtFor("ontem", tap)).toBeUndefined();
  });
});

describe("deviceIdentity", () => {
  it("is the Android ID on Android", async () => {
    await expect(deviceIdentity()).resolves.toBe("23be03c084165505");
    expect(native.store.size).toBe(0);
  });

  it("falls back to one installation UUID, created once and kept", async () => {
    native.androidId = () => {
      throw new Error("native module missing");
    };

    await expect(deviceIdentity()).resolves.toBe(native.uuid);
    expect(native.store.get(INSTALLATION_ID_KEY)).toBe(native.uuid);

    resetDeviceIdentity();
    native.uuid = "11111111-2222-4333-8444-555555555555";

    // The kept one, not a new one.
    await expect(deviceIdentity()).resolves.toBe("8f0c6a8e-2f5b-4d7e-9a51-3c2b1d0e4f6a");
    native.uuid = "8f0c6a8e-2f5b-4d7e-9a51-3c2b1d0e4f6a";
  });

  it("uses the installation UUID off Android", async () => {
    native.os = "ios";

    await expect(deviceIdentity()).resolves.toBe(native.uuid);
  });
});
