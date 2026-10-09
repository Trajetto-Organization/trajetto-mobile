import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A GPS fix that never comes does not hold a form hostage (MOB-13).
 *
 * `getCurrentPositionAsync` has no timeout. Under a fuel station canopy or in
 * a basement the refuelling form's location card sat on "Capturando
 * localização GPS..." with nothing to press: the picker awaited the raw call.
 * The delivery actions already went through `captureLocation` (a budget,
 * then the phone's last known position if it is recent); the refuelling
 * form did not.
 *
 * Only the native module is stubbed: the budget, the fallback and the
 * failure reasons are the real `captureLocation`.
 */

const native = vi.hoisted(() => ({
  permission: "granted" as string,
  fix: null as null | (() => Promise<unknown>),
  lastKnown: null as unknown,
  lastKnownAsks: [] as unknown[],
}));

vi.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: async () => ({ status: native.permission }),
  getCurrentPositionAsync: () =>
    native.fix ? native.fix() : new Promise(() => undefined),
  getLastKnownPositionAsync: async (options: unknown) => {
    native.lastKnownAsks.push(options);
    return native.lastKnown;
  },
  Accuracy: { Balanced: 3, High: 4 },
  PermissionStatus: { GRANTED: "granted" },
}));

const position = (
  latitude: number,
  longitude: number,
  extra: { accuracy?: number | null; timestamp?: number } = {},
) => ({
  coords: { latitude, longitude, accuracy: extra.accuracy },
  ...(extra.timestamp !== undefined && { timestamp: extra.timestamp }),
});

