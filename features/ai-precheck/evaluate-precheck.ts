import { linesOf, type ReadTextLike } from "./ocr-text";
import { checkProof } from "./proof-precheck-rules";
import { checkOdometer } from "./odometer-precheck-rules";
import {
  precheckFailure,
  precheckResult,
  withTimeout,
  PRECHECK_TIMEOUT_MS,
  type PrecheckKind,
  type StoredPrecheck,
} from "./device-precheck";

/**
 * One pre-check, from the photo to the stored result (decision 14.2).
 *
 * The reader is injected: the screens pass the native module, the tests a
 * fake. Never throws — a reader that fails, hangs or is missing becomes an
 * `error` outcome (or nothing at all when there is no reader), and the
 * driver's flow goes on exactly as without the pre-check.
 */

interface PrecheckReader {
  readText: (uri: string) => Promise<ReadTextLike & { durationMs?: number }>;
  engineVersion: string;
}

interface PrecheckInput {
  kind: PrecheckKind;
  photoUri: string;

  /** Receipt: the delivery's invoice number and the proof's business day. */
  invoiceNumber?: string | null;
  businessDay?: string;

  /** Odometer: the km the driver typed. */
  mileage?: number | null;
}

interface PrecheckOutcome {
  stored: StoredPrecheck;

  /** Why the read failed, for diagnostics (never the text read). */
  failure: string | null;
}

async function evaluatePrecheck(
  reader: PrecheckReader,
  input: PrecheckInput,
  options: { now?: () => Date; timeoutMs?: number } = {},
): Promise<PrecheckOutcome> {
  const now = options.now ?? (() => new Date());
  const ranAt = now();
  const run = (durationMs: number) => ({
    kind: input.kind,
    engineVersion: reader.engineVersion,
    ranAt,
    durationMs,
  });
  const bound = { photoUri: input.photoUri, mileage: input.kind === "odometer" ? (input.mileage ?? null) : null };

  try {
    const read = await withTimeout(
      reader.readText(input.photoUri),
      options.timeoutMs ?? PRECHECK_TIMEOUT_MS,
    );

    const lines = linesOf(read);
    const elapsed = now().getTime() - ranAt.getTime();
    const durationMs =
      typeof read.durationMs === "number" && Number.isFinite(read.durationMs)
        ? read.durationMs
        : elapsed;

    const check =
      input.kind === "proof"
        ? checkProof(lines, {
            invoiceNumber: input.invoiceNumber,
            businessDay: input.businessDay ?? "",
          })
        : checkOdometer(lines, input.mileage);

    return { stored: { ...bound, result: precheckResult(run(durationMs), check) }, failure: null };
  } catch (error) {
    return {
      stored: { ...bound, result: precheckFailure(run(now().getTime() - ranAt.getTime())) },
      failure: error instanceof Error ? error.name === "Error" ? error.message : error.name : "unknown",
    };
  }
}

export { evaluatePrecheck };
export type { PrecheckInput, PrecheckOutcome, PrecheckReader };
