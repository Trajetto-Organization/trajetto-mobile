import { describe, expect, it } from "vitest";

import {
  EVERY_PRESENCE_HINT,
  chatHintMaxGapMs,
  chatHintSurvivesLostPulse,
  AUDIO_COUNTDOWN_LEAD_MS,
  MAX_AUDIO_DURATION_MS,
  PAUSED_WATCH_MS,
  RECORDING_EMIT_PULSE_MS,
  RECORDING_HINT_TTL_MS,
  RECORDING_TICK_MS,
  TYPING_EMIT_THROTTLE_MS,
  TYPING_HINT_TTL_MS,
  chatHintPulseMs,
  chatHintTtlMs,
  chatPresenceHint,
  chatPresenceHintAccessibilityLabel,
  chatPresenceHintLabel,
  confirmOptimistic,
  formatAudioClock,
  isFromOperation,
  latestIso,
  markSendFailed,
  mergeIncomingMessage,
  needsDaySeparator,
  newestDeliverableAt,
  presencePulseIsDue,
  reconcileRecorderState,
  recorderClockMs,
  recorderWatchPeriodMs,
  recordingCountdownSeconds,
  recordingIsSendable,
  recordingReachedLimit,
  recordingRemainingMs,
  reportedRecordingMs,
  resolveOwnMessageCheck,
  splitChatImageBatch,
  groupChatMessages,
  wasDeliveredToCounterpart,
  wasReadByCounterpart,
  whyRecordingIsNotSendable,
} from "@/features/chat/chat-rules";

import type { ChatMessage, ClientChatMessage } from "@/features/chat/types";

const DRIVER_USER = "user-driver";
const AGENT_USER = "user-agent";

function makeMessage(
  overrides: Partial<ChatMessage> & { id: string },
): ChatMessage {
  return {
    kind: "TEXT",
    body: "olá",
    attachment_url: null,
    duration_ms: null,
    deliveryId: null,
    broadcast_id: null,
    client_submission_id: null,
    threadId: "thread-1",
    senderId: AGENT_USER,
    sender: { id: AGENT_USER, name: "Atendente" },
    delivery: null,
    created_at: "2026-08-31T12:00:00.000Z",
    ...overrides,
  };
}

describe("sides and checks", () => {
  it("everything not sent by the driver is the operation", () => {
    const fromAgent = makeMessage({ id: "m1" });
    const fromMe = makeMessage({ id: "m2", senderId: DRIVER_USER });

    expect(isFromOperation(fromAgent, DRIVER_USER)).toBe(true);
    expect(isFromOperation(fromMe, DRIVER_USER)).toBe(false);
  });

  it("derives the double check from the counterpart cursor", () => {
    const createdAt = "2026-08-31T12:00:00.000Z";

    expect(wasReadByCounterpart(createdAt, null)).toBe(false);
    expect(
      wasReadByCounterpart(createdAt, "2026-08-31T11:59:00.000Z"),
    ).toBe(false);
    expect(
      wasReadByCounterpart(createdAt, "2026-08-31T12:00:00.000Z"),
    ).toBe(true);
    expect(
      wasReadByCounterpart(createdAt, "2026-08-31T12:01:00.000Z"),
    ).toBe(true);
  });
});

describe("merging socket arrivals", () => {
  it("keeps the list orderly and never duplicates", () => {
    const first = makeMessage({
      id: "m1",
      created_at: "2026-08-31T12:00:00.000Z",
    });
    const second = makeMessage({
      id: "m2",
      created_at: "2026-08-31T12:01:00.000Z",
    });

    let list: ClientChatMessage[] = [first];

    list = mergeIncomingMessage(list, second);
    expect(list.map((message) => message.id)).toEqual(["m1", "m2"]);

    // The socket echoing what is already there is a no-op.
    list = mergeIncomingMessage(list, second);
    expect(list).toHaveLength(2);
  });

  it("replaces the optimistic copy when the echo carries its submission id", () => {
    const optimistic: ClientChatMessage = {
      ...makeMessage({ id: "local-1", senderId: DRIVER_USER }),
      client_submission_id: "sub-1",
      pending: true,
    };

    const confirmed = makeMessage({
      id: "server-1",
      senderId: DRIVER_USER,
      client_submission_id: "sub-1",
    });

    const merged = mergeIncomingMessage([optimistic], confirmed);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("server-1");
    expect(merged[0].pending).toBeUndefined();
  });
});