beforeEach(() => {
  vi.useFakeTimers();

  native.permission = "granted";
  native.fix = null;
  native.lastKnown = null;
  native.lastKnownAsks = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a required reading (the refuelling form)", () => {
  it("answers with the fresh fix when it comes in time", async () => {
    const { captureLocation } = await import("@/features/tracking/capture-location");

    native.fix = async () => position(-23.5, -46.6);

    await expect(
      captureLocation({ required: true, accuracy: 4 }),
    ).resolves.toEqual({ latitude: -23.5, longitude: -46.6 });
  });

  it("stops waiting after 8 s and uses a last known position of up to 5 min", async () => {
    const { captureLocation, LAST_KNOWN_MAX_AGE_MS, REQUIRED_FIX_TIMEOUT_MS } =
      await import("@/features/tracking/capture-location");

    native.lastKnown = position(-15.8, -47.9, { timestamp: Date.now() - 60_000 });

    let settled = false;
    const reading = captureLocation({ required: true, accuracy: 4 }).then(
      (value) => {
        settled = true;
        return value;
      },
    );

    await vi.advanceTimersByTimeAsync(REQUIRED_FIX_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    await expect(reading).resolves.toEqual({ latitude: -15.8, longitude: -47.9 });
    expect(native.lastKnownAsks).toEqual([{ maxAge: LAST_KNOWN_MAX_AGE_MS }]);
  });

  it("fails with a reason the form can act on when there is nothing at all", async () => {
    const { captureLocation, LocationCaptureError, REQUIRED_FIX_TIMEOUT_MS } =
      await import("@/features/tracking/capture-location");

    const reading = captureLocation({ required: true, accuracy: 4 });
    const outcome = reading.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(REQUIRED_FIX_TIMEOUT_MS);

    const error = await outcome;
    expect(error).toBeInstanceOf(LocationCaptureError);
    expect((error as InstanceType<typeof LocationCaptureError>).reason).toBe(
      "unavailable",
    );
  });

  it("says 'denied' without waiting for a fix when permission is refused", async () => {
    const { captureLocation, LocationCaptureError } = await import(
      "@/features/tracking/capture-location"
    );

    native.permission = "denied";

    const error = await captureLocation({ required: true }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(LocationCaptureError);
    expect((error as InstanceType<typeof LocationCaptureError>).reason).toBe(
      "denied",
    );
  });
});

/**
 * What may stand in for the station's GPS reading.
 *
 * The API stores the refuelling form's position as the GPS reading of the
 * station (GPS_AUTO) and measures any later edit against it (500 m). The
 * default stand-in — any last known position of up to five minutes — could
 * be kilometres down the road or a cell-tower guess, shown as "capturada com
 * sucesso" and stored as if the GPS had read it at the pump.
 */
describe("the refuelling reading's stand-in", () => {
  const NOW = new Date("2026-09-29T12:00:00.000Z").getTime();

  beforeEach(() => {
    vi.setSystemTime(NOW);
  });

  async function refuelReading() {
    const { readLocation, REFUEL_LAST_KNOWN, REQUIRED_FIX_TIMEOUT_MS } =
      await import("@/features/tracking/capture-location");

    const reading = readLocation({
      required: true,
      accuracy: 4,
      lastKnown: REFUEL_LAST_KNOWN,
    });
    const outcome = reading.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(REQUIRED_FIX_TIMEOUT_MS);

    return outcome;
  }

  it("is at most a minute old and 100 m accurate, and asks the OS for exactly that", async () => {
    const { REFUEL_LAST_KNOWN } = await import("@/features/tracking/capture-location");

    expect(REFUEL_LAST_KNOWN).toEqual({ maxAgeMs: 60_000, maxAccuracyM: 100 });

    native.lastKnown = position(-23.5, -46.6, { accuracy: 30, timestamp: NOW - 30_000 });

    await expect(refuelReading()).resolves.toEqual({
      latitude: -23.5,
      longitude: -46.6,
      source: "last-known",
    });
    expect(native.lastKnownAsks).toEqual([{ maxAge: 60_000, requiredAccuracy: 100 }]);
  });

  it.each([
    ["three minutes old", { accuracy: 20, timestamp: NOW - 3 * 60_000 }],
    ["a cell-tower guess (1.5 km)", { accuracy: 1_500, timestamp: NOW - 10_000 }],
    ["of unknown accuracy", { accuracy: null, timestamp: NOW - 10_000 }],
    // Its age cannot be told: no time at all, or a time ahead of the phone's
    // clock (a skewed clock would let any maxAge through).
    ["with no time of its own", { accuracy: 20 }],
    ["dated a minute ahead of the phone's clock", { accuracy: 20, timestamp: NOW + 60_000 }],
  ])("refuses a stand-in %s, even if the OS hands it over", async (_label, extra) => {
    const { LocationCaptureError } = await import("@/features/tracking/capture-location");

    native.lastKnown = position(-23.5, -46.6, extra);

    const error = await refuelReading();

    expect(error).toBeInstanceOf(LocationCaptureError);
    expect((error as InstanceType<typeof LocationCaptureError>).reason).toBe(
      "unavailable",
    );
  });

  it("tolerates the second or two a GPS time and a synced clock differ by", async () => {
    const { FUTURE_TIMESTAMP_TOLERANCE_MS } = await import(
      "@/features/tracking/capture-location"
    );

    native.lastKnown = position(-23.5, -46.6, {
      accuracy: 20,
      timestamp: NOW + FUTURE_TIMESTAMP_TOLERANCE_MS,
    });

    await expect(refuelReading()).resolves.toMatchObject({ source: "last-known" });
  });

  it("says a fresh fix is fresh", async () => {
    native.fix = async () => position(-23.5, -46.6, { accuracy: 8 });

    await expect(refuelReading()).resolves.toMatchObject({ source: "fresh" });
  });

  it("leaves the arrival's default stand-in as it was (5 min, any accuracy)", async () => {
    const { captureLocation, REQUIRED_FIX_TIMEOUT_MS } = await import(
      "@/features/tracking/capture-location"
    );

    native.lastKnown = position(-15.8, -47.9, {
      accuracy: 1_500,
      timestamp: NOW - 4 * 60_000,
    });

    const reading = captureLocation({ required: true });
    await vi.advanceTimersByTimeAsync(REQUIRED_FIX_TIMEOUT_MS);

    await expect(reading).resolves.toEqual({ latitude: -15.8, longitude: -47.9 });
  });
});

describe("the refuelling form's location card", () => {
  const source = readFileSync(
    resolve(__dirname, "../..", "components/ui/location-picker.tsx"),
    "utf8",
  );

  it("reads the position through the bounded capture, as a required reading with the refuelling stand-in", () => {
    expect(source).toMatch(/from "@\/features\/tracking\/capture-location"/);
    expect(source).toMatch(
      /readLocation\(\{\s*required: true,\s*accuracy: Location\.Accuracy\.High,\s*lastKnown: REFUEL_LAST_KNOWN,?\s*\}\)/,
    );
  });

  it("does not call a last known position 'capturada com sucesso' as if it were a fix", () => {
    expect(source).toMatch(/readingCopy\(reading\.source, REFUEL_LAST_KNOWN\)/);
  });

  it("writes neither the GPS note nor the age limit by hand", () => {
    // Both come from readingCopy: the note under a last known position used
    // to say the GPS had just read it, and "1 minuto" sat beside a policy.
    expect(source).not.toMatch(/capturada automaticamente pelo GPS/);
    expect(source).not.toMatch(/menos de 1 minuto/);
    expect(source).toMatch(/\{readingNote && \(/);
  });

  it("never awaits the unbounded native call itself", () => {
    expect(source).not.toMatch(/getCurrentPositionAsync/);
  });

  it("tells a refused permission apart from a fix that did not come", () => {
    expect(source).toMatch(/error instanceof LocationCaptureError/);
    expect(source).toMatch(/error\.reason === "denied"/);
  });
});

describe("what the card says about the reading", () => {
  it("names a fresh fix as the GPS reading it is", async () => {
    const { readingCopy } = await import("@/features/tracking/location-reading-copy");
    const { REFUEL_LAST_KNOWN } = await import("@/features/tracking/capture-location");

    const copy = readingCopy("fresh", REFUEL_LAST_KNOWN);

    expect(copy.status).toBe("Localização capturada com sucesso!");
    expect(copy.note).toMatch(/GPS do seu dispositivo/);
  });

  it("names a last known position as such, with the refuelling limits", async () => {
    const { readingCopy } = await import("@/features/tracking/location-reading-copy");
    const { REFUEL_LAST_KNOWN } = await import("@/features/tracking/capture-location");

    const copy = readingCopy("last-known", REFUEL_LAST_KNOWN);

    expect(copy.status).toBe(
      "Localização capturada (última posição do aparelho, registrada há no máximo 1 minuto)",
    );
    expect(copy.note).toMatch(/O GPS não respondeu a tempo/);
    expect(copy.note).toMatch(/há no máximo 1 minuto, com precisão de até 100 m/);
    expect(copy.note).toMatch(/Atualizar Localização/);
    expect(copy.note).not.toMatch(/capturada agora pelo GPS/);
    expect(copy.status).not.toMatch(/sucesso/);
  });

  it("follows the policy when it changes, instead of a hand-written minute", async () => {
    const { ageLimitText, readingCopy } = await import(
      "@/features/tracking/location-reading-copy"
    );

    expect(readingCopy("last-known", { maxAgeMs: 5 * 60_000 }).status).toMatch(
      /há no máximo 5 minutos\)$/,
    );
    expect(readingCopy("last-known", { maxAgeMs: 5 * 60_000 }).note).not.toMatch(/precisão/);
    expect(readingCopy("last-known", { maxAgeMs: 30_000, maxAccuracyM: 50 }).note).toMatch(
      /há no máximo 30 segundos, com precisão de até 50 m/,
    );

    expect(ageLimitText(60_000)).toBe("1 minuto");
    expect(ageLimitText(120_000)).toBe("2 minutos");
    expect(ageLimitText(1_000)).toBe("1 segundo");
    expect(ageLimitText(90_000)).toBe("90 segundos");
  });
});
