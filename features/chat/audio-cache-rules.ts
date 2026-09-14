/**
 * The decisions behind a cached voice note, kept free of `expo-file-system`
 * and `expo-audio` so they can be tested as what they are: rules.
 *
 * The one that matters most is the naming rule. Everything else here is
 * bookkeeping.
 */

/**
 * What the round button in a voice-note bubble is currently offering.
 *
 * `download` is the state this whole model exists for. A driver on the road
 * pays for their own data, and a play triangle that silently pulls two
 * megabytes over 3G is a promise the app never made. The arrow says what the
 * tap will cost before it costs it.
 */
type AudioControl =
  | "download"
  | "downloading"
  | "play"
  | "pause"
  | "buffering"
  | "retry";

interface AudioControlInput {
  /** A playable copy exists on this device. */
  isCached: boolean;

  isDownloading: boolean;

  /** The download failed, or the cached file refused to load. */
  hasFailed: boolean;

  /** Sound was asked for and has not started yet: loading, or buffering. */
  isPreparing: boolean;

  isPlaying: boolean;
}

/** One file in the voice-note cache, as the eviction rule sees it. */
interface AudioCacheEntry {
  name: string;
  size: number;

  /** Milliseconds since epoch. Files with no readable time sort as oldest. */
  modifiedAt: number;
}

interface AudioCacheLimits {
  maxFiles: number;
  maxBytes: number;
}

/**
 * The cache ceiling.
 *
 * Two limits rather than one, because either alone is wrong. A file count
 * alone ignores how big a note may legally be: at MAX_AUDIO_DURATION_MS of
 * compressed speech, fifty of them still add up to most of the byte ceiling
 * below, and the count would let them through. A byte ceiling alone would keep
 * hundreds of tiny notes around long after the conversation moved on.
 *
 * Fifty notes is far more thread history than a driver scrolls back through
 * in a shift, and a hundred megabytes is a bound the device can absorb. Both
 * are generous on purpose: this lives in the CACHE directory, which the OS is
 * already free to wipe when storage runs low, so the cost of guessing high is
 * a re-download, never lost data.
 */
const AUDIO_CACHE_LIMITS: AudioCacheLimits = {
  maxFiles: 50,
  maxBytes: 100 * 1024 * 1024,
};

/**
 * Extensions worth carrying over to the cached copy. The list exists because
 * the players pick a decoder partly from the file name, and an unknown
 * extension copied blindly out of a url is worse than a sane default.
 */
const AUDIO_CACHE_EXTENSIONS = [
  ".m4a",
  ".mp4",
  ".aac",
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".opus",
  ".webm",
  ".amr",
  ".3gp",
] as const;

/** What the app itself records, and the safest guess for anything else. */
const DEFAULT_AUDIO_EXTENSION = ".m4a";

/** A note the driver just recorded is already on disk — it IS its own cache. */
function isLocalFileUri(url: string): boolean {
  return /^file:\/\//i.test(url.trim());
}

/** Everything before the first `?` or `#` — the part a signature never moves. */
function urlPath(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? "";
}

/**
 * The extension to give the cached copy, read from the url PATH only.
 *
 * The path is the object key and does not change between signatures; the
 * signature itself lives in the query string, which is cut off above. So this
 * is derived data that cannot make the file name drift.
 */
function audioCacheExtension(sourceUrl: string): string {
  const lastSegment = urlPath(sourceUrl).split("/").pop() ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");

  if (dotIndex <= 0) return DEFAULT_AUDIO_EXTENSION;

  const extension = lastSegment.slice(dotIndex).toLowerCase();

  return (AUDIO_CACHE_EXTENSIONS as readonly string[]).includes(extension)
    ? extension
    : DEFAULT_AUDIO_EXTENSION;
}

/**
 * The name a cached voice note is filed under.
 *
 * KEYED ON THE MESSAGE, NEVER ON THE URL. Attachment urls are signed and
 * expire, so the same note comes back under a different url every time the
 * thread is loaded — hashing the url would file a brand new copy on each
 * signature and the cache would never hit once, which is the exact opposite
 * of the point. The message id is the only identity of a voice note that does
 * not move.
 *
 * The extension is the single thing taken from the url, and only from its
 * path (see `audioCacheExtension`), which the signature does not touch.
 */
function audioCacheFileName(messageId: string, sourceUrl: string): string {
  // Anything that is not plainly safe in a file name becomes an underscore:
  // ids are server-issued today, but a name that can climb out of its own
  // directory is not a risk worth carrying.
  const safeId = messageId.trim().replace(/[^A-Za-z0-9_-]/g, "_");

  return `${safeId || "unknown"}${audioCacheExtension(sourceUrl)}`;
}

/**
 * How far along a download is, or null when the server never said how big the
 * file was. Null is a real answer, not a zero: an indeterminate spinner is
 * honest about not knowing, a bar frozen at 0% is not.
 */
function downloadRatio(written: number, expected: number): number | null {
  if (!Number.isFinite(expected) || expected <= 0) return null;
  if (!Number.isFinite(written) || written <= 0) return 0;

  return Math.min(1, written / expected);
}

/**
 * What the round button shows right now.
 *
 * The precedence reads top to bottom as the driver's own question: did it
 * break, is it coming, do I have it, is it talking.
 */
function resolveAudioControl(input: AudioControlInput): AudioControl {
  if (input.hasFailed) return "retry";
  if (input.isDownloading) return "downloading";
  if (!input.isCached) return "download";

  // Preparing outranks playing: the split second between the tap and the
  // first sound belongs to the spinner, not to a pause icon for audio that
  // is not audible yet.
  if (input.isPreparing) return "buffering";
  if (input.isPlaying) return "pause";

  return "play";
}

/**
 * Which files have to go, oldest first, for the cache to fit back under its
 * ceiling. Returns names, not files: deleting is the caller's business.
 *
 * Oldest-first by modification time is what makes this safe to run right
 * after a download — the file just written is the newest, so it is the last
 * thing that could ever be chosen, and a cache smaller than its ceiling
 * evicts nothing at all.
 */
function selectAudioCacheEvictions(
  entries: AudioCacheEntry[],
  limits: AudioCacheLimits = AUDIO_CACHE_LIMITS,
): string[] {
  const oldestFirst = [...entries].sort(
    (a, b) => a.modifiedAt - b.modifiedAt || a.name.localeCompare(b.name),
  );

  let files = oldestFirst.length;
  let bytes = oldestFirst.reduce(
    (total, entry) => total + Math.max(0, entry.size),
    0,
  );

  const evicted: string[] = [];

  for (const entry of oldestFirst) {
    if (files <= limits.maxFiles && bytes <= limits.maxBytes) break;

    evicted.push(entry.name);

    files -= 1;
    bytes -= Math.max(0, entry.size);
  }

  return evicted;
}

export {
  AUDIO_CACHE_LIMITS,
  AUDIO_CACHE_EXTENSIONS,
  DEFAULT_AUDIO_EXTENSION,
  isLocalFileUri,
  audioCacheExtension,
  audioCacheFileName,
  downloadRatio,
  resolveAudioControl,
  selectAudioCacheEvictions,
};

export type {
  AudioControl,
  AudioControlInput,
  AudioCacheEntry,
  AudioCacheLimits,
};