describe("the optimistic lifecycle", () => {
  const optimistic: ClientChatMessage = {
    ...makeMessage({ id: "local-1", senderId: DRIVER_USER }),
    client_submission_id: "sub-1",
    pending: true,
  };

  it("confirms into the server truth", () => {
    const confirmed = makeMessage({
      id: "server-1",
      senderId: DRIVER_USER,
      client_submission_id: "sub-1",
    });

    const list = confirmOptimistic([optimistic], "sub-1", confirmed);

    expect(list[0].id).toBe("server-1");
  });

  it("marks the failure without losing the message", () => {
    const list = markSendFailed([optimistic], "sub-1");

    expect(list[0].failed).toBe(true);
    expect(list[0].pending).toBe(false);
    expect(list[0].body).toBe("olá");
  });
});

describe("voice notes", () => {
  it("caps a note at two minutes, not at a meeting", () => {
    expect(MAX_AUDIO_DURATION_MS).toBe(2 * 60 * 1000);
  });

  it("refuses grazes and marathon recordings, keeps the real ones", () => {
    expect(recordingIsSendable(400)).toBe(false);
    expect(recordingIsSendable(1_500)).toBe(true);
    expect(recordingIsSendable(MAX_AUDIO_DURATION_MS)).toBe(true);
    expect(recordingIsSendable(MAX_AUDIO_DURATION_MS + 1)).toBe(false);
    expect(recordingIsSendable(16 * 60 * 1000)).toBe(false);
  });

  it("says WHICH way a recording missed, so the advice can differ", () => {
    expect(whyRecordingIsNotSendable(400)).toBe("too-short");
    expect(whyRecordingIsNotSendable(30_000)).toBe(null);
    expect(whyRecordingIsNotSendable(MAX_AUDIO_DURATION_MS + 1)).toBe(
      "too-long",
    );
  });

  it("formats the player clock", () => {
    expect(formatAudioClock(42_000)).toBe("0:42");
    expect(formatAudioClock(61_000)).toBe("1:01");
    expect(formatAudioClock(null)).toBe("0:00");
    expect(formatAudioClock(MAX_AUDIO_DURATION_MS)).toBe("2:00");
  });
});

