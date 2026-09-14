import { describe, expect, it } from "vitest";

import {
  AUDIO_BAR_MIN_GAP,
  AUDIO_BAR_WIDTH,
  AUDIO_TRACK_PADDING,
  audioBarCount,
  audioPlayedRatio,
  audioRailOffsetFromRatio,
  audioRailWidth,
  audioRatioFromX,
  audioSeekLanded,
  audioSeekSeconds,
  audioSteppedRatio,
  AUDIO_SEEK_STEP_SECONDS,
} from "@/features/chat/audio-track-rules";

import type { AudioTrackGeometry } from "@/features/chat/audio-track-rules";

/** A track as wide as one really is inside a bubble. */
const TRACK: AudioTrackGeometry = {
  width: 200,
  padding: AUDIO_TRACK_PADDING,
};

const RAIL = 200 - AUDIO_TRACK_PADDING * 2;

describe("track rail", () => {
  it("discounts the padding reserved at BOTH ends", () => {
    expect(audioRailWidth(TRACK)).toBe(RAIL);
  });

  it("never goes negative on a track too narrow for its own padding", () => {
    expect(audioRailWidth({ width: 4, padding: 7 })).toBe(0);
    expect(audioRailWidth({ width: 0, padding: 7 })).toBe(0);
  });
});

describe("touch to proportion", () => {
  it("puts the ends of the rail at 0 and 1", () => {
    expect(audioRatioFromX(AUDIO_TRACK_PADDING, TRACK)).toBe(0);
    expect(audioRatioFromX(TRACK.width - AUDIO_TRACK_PADDING, TRACK)).toBe(1);
  });

  it("puts the middle of the rail at exactly one half", () => {
    expect(audioRatioFromX(AUDIO_TRACK_PADDING + RAIL / 2, TRACK)).toBe(0.5);
  });

  /**
   * The regression this whole module exists for: measuring the track but
   * mapping the touch over its FULL width ignores the padding, and every
   * position comes out a few percent early. At a quarter of the rail that is
   * a visible slice of a two-minute note.
   */
  it("does not answer what a padding-blind mapping would answer", () => {
    const x = AUDIO_TRACK_PADDING + RAIL * 0.25;

    expect(audioRatioFromX(x, TRACK)).toBe(0.25);
    expect(x / TRACK.width).not.toBe(0.25);
  });

  it("clamps a finger that slid off either end", () => {
    expect(audioRatioFromX(-40, TRACK)).toBe(0);
    expect(audioRatioFromX(0, TRACK)).toBe(0);
    expect(audioRatioFromX(999, TRACK)).toBe(1);
  });

  it("answers 0 for a track that has not been measured yet", () => {
    expect(audioRatioFromX(30, { width: 0, padding: 7 })).toBe(0);
  });
});

describe("proportion to pixels", () => {
  it("is the exact inverse of the touch mapping", () => {
    [0, 0.13, 0.25, 0.5, 0.777, 1].forEach((ratio) => {
      const offset = audioRailOffsetFromRatio(ratio, TRACK);

      expect(audioRatioFromX(TRACK.padding + offset, TRACK)).toBeCloseTo(
        ratio,
        10,
      );
    });
  });

  it("keeps the head inside the rail whatever it is handed", () => {
    expect(audioRailOffsetFromRatio(-1, TRACK)).toBe(0);
    expect(audioRailOffsetFromRatio(4, TRACK)).toBe(RAIL);
  });
});

describe("bar density", () => {
  it("fills the rail at the asked density", () => {
    // 186px of rail, 2.5 wide bars, 4 of gap: 6.5 of pitch, plus the gap the
    // last bar does not need.
    expect(audioBarCount(RAIL, AUDIO_BAR_WIDTH, AUDIO_BAR_MIN_GAP)).toBe(
      Math.floor((RAIL + AUDIO_BAR_MIN_GAP) / (AUDIO_BAR_WIDTH + AUDIO_BAR_MIN_GAP)),
    );
  });

  it("grows with the rail instead of stretching the same bars", () => {
    const narrow = audioBarCount(120, AUDIO_BAR_WIDTH, AUDIO_BAR_MIN_GAP);
    const wide = audioBarCount(320, AUDIO_BAR_WIDTH, AUDIO_BAR_MIN_GAP);

    expect(wide).toBeGreaterThan(narrow);
  });

  it("draws nothing on a rail with no room for one bar", () => {
    expect(audioBarCount(0, AUDIO_BAR_WIDTH, AUDIO_BAR_MIN_GAP)).toBe(0);
    expect(audioBarCount(1, AUDIO_BAR_WIDTH, AUDIO_BAR_MIN_GAP)).toBe(0);
  });
});

describe("proportion to playback", () => {
  it("turns a proportion into a position in the note", () => {
    expect(audioSeekSeconds(0.5, 60)).toBe(30);
    expect(audioSeekSeconds(1.4, 60)).toBe(60);
    expect(audioSeekSeconds(-0.2, 60)).toBe(0);
  });

  it("refuses to seek a note of unknown length", () => {
    expect(audioSeekSeconds(0.5, 0)).toBe(0);
  });

  it("reads the played proportion back, clamped", () => {
    expect(audioPlayedRatio(15, 60)).toBe(0.25);
    expect(audioPlayedRatio(61, 60)).toBe(1);
    expect(audioPlayedRatio(5, 0)).toBe(0);
  });

  it("round-trips a tap through the note and back", () => {
    const totalSeconds = 92;
    const x = TRACK.padding + RAIL * 0.4;

    const ratio = audioRatioFromX(x, TRACK);
    const seconds = audioSeekSeconds(ratio, totalSeconds);

    expect(audioPlayedRatio(seconds, totalSeconds)).toBeCloseTo(0.4, 10);
  });
});

