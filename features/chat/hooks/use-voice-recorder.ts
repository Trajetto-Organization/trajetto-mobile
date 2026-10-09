import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AppState, Linking } from "react-native";

import {
  AudioModule,
  setAudioModeAsync,
  useAudioRecorder,
  type RecorderState,
} from "expo-audio";

import * as FileSystem from "expo-file-system/legacy";
import Toast from "react-native-toast-message";

import {
  recorderClockMs,
  recorderWatchPeriodMs,
  recordingReachedLimit,
  reconcileRecorderState,
  reportedRecordingMs,
} from "../chat-rules";

import { stopChatAudio } from "../audio-focus";
import { VOICE_NOTE_RECORDING_OPTIONS } from "../voice-note-preset";

import {
  microphoneAccessNotice,
  microphoneNeedsRequest,
  resolveMicrophoneAccess,
  type MicrophoneAccess,
} from "../microphone-permission";

interface FinishedRecording {
  uri: string;
  durationMs: number;
  fileSize?: number;
}

/**
 * Idle, capturing, held with something already on tape, or on its way out.
 *
 * `stopping` is a real state and not a formality. The hardware stop is
 * asynchronous, and between asking for it and holding the file there is a
 * stretch in which the recording is neither running nor finished. Calling that
 * stretch "idle" made the recording bar blink away to the text composer and —
 * worse — put the microphone button back under the driver's thumb while a stop
 * was still in flight, which is how a recording on its way out and a fresh one
 * end up fighting over the same hardware.
 */
type RecorderPhase = "idle" | "recording" | "paused" | "stopping";

/**
 * The microphone permission. Anything short of a grant is requested: the
 * silent check cannot tell a real block from a dismissed dialog or an expired
 * one-time grant (see `microphone-permission.ts`), and a real block answers
 * the request at once, without a dialog. A check that throws is its own
 * answer: it is not "another app has the microphone", and telling the driver
 * so would send them looking for the wrong culprit.
 */
async function ensureMicrophoneAccess(): Promise<MicrophoneAccess | "error"> {
  try {
    const current = await AudioModule.getRecordingPermissionsAsync();

    if (!microphoneNeedsRequest(current)) return "granted";

    return resolveMicrophoneAccess(
      await AudioModule.requestRecordingPermissionsAsync(),
      current,
    );
  } catch {
    return "error";
  }
}

/**
 * Says why the recording did not start. A blocked permission gets a dialog
 * with the way out — the system settings — because a toast would only repeat
 * itself on every tap while the system never asks again.
 */
function tellAboutMicrophone(access: MicrophoneAccess | "error"): void {
  if (access === "error") {
    Toast.show({
      type: "error",
      text1: "Não foi possível verificar o microfone",
      text2: "Tente de novo em instantes.",
      position: "top",
    });

    return;
  }

  const notice = microphoneAccessNotice(access);

  if (!notice) return;

  if (notice.offersSettings) {
    Alert.alert(notice.title, notice.message, [
      { text: "Agora não", style: "cancel" },
      {
        text: "Abrir configurações",
        onPress: () => {
          void Linking.openSettings().catch(() => undefined);
        },
      },
    ]);

    return;
  }

  Toast.show({
    type: "error",
    text1: notice.title,
    text2: notice.message,
    position: "top",
  });
}

/**
 * Voice notes for the road: mono AAC/M4A tuned for speech (see
 * `VOICE_NOTE_RECORDING_OPTIONS`), which every browser on the SAC side plays.
 *
 * The length comes from the recorder (`getStatus().durationMillis`), never
 * from a clock here: `expo-audio` pauses and resumes the recorder on its own
 * at app-state transitions without telling JS, so a wall-clock counter drifts
 * from the file. `recorder.currentTime` is unused on purpose: its unit
 * differs per platform.
 *
 * The driver's intent (held or recording) is re-imposed on every beat and on
 * every return to the foreground, reading the recorder's own status instead
 * of assuming an order between the native handler and this hook.
 *
 * The ceiling stops the recording instead of rejecting it, so what was said
 * waits on the send button. Every failure (permission, half-started
 * recorder, stop without a file) leaves a message and a recorder the next
 * tap can start from.
 */