describe("the recording ceiling", () => {
  it("counts down what is left, and never past zero", () => {
    expect(recordingRemainingMs(0)).toBe(MAX_AUDIO_DURATION_MS);
    expect(recordingRemainingMs(MAX_AUDIO_DURATION_MS - 5_000)).toBe(5_000);
    expect(recordingRemainingMs(MAX_AUDIO_DURATION_MS + 9_000)).toBe(0);
  });

  it("tells the recorder to stop itself at the ceiling", () => {
    expect(recordingReachedLimit(MAX_AUDIO_DURATION_MS - 1)).toBe(false);
    expect(recordingReachedLimit(MAX_AUDIO_DURATION_MS)).toBe(true);
    expect(recordingReachedLimit(MAX_AUDIO_DURATION_MS + 250)).toBe(true);
  });

  it("stays quiet until the last stretch, then warns every second", () => {
    expect(recordingCountdownSeconds(0)).toBe(null);
    expect(
      recordingCountdownSeconds(
        MAX_AUDIO_DURATION_MS - AUDIO_COUNTDOWN_LEAD_MS - 1,
      ),
    ).toBe(null);

    expect(
      recordingCountdownSeconds(MAX_AUDIO_DURATION_MS - AUDIO_COUNTDOWN_LEAD_MS),
    ).toBe(AUDIO_COUNTDOWN_LEAD_MS / 1000);

    expect(recordingCountdownSeconds(MAX_AUDIO_DURATION_MS - 12_000)).toBe(12);
  });

  it("rounds the countdown up, so it never promises a cut that has not come", () => {
    expect(recordingCountdownSeconds(MAX_AUDIO_DURATION_MS - 11_400)).toBe(12);
    expect(recordingCountdownSeconds(MAX_AUDIO_DURATION_MS - 1)).toBe(1);
    expect(recordingCountdownSeconds(MAX_AUDIO_DURATION_MS)).toBe(0);
  });

  it("never refuses a recording for overrunning a limit it enforced itself", () => {
    const tick = recorderWatchPeriodMs("recording");

    // The watch beat is what a self-stopped recording may overshoot by.
    expect(reportedRecordingMs(MAX_AUDIO_DURATION_MS + 180, tick)).toBe(
      MAX_AUDIO_DURATION_MS,
    );
    expect(recordingIsSendable(reportedRecordingMs(MAX_AUDIO_DURATION_MS + 180, tick))).toBe(
      true,
    );
  });

  it("reports a genuinely oversized recording as measured, not as the ceiling", () => {
    const starved = MAX_AUDIO_DURATION_MS + 90_000;

    expect(reportedRecordingMs(starved, 250)).toBe(starved);
    expect(recordingIsSendable(reportedRecordingMs(starved, 250))).toBe(false);
  });

  it("leaves a normal recording exactly as it was measured", () => {
    expect(reportedRecordingMs(42_000, 250)).toBe(42_000);
  });

  /**
   * The two watches are not the same length, and that is the whole point: a
   * hold is looked at four times more slowly than a capturing recorder,
   * because a hold has no clock to animate.
   */
  it("watches a held recording more slowly than a capturing one", () => {
    expect(recorderWatchPeriodMs("recording")).toBe(RECORDING_TICK_MS);
    expect(recorderWatchPeriodMs("paused")).toBe(PAUSED_WATCH_MS);
    expect(PAUSED_WATCH_MS).toBeGreaterThan(RECORDING_TICK_MS);
  });

  /**
   * The pairing this rule exists for. The driver records 1:59.6 and holds; the
   * system starts the recorder again behind the app's back on the way back
   * from another app, and the hold is only looked at a second later — by which
   * time the recorder has 2:00.6 on it. Clamped against the CAPTURING beat
   * that reads as an oversized note and the send throws two minutes of speech
   * away. Clamped against the watch that actually produced it, it is exactly
   * the ceiling — which is all the app itself ever enforced.
   */
  it("clamps an overshoot against the watch that produced it, not a constant", () => {
    const heldOvershoot = MAX_AUDIO_DURATION_MS + 600;

    expect(
      reportedRecordingMs(heldOvershoot, recorderWatchPeriodMs("paused")),
    ).toBe(MAX_AUDIO_DURATION_MS);

    expect(
      recordingIsSendable(
        reportedRecordingMs(heldOvershoot, recorderWatchPeriodMs("paused")),
      ),
    ).toBe(true);

    // The same reading taken by the capturing watch IS a genuine overrun:
    // that watch cannot be a second late.
    expect(
      reportedRecordingMs(heldOvershoot, recorderWatchPeriodMs("recording")),
    ).toBe(heldOvershoot);
  });

  it("still refuses an overshoot no watch can account for", () => {
    const beyondEveryWatch = MAX_AUDIO_DURATION_MS + PAUSED_WATCH_MS + 1;

    expect(
      reportedRecordingMs(beyondEveryWatch, recorderWatchPeriodMs("paused")),
    ).toBe(beyondEveryWatch);

    expect(
      recordingIsSendable(
        reportedRecordingMs(beyondEveryWatch, recorderWatchPeriodMs("paused")),
      ),
    ).toBe(false);
  });
});

/**
 * A recording the driver can hold and pick up again: the radio, a customer,
 * a manoeuvre. What the clock and the ceiling count is what was RECORDED —
 * and the only thing that knows that is the recorder itself.
 */
describe("the recorded clock", () => {
  it("takes the length the recorder reports", () => {
    expect(recorderClockMs(20_000, 12_000)).toBe(20_000);
  });

  /**
   * The reason a wall clock cannot do this job. `durationMillis` freezes for
   * as long as the recorder is held, so thirty seconds of radio spend none of
   * the allowance — and the file agrees, because the same accumulation is what
   * the recorder wrote.
   */
  it("stands still while the recording is held", () => {
    // 1:50 recorded, then held. The recorder keeps reporting the same length
    // however long the hold lasts.
    const held = 110_000;

    expect(recorderClockMs(held, held)).toBe(held);
    expect(recordingReachedLimit(recorderClockMs(held, held))).toBe(false);

    // Ten more seconds spoken after the hold, and only those ten count.
    const afterResume = recorderClockMs(120_000, held);

    expect(afterResume).toBe(MAX_AUDIO_DURATION_MS);
    expect(recordingReachedLimit(afterResume)).toBe(true);
  });

  /**
   * A status that could not be read is not a recording of length zero. The
   * clock holds what it had rather than collapsing to 0:00 under the driver.
   */
  it("holds its last value when the status cannot be read", () => {
    expect(recorderClockMs(null, 42_000)).toBe(42_000);
    expect(recorderClockMs(Number.NaN, 42_000)).toBe(42_000);
  });

  /**
   * Both platforms report 0 once the recorder is stopped or has errored.
   * Believing that on the last read would erase the seconds the driver
   * actually recorded, moments before they are sent.
   */
  it("never walks backwards", () => {
    expect(recorderClockMs(0, 42_000)).toBe(42_000);
    expect(recorderClockMs(30_000, 42_000)).toBe(42_000);
  });

  it("starts at nothing before anything has been recorded", () => {
    expect(recorderClockMs(0, 0)).toBe(0);
  });
});

