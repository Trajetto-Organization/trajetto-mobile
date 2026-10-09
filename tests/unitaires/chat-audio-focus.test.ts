import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  armAudioPlayer,
  armedAudioPlayerId,
  claimAudioFocus,
  disarmAudioPlayer,
  holdsAudioFocus,
  releaseAudioFocus,
  stopChatAudio,
  subscribeArmedAudioPlayer,
} from "@/features/chat/audio-focus";

import { audioResumeSeconds } from "@/features/chat/audio-track-rules";

/**
 * One native player per conversation (MOB-06).
 *
 * Every bubble used to build its own ExoPlayer on mount — a thread, and for a
 * downloaded note a prepared decoder and a status loop — so thirty voice notes
 * meant thirty of them alive at once. A bubble now builds its player only
 * while it is ARMED, and this arbiter is what guarantees there is never more
 * than one armed bubble.
 */
describe("the conversation's single audio player", () => {
  beforeEach(() => {
    stopChatAudio();
  });

  it("is owned by at most one bubble: arming a note disarms the previous one", () => {
    armAudioPlayer("note-a");
    expect(armedAudioPlayerId()).toBe("note-a");

    armAudioPlayer("note-b");
    expect(armedAudioPlayerId()).toBe("note-b");
  });

  it("silences the note that was sounding when another one is armed", () => {
    const stopA = vi.fn();

    claimAudioFocus("note-a", stopA);
    armAudioPlayer("note-b");

    expect(stopA).toHaveBeenCalledTimes(1);
    expect(armedAudioPlayerId()).toBe("note-b");
  });

  it("does not stop a note that re-claims its own floor (resuming after a drag)", () => {
    const stopA = vi.fn();

    claimAudioFocus("note-a", stopA);
    claimAudioFocus("note-a", stopA);
    armAudioPlayer("note-a");

    expect(stopA).not.toHaveBeenCalled();
    expect(armedAudioPlayerId()).toBe("note-a");
  });

  it("keeps a paused note armed, so resuming it does not rebuild the player", () => {
    claimAudioFocus("note-a", () => undefined);
    releaseAudioFocus("note-a");

    expect(armedAudioPlayerId()).toBe("note-a");
  });

  it("a note that starts playing is the armed one", () => {
    armAudioPlayer("note-a");
    claimAudioFocus("note-b", () => undefined);

    expect(armedAudioPlayerId()).toBe("note-b");
  });

  it("leaving the conversation (or opening the microphone) stops the sound and releases the player", () => {
    const stopA = vi.fn();

    claimAudioFocus("note-a", stopA);
    stopChatAudio();

    expect(stopA).toHaveBeenCalledTimes(1);
    expect(armedAudioPlayerId()).toBeNull();
  });

  it("a bubble leaving the screen only gives the player back if it still holds it", () => {
    armAudioPlayer("note-a");
    armAudioPlayer("note-b");

    disarmAudioPlayer("note-a");
    expect(armedAudioPlayerId()).toBe("note-b");

    disarmAudioPlayer("note-b");
    expect(armedAudioPlayerId()).toBeNull();
  });

  it("a disarmed holder is never stopped again by the next claim (its player is gone)", () => {
    const stopA = vi.fn();

    claimAudioFocus("note-a", stopA);
    disarmAudioPlayer("note-a");
    claimAudioFocus("note-b", () => undefined);

    expect(stopA).not.toHaveBeenCalled();
  });

  it("tells subscribers when the owner changes, and only then", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeArmedAudioPlayer(listener);

    armAudioPlayer("note-a");
    armAudioPlayer("note-a");
    armAudioPlayer("note-b");
    stopChatAudio();

    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    armAudioPlayer("note-c");

    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe("where a note picks up when its player is rebuilt", () => {
  it("resumes where the driver left it", () => {
    expect(audioResumeSeconds(31, 42)).toBe(31);
  });

  it("starts over from the top once it had played out", () => {
    expect(audioResumeSeconds(42, 42)).toBe(0);
    expect(audioResumeSeconds(41.8, 42)).toBe(0);
  });

  it("treats a missing or nonsensical position as the start", () => {
    expect(audioResumeSeconds(0, 42)).toBe(0);
    expect(audioResumeSeconds(-3, 42)).toBe(0);
    expect(audioResumeSeconds(Number.NaN, 42)).toBe(0);
  });

  it("keeps the position when the length is not known yet", () => {
    expect(audioResumeSeconds(12, 0)).toBe(12);
  });
});

describe("a start that waits for a seek", () => {
  beforeEach(() => {
    stopChatAudio();
  });

  it("only plays if its note still holds the floor when the seek lands", () => {
    claimAudioFocus("note-a", () => undefined);
    expect(holdsAudioFocus("note-a")).toBe(true);

    // The driver tapped another note while note-a was still seeking.
    claimAudioFocus("note-b", () => undefined);

    expect(holdsAudioFocus("note-a")).toBe(false);
    expect(holdsAudioFocus("note-b")).toBe(true);
  });
});
