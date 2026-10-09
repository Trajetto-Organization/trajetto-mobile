import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_AUDIO_DURATION_MS } from "@/features/chat/chat-rules";

import {
  MAX_VOICE_NOTE_BYTES,
  VOICE_NOTE_RECORDING_OPTIONS,
  estimatedVoiceNoteBytes,
} from "@/features/chat/voice-note-preset";

import {
  microphoneAccessNotice,
  microphoneNeedsRequest,
  resolveMicrophoneAccess,
} from "@/features/chat/microphone-permission";

/**
 * The voice note on the driver's side: what it is recorded as (MOB-07) and
 * what happens when the microphone permission is not there (MOB-01's runtime
 * half — the manifest half is guarded by android-manifest.test.ts).
 *
 * The hook runs outside a renderer: state is inert, refs are real objects,
 * and the native modules are replaced by the smallest fakes that answer.
 */
vi.mock("react", () => ({
  useState: <T,>(initial: T) => [initial, () => undefined],
  useRef: <T,>(initial: T) => ({ current: initial }),
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
}));

const alert = vi.fn();
const openSettings = vi.fn(async () => undefined);

vi.mock("react-native", () => ({
  Alert: { alert: (...args: unknown[]) => alert(...args) },
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: () => undefined }),
  },
  Linking: { openSettings: () => openSettings() },
}));

const toast = vi.fn();

vi.mock("react-native-toast-message", () => ({
  default: { show: (...args: unknown[]) => toast(...args) },
}));

vi.mock("expo-file-system/legacy", () => ({
  getInfoAsync: async () => ({ exists: true, size: 1024 }),
}));

const permission = {
  get: vi.fn(async () => ({ granted: true, canAskAgain: true, status: "granted" })),
  request: vi.fn(async () => ({ granted: true, canAskAgain: true, status: "granted" })),
};

const recorder = {
  prepareToRecordAsync: vi.fn(async () => undefined),
  record: vi.fn(),
  stop: vi.fn(async () => undefined),
  pause: vi.fn(),
  getStatus: () => ({
    isRecording: true,
    canRecord: true,
    durationMillis: 0,
  }),
  uri: "file:///voice.m4a",
};

const useAudioRecorder = vi.fn((_options: unknown) => recorder);

vi.mock("expo-audio", () => ({
  AudioModule: {
    getRecordingPermissionsAsync: () => permission.get(),
    requestRecordingPermissionsAsync: () => permission.request(),
  },
  setAudioModeAsync: async () => undefined,
  useAudioRecorder: (options: unknown) => useAudioRecorder(options),
  // What the hook used to record with — here so the old code still loads.
  RecordingPresets: {
    HIGH_QUALITY: {
      extension: ".m4a",
      sampleRate: 44_100,
      numberOfChannels: 2,
      bitRate: 128_000,
      android: { outputFormat: "mpeg4", audioEncoder: "aac" },
    },
  },
}));

let useVoiceRecorder: typeof import("@/features/chat/hooks/use-voice-recorder").useVoiceRecorder;

beforeAll(async () => {
  ({ useVoiceRecorder } = await import(
    "@/features/chat/hooks/use-voice-recorder"
  ));
});

beforeEach(() => {
  alert.mockClear();
  openSettings.mockClear();
  toast.mockClear();
  useAudioRecorder.mockClear();
  recorder.prepareToRecordAsync.mockClear();
  recorder.record.mockClear();
  permission.get.mockReset();
  permission.request.mockReset();
  permission.get.mockResolvedValue({ granted: true, canAskAgain: true, status: "granted" });
  permission.request.mockResolvedValue({ granted: true, canAskAgain: true, status: "granted" });
});

// ------------------------------------------------------------------ preset
describe("the voice note preset", () => {
  it("records speech, not music: mono AAC in an .m4a at 16–22.05 kHz and 32–48 kbps", () => {
    const options = VOICE_NOTE_RECORDING_OPTIONS;

    expect(options.numberOfChannels).toBe(1);
    expect(options.sampleRate).toBeGreaterThanOrEqual(16_000);
    expect(options.sampleRate).toBeLessThanOrEqual(22_050);
    expect(options.bitRate).toBeGreaterThanOrEqual(32_000);
    expect(options.bitRate).toBeLessThanOrEqual(48_000);

    // The one compressed format every browser on the SAC side decodes.
    expect(options.extension).toBe(".m4a");
    expect(options.android.outputFormat).toBe("mpeg4");
    expect(options.android.audioEncoder).toBe("aac");
  });

  it("keeps a note at the ceiling well under what the music preset cost", () => {
    const musicPresetBytes = (128_000 / 8) * (MAX_AUDIO_DURATION_MS / 1000);

    expect(MAX_VOICE_NOTE_BYTES).toBe(estimatedVoiceNoteBytes(MAX_AUDIO_DURATION_MS));
    expect(MAX_VOICE_NOTE_BYTES).toBeLessThanOrEqual(600 * 1024);
    expect(MAX_VOICE_NOTE_BYTES * 3).toBeLessThan(musicPresetBytes);
  });

  it("is what the recorder is actually built with", () => {
    useVoiceRecorder();

    expect(useAudioRecorder).toHaveBeenCalledTimes(1);

    const options = useAudioRecorder.mock.calls[0][0] as {
      numberOfChannels: number;
      bitRate: number;
    };

    expect(options.numberOfChannels).toBe(1);
    expect(options.bitRate).toBeLessThanOrEqual(48_000);
  });
});