/**
 * The system moves the recorder on its own — it pauses whatever is capturing
 * when the app goes to the background, and RESUMES whatever it finds paused
 * when the app comes back, the driver's own hold included. These are the
 * corrections that put it back under the driver's control.
 */
describe("reconciling a recorder the system moved", () => {
  /**
   * The bug this whole rule exists for: the driver holds at 0:42, opens the
   * maps app, comes back, and the microphone is running again under a UI that
   * still reads "Pausado". Left alone that is a ten-minute file declared as
   * forty-two seconds.
   */
  it("re-imposes a hold the system undid", () => {
    expect(
      reconcileRecorderState({
        intent: "paused",
        isRecording: true,
        canRecord: true,
        isAppActive: true,
      }),
    ).toBe("pause");
  });

  /**
   * A hold is the driver's instruction, so it is re-imposed wherever it is
   * noticed. There is no state of the app in which a microphone may run
   * against an explicit pause.
   */
  it("re-imposes a hold even when the app is not active", () => {
    expect(
      reconcileRecorderState({
        intent: "paused",
        isRecording: true,
        canRecord: true,
        isAppActive: false,
      }),
    ).toBe("pause");
  });

  it("leaves a hold that is genuinely still held alone", () => {
    expect(
      reconcileRecorderState({
        intent: "paused",
        isRecording: false,
        canRecord: true,
        isAppActive: true,
      }),
    ).toBe("none");
  });

  /** The mirror: the system paused a recording the driver never held. */
  it("resumes a recording the system paused, once the app is back", () => {
    expect(
      reconcileRecorderState({
        intent: "recording",
        isRecording: false,
        canRecord: true,
        isAppActive: true,
      }),
    ).toBe("resume");
  });

  /**
   * In the background the system's pause is not a glitch to undo — it is the
   * platform refusing to record there. Fighting it would either fail or, far
   * worse, succeed and record the driver inside another app.
   */
  it("does not fight the background pause", () => {
    expect(
      reconcileRecorderState({
        intent: "recording",
        isRecording: false,
        canRecord: true,
        isAppActive: false,
      }),
    ).toBe("none");
  });

  /** Nothing to resume once the session is gone; only a stop tidies that up. */
  it("does not resume a session that no longer exists", () => {
    expect(
      reconcileRecorderState({
        intent: "recording",
        isRecording: false,
        canRecord: false,
        isAppActive: true,
      }),
    ).toBe("none");
  });

  it("leaves a recording that is doing what was asked alone", () => {
    expect(
      reconcileRecorderState({
        intent: "recording",
        isRecording: true,
        canRecord: true,
        isAppActive: true,
      }),
    ).toBe("none");
  });
});

describe("day separators", () => {
  it("appear on the first message and on day changes", () => {
    expect(needsDaySeparator(undefined, "2026-08-31T12:00:00.000Z")).toBe(
      true,
    );
    expect(
      needsDaySeparator(
        "2026-08-31T08:00:00.000Z",
        "2026-08-31T12:00:00.000Z",
      ),
    ).toBe(false);
    // Midday timestamps: unambiguous across any timezone the test runs in
    // (the rule reads LOCAL calendar days, which is what the reader sees).
    expect(
      needsDaySeparator(
        "2026-08-30T12:00:00.000Z",
        "2026-08-31T12:00:00.000Z",
      ),
    ).toBe(true);
  });
});

