import { describe, expect, it } from "vitest";

import {
  decideSubmissionFailure,
  isCancellation,
  photosForQueue,
  queuedNotice,
  queuedOutcome,
  type PhotoEntry,
} from "@/features/submissions/queue-decision";

/**
 * Whether a driver's work survives a bad moment.
 *
 * A refuelling or an inspection is twenty minutes of somebody's afternoon and
 * a pile of photos taken in a garage with no signal. The rule that decides
 * between keeping it and losing it lived inside a `try/catch` wrapped around
 * an HTTP client and a storage upload — unreachable by any test that did not
 * mock a network, which in this repository means unreachable.
 *
 * Three outcomes, and getting any of them backwards has a cost with a name:
 *
 * - queueing a CANCELLED submission resurrects on Monday what the driver
 *   abandoned on Friday;
 * - queueing a REJECTED one retries forever against an answer that will not
 *   change, and hides from the driver that it was refused;
 * - rejecting a TRANSIENT one throws away the afternoon.
 */
const apiFailure = (extra: Record<string, unknown> = {}) => ({
  source: "api" as const,
  ...extra,
});

describe("a submission that did not go through", () => {
  it("is queued when nothing answered", () => {
    /**
     * The whole reason the outbox exists: **no answer from the API is not the
     * API saying no.** A timeout, a dropped connection, a 502 from a proxy —
     * none of them is a verdict on the submission.
     */
    expect(
      decideSubmissionFailure({
        isAbort: false,
        description: apiFailure({ isTransient: true }),
      }),
    ).toBe("queued");
  });

  it("is queued when the upload itself failed", () => {
    // A failed PUT is network-shaped: an expired signature is re-signed on the
    // next attempt, and everything else is the connection.
    expect(
      decideSubmissionFailure({
        isAbort: false,
        description: { source: "upload" },
      }),
    ).toBe("queued");
  });

  it("is queued when nobody recognised the error", () => {
    /**
     * Deliberate, and it is the generous direction on purpose: guessing
     * "permanent" for something unrecognised would throw away a driver's work
     * over a bug in our own code.
     */
    expect(
      decideSubmissionFailure({
        isAbort: false,
        description: { source: "unknown" },
      }),
    ).toBe("queued");
  });

  it("is handed back when the API refused it on the merits", () => {
    // A 4xx that is not a timeout or a rate limit: mileage below the
    // vehicle's, an inactive branch, a delivery already closed. Repeating it
    // produces the same answer forever, and the driver needs to see it.
    expect(
      decideSubmissionFailure({
        isAbort: false,
        description: apiFailure({ isTransient: false }),
      }),
    ).toBe("rejected");
  });

  it("is queued when the session is the problem, not the work", () => {
    /**
     * It used to be handed back — while the logout fired by the same 401 had
     * already deleted the draft and its photos, so a finished checklist was
     * simply gone. An ended session says nothing about the submission, and
     * the queue already waits for its own driver to sign in again.
     */
    expect(
      decideSubmissionFailure({
        isAbort: false,
        description: apiFailure({ isAuthenticationError: true }),
      }),
    ).toBe("queued");
  });

  it("is queued when the API turned this build away, not the work (GAP5-2)", () => {
    /**
     * A 426 CLIENT_UPGRADE_REQUIRED says nothing about the submission, and
     * nothing the driver could change on this build gets it through. Handed
     * back, it lived only in the screen's memory, which the update screen's
     * restart into the new bundle wiped a moment later — a signed proof with
     * it. Queued, it is a contract failure the updated app sends by itself.
     */
    expect(
      decideSubmissionFailure({
        isAbort: false,
        description: apiFailure({
          isTransient: false,
          code: "CLIENT_UPGRADE_REQUIRED",
        }),
      }),
    ).toBe("queued");

    // The other contract codes on the FIRST try are still the driver's to
    // see: a field the form got wrong is fixed on the form.
    expect(
      decideSubmissionFailure({
        isAbort: false,
        description: apiFailure({ code: "VALIDATION_ERROR" }),
      }),
    ).toBe("rejected");
  });

  it("is queued when the session ended under it, even though that aborted it", () => {
    // The logout aborts the request and unmounts the form, and the form's
    // cleanup aborts its own signal: none of that is the driver cancelling.
    expect(
      decideSubmissionFailure({
        isAbort: true,
        sessionEnded: true,
        description: { source: "unknown" },
      }),
    ).toBe("queued");
  });

  it("and is NEVER queued when the driver cancelled it", () => {
    /**
     * Checked before anything else, and that order is the test.
     *
     * An aborted fetch rejects with an error that looks like a network failure
     * from the inside — so a version that classified first and asked about the
     * abort second would call it transient and queue it. The driver presses
     * cancel, walks away, and the submission they abandoned comes back on the
     * next sync under their name.
     */
    expect(
      decideSubmissionFailure({
        isAbort: true,
        description: apiFailure({ isTransient: true }),
      }),
    ).toBe("cancelled");
  });

  it("even when the cancellation looks like every other failure", () => {
    expect(
      decideSubmissionFailure({
        isAbort: true,
        description: { source: "unknown" },
      }),
    ).toBe("cancelled");
  });

  it("is a cancellation when the driver's signal says so, whatever was thrown", () => {
    /**
     * A discard mid-upload used to surface as `UploadError('Envio
     * cancelado.')`, which describes as an upload failure — transient — and
     * the abandoned checklist was queued and sent on the next sweep.
     */
    const thrown = Object.assign(new Error("Envio cancelado."), {
      name: "UploadError",
    });

    expect(isCancellation(thrown, { aborted: true })).toBe(true);
    expect(
      decideSubmissionFailure({
        isAbort: isCancellation(thrown, { aborted: true }),
        description: { source: "upload" },
      }),
    ).toBe("cancelled");

    expect(isCancellation(thrown, { aborted: false })).toBe(false);
  });
});

