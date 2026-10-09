/**
 * The geometry of a voice-note seek bar: pixels to proportion and back.
 *
 * It lives here, apart from the component, because it is the part that can be
 * WRONG in a way nobody notices by looking. A player whose drawn head and
 * whose touch area disagree by a few pixels seeks a few percent off every
 * single time, consistently enough to feel like the player is lying rather
 * than like a bug — and that is exactly the kind of thing a test pins down and
 * an eye does not.
 *
 * The single invariant everything else rests on: `audioRatioFromX` and
 * `audioRailOffsetFromRatio` are inverses of each other. Whatever the drawing
 * does with bars, gaps and rounding, the pixel the finger lands on and the
 * pixel the head is drawn at are computed from the same rail.
 */

/**
 * Dead space kept at each end of the track.
 *
 * The head is a dot with width, so its CENTRE cannot reach the track's own
 * edges without half of it being clipped. Reserving its radius at both ends
 * gives the rail — the run the centre may actually travel — and that rail, not
 * the measured width, is what maps to 0..1. Skip this and every position is
 * off by up to a radius, which is the classic "it always lands slightly
 * before where I tapped".
 */
const AUDIO_TRACK_PADDING = 7;

/** Width of one bar of the progress motif. */
const AUDIO_BAR_WIDTH = 2.5;

/**
 * The narrowest breathing room between two bars. It sets the DENSITY, not the
 * positions: the bars are then spread across the whole rail, so a wider bubble
 * gets more bars rather than more stretched ones.
 */
const AUDIO_BAR_MIN_GAP = 4;

interface AudioTrackGeometry {
  /** What `onLayout` measured on the track itself, its end padding included. */
  width: number;

  /** Reserved at each end, so the head never draws outside the track. */
  padding: number;
}

/** The run the head may travel: the measured width minus both end paddings. */
function audioRailWidth(geometry: AudioTrackGeometry): number {
  "worklet";

  return Math.max(0, geometry.width - geometry.padding * 2);
}

/**
 * Where a touch landed, as 0..1 of the rail.
 *
 * The x is relative to the track view — the same view that was measured — so
 * the padding is subtracted here and nowhere else. Clamped, because a finger
 * that slides past either end asked for the end, not for a negative position.
 */
function audioRatioFromX(x: number, geometry: AudioTrackGeometry): number {
  "worklet";

  const rail = audioRailWidth(geometry);

  if (rail <= 0) return 0;

  return Math.min(1, Math.max(0, (x - geometry.padding) / rail));
}

/**
 * The inverse: how far into the rail a proportion sits, in pixels. This is
 * what the fill is clipped at and where the head is drawn, which is what makes
 * "seeks where you tapped" true by construction rather than by luck.
 */
function audioRailOffsetFromRatio(
  ratio: number,
  geometry: AudioTrackGeometry,
): number {
  "worklet";

  return Math.min(1, Math.max(0, ratio)) * audioRailWidth(geometry);
}

/**
 * How many bars fit a rail at a given density.
 *
 * They are drawn spread across the rail afterwards, so this decides how many,
 * never where — the seek maths does not depend on it. A rail with no room for
 * a single bar draws none.
 */
function audioBarCount(
  railWidth: number,
  barWidth: number,
  minGap: number,
): number {
  if (railWidth < barWidth) return 0;

  return Math.max(1, Math.floor((railWidth + minGap) / (barWidth + minGap)));
}

/** How far into the note a proportion points, in seconds. */
function audioSeekSeconds(ratio: number, totalSeconds: number): number {
  if (totalSeconds <= 0) return 0;

  return Math.min(1, Math.max(0, ratio)) * totalSeconds;
}

/**
 * How far one screen-reader step moves the head.
 *
 * A voice note is short, so the step is short: five seconds is about a
 * sentence, which is the unit somebody scrubbing by ear is actually looking
 * for. Anything larger turns a two-minute note into a control with a dozen
 * usable positions.
 */
const AUDIO_SEEK_STEP_SECONDS = 5;

/**
 * Where a step lands, as 0..1 of the note.
 *
 * Clamped at both ends rather than refused: a step past the end of a note is a
 * request for the end, and a step back from 0:02 is a request for the start.
 * A control that does nothing at its extremes reads, through a screen reader,
 * exactly like a control that has stopped responding.
 */