describe("the delivery receipt timestamp", () => {
  const at = (iso: string, id: string, overrides: Partial<ClientChatMessage> = {}) =>
    ({ ...makeMessage({ id, created_at: iso }), ...overrides }) as ClientChatMessage;

  it("has nothing to confirm on an empty conversation", () => {
    expect(newestDeliverableAt([], DRIVER_USER)).toBeNull();
  });

  it("has nothing to confirm when only the driver spoke", () => {
    const mine = [
      at("2026-08-31T12:00:00.000Z", "m1", { senderId: DRIVER_USER }),
      at("2026-08-31T12:05:00.000Z", "m2", { senderId: DRIVER_USER }),
    ];

    expect(newestDeliverableAt(mine, DRIVER_USER)).toBeNull();
  });

  it("picks the newest message from the operation, ignoring the driver's own", () => {
    const mixed = [
      at("2026-08-31T12:00:00.000Z", "m1"),
      at("2026-08-31T12:10:00.000Z", "m2", { senderId: DRIVER_USER }),
      at("2026-08-31T12:05:00.000Z", "m3"),
    ];

    expect(newestDeliverableAt(mixed, DRIVER_USER)).toBe(
      "2026-08-31T12:05:00.000Z",
    );
  });

  it("does not depend on the list being ordered", () => {
    const shuffled = [
      at("2026-08-31T12:05:00.000Z", "m3"),
      at("2026-08-31T12:30:00.000Z", "m9"),
      at("2026-08-31T11:00:00.000Z", "m1"),
      at("2026-08-31T12:20:00.000Z", "m7"),
    ];

    expect(newestDeliverableAt(shuffled, DRIVER_USER)).toBe(
      "2026-08-31T12:30:00.000Z",
    );
  });

  it("ignores optimistic copies — their clock is local, not the server's", () => {
    const list = [
      at("2026-08-31T12:00:00.000Z", "m1"),
      at("2026-08-31T23:00:00.000Z", "local-1", {
        senderId: DRIVER_USER,
        pending: true,
      }),
      at("2026-08-31T23:30:00.000Z", "local-2", {
        senderId: DRIVER_USER,
        failed: true,
      }),
      // Even coming from the operation, a copy still in flight is not proof
      // the device holds the server's version.
      at("2026-08-31T23:45:00.000Z", "local-3", { pending: true }),
    ];

    expect(newestDeliverableAt(list, DRIVER_USER)).toBe(
      "2026-08-31T12:00:00.000Z",
    );
  });

  it("keeps the later of two instants, whichever side is missing", () => {
    expect(latestIso(null, null)).toBeNull();
    expect(latestIso(undefined, "2026-08-31T12:00:00.000Z")).toBe(
      "2026-08-31T12:00:00.000Z",
    );
    expect(latestIso("2026-08-31T12:00:00.000Z", null)).toBe(
      "2026-08-31T12:00:00.000Z",
    );
    expect(
      latestIso("2026-08-31T12:00:00.000Z", "2026-08-31T12:00:01.000Z"),
    ).toBe("2026-08-31T12:00:01.000Z");
    expect(
      latestIso("2026-08-31T12:00:01.000Z", "2026-08-31T12:00:00.000Z"),
    ).toBe("2026-08-31T12:00:01.000Z");
  });
});

describe("the driver's own checks", () => {
  const CREATED_AT = "2026-08-31T12:00:00.000Z";

  const check = (input: {
    pending?: boolean;
    read?: string | null;
    delivered?: string | null;
  }) =>
    resolveOwnMessageCheck({
      createdAt: CREATED_AT,
      pending: input.pending,
      counterpartReadAt: input.read ?? null,
      counterpartDeliveredAt: input.delivered ?? null,
    });

  it("derives the grey double check from the staff delivery cursor", () => {
    expect(wasDeliveredToCounterpart(CREATED_AT, null)).toBe(false);
    expect(
      wasDeliveredToCounterpart(CREATED_AT, "2026-08-31T11:59:00.000Z"),
    ).toBe(false);
    expect(
      wasDeliveredToCounterpart(CREATED_AT, "2026-08-31T12:00:00.000Z"),
    ).toBe(true);
    expect(
      wasDeliveredToCounterpart(CREATED_AT, "2026-08-31T12:01:00.000Z"),
    ).toBe(true);
  });

  it("shows the clock while the send is still in flight", () => {
    // Even with both cursors ahead: nothing was sent yet, so nothing was
    // received. The cursors describe a message the SAC does not have.
    expect(
      check({
        pending: true,
        read: "2026-08-31T12:05:00.000Z",
        delivered: "2026-08-31T12:05:00.000Z",
      }),
    ).toBe("pending");
  });

  it("is only sent while no cursor reaches it", () => {
    expect(check({})).toBe("sent");
    expect(
      check({
        read: "2026-08-31T11:59:00.000Z",
        delivered: "2026-08-31T11:59:00.000Z",
      }),
    ).toBe("sent");
  });

  it("is delivered once the staff cursor covers it and the read one does not", () => {
    expect(
      check({
        read: "2026-08-31T11:00:00.000Z",
        delivered: "2026-08-31T12:00:00.000Z",
      }),
    ).toBe("delivered");
  });

  it("is read even with no delivery cursor at all", () => {
    // The receipt may never arrive — the panel that read it can be one that
    // never confirmed delivery. Reading is proof enough of receiving.
    expect(check({ read: "2026-08-31T12:00:00.000Z", delivered: null })).toBe(
      "read",
    );
  });

  it("stays read when a late receipt leaves the delivery cursor behind", () => {
    // The precedence that matters: a delivery cursor sitting in the past must
    // never demote a message the base has demonstrably already read.
    expect(
      check({
        read: "2026-08-31T12:30:00.000Z",
        delivered: "2026-08-31T11:00:00.000Z",
      }),
    ).toBe("read");
  });

  it("falls back to sent when both cursors are null", () => {
    expect(check({ read: null, delivered: null })).toBe("sent");
  });
});

