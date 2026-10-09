import {
  DEVICE_PRECHECK_ENGINE,
  devicePrecheckSchema,
  type DevicePrecheck,
} from "@/schemas/device-precheck";

import type { OdometerCheck } from "./odometer-precheck-rules";
import type { ProofCheck } from "./proof-precheck-rules";

/**
 * From a check to what the submission carries, and what the driver reads
 * (decision 14.2; design §P7.2–§P7.3). Pure: no React, no native module.
 *
 * The pre-check never blocks anything. Its result is a provisional hint that
 * travels with the submission, kept in the draft and in the queued item, and
 * the server's own reading of the same photo confirms it later. One photo is
 * one unit of the company's quota, counted once by the server: the phone's
 * reading costs nothing and reserves nothing.
 */

/** Bumped on any change of the rules; sent as `rules_version`. */
const PRECHECK_RULES_VERSION = 1;

/** The phone's reading gives up after this; the flow goes on without it. */
const PRECHECK_TIMEOUT_MS = 5_000;

type PrecheckKind = DevicePrecheck["kind"];

interface PrecheckRun {
  kind: PrecheckKind;
  engineVersion: string;
  ranAt: Date;
  durationMs: number;
}

const clampDuration = (ms: number) =>
  Math.min(60_000, Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0)));

function warnedProof(check: ProofCheck): boolean {
  return check.invoice_number_found === false || check.date_out_of_window === true;
}

function warnedOdometer(check: OdometerCheck): boolean {
  return check.typed_mileage_found === false;
}

/** The payload of a check that ran. `driver_overrode` is decided at the send. */
function precheckResult(
  run: PrecheckRun,
  check: Partial<ProofCheck & OdometerCheck>,
): DevicePrecheck {
  const proof = run.kind === "proof";

  const invoice = proof ? (check.invoice_number_found ?? null) : null;
  const date = proof ? (check.date_out_of_window ?? null) : null;
  const mileage = proof ? null : (check.typed_mileage_found ?? null);

  const warned = proof
    ? warnedProof({ invoice_number_found: invoice, date_out_of_window: date })
    : warnedOdometer({ typed_mileage_found: mileage });

  return {
    engine: DEVICE_PRECHECK_ENGINE,
    engine_version: run.engineVersion.slice(0, 20),
    rules_version: PRECHECK_RULES_VERSION,
    ran_at: run.ranAt.toISOString(),
    duration_ms: clampDuration(run.durationMs),
    kind: run.kind,
    invoice_number_found: invoice,
    date_out_of_window: date,
    typed_mileage_found: mileage,
    outcome: warned ? "warned" : "ok",
    driver_overrode: false,
  };
}

/** The payload of a read that failed or timed out: nothing known, no warning. */
function precheckFailure(run: PrecheckRun): DevicePrecheck {
  return {
    engine: DEVICE_PRECHECK_ENGINE,
    engine_version: run.engineVersion.slice(0, 20),
    rules_version: PRECHECK_RULES_VERSION,
    ran_at: run.ranAt.toISOString(),
    duration_ms: clampDuration(run.durationMs),
    kind: run.kind,
    invoice_number_found: null,
    date_out_of_window: null,
    typed_mileage_found: null,
    outcome: "error",
    driver_overrode: false,
  };
}

/**
 * A check bound to what it was run on. The draft keeps this: a photo taken
 * again, or a km typed again, makes the old result about something that is
 * no longer being sent.
 */
interface StoredPrecheck {
  photoUri: string;

  /** The km the odometer check compared with; null for a receipt. */
  mileage: number | null;

  result: DevicePrecheck;
}

/** A stored check read back from a draft; anything malformed is dropped. */
function storedPrecheckOf(value: unknown): StoredPrecheck | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<StoredPrecheck>;
  const result = devicePrecheckSchema.safeParse(candidate.result);

  if (typeof candidate.photoUri !== "string" || !result.success) return null;

  return {
    photoUri: candidate.photoUri,
    mileage: typeof candidate.mileage === "number" ? candidate.mileage : null,
    result: result.data,
  };
}

/** Whether a stored check is about this photo (and this km). */
function precheckApplies(
  stored: StoredPrecheck | null,
  photoUri: string | null | undefined,
  mileage: number | null = null,
): stored is StoredPrecheck {
  if (!stored || !photoUri || stored.photoUri !== photoUri) return false;

  return stored.result.kind === "proof" || stored.mileage === mileage;
}

/**
 * What the submission carries: the check about the photo being sent, or
 * nothing. Sending after a warning is the driver overriding it — the warning
 * was on screen, and the submit button never waits for an answer to it.
 */
function precheckForSubmit(
  stored: StoredPrecheck | null,
  photoUri: string | null | undefined,
  mileage: number | null = null,
): DevicePrecheck | undefined {
  if (!precheckApplies(stored, photoUri, mileage)) return undefined;

  return { ...stored.result, driver_overrode: stored.result.outcome === "warned" };
}

/** "123456" → "123.456", as the driver reads it on the paper. */
function formatInvoice(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");

  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** "45210" → "45.210". */
function formatKm(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** The warning under the receipt photo, or null (nothing shown). */
function proofWarning(result: DevicePrecheck | null | undefined, invoiceNumber?: string | null): string | null {
  if (!result || result.kind !== "proof" || result.outcome !== "warned") return null;

  if (result.invoice_number_found === false) {
    const number = invoiceNumber ? ` ${formatInvoice(invoiceNumber)}` : "";

    return `O número da NF${number} não aparece na foto. Confira se fotografou o canhoto desta entrega.`;
  }

  return "A data de recebimento na foto não é a de hoje. Confira se fotografou o canhoto desta entrega.";
}

/** The warning under the odometer photo, or null (nothing shown). */
function odometerWarning(result: DevicePrecheck | null | undefined, mileage?: number | null): string | null {
  if (!result || result.kind !== "odometer" || result.outcome !== "warned") return null;

  const km = typeof mileage === "number" ? ` ${formatKm(mileage)}` : "";

  return `A km${km} não aparece na foto do odômetro. Confira o número digitado.`;
}

class PrecheckTimeoutError extends Error {
  constructor() {
    super("TEXT_READER_TIMEOUT");
    this.name = "PrecheckTimeoutError";
  }
}

/** The read, or a rejection after `ms`: a slow phone never holds the flow. */
function withTimeout<T>(work: Promise<T>, ms: number = PRECHECK_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PrecheckTimeoutError()), ms);

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export {
  PRECHECK_RULES_VERSION,
  PRECHECK_TIMEOUT_MS,
  PrecheckTimeoutError,
  odometerWarning,
  precheckApplies,
  precheckFailure,
  precheckForSubmit,
  precheckResult,
  proofWarning,
  storedPrecheckOf,
  withTimeout,
};
export type { PrecheckKind, PrecheckRun, StoredPrecheck };