function audioSteppedRatio(
  currentSeconds: number,
  stepSeconds: number,
  totalSeconds: number,
): number {
  if (totalSeconds <= 0) return 0;

  const target = Math.min(
    totalSeconds,
    Math.max(0, currentSeconds + stepSeconds),
  );

  return target / totalSeconds;
}

/** How far the note has played, as 0..1. A note of unknown length is at 0. */
function audioPlayedRatio(
  currentSeconds: number,
  totalSeconds: number,
): number {
  if (totalSeconds <= 0) return 0;

  return Math.min(1, Math.max(0, currentSeconds / totalSeconds));
}

/**
 * How long the head may hold the position the finger let it at, before the
 * player is presumed to have swallowed the seek.
 *
 * The hold below has no other way out: it ends when a status report is about
 * the new position, and a seek that silently did nothing produces no such
 * report. Generous enough to cover several status intervals on a phone that
 * is busy, short enough that a head stuck on a lie is measured in one beat
 * rather than in "it froze".
 */
const AUDIO_SEEK_HOLD_TIMEOUT_MS = 1_500;

/** One position report from the player, against the seek that is in flight. */
interface AudioSeekReport {
  /** What the player last said its position was, in seconds. */
  reportedSeconds: number;

  /** Where the player was when the seek was asked for, in seconds. */
  fromSeconds: number;

  /** Where the seek asked it to go, in seconds. */
  targetSeconds: number;
}

/**
 * Whether a position report is about the seek that was just asked for, or
 * still about the position the note was at before it.
 *
 * This is the whole fix for "the head goes back and only then jumps". The
 * player reports its position on a fixed beat, and a report emitted before
 * the seek landed still carries the OLD position — arriving, unhelpfully,
 * AFTER the seek call has resolved. Believing it drags the head backwards for
 * one beat, which reads as the release having been ignored.
 *
 * The test is a distance, not a tolerance: a report belongs to the new
 * position once it is at least as close to where the seek was going as to
 * where it came from. That works in both directions — a backward seek from
 * 100s to 10s is not confirmed by a stale 100s report, which any
 * "reported >= target" test would happily accept — and it needs no guess
 * about how exactly the decoder lands or how late a report may be.
 *
 * It also self-heals: a seek that never happened leaves the note playing on
 * from `fromSeconds`, and the report crosses the midpoint between the two on
 * its own. The timeout above is what keeps that from taking half a note.
 */
function audioSeekLanded(report: AudioSeekReport): boolean {
  const { reportedSeconds, fromSeconds, targetSeconds } = report;

  return (
    Math.abs(reportedSeconds - targetSeconds) <=
    Math.abs(reportedSeconds - fromSeconds)
  );
}

/**
 * How close to the end a note counts as finished when its player is rebuilt.
 * The last status report of a note that played out lands a beat short of the
 * duration, so "at the end" has to be a margin, not an equality.
 */
const AUDIO_RESUME_END_MARGIN_SECONDS = 0.5;

/**
 * Where a note picks up when its player is built again.
 *
 * A bubble only holds a native player while it is the conversation's armed
 * note (MOB-06), so playing another note tears this one's player down. The
 * driver must not notice: a note paused at 0:31 resumes at 0:31. A note that
 * had played out starts over from the top instead of "resuming" into silence,
 * and nonsense (a negative or non-finite report) is the start.
 */
function audioResumeSeconds(
  positionSeconds: number,
  totalSeconds: number,
): number {
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) return 0;

  if (totalSeconds > 0) {
    if (positionSeconds >= totalSeconds - AUDIO_RESUME_END_MARGIN_SECONDS) {
      return 0;
    }

    return Math.min(positionSeconds, totalSeconds);
  }

  return positionSeconds;
}

export {
  AUDIO_RESUME_END_MARGIN_SECONDS,
  audioResumeSeconds,
  AUDIO_TRACK_PADDING,
  AUDIO_BAR_WIDTH,
  AUDIO_BAR_MIN_GAP,
  audioRailWidth,
  audioRatioFromX,
  audioRailOffsetFromRatio,
  audioBarCount,
  audioSeekSeconds,
  audioPlayedRatio,
  AUDIO_SEEK_STEP_SECONDS,
  audioSteppedRatio,
  AUDIO_SEEK_HOLD_TIMEOUT_MS,
  audioSeekLanded,
};

export type { AudioTrackGeometry, AudioSeekReport };