describe("staging a batch of images", () => {
  const jpeg = (name: string) => ({ name, mimeType: "image/jpeg" });

  it("takes jpeg, png and webp", () => {
    const batch = splitChatImageBatch(
      [
        { name: "a", mimeType: "image/jpeg" },
        { name: "b", mimeType: "image/png" },
        { name: "c", mimeType: "image/webp" },
      ],
      0,
    );

    expect(batch.accepted).toHaveLength(3);
    expect(batch.unsupportedType).toBe(0);
    expect(batch.overLimit).toBe(0);
  });

  it("counts the ones over the ceiling apart from the ones it cannot read", () => {
    // Fifteen picked, two of them a format the chat does not take: thirteen
    // are eligible, ten fit, three are over the limit.
    const picked = [
      ...Array.from({ length: 13 }, (_unused, index) => jpeg(`ok-${index}`)),
      { name: "gif", mimeType: "image/gif" },
      { name: "pdf", mimeType: "application/pdf" },
    ];

    const batch = splitChatImageBatch(picked, 0);

    expect(batch.accepted).toHaveLength(10);
    expect(batch.overLimit).toBe(3);
    expect(batch.unsupportedType).toBe(2);
  });

  it("counts what is already staged against the ceiling", () => {
    const batch = splitChatImageBatch(
      Array.from({ length: 4 }, (_unused, index) => jpeg(`new-${index}`)),
      8,
    );

    expect(batch.accepted.map((image) => image.name)).toEqual([
      "new-0",
      "new-1",
    ]);
    expect(batch.overLimit).toBe(2);
  });

  it("refuses everything once the strip is full", () => {
    const batch = splitChatImageBatch([jpeg("a"), jpeg("b")], 10);

    expect(batch.accepted).toEqual([]);
    expect(batch.overLimit).toBe(2);
  });

  it("lets an undeclared type through — transcoding is the real gate", () => {
    const batch = splitChatImageBatch(
      [{ name: "unknown", mimeType: null }, { name: "empty" }],
      0,
    );

    expect(batch.accepted).toHaveLength(2);
    expect(batch.unsupportedType).toBe(0);
  });

  it("never lets a refused file cost a slot", () => {
    // The eleven eligible files are what compete for the ten slots; the two
    // unsupported ones were out before the count began.
    const picked = [
      { name: "gif-1", mimeType: "image/gif" },
      ...Array.from({ length: 11 }, (_unused, index) => jpeg(`ok-${index}`)),
      { name: "gif-2", mimeType: "image/gif" },
    ];

    const batch = splitChatImageBatch(picked, 0);

    expect(batch.accepted).toHaveLength(10);
    expect(batch.overLimit).toBe(1);
    expect(batch.unsupportedType).toBe(2);
  });
});