/**
 * What a queued submission is waiting for, so the screen can say it (MOB-07).
 *
 * Two different waits hide behind "queued". No signal: the queue sends it by
 * itself when the connection comes back. An ended session: the queue keeps it
 * for the driver who pressed send, and it goes only when THAT driver signs in
 * again — until then no connection in the world sends it. The toast said the
 * first thing in both cases, so a driver logged out mid-send was told to wait
 * for a signal they already had.
 */
describe("what a queued submission waits for", () => {
  it("is the connection when nothing answered", () => {
    expect(
      queuedOutcome({
        isAbort: false,
        description: apiFailure({ isTransient: true }),
      }),
    ).toBe("queued");

    expect(
      queuedOutcome({ isAbort: false, description: { source: "upload" } }),
    ).toBe("queued");
  });

  it("is the driver signing in again when the session ended under it", () => {
    expect(
      queuedOutcome({
        isAbort: true,
        sessionEnded: true,
        description: { source: "unknown" },
      }),
    ).toBe("queued-signed-out");

    // Even when the failure that surfaced looked like a network one: the
    // logout aborted the request, and the item still waits for its driver.
    expect(
      queuedOutcome({
        isAbort: false,
        sessionEnded: true,
        description: apiFailure({ isTransient: true }),
      }),
    ).toBe("queued-signed-out");
  });

  it("is the driver signing in again when the API said the session is over", () => {
    expect(
      queuedOutcome({
        isAbort: false,
        description: apiFailure({ isAuthenticationError: true }),
      }),
    ).toBe("queued-signed-out");
  });

  it("is the app's update when the API turned this build away", () => {
    // No connection sends it before that: every one meets the same 426.
    expect(
      queuedOutcome({
        isAbort: false,
        description: apiFailure({ code: "CLIENT_UPGRADE_REQUIRED" }),
      }),
    ).toBe("queued-until-update");
  });

  it("is told to the driver as it is", () => {
    expect(queuedNotice("queued")).toBe(
      "Será enviado automaticamente quando houver conexão.",
    );

    const signedOut = queuedNotice("queued-signed-out");

    expect(signedOut).toMatch(/quando você entrar de novo/);
    expect(signedOut).not.toMatch(/conexão/);

    const untilUpdate = queuedNotice("queued-until-update");

    expect(untilUpdate).toMatch(/atualiza/);
    expect(untilUpdate).not.toMatch(/conexão/);
  });
});

describe("the photos handed to the queue", () => {
  const entry = (overrides: Partial<PhotoEntry> = {}): PhotoEntry => ({
    file: {
      uri: "file:///foto.jpg",
      fileName: "foto.jpg",
      fileSize: 1024,
      mimeType: "image/jpeg",
    },
    ...overrides,
  });

  it("carry the keys that reached storage during this attempt", () => {
    /**
     * A checklist holds twenty photos and a connection drops on the
     * nineteenth. Everything that landed is already in storage, paid for on a
     * phone connection — and the keys are what stop the retry from uploading
     * it all again. On a link that drops every few minutes, a queue that
     * restarts from zero never finishes.
     */
    const entries = [entry(), entry(), entry()];

    const landed = new Map([
      [0, "chave-0"],
      [2, "chave-2"],
    ]);

    const photos = photosForQueue(entries, landed);

    expect(photos.map((photo) => photo.uploadedKey)).toEqual([
      "chave-0",
      undefined,
      "chave-2",
    ]);
  });

  it("and keep a key from an EARLIER attempt over this one", () => {
    /**
     * Both can be present: the entry carries what survived a previous round
     * trip, the map carries what landed just now. The entry wins, because a
     * key that already came back from the server is the one we know the API
     * accepted.
     */
    const entries = [entry({ uploadedKey: "chave-antiga" })];

    const photos = photosForQueue(entries, new Map([[0, "chave-nova"]]));

    expect(photos[0].uploadedKey).toBe("chave-antiga");
  });

  it("keep which question each photo answers", () => {
    // A checklist photo without its field is a photo of a tyre attached to
    // nothing: the queue would send it and the inspection would come back
    // with an unanswered question.
    const photos = photosForQueue(
      [entry({ fieldName: "pneus" }), entry({ fieldName: "farois" })],
      new Map(),
    );

    expect(photos.map((photo) => photo.fieldName)).toEqual(["pneus", "farois"]);
  });

  it("and survive a picker that gave no name or size", () => {
    // Some Android gallery providers hand back a uri and nothing else. The
    // queue stores what it got rather than refusing the photo.
    const photos = photosForQueue(
      [{ file: { uri: "content://media/42" } }],
      new Map(),
    );

    expect(photos[0].uri).toBe("content://media/42");
    expect(photos[0].fileName).toBeUndefined();
  });

  it("and keep the order they were taken in", () => {
    const photos = photosForQueue(
      [
        entry({ file: { uri: "a" } }),
        entry({ file: { uri: "b" } }),
        entry({ file: { uri: "c" } }),
      ],
      new Map(),
    );

    expect(photos.map((photo) => photo.uri)).toEqual(["a", "b", "c"]);
  });
});