function useVoiceRecorder() {
  const recorder = useAudioRecorder(VOICE_NOTE_RECORDING_OPTIONS);

  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [recordingMs, setRecordingMs] = useState<number>(0);

  /**
   * A recording the ceiling stopped, held ready to send. Non-null only on that
   * path: a recording the driver ended themselves goes straight out and never
   * needs a resting place.
   */
  const [captured, setCaptured] = useState<FinishedRecording | null>(null);

  /**
   * The driver's standing instruction, readable synchronously.
   *
   * The beat and the app-state listener both have to know it without being
   * rebuilt on every phase change, and neither may read a render-old value:
   * acting on a stale intent is how a hold gets undone. `setPhaseNow` below is
   * the only writer of either half.
   */
  const phaseRef = useRef<RecorderPhase>("idle");

  /** The last length the recorder admitted to. Never walks backwards. */
  const recordingMsRef = useRef<number>(0);

  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * False once the composer is gone.
   *
   * Every watch is scheduled through `startTicker`, and the screen can ask for
   * one on its way out — holding the recording as the conversation loses
   * focus, for instance. A watch started after the teardown has nothing left
   * to stop it: it would outlive the recorder it polls and keep poking a
   * native object the module has already released.
   */
  const isMountedRef = useRef<boolean>(true);

  /**
   * The period of the watch currently running — how long the app may go
   * without looking at the recorder, and therefore how far past the ceiling a
   * reading may legitimately be found. A held recording is watched four times
   * more slowly than a capturing one, so this is what the stop clamps against.
   */
  const watchPeriodRef = useRef<number>(recorderWatchPeriodMs("recording"));

  // The stop already in flight. The ceiling and the send button can land on
  // the same beat, and stopping a recorder twice loses the file.
  const stoppingRef = useRef<Promise<FinishedRecording | null> | null>(null);

  // The start in flight, so a double tap on the microphone is one start.
  const startingRef = useRef<Promise<boolean> | null>(null);

  /**
   * Which recording the results still in flight belong to.
   *
   * The ceiling's stop resolves LATER, and by then the driver may have thrown
   * the recording away or started another one. Without this, a discarded note
   * came back on its own, parked on the send button as if the driver had asked
   * for it — and went out as a duplicate.
   */
  const captureTokenRef = useRef<number>(0);

  const setPhaseNow = useCallback((next: RecorderPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const stopTicker = useCallback(() => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  /**
   * The recorder's own status, or `null` when it cannot be read. A throw here
   * is not an emergency — it is one missed reading, and the clock holds its
   * last value rather than inventing one.
   */
  const readStatus = useCallback((): RecorderState | null => {
    try {
      return recorder.getStatus();
    } catch {
      return null;
    }
  }, [recorder]);

  /** Pulls the clock forward from a status reading and returns it. */
  const syncClock = useCallback((status: RecorderState | null): number => {
    const next = recorderClockMs(
      status ? status.durationMillis : null,
      recordingMsRef.current,
    );

    recordingMsRef.current = next;
    setRecordingMs(next);

    return next;
  }, []);

  /** Back to an idle composer, without touching the hardware. */
  const reset = useCallback((): void => {
    stopTicker();
    stoppingRef.current = null;

    // Whatever is still in flight now belongs to a recording that no longer
    // exists, and must not land on the screen behind the driver's back.
    captureTokenRef.current += 1;

    recordingMsRef.current = 0;

    setCaptured(null);
    setRecordingMs(0);
    setPhaseNow("idle");
  }, [setPhaseNow, stopTicker]);

  /**
   * Stops the hardware and hands back what was recorded. Idempotent: whoever
   * asks second gets the same promise as whoever asked first.
   *
   * It leaves the phase at `stopping`, deliberately. Every caller finishes the
   * transition itself — `reset()` on the discard and on both send paths, the
   * ceiling below once it holds the file — because the phase and the result
   * have to land in the SAME update. Clearing the phase here would hand the
   * driver an empty composer for the frame in between.
   */
  const stopRecorder = useCallback((): Promise<FinishedRecording | null> => {
    if (stoppingRef.current) return stoppingRef.current;

    stopTicker();

    // Read BEFORE the recorder is stopped: stopping resets the module's
    // duration to zero on both platforms, so this is the last moment the
    // recorded length can be had — and it is the length the file contains.
    const elapsedMs = syncClock(readStatus());

    // The tolerance that reading deserves is the watch which PRODUCED it, not
    // a fixed number. A recording held while the system started it again
    // behind the app's back is read up to a whole second late; clamping that
    // against the capturing beat is how a 2:00.6 note is refused at the send
    // and thrown away whole.
    const toleranceMs = watchPeriodRef.current;

    setPhaseNow("stopping");

    const stopping = (async (): Promise<FinishedRecording | null> => {
      try {
        await recorder.stop();
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });

        const uri = recorder.uri;

        if (!uri) return null;

        const info = await FileSystem.getInfoAsync(uri);

        return {
          uri,
          durationMs: reportedRecordingMs(elapsedMs, toleranceMs),
          fileSize: info.exists ? info.size : undefined,
        };
      } catch {
        return null;
      }
    })();

    stoppingRef.current = stopping;

    return stopping;
  }, [recorder, readStatus, syncClock, setPhaseNow, stopTicker]);

  /**
   * One look at the recorder: what it has recorded, whether it is still doing
   * what the driver asked, and whether the ceiling has been reached.
   *
   * The order is the point. The clock is pulled from the recorder first, so
   * every decision below is made on the recorded length rather than on elapsed
   * wall time. The intent is re-imposed next, because a microphone running
   * against the driver's wishes must be stopped in the same beat it is
   * noticed. The ceiling is checked last, and it is checked whatever the phase
   * is: a hold the system undid behind the app's back can come back over the
   * limit, and a limit that only applies while the UI agrees is not a limit.
   */
  const beat = useCallback((): void => {
    const status = readStatus();
    const elapsedMs = syncClock(status);

    const intent = phaseRef.current;

    // Idle has nothing to watch, and a stop already in flight must not be
    // nudged: telling a recorder on its way out to record again is how a
    // microphone survives its own stop.
    if (intent !== "recording" && intent !== "paused") return;

    if (status) {
      const action = reconcileRecorderState({
        intent,
        isRecording: status.isRecording,
        canRecord: status.canRecord,
        isAppActive: AppState.currentState === "active",
      });

      try {
        if (action === "pause") recorder.pause();
        if (action === "resume") recorder.record();
      } catch {
        // The recorder refused the correction. Nothing here pretends it
        // worked: the next beat reads the real state again and tries once
        // more, and the ceiling below still applies either way.
      }
    }

    if (!recordingReachedLimit(elapsedMs)) return;

    // The ceiling stops the recording; it never discards it. Whatever the
    // driver managed to say is parked on the send button.
    const token = captureTokenRef.current;

    void stopRecorder().then((finished) => {
      // Discarded, or replaced by another recording, while the stop was in
      // flight. What came back belongs to nothing the driver can still see.
      if (token !== captureTokenRef.current) return;

      if (!finished) {
        // The same failure the send button reports with a toast, and the same
        // right to be told about it. A recording that disappears at the
        // ceiling without a word is the ceiling lying about having kept it.
        reset();

        Toast.show({
          type: "error",
          text1: "Não foi possível salvar a gravação",
          text2: "Tente gravar de novo.",
          position: "top",
        });

        return;
      }

      // Both in the same update: the bar goes straight from "finalizando" to
      // "pronto para enviar", with no frame in between where the composer has
      // forgotten there was a recording at all.
      setCaptured(finished);
      setPhaseNow("idle");
    });
  }, [recorder, readStatus, syncClock, stopRecorder, reset, setPhaseNow]);

  /**
   * The watch over the recorder, at the beat the current phase deserves. It
   * runs while HELD as well as while capturing — a hold is exactly the state
   * the system undoes on its own, so it is the state that most needs watching.
   *
   * The period is remembered, not merely used: the stop clamps the recorded
   * length against the watch that was actually running when it read it.
   */
  const startTicker = useCallback(
    (periodMs: number) => {
      stopTicker();

      watchPeriodRef.current = periodMs;

      // Asked for on the way out — nothing to watch, and nothing left that
      // would ever clear it.
      if (!isMountedRef.current) return;

      tickerRef.current = setInterval(beat, periodMs);
    },
    [beat, stopTicker],
  );

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      stopTicker();
    };
  }, [stopTicker]);

  /**
   * The return to the foreground, which is when `expo-audio` resumes every
   * recorder it finds paused — the driver's own hold included.
   *
   * This assumes nothing about whether the native handler has already run: the
   * beat reads the recorder's real state and corrects it. The ticker above is
   * the other half, and it is what makes the ordering genuinely not matter — a
   * resume the native side performs AFTER this listener has run is caught on
   * the next beat instead of living until the driver notices.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;

      const intent = phaseRef.current;

      if (intent !== "recording" && intent !== "paused") return;

      beat();
    });

    return () => subscription.remove();
  }, [beat]);

  /**
   * Hands the microphone back after a start that did not take.
   *
   * This is the half that decides whether the failure is recoverable. Android
   * refuses `prepareToRecordAsync` outright on a recorder that is ALREADY
   * prepared, and `record()` can throw with the preparation already done — the
   * microphone held by a call, by another app, by an assistant. Left as it is,
   * that one throw poisons every later tap: the driver presses the microphone
   * and nothing happens, for as long as the screen lives. `stop()` is what
   * releases the native recorder — it resets the module's state even when the
   * stop itself throws — so it is asked for unconditionally, and its own
   * failure has nothing left to report.
   */
  const releaseRecorder = useCallback(async (): Promise<void> => {
    try {
      await recorder.stop();
    } catch {
      // Never prepared, or already released. Either way nothing is left
      // holding the microphone.
    }

    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch {
      // The mode is set again by the next start that succeeds.
    }
  }, [recorder]);

  /**
   * Starts capturing, and NEVER rejects: it reports its own failure to the
   * driver and answers `false`. Callers fire it and forget it, which is only
   * honest because every way it can fail is handled right here.
   */
  const startCapture = useCallback(async (): Promise<boolean> => {
    /**
     * The microphone joins the "one note at a time" arbiter, as a participant
     * and not as an exception.
     *
     * A driver who taps the mic in the middle of a note from the base is
     * answering it. On Android that note goes on playing out of the LOUDSPEAKER
     * and straight back into the microphone, so the base receives its own
     * message mixed into the reply. Silencing first is the whole fix, and it
     * happens before the permission prompt on purpose: a note still talking
     * under a system dialog is the same bug, one dialog later.
     */
    stopChatAudio();

    // Anything still in flight stops being this recording's business the
    // moment a new one is asked for.
    captureTokenRef.current += 1;

    const access = await ensureMicrophoneAccess();

    if (access !== "granted") {
      tellAboutMicrophone(access);

      return false;
    }

    try {
      // iOS records nothing without this mode; restored on stop so playback
      // goes back to the speaker.
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await recorder.prepareToRecordAsync();

      // Synchronous, and a genuine thrower: the permission is checked again
      // natively here, and the platform refuses outright when the microphone
      // belongs to something else.
      recorder.record();
    } catch {
      await releaseRecorder();

      Toast.show({
        type: "error",
        text1: "Não foi possível iniciar a gravação",
        text2: "Verifique se outro app está usando o microfone e tente de novo.",
        position: "top",
      });

      return false;
    }

    recordingMsRef.current = 0;
    stoppingRef.current = null;

    setCaptured(null);
    setRecordingMs(0);
    setPhaseNow("recording");

    startTicker(recorderWatchPeriodMs("recording"));

    return true;
  }, [recorder, releaseRecorder, startTicker, setPhaseNow]);

  const start = useCallback((): Promise<boolean> => {
    // The microphone button stays under the thumb while the permission is
    // checked. A second tap in that window must not prepare the recorder a
    // second time: Android refuses, and the recovery above would then stop
    // the recording the first tap had just started.
    if (startingRef.current) return startingRef.current;
    if (phaseRef.current !== "idle") return Promise.resolve(false);

    const starting = startCapture().finally(() => {
      startingRef.current = null;
    });

    startingRef.current = starting;

    return starting;
  }, [startCapture]);

  /**
   * Holds the recording where it is, with the file still open.
   *
   * The hardware call comes first: if it refuses, nothing here pretends the
   * recording stopped — a UI that says "pausado" over a microphone still
   * listening is worse than a pause button that admits it failed.
   */
  const pause = useCallback((): void => {
    if (phaseRef.current !== "recording") return;

    try {
      recorder.pause();
    } catch {
      Toast.show({
        type: "error",
        text1: "Não foi possível pausar",
        text2: "A gravação continua. Toque em enviar quando terminar.",
        position: "top",
      });

      return;
    }

    // The recorder banked the stretch as it paused; this reads back what it
    // banked instead of guessing at it.
    syncClock(readStatus());
    setPhaseNow("paused");

    // Held, not unwatched: the system resumes paused recorders on its own.
    startTicker(recorderWatchPeriodMs("paused"));
  }, [recorder, readStatus, syncClock, setPhaseNow, startTicker]);

  /** Picks the same file back up, from where the hold left it. */
  const resume = useCallback((): void => {
    if (phaseRef.current !== "paused") return;

    // Nothing left to record: resuming would only stop again on the next beat.
    if (recordingReachedLimit(recordingMsRef.current)) return;

    try {
      recorder.record();
    } catch {
      Toast.show({
        type: "error",
        text1: "Não foi possível continuar",
        text2: "Envie o que já foi gravado ou descarte.",
        position: "top",
      });

      return;
    }

    setPhaseNow("recording");
    startTicker(recorderWatchPeriodMs("recording"));
  }, [recorder, startTicker, setPhaseNow]);

  /**
   * What to send. A recording the ceiling already stopped is handed back as
   * it is — asking the hardware to stop a second time is how the file gets
   * lost.
   */
  const finish = useCallback(async (): Promise<FinishedRecording | null> => {
    if (captured) return captured;

    return stopRecorder();
  }, [captured, stopRecorder]);

  const cancel = useCallback(async (): Promise<void> => {
    // A held recording still owns the hardware and still has to be stopped.
    const stopping = phaseRef.current === "idle" ? null : stopRecorder();

    reset();

    try {
      await stopping;
    } catch {
      // A cancel that failed to stop cleanly has nothing left to lose.
    }
  }, [stopRecorder, reset]);

  return {
    /** The microphone is capturing right now. */
    isRecording: phase === "recording",

    /** Something is on tape and the microphone is holding. */
    isPaused: phase === "paused",

    /**
     * The hardware stop is in flight. The composer keeps the recording bar up
     * while this is true: the recording is on its way out but it is not gone,
     * and the microphone button must not be back under the driver's thumb.
     */
    isFinishing: phase === "stopping",

    recordingMs,

    /** Set once the ceiling stopped the recording, and never otherwise. */
    captured,

    start,
    pause,
    resume,
    finish,
    cancel,
    reset,
  };
}

export { useVoiceRecorder };
export type { FinishedRecording };