describe("folding photos into a grid", () => {
  const photo = (
    id: string,
    minute: number,
    overrides: Partial<ClientChatMessage> = {},
  ): ClientChatMessage => ({
    ...makeMessage({
      id,
      kind: "IMAGE",
      body: null,
      senderId: DRIVER_USER,
      attachment_url: `https://bucket/${id}.jpg`,
      created_at: `2026-08-31T12:${String(minute).padStart(2, "0")}:00.000Z`,
    }),
    ...overrides,
  });

  const rows = (messages: ClientChatMessage[]) =>
    groupChatMessages(messages).map((item) =>
      item.messages.map((message) => message.id),
    );

  it("leaves text alone", () => {
    const list = [
      makeMessage({ id: "t1" }),
      makeMessage({ id: "t2" }),
    ] as ClientChatMessage[];

    expect(rows(list)).toEqual([["t1"], ["t2"]]);
  });

  it("folds a burst from one sender into a single row", () => {
    expect(rows([photo("p1", 0), photo("p2", 0), photo("p3", 1)])).toEqual([
      ["p1", "p2", "p3"],
    ]);
  });

  it("leaves a lone photo its own big bubble", () => {
    expect(rows([photo("p1", 0), makeMessage({ id: "t1" }) as ClientChatMessage])).toEqual([
      ["p1"],
      ["t1"],
    ]);
  });

  it("never mixes senders", () => {
    const list = [
      photo("mine", 0),
      photo("theirs", 0, { senderId: AGENT_USER }),
    ];

    expect(rows(list)).toEqual([["mine"], ["theirs"]]);
  });

  it("splits when the burst is over", () => {
    // Three minutes later is a different thing photographed, not the same
    // batch finishing its upload.
    expect(rows([photo("p1", 0), photo("p2", 3)])).toEqual([["p1"], ["p2"]]);
  });

  it("closes the group on the photo that carries the caption", () => {
    const list = [
      photo("p1", 0),
      photo("p2", 0, { body: "olha a fachada" }),
      photo("p3", 1),
    ];

    expect(rows(list)).toEqual([["p1", "p2"], ["p3"]]);
  });

  it("keeps a failed send out, so its retry stays reachable", () => {
    const list = [photo("p1", 0), photo("p2", 0, { failed: true }), photo("p3", 0)];

    expect(rows(list)).toEqual([["p1"], ["p2"], ["p3"]]);
  });

  it("groups the pending copies of a batch still uploading", () => {
    const list = [
      photo("p1", 0, { pending: true }),
      photo("p2", 0, { pending: true }),
    ];

    expect(rows(list)).toEqual([["p1", "p2"]]);
  });
});

describe("what the operation is doing right now", () => {
  it("says nothing when neither hint is lit", () => {
    expect(
      chatPresenceHint({ isTyping: false, isRecording: false }),
    ).toBeNull();
  });

  it("says digitando when only the keyboard is busy", () => {
    expect(chatPresenceHint({ isTyping: true, isRecording: false })).toBe(
      "typing",
    );
  });

  it("says gravando when only the microphone is busy", () => {
    expect(chatPresenceHint({ isTyping: false, isRecording: true })).toBe(
      "recording",
    );
  });

  it("lets gravando win when both are lit at once", () => {
    // A hand on the keyboard and a note recording beside it is an ordinary
    // second at the SAC's desk, and the more specific fact is the useful one.
    expect(chatPresenceHint({ isTyping: true, isRecording: true })).toBe(
      "recording",
    );
  });

  it("gives each hint its own sentence, on screen and out loud", () => {
    expect(chatPresenceHintLabel("typing")).toBe("digitando...");
    expect(chatPresenceHintLabel("recording")).toBe("gravando um áudio...");

    expect(chatPresenceHintAccessibilityLabel("typing")).toContain(
      "digitando",
    );
    expect(chatPresenceHintAccessibilityLabel("recording")).toContain(
      "gravando",
    );
  });
});

/**
 * Both hints work the same way now: they are PULSED while they stay true, and
 * they go out on their own when the pulses stop. The window is therefore not a
 * safety net for a message that might never come — the absence of the next
 * pulse IS the message, and it cannot be lost, dropped or forgotten.
 */