/**
 * The bug this exists for: with the note PLAYING, dragging the head forward
 * and letting go made it fall back to where the sound was and only then jump
 * to where the finger left it. The player reports its position on a fixed
 * beat, and the report emitted just before the seek landed carries the old
 * position while arriving after the seek call resolved.
 */
describe("seek confirmation", () => {
  it("does not believe a report still sitting at the old position", () => {
    // Dragged from 30s to 80s; the report in flight is the old one.
    expect(
      audioSeekLanded({
        reportedSeconds: 30.2,
        fromSeconds: 30,
        targetSeconds: 80,
      }),
    ).toBe(false);
  });

  it("accepts the first report about the new position", () => {
    expect(
      audioSeekLanded({
        reportedSeconds: 80.1,
        fromSeconds: 30,
        targetSeconds: 80,
      }),
    ).toBe(true);
  });

  it("accepts a report that landed late, past the target", () => {
    // A phone busy enough to miss a beat lands the head half a second on.
    // A fixed tolerance around the target would reject this and hold a
    // position that is no longer true.
    expect(
      audioSeekLanded({
        reportedSeconds: 80.6,
        fromSeconds: 30,
        targetSeconds: 80,
      }),
    ).toBe(true);
  });

  /**
   * The direction that catches a naive `reported >= target`: seeking
   * BACKWARDS, every stale report is far past the target and would be taken
   * as confirmation of a seek that has not happened.
   */
  it("does not believe a stale report on a backward seek", () => {
    expect(
      audioSeekLanded({
        reportedSeconds: 100.2,
        fromSeconds: 100,
        targetSeconds: 10,
      }),
    ).toBe(false);

    expect(
      audioSeekLanded({
        reportedSeconds: 10.05,
        fromSeconds: 100,
        targetSeconds: 10,
      }),
    ).toBe(true);
  });

  it("confirms at once a seek that asked for where it already was", () => {
    expect(
      audioSeekLanded({
        reportedSeconds: 42,
        fromSeconds: 42,
        targetSeconds: 42,
      }),
    ).toBe(true);
  });

  /**
   * A seek the player ignored leaves the note running on from where it was.
   * The head must not hold a position the note is never going to reach, so
   * the report frees it once it is nearer the target than the origin.
   */
  it("gives up once playback has carried past the halfway point", () => {
    expect(
      audioSeekLanded({
        reportedSeconds: 54,
        fromSeconds: 30,
        targetSeconds: 80,
      }),
    ).toBe(false);

    expect(
      audioSeekLanded({
        reportedSeconds: 56,
        fromSeconds: 30,
        targetSeconds: 80,
      }),
    ).toBe(true);
  });

  it("handles a seek to the very start of a playing note", () => {
    expect(
      audioSeekLanded({
        reportedSeconds: 45.1,
        fromSeconds: 45,
        targetSeconds: 0,
      }),
    ).toBe(false);

    expect(
      audioSeekLanded({ reportedSeconds: 0, fromSeconds: 45, targetSeconds: 0 }),
    ).toBe(true);
  });
});

/**
 * The seek a screen reader performs. The track calls itself `adjustable`, so
 * stepping it has to land somewhere sensible at both ends of the note — a
 * control that goes dead at 0:00 and at the end is indistinguishable, through
 * a reader, from one that has stopped responding.
 */
describe("stepping the head with a screen reader", () => {
  const NOTE = 100;

  it("steps forward by the step, as a proportion", () => {
    expect(audioSteppedRatio(40, AUDIO_SEEK_STEP_SECONDS, NOTE)).toBeCloseTo(
      0.45,
    );
  });

  it("steps backward by the step", () => {
    expect(audioSteppedRatio(40, -AUDIO_SEEK_STEP_SECONDS, NOTE)).toBeCloseTo(
      0.35,
    );
  });

  it("clamps at the end instead of running past it", () => {
    expect(audioSteppedRatio(98, AUDIO_SEEK_STEP_SECONDS, NOTE)).toBe(1);
  });

  it("clamps at the start instead of going negative", () => {
    expect(audioSteppedRatio(2, -AUDIO_SEEK_STEP_SECONDS, NOTE)).toBe(0);
  });

  /** A note whose length is not known yet has no position to step to. */
  it("stays at the start for a note of unknown length", () => {
    expect(audioSteppedRatio(10, AUDIO_SEEK_STEP_SECONDS, 0)).toBe(0);
  });

  /** The step and the geometry agree: a ratio is always a ratio. */
  it("hands back something the seek maths accepts", () => {
    const ratio = audioSteppedRatio(40, AUDIO_SEEK_STEP_SECONDS, NOTE);

    expect(audioSeekSeconds(ratio, NOTE)).toBeCloseTo(45);
  });
});
