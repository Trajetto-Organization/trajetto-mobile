import type { RecordingOptions } from "expo-audio";

import { MAX_AUDIO_DURATION_MS } from "./chat-rules";

/**
 * How a voice note is recorded (MOB-07).
 *
 * `RecordingPresets.HIGH_QUALITY` is a MUSIC preset: AAC at 44.1 kHz, stereo,
 * 128 kbps — about 1.9 MB for a two-minute note, paid for twice on the
 * driver's 3G/4G (upload here, download on every phone that plays it). Speech
 * carries almost nothing above 8 kHz and never needs two channels, so this is
 * mono AAC-LC at 22.05 kHz and 32 kbps: roughly 480 KB for the same two
 * minutes, four times less, and still clearly intelligible.
 *
 * The container stays `.m4a` (MPEG-4/AAC-LC) because it is the one compressed
 * format every browser on the SAC side decodes natively. HE-AAC would squeeze
 * further, but not every browser plays it back.
 *
 * Kept free of runtime imports from `expo-audio` (the iOS enum values are
 * written out) so the preset can be pinned by a unit test in plain Node.
 */
const VOICE_NOTE_SAMPLE_RATE = 22_050;
const VOICE_NOTE_CHANNELS = 1;
const VOICE_NOTE_BIT_RATE = 32_000;

const VOICE_NOTE_RECORDING_OPTIONS: RecordingOptions = {
  extension: ".m4a",
  sampleRate: VOICE_NOTE_SAMPLE_RATE,
  numberOfChannels: VOICE_NOTE_CHANNELS,
  bitRate: VOICE_NOTE_BIT_RATE,
  isMeteringEnabled: false,
  android: {
    extension: ".m4a",
    outputFormat: "mpeg4",
    audioEncoder: "aac",
  },
  ios: {
    extension: ".m4a",
    // `IOSOutputFormat.MPEG4AAC` and `AudioQuality.MEDIUM`, spelled out.
    outputFormat: "aac ",
    audioQuality: 64,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: VOICE_NOTE_BIT_RATE,
  },
};

/**
 * What a note of `durationMs` costs on the wire, before the container's few
 * hundred bytes of headers. The number the driver's data plan actually sees.
 */
function estimatedVoiceNoteBytes(durationMs: number): number {
  const seconds = Math.max(0, durationMs) / 1000;

  return Math.ceil((VOICE_NOTE_BIT_RATE / 8) * seconds);
}

/** The heaviest note the recorder can produce, at the ceiling. */
const MAX_VOICE_NOTE_BYTES = estimatedVoiceNoteBytes(MAX_AUDIO_DURATION_MS);

export {
  VOICE_NOTE_RECORDING_OPTIONS,
  VOICE_NOTE_SAMPLE_RATE,
  VOICE_NOTE_CHANNELS,
  VOICE_NOTE_BIT_RATE,
  MAX_VOICE_NOTE_BYTES,
  estimatedVoiceNoteBytes,
};