describe("how long a hint stands without news", () => {
  const HINTS = ["typing", "recording"] as const;

  it("keeps every hint up for longer than the gap between its own pulses", () => {
    // The sender re-announces itself while the fact stays true; a window
    // shorter than that gap would blink the line off between two perfectly
    // ordinary announcements.
    HINTS.forEach((hint) => {
      expect(chatHintTtlMs(hint)).toBeGreaterThan(chatHintPulseMs(hint));
    });
  });

  /**
   * The invariant the whole design rests on. One pulse may be lost — to a
   * hiccup on the socket, to a phone under a bridge — without the bubble
   * blinking, and it takes a second miss for the hint to come down. Any
   * window narrower than two pulses would turn ordinary jitter into a
   * flickering "gravando um áudio...".
   */
  it("keeps every window wider than the gap it actually has to cover", () => {
    // Measured against the REAL gap — the interval plus the beat the emitter
    // is asked on. Asserting the nominal interval is how this invariant read
    // green while the property did not hold: the recorder pulses on a 250 ms
    // beat, so two pulses can sit 2250 ms apart, not 2000.
    EVERY_PRESENCE_HINT.forEach((hint) => {
      expect(chatHintTtlMs(hint)).toBeGreaterThan(chatHintMaxGapMs(hint));
    });
  });

  it("swallows a whole lost pulse only where that is the right trade", () => {
    EVERY_PRESENCE_HINT.forEach((hint) => {
      if (!chatHintSurvivesLostPulse(hint)) return;

      expect(chatHintTtlMs(hint)).toBeGreaterThanOrEqual(
        chatHintMaxGapMs(hint) * 2,
      );
    });
  });

  it("does not pad typing wide enough to outlive the typist", () => {
    // Deliberate asymmetry, and the reason it is asserted rather than left
    // to a comment: recording is a long silent stretch where a blink reads
    // as "they gave up", while typing heals on the next keystroke — a window
    // wide enough to swallow a lost pulse there would leave "digitando..."
    // standing five seconds after the person stopped.
    expect(chatHintSurvivesLostPulse("typing")).toBe(false);
    expect(chatHintTtlMs("typing")).toBeLessThan(
      chatHintMaxGapMs("typing") * 2,
    );
  });

  /**
   * The window that made the whole family of bugs possible: it used to be the
   * audio ceiling plus thirty seconds, so ANY lost "stopped" left "gravando um
   * áudio..." standing on the other side for two and a half minutes. It is now
   * four seconds and owes the recorder's ceiling nothing at all.
   */
  it("no longer waits out a whole recording before letting go", () => {
    expect(RECORDING_HINT_TTL_MS).toBeLessThan(MAX_AUDIO_DURATION_MS);
    expect(RECORDING_HINT_TTL_MS).not.toBe(MAX_AUDIO_DURATION_MS + 30_000);
  });

  /**
   * The two numbers the contract names out loud.
   *
   * The window is five seconds, not the four the pulse contract first named:
   * the emitter can only fire on the recorder's 250 ms beat, so the real gap
   * between two pulses is 2250 ms and four seconds would not have swallowed
   * one lost pulse — which was the whole point of having a window.
   */
  it("pulses every two seconds and forgets after five", () => {
    expect(RECORDING_EMIT_PULSE_MS).toBe(2_000);
    expect(RECORDING_HINT_TTL_MS).toBe(5_000);
  });

  it("hands each hint its own window and its own pulse", () => {
    expect(chatHintTtlMs("typing")).toBe(TYPING_HINT_TTL_MS);
    expect(chatHintTtlMs("recording")).toBe(RECORDING_HINT_TTL_MS);

    expect(chatHintPulseMs("typing")).toBe(TYPING_EMIT_THROTTLE_MS);
    expect(chatHintPulseMs("recording")).toBe(RECORDING_EMIT_PULSE_MS);
  });
});

/**
 * The other half of the same contract: when the sender speaks. Both hints go
 * through this — the keyboard on every keystroke, the microphone on every
 * reading of the recorded clock — and it is what keeps a fact that stays true
 * for two minutes from becoming two minutes of events.
 */
describe("pulsing a presence hint", () => {
  const EVERY = RECORDING_EMIT_PULSE_MS;

  it("pulses at once when nothing was ever announced", () => {
    expect(
      presencePulseIsDue({ nowMs: 10_000, lastPulseAtMs: null, everyMs: EVERY }),
    ).toBe(true);
  });

  it("holds back until the interval has actually passed", () => {
    expect(
      presencePulseIsDue({
        nowMs: 10_000 + EVERY - 1,
        lastPulseAtMs: 10_000,
        everyMs: EVERY,
      }),
    ).toBe(false);
  });

  it("pulses again exactly on the interval, not a beat later", () => {
    // The recorder is read on a 250 ms beat, so the reading that lands ON the
    // interval is the one that has to send: waiting for the next would drift
    // the pulse a quarter second further out every time.
    expect(
      presencePulseIsDue({
        nowMs: 10_000 + EVERY,
        lastPulseAtMs: 10_000,
        everyMs: EVERY,
      }),
    ).toBe(true);
  });

  /**
   * A recording held for a minute and picked back up. The clock the pulse
   * reads froze through the hold and moves again the instant the microphone
   * does, and this is what makes the bubble come straight back rather than
   * waiting out another interval first.
   */
  it("pulses immediately when the fact becomes true again after a silence", () => {
    expect(
      presencePulseIsDue({
        nowMs: 70_000,
        lastPulseAtMs: 10_000,
        everyMs: EVERY,
      }),
    ).toBe(true);
  });
});