// -------------------------------------------------------------- permission
// What expo answers on Android, by state. After the permission was ever
// asked, `canAskAgain` is Android's "show rationale" flag: false both for a
// real block and for a dismissed dialog or an expired one-time grant.
const NEVER_ASKED = { granted: false, canAskAgain: true, status: "undetermined" };
const DENIED_ONCE = { granted: false, canAskAgain: true, status: "denied" };
const NO_RATIONALE = { granted: false, canAskAgain: false, status: "denied" };
const GRANTED = { granted: true, canAskAgain: true, status: "granted" };

describe("the microphone permission rule", () => {
  it("requests whenever the silent check is not a grant (it cannot tell a block from a dismissed dialog)", () => {
    expect(microphoneNeedsRequest(GRANTED)).toBe(false);
    expect(microphoneNeedsRequest(NEVER_ASKED)).toBe(true);
    expect(microphoneNeedsRequest(DENIED_ONCE)).toBe(true);
    expect(microphoneNeedsRequest(NO_RATIONALE)).toBe(true);
  });

  it("records when the request grants, whatever the check said", () => {
    expect(resolveMicrophoneAccess(GRANTED, NO_RATIONALE)).toBe("granted");
  });

  it("calls a refusal that can be asked again a denial the next tap can undo", () => {
    expect(resolveMicrophoneAccess(DENIED_ONCE, NEVER_ASKED)).toBe("denied");
    expect(resolveMicrophoneAccess(DENIED_ONCE, DENIED_ONCE)).toBe("denied");
  });

  it("calls a first request that comes back without rationale a dismissed dialog, not a block", () => {
    // Android never offers "do not ask again" the first time.
    expect(resolveMicrophoneAccess(NO_RATIONALE, NEVER_ASKED)).toBe("denied");
  });

  it("calls it blocked when a later request comes back without rationale", () => {
    expect(resolveMicrophoneAccess(NO_RATIONALE, DENIED_ONCE)).toBe("blocked");
    expect(resolveMicrophoneAccess(NO_RATIONALE, NO_RATIONALE)).toBe("blocked");
  });

  it("only a blocked microphone sends the driver to the settings", () => {
    expect(microphoneAccessNotice("blocked")?.offersSettings).toBe(true);
    expect(microphoneAccessNotice("denied")?.offersSettings).toBe(false);
    expect(microphoneAccessNotice("granted")).toBeNull();
  });
});

describe("starting a recording", () => {
  it("with the permission blocked, offers the system settings instead of repeating a toast", async () => {
    permission.get.mockResolvedValue(NO_RATIONALE);

    // A real block: Android answers the request at once, without a dialog.
    permission.request.mockResolvedValue(NO_RATIONALE);

    const started = await useVoiceRecorder().start();

    expect(started).toBe(false);
    expect(recorder.prepareToRecordAsync).not.toHaveBeenCalled();
    expect(permission.request).toHaveBeenCalledTimes(1);

    expect(alert).toHaveBeenCalledTimes(1);

    const [title, , buttons] = alert.mock.calls[0] as [
      string,
      string,
      Array<{ text: string; onPress?: () => void }>,
    ];

    expect(title).toBe("Microfone bloqueado");

    const settings = buttons.find((button) => button.text === "Abrir configurações");

    expect(settings, "sem caminho para as configurações").toBeDefined();

    settings!.onPress!();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("still shows the system dialog when the check says no rationale (dismissed dialog, expired one-time grant), and records once granted", async () => {
    permission.get.mockResolvedValue(NO_RATIONALE);
    permission.request.mockResolvedValue(GRANTED);

    const started = await useVoiceRecorder().start();

    expect(permission.request).toHaveBeenCalledTimes(1);
    expect(started).toBe(true);
    expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it("asks through the system dialog the first time, and records once granted", async () => {
    permission.get.mockResolvedValue(NEVER_ASKED);
    permission.request.mockResolvedValue(GRANTED);

    const started = await useVoiceRecorder().start();

    expect(started).toBe(true);
    expect(permission.request).toHaveBeenCalledTimes(1);
    expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it("does not show the dialog again when the permission is already there", async () => {
    const started = await useVoiceRecorder().start();

    expect(started).toBe(true);
    expect(permission.request).not.toHaveBeenCalled();
  });

  it("explains a fresh denial without sending the driver to the settings", async () => {
    permission.get.mockResolvedValue(NEVER_ASKED);
    permission.request.mockResolvedValue(DENIED_ONCE);

    const started = await useVoiceRecorder().start();

    expect(started).toBe(false);
    expect(alert).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ text1: "Permissão do microfone negada" }),
    );
  });

  it("does not call a dismissed first dialog a block", async () => {
    permission.get.mockResolvedValue(NEVER_ASKED);
    permission.request.mockResolvedValue(NO_RATIONALE);

    const started = await useVoiceRecorder().start();

    expect(started).toBe(false);
    expect(alert).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ text1: "Permissão do microfone negada" }),
    );
  });

  it("says the check failed (not that the microphone is taken) when the permission cannot be read", async () => {
    permission.get.mockRejectedValue(new Error("no activity"));

    const started = await useVoiceRecorder().start();

    expect(started).toBe(false);
    expect(recorder.prepareToRecordAsync).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ text1: "Não foi possível verificar o microfone" }),
    );
  });

  it("treats a double tap on the microphone as one start", async () => {
    const voice = useVoiceRecorder();

    const [first, second] = await Promise.all([voice.start(), voice.start()]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
  });
});
