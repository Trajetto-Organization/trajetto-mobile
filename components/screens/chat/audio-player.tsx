import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from "react-native";

import { Gesture, GestureDetector } from "react-native-gesture-handler";

import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import Ionicons from "@expo/vector-icons/Ionicons";

import { formatAudioClock } from "@/features/chat/chat-rules";

import {
  AUDIO_BAR_MIN_GAP,
  AUDIO_BAR_WIDTH,
  AUDIO_SEEK_HOLD_TIMEOUT_MS,
  AUDIO_SEEK_STEP_SECONDS,
  AUDIO_TRACK_PADDING,
  audioBarCount,
  audioPlayedRatio,
  audioRailWidth,
  audioRatioFromX,
  audioSeekLanded,
  audioSeekSeconds,
  audioSteppedRatio,
} from "@/features/chat/audio-track-rules";

import {
  isLocalFileUri,
  resolveAudioControl,
} from "@/features/chat/audio-cache-rules";

import {
  downloadChatAudio,
  findCachedChatAudio,
  type ChatAudioDownload,
} from "@/features/chat/audio-cache";

import {
  claimAudioFocus,
  releaseAudioFocus,
} from "@/features/chat/audio-focus";

/**
 * The bars are a PROGRESS MOTIF, not a waveform.
 *
 * Nothing in this component has read a single sample of the file. Heights
 * drawn from a hash of the url or from Math.random would look exactly like
 * amplitude while meaning nothing at all — a lie the driver has no way to
 * catch, and one that would make a silent note look loud. So the pattern is a
 * fixed rhythm, repeated: it reads as a voice note, it is identical for every
 * note in the thread, and it claims nothing it does not know.
 */
const BAR_RHYTHM = [0.45, 0.7, 1, 0.7, 0.45, 0.6, 0.85, 0.6];

const BAR_MAX_HEIGHT = 22;
const BAR_MIN_HEIGHT = 4;
const BAR_RADIUS = 1.5;

/**
 * The head that marks the position. Its diameter is twice the track padding
 * on purpose: that is exactly the room reserved at each end for it, so it
 * touches both edges at 0% and 100% without ever being clipped.
 */
const KNOB_SIZE = AUDIO_TRACK_PADDING * 2;

/** Not scrubbing. A sentinel rather than null, so it fits a shared value. */
const NO_SCRUB = -1;

const BUTTON_SIZE = 40;

const SPEEDS = [1, 1.5, 2] as const;

type PlaybackSpeed = (typeof SPEEDS)[number];

/**
 * How long a note may take to load before the player admits it is broken.
 * Now that playback only ever reads a local file this is generous to the
 * point of being a last resort — it is here for a cached file that turns out
 * to be undecodable, not for a slow connection.
 */
const LOAD_TIMEOUT_MS = 15_000;

/** Smooth enough for the bars to move, cheap enough for a long thread. */
const STATUS_INTERVAL_MS = 120;

/**
 * A seek that has been asked for and not yet confirmed by the player.
 *
 * It carries where the note WAS as well as where it was sent, because that is
 * what tells a status report about the new position apart from one that was
 * already in flight carrying the old.
 */
interface PendingSeek {
  fromSeconds: number;
  targetSeconds: number;
}

interface AudioPlayerBubbleProps {
  /**
   * The cache key. The url cannot be one: it is signed and expires, so the
   * same note arrives under a new url on every load.
   */
  messageId: string;

  url: string;
  durationMs: number | null;

  /** Adapts icon/track colors to the bubble behind it. */
  onDarkBubble: boolean;
}

/**
 * The voice-note player inside a bubble, on the WhatsApp model: a note this
 * device does not have yet offers a DOWNLOAD arrow, not a play triangle. The
 * tap fetches it into the app cache with visible progress and then plays; a
 * note already cached plays instantly, and keeps playing with no signal at
 * all, which is the entire point for a driver on the road.
 *
 * Three things it refuses to get wrong. Only one note in the conversation may
 * sound at a time, arbitrated by the audio-focus module. The total duration
 * comes from the server's `duration_ms` before anything is fetched, so the
 * clock is right on the first frame instead of counting up from 0:00. And the
 * player is never handed a remote url — its source is always a local file, so
 * "downloaded" and "playable" cannot drift apart.
 */
const AudioPlayerBubble = ({
  messageId,
  url,
  durationMs,
  onDarkBubble,
}: AudioPlayerBubbleProps) => {
  // Probed once, as the bubble mounts: an existing file decides between the
  // download arrow and the play triangle on the very first frame, and nothing
  // is fetched to find out.
  const [localUri, setLocalUri] = useState<string | null>(() =>
    findCachedChatAudio(messageId, url),
  );

  // Null source until there is a file: the player must never reach for the
  // network on its own.
  const player = useAudioPlayer(localUri, {
    updateInterval: STATUS_INTERVAL_MS,
  });

  const status = useAudioPlayerStatus(player);

  // Identity for the audio-focus arbiter: stable for this component's life,
  // and unique even when the same note is rendered twice.
  const focusId = useId();

  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  // Measured on the track ITSELF — the very view the gesture is attached to.
  // Anything else (the row, the bubble) would hand the seek maths a width the
  // finger never touches.
  const [trackWidth, setTrackWidth] = useState<number>(0);

  /**
   * Where the head is drawn, 0..1, and where the finger has dragged it.
   *
   * Both live on the UI thread. That is the point: the bar follows the drag
   * without a single `setState`, so a scrub costs no React render at all and
   * the track keeps up with the finger on a cheap phone in a moving truck.
   */
  const playbackRatio = useSharedValue<number>(0);
  const scrubRatio = useSharedValue<number>(NO_SCRUB);

  // The clock under the bars, while a finger owns the track. Whole seconds,
  // so this is at most one render per second of dragging instead of one per
  // touch event.
  const [scrubSeconds, setScrubSeconds] = useState<number | null>(null);

  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadRatio, setDownloadRatio] = useState<number | null>(null);

  // The driver asked for this note. Nothing loads eagerly and nothing is
  // called broken before somebody wanted to hear it.
  const [playRequested, setPlayRequested] = useState<boolean>(false);
  const [hasFailed, setHasFailed] = useState<boolean>(false);

  const downloadRef = useRef<ChatAudioDownload | null>(null);
  const mountedRef = useRef<boolean>(true);

  // A download the driver started is a download they want to hear: playback
  // follows the last byte without a second tap.
  const autoPlayRef = useRef<boolean>(false);

  /**
   * Whether the drag borrowed the sound and owes it back.
   *
   * Two forms of one fact, and `setScrubPause` below is the only writer of
   * either: the gesture's callbacks have to stay stable across renders, so
   * they read the ref, while the button icon is drawn from the state.
   */
  const scrubPauseRef = useRef<boolean>(false);
  const [isScrubPaused, setIsScrubPaused] = useState<boolean>(false);

  /**
   * The seek the finger asked for, held until the player confirms it.
   *
   * State rather than a ref on purpose: the whole point is to keep the status
   * poll from moving the head, and the effect that reads the poll has to run
   * again the moment this clears.
   */
  const [pendingSeek, setPendingSeek] = useState<PendingSeek | null>(null);

  const totalSeconds =
    status.duration > 0 ? status.duration : (durationMs ?? 0) / 1000;

  const playedRatio = audioPlayedRatio(status.currentTime, totalSeconds);

  // What the driver is being SHOWN. While a seek is in flight that is where
  // they left the head, not the position the player last admitted to.
  const shownRatio = pendingSeek
    ? audioPlayedRatio(pendingSeek.targetSeconds, totalSeconds)
    : playedRatio;

  // Who owns the clock, in order: the finger while it is on the track, then
  // the position it let go at until the seek lands, then the player.
  const elapsedMs =
    (scrubSeconds ?? pendingSeek?.targetSeconds ?? status.currentTime) * 1000;

  // The track geometry, as one value: what was measured and what is reserved
  // at the ends. The gesture and the drawing both read it, which is the only
  // way "seeks where you tapped" can be true.
  const geometry = useMemo(
    () => ({ width: trackWidth, padding: AUDIO_TRACK_PADDING }),
    [trackWidth],
  );

  const rail = audioRailWidth(geometry);
  const barCount = audioBarCount(rail, AUDIO_BAR_WIDTH, AUDIO_BAR_MIN_GAP);

  const isPreparing =
    !hasFailed &&
    Boolean(localUri) &&
    ((playRequested && !status.isLoaded) ||
      (status.playing && status.isBuffering));

  const control = resolveAudioControl({
    isCached: Boolean(localUri),
    isDownloading,
    hasFailed,
    isPreparing,

    // A note paused for the length of a drag is still the driver's note: the
    // button must not blink to a play triangle and back while they scrub.
    isPlaying: status.playing || isScrubPaused,
  });

  // ------------------------------------------------------------ lifecycle
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A note that loads late is not a broken note: the moment it is ready the
  // error goes away on its own.
  useEffect(() => {
    if (status.isLoaded) setHasFailed(false);
  }, [status.isLoaded]);

  useEffect(() => {
    if (!playRequested || status.isLoaded || hasFailed || !localUri) return;

    const timer = setTimeout(() => setHasFailed(true), LOAD_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [playRequested, status.isLoaded, hasFailed, localUri]);

  // The floor is given back when the note ends by itself, so the next tap
  // anywhere in the thread does not have to stop a player already silent.
  useEffect(() => {
    if (status.didJustFinish) releaseAudioFocus(focusId);
  }, [status.didJustFinish, focusId]);

  // Declared BEFORE the auto-play effect on purpose. Finishing a download
  // swaps the player for one built on the new source, and React runs every
  // cleanup before any new effect body — so this pause/release lands first
  // and the claim below is not undone a moment after it is made.
  useEffect(() => {
    return () => {
      // expo-audio releases the native player itself when the component that
      // created it unmounts (this API's `unloadAsync`), but that release and
      // this cleanup are not ordered — pausing first is what guarantees the
      // sound stops in the same frame the bubble leaves the screen.
      try {
        player.pause();
      } catch {
        // The native object may already be gone; there is nothing to stop.
      }

      releaseAudioFocus(focusId);
    };
  }, [player, focusId]);

  // A transfer nobody is waiting for any more. Scrolling a note off screen
  // must not keep spending the driver's data.
  useEffect(() => {
    return () => {
      downloadRef.current?.cancel();
      downloadRef.current = null;
    };
  }, []);

  // The rate lives on the native player, and a finished download builds a new
  // one — so it is re-applied here rather than at the tap that changed it.
  useEffect(() => {
    if (!localUri) return;

    try {
      player.setPlaybackRate(speed, "high");
    } catch {
      // A source still settling refuses the rate; the next render reapplies.
    }
  }, [player, speed, localUri]);

  useEffect(() => {
    if (!autoPlayRef.current) return;
    if (!localUri || !status.isLoaded) return;

    autoPlayRef.current = false;

    // Taking the floor stops whatever else was playing in the thread.
    claimAudioFocus(focusId, () => player.pause());

    try {
      player.play();
    } catch {
      setHasFailed(true);
    }
  }, [localUri, status.isLoaded, player, focusId]);

  // --------------------------------------------------------------- scrub
  /** The only writer of the scrub-pause debt, in either of its two forms. */
  const setScrubPause = useCallback((paused: boolean) => {
    scrubPauseRef.current = paused;
    setIsScrubPaused(paused);
  }, []);

  /**
   * A drag begins.
   *
   * WhatsApp's behaviour, and the one that stops the head from fighting the
   * finger: a note that is playing pauses for the length of the drag and picks
   * up again from where the finger let go. A note that was already paused is
   * left alone — dragging is how the driver looks through a note, not a way to
   * start it.
   */
  const beginScrub = useCallback(() => {
    // Read off the player rather than off `status`: the render that would
    // carry a fresh `playing` may not have happened yet when the finger moves.
    //
    // A debt already outstanding counts as playing. Two drags in a row is the
    // case: the first one's resume is waiting on `seekTo` to settle, so the
    // player is genuinely NOT playing when the second drag starts — and asking
    // only `player.playing` would let that second drag run with the note about
    // to burst back into sound under the finger.
    if (!player.playing && !scrubPauseRef.current) return;

    setScrubPause(true);

    // The floor is deliberately NOT released. This is a pause the player
    // itself intends to undo in a moment, and giving the floor up would only
    // mean taking it back from whatever grabbed it in between.
    player.pause();
  }, [player, setScrubPause]);

  /** Gives back the sound the drag borrowed — if it borrowed any. */
  const resumeAfterScrub = useCallback(() => {
    if (!scrubPauseRef.current) return;

    // A new drag already owns the track. The sound stays borrowed and the drag
    // that is running NOW is the one that will give it back — resuming here
    // would start the note playing under a finger that is still scrubbing it.
    if (scrubRatio.value !== NO_SCRUB) return;

    setScrubPause(false);

    // Another note may have claimed the floor while the finger was on the
    // track; claiming it again is what keeps "one note at a time" true.
    claimAudioFocus(focusId, () => player.pause());

    try {
      player.play();
    } catch {
      setHasFailed(true);
    }
  }, [player, focusId, setScrubPause, scrubRatio]);

  /** A drag the list took back: no seek was asked for, but sound may be owed. */
  const abortScrub = useCallback(() => {
    setScrubSeconds(null);
    resumeAfterScrub();
  }, [resumeAfterScrub]);

  // ---------------------------------------------------------------- seek
  /**
   * The seek the driver just asked for, applied ON RELEASE — never per pixel.
   * A `seekTo` on every touch event would keep the decoder rebuffering all the
   * way across the bar and land, at best, on the last one anyway.
   *
   * Releasing has NO rebound. The head is planted where the finger let it go
   * and stays there until a status report is about the new position. The old
   * shape of this — drop the preview, trust the next report — is exactly what
   * made a drag look like it snapped back before jumping: the report already
   * in flight carries the position from before the seek and lands after it.
   */
  const commitSeek = useCallback(
    (ratio: number) => {
      // Nothing to seek in a note that has not been fetched: the track is
      // decoration until the file exists.
      if (!localUri || totalSeconds <= 0) {
        scrubRatio.value = NO_SCRUB;
        setScrubSeconds(null);
        resumeAfterScrub();

        return;
      }

      const seconds = audioSeekSeconds(ratio, totalSeconds);

      // Read off the player, not off `status`: this is the position the
      // reports still in flight will be near, and the native value is the only
      // one that is not already a beat old.
      const fromSeconds = player.currentTime;

      // The head is planted at the released position BEFORE the scrub value
      // is given up. Release it first and the bar snaps back to the last
      // polled position for a frame and crawls forward again — which is what
      // reads as "it did not go where I tapped", however exact the seek was.
      cancelAnimation(playbackRatio);

      playbackRatio.value = ratio;
      scrubRatio.value = NO_SCRUB;

      // The finger is off the track, so the pending seek owns the clock now.
      setScrubSeconds(null);
      setPendingSeek({ fromSeconds, targetSeconds: seconds });

      // The sound comes back only once the note is AT the new position.
      // Resuming first would play a moment of the passage just left behind.
      void player.seekTo(seconds).finally(resumeAfterScrub);
    },
    [
      player,
      totalSeconds,
      localUri,
      playbackRatio,
      scrubRatio,
      resumeAfterScrub,
    ],
  );

  const seekGesture = useMemo(() => {
    // The callbacks are worklets: every MOVE writes a shared value on the UI
    // thread and nothing else, so the bar tracks the finger frame by frame
    // with no React render in the loop. Only the two ends of the drag cross
    // back to JS — once to silence the note, once to seek it.
    const drag = Gesture.Pan()
      // Horizontal intent only, and any real vertical movement hands the
      // touch back to the list — scrolling a conversation must never be
      // hijacked by a track the driver only brushed past.
      .activeOffsetX([-4, 4])
      .failOffsetY([-14, 14])
      .onStart((event) => {
        scrubRatio.value = audioRatioFromX(event.x, geometry);

        // The one crossing to JS a drag makes before it ends: the note has to
        // go quiet while the finger owns the head.
        runOnJS(beginScrub)();
      })
      .onUpdate((event) => {
        scrubRatio.value = audioRatioFromX(event.x, geometry);
      })
      .onEnd((event) => {
        runOnJS(commitSeek)(audioRatioFromX(event.x, geometry));
      })
      .onFinalize((_event, success) => {
        if (success) return;

        // A pan that never took the finger has no preview to drop — and this
        // fires for the losing side of the race with the tap, whose committed
        // seek must not be undone from here.
        if (scrubRatio.value === NO_SCRUB) return;

        // A pan the list took back never asked for a seek — but if it had
        // already silenced the note, the note is still owed.
        scrubRatio.value = NO_SCRUB;
        runOnJS(abortScrub)();
      });

    const tap = Gesture.Tap()
      // `success` is false for a tap the recogniser gave up on — a finger
      // that slid off the track never asked for a seek.
      .onEnd((event, success) => {
        if (success) runOnJS(commitSeek)(audioRatioFromX(event.x, geometry));
      });

    return Gesture.Race(tap, drag);
  }, [geometry, commitSeek, beginScrub, abortScrub, scrubRatio]);

  // The width of the DRAWN track, from the drawn track. The gesture is
  // attached to this very view, so the area that receives the touch and the
  // area the bars occupy are the same box by construction.
  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  /**
   * The head follows PLAYBACK between polls instead of hopping on each one.
   *
   * The native status arrives every STATUS_INTERVAL_MS; animating linearly to
   * each new reading over exactly that interval turns a staircase into a
   * continuous march, at the cost of trailing the sound by at most one poll.
   */
  useEffect(() => {
    // A finger owns the head; the poll does not get to argue.
    if (scrubRatio.value !== NO_SCRUB) return;

    if (pendingSeek) {
      // The report that was already on its way when the seek was asked for
      // still carries the OLD position, and it arrives after the seek call has
      // resolved. Believing it is the whole of the rebound bug.
      if (
        !audioSeekLanded({
          reportedSeconds: status.currentTime,
          fromSeconds: pendingSeek.fromSeconds,
          targetSeconds: pendingSeek.targetSeconds,
        })
      ) {
        return;
      }

      setPendingSeek(null);
    }

    if (status.playing) {
      playbackRatio.value = withTiming(playedRatio, {
        duration: STATUS_INTERVAL_MS,
        easing: Easing.linear,
      });

      return;
    }

    cancelAnimation(playbackRatio);
    playbackRatio.value = playedRatio;
  }, [
    playedRatio,
    status.currentTime,
    status.playing,
    pendingSeek,
    playbackRatio,
    scrubRatio,
  ]);

  /**
   * Holding the head is a courtesy, not a promise.
   *
   * Both platforms report the new position the moment a seek lands, so the
   * hold normally ends the instant it should. This is for the seek that was
   * swallowed in silence: letting the report through after that is the head
   * admitting where the note really is, which is the honest end of a hold
   * whose seek never happened — not the rebound this whole change removes.
   */
  useEffect(() => {
    if (!pendingSeek) return;

    const timer = setTimeout(
      () => setPendingSeek(null),
      AUDIO_SEEK_HOLD_TIMEOUT_MS,
    );

    return () => clearTimeout(timer);
  }, [pendingSeek]);

  // The only bridge back to React while scrubbing, and it fires when the
  // DISPLAYED second changes — not when the finger moves. Releasing is not its
  // business: `commitSeek` owns the clock from there until the seek lands.
  useAnimatedReaction(
    () =>
      scrubRatio.value === NO_SCRUB
        ? NO_SCRUB
        : Math.round(scrubRatio.value * totalSeconds),
    (current, previous) => {
      if (current === previous || current === NO_SCRUB) return;

      runOnJS(setScrubSeconds)(current);
    },
    [totalSeconds],
  );

  const fillStyle = useAnimatedStyle(() => {
    const ratio =
      scrubRatio.value === NO_SCRUB ? playbackRatio.value : scrubRatio.value;

    return { width: ratio * rail };
  }, [rail]);

  const knobStyle = useAnimatedStyle(() => {
    const ratio =
      scrubRatio.value === NO_SCRUB ? playbackRatio.value : scrubRatio.value;

    return { transform: [{ translateX: ratio * rail }] };
  }, [rail]);

  // -------------------------------------------------------------- actions
  const startDownload = useCallback(() => {
    if (downloadRef.current) return;

    setHasFailed(false);
    setDownloadRatio(0);
    setIsDownloading(true);

    const handle = downloadChatAudio({
      messageId,
      sourceUrl: url,
      onProgress: (ratio) => {
        if (mountedRef.current) setDownloadRatio(ratio);
      },
    });

    downloadRef.current = handle;

    handle.promise
      .then((uri) => {
        if (!mountedRef.current) return;

        autoPlayRef.current = true;
        setLocalUri(uri);
      })
      .catch(() => {
        if (!mountedRef.current) return;

        setHasFailed(true);
      })
      .finally(() => {
        downloadRef.current = null;

        if (!mountedRef.current) return;

        setIsDownloading(false);
        setDownloadRatio(null);
      });
  }, [messageId, url]);

  const handleRetry = useCallback(() => {
    setHasFailed(false);
    setPlayRequested(false);

    // The driver's own note, still uploading, has no remote copy to fetch —
    // only the handle to the local file is worth rebuilding.
    if (isLocalFileUri(url)) {
      player.replace(url);
      return;
    }

    // Everything else starts over from the network. Whatever failed — an
    // expired signature, a connection that died mid-transfer, a file that
    // will not decode — is not fixed by asking the same dead handle again.
    startDownload();
  }, [player, url, startDownload]);

  const handleToggle = useCallback(() => {
    if (hasFailed) {
      handleRetry();
      return;
    }

    // The transfer owns the button until it is done.
    if (isDownloading) return;

    if (!localUri) {
      startDownload();
      return;
    }

    // `isScrubPaused` belongs in this test, not just in the icon above it. A
    // note silenced for the length of a drag is still the driver's note, and
    // the button already SHOWS a pause icon throughout — so `status.playing`
    // alone made the branch unreachable exactly when the comment below
    // mattered, and tapping the pause icon started the note instead.
    if (status.playing || isScrubPaused) {
      // An explicit pause outranks a resume that a drag was about to make:
      // clearing the debt is what makes the pending `seekTo` land silently
      // instead of resuming a note the driver just asked to stop.
      setScrubPause(false);

      player.pause();
      releaseAudioFocus(focusId);

      return;
    }

    setPlayRequested(true);

    claimAudioFocus(focusId, () => player.pause());

    // A finished note replays from the top instead of doing nothing.
    if (status.didJustFinish || playedRatio >= 1) void player.seekTo(0);

    player.play();
  }, [
    hasFailed,
    handleRetry,
    isDownloading,
    localUri,
    startDownload,
    status.playing,
    status.didJustFinish,
    isScrubPaused,
    playedRatio,
    player,
    focusId,
    setScrubPause,
  ]);

  /**
   * The screen-reader half of the seek bar.
   *
   * The track calls itself `adjustable`, which promises a control that can be
   * stepped — and a promise with no `accessibilityActions` behind it is a
   * slider that announces a position and then refuses to move. The step goes
   * through the same `commitSeek` as a finger does, so the planted head, the
   * pending-seek bookkeeping and the borrowed sound behave identically
   * whichever way the note was scrubbed.
   */
  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const action = event.nativeEvent.actionName;

      if (action !== "increment" && action !== "decrement") return;

      // Decoration until there is a file to seek in, exactly as for a touch.
      if (!localUri || totalSeconds <= 0) return;

      // Stepped from the position the driver is being SHOWN, not from the one
      // the player last admitted to: two quick steps while a seek is still in
      // flight must land ten seconds away, not five.
      commitSeek(
        audioSteppedRatio(
          elapsedMs / 1000,
          action === "increment"
            ? AUDIO_SEEK_STEP_SECONDS
            : -AUDIO_SEEK_STEP_SECONDS,
          totalSeconds,
        ),
      );
    },
    [localUri, totalSeconds, elapsedMs, commitSeek],
  );

  const handleCycleSpeed = useCallback(() => {
    setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);
  }, [speed]);

  // --------------------------------------------------------------- colors
  const tint = onDarkBubble ? "#ffffff" : "#374151";
  const track = onDarkBubble ? "rgba(255,255,255,0.35)" : "#d1d5db";
  const fill = onDarkBubble ? "#ffffff" : "#2563eb";
  const muted = onDarkBubble ? "rgba(255,255,255,0.75)" : "#6b7280";
  const danger = onDarkBubble ? "#fecaca" : "#dc2626";

  const buttonBackground = onDarkBubble ? "rgba(255,255,255,0.2)" : "#e5e7eb";

  // --------------------------------------------------------------- render
  if (control === "retry") {
    return (
      <TouchableOpacity
        onPress={handleRetry}
        accessibilityRole="button"
        accessibilityLabel="Áudio não carregou. Toque para tentar de novo."
        className="flex-row items-center gap-2 py-1"
        style={{ minWidth: 200 }}
      >
        <Ionicons name="alert-circle-outline" size={30} color={danger} />

        <View className="flex-1">
          <Text className="text-[13px] font-medium" style={{ color: danger }}>
            Áudio indisponível
          </Text>
          <Text className="text-[11px]" style={{ color: muted }}>
            Toque para tentar de novo
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  /**
   * One row of the motif. It is drawn twice — once in the track colour and
   * once in the fill colour behind a clip that ends exactly at the played
   * proportion — so the head lands on a pixel, not on a whole bar. Rounding
   * progress to the nearest bar is a 1/N error in the DRAWING, which is what a
   * driver reads as "it seeked a bit off" even when the seek was exact.
   */
  const renderBars = (color: string) => (
    <View
      style={{
        width: rail,
        height: BAR_MAX_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {Array.from({ length: barCount }, (_unused, index) => (
        <View
          key={index}
          style={{
            width: AUDIO_BAR_WIDTH,
            borderRadius: BAR_RADIUS,
            height: Math.max(
              BAR_MIN_HEIGHT,
              BAR_MAX_HEIGHT * BAR_RHYTHM[index % BAR_RHYTHM.length],
            ),
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );

  const buttonLabel =
    control === "download"
      ? "Baixar mensagem de voz"
      : control === "downloading"
        ? "Baixando mensagem de voz"
        : control === "pause"
          ? "Pausar mensagem de voz"
          : "Ouvir mensagem de voz";

  const renderButtonContent = () => {
    if (control === "buffering") {
      return <ActivityIndicator size="small" color={tint} />;
    }

    // An unknown content length means an unknown ratio: a spinner says "no
    // idea how long" honestly, a bar frozen at 0% does not.
    if (control === "downloading" && downloadRatio === null) {
      return <ActivityIndicator size="small" color={tint} />;
    }

    return (
      <Ionicons
        name={
          control === "download" || control === "downloading"
            ? "arrow-down"
            : control === "pause"
              ? "pause"
              : "play"
        }
        size={18}
        color={tint}
        // Optical centring: the play triangle's mass sits to the left.
        style={control === "play" ? { marginLeft: 2 } : undefined}
      />
    );
  };

  return (
    <View className="py-1" style={{ minWidth: 210 }}>
      <View className="flex-row items-center gap-2.5">
        <TouchableOpacity
          onPress={handleToggle}
          disabled={control === "downloading"}
          accessibilityRole="button"
          accessibilityLabel={buttonLabel}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          className="items-center justify-center overflow-hidden rounded-full"
          style={{
            height: BUTTON_SIZE,
            width: BUTTON_SIZE,
            backgroundColor: buttonBackground,
          }}
        >
          {control === "downloading" && downloadRatio !== null ? (
            // The button fills from the bottom as the bytes land: a progress
            // indicator that needs no extra row and no SVG.
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: BUTTON_SIZE * downloadRatio,
                backgroundColor: fill,
                opacity: 0.35,
              }}
            />
          ) : null}

          {renderButtonContent()}
        </TouchableOpacity>

        <GestureDetector gesture={seekGesture}>
          <View
            onLayout={handleTrackLayout}
            accessibilityRole="adjustable"
            accessibilityLabel="Posição da mensagem de voz"
            accessibilityValue={{
              now: Math.round(shownRatio * 100),
              min: 0,
              max: 100,
            }}
            accessibilityActions={[
              { name: "increment", label: "Avançar 5 segundos" },
              { name: "decrement", label: "Voltar 5 segundos" },
            ]}
            onAccessibilityAction={handleAccessibilityAction}
            className="h-8 flex-1 justify-center"
            // The padding is what the head's radius needs at each end, and it
            // is the same padding the seek maths subtracts. Touch area and
            // drawn rail are therefore the same run of pixels.
            style={{ paddingHorizontal: AUDIO_TRACK_PADDING }}
          >
            <View style={{ height: BAR_MAX_HEIGHT, width: rail }}>
              {renderBars(track)}

              <Animated.View
                pointerEvents="none"
                style={[
                  {
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    overflow: "hidden",
                  },
                  fillStyle,
                ]}
              >
                {renderBars(fill)}
              </Animated.View>

              <Animated.View
                pointerEvents="none"
                style={[
                  {
                    position: "absolute",
                    left: -KNOB_SIZE / 2,
                    top: (BAR_MAX_HEIGHT - KNOB_SIZE) / 2,
                    width: KNOB_SIZE,
                    height: KNOB_SIZE,
                    borderRadius: KNOB_SIZE / 2,
                    backgroundColor: fill,
                  },
                  knobStyle,
                ]}
              />
            </View>
          </View>
        </GestureDetector>

        <TouchableOpacity
          onPress={handleCycleSpeed}
          accessibilityRole="button"
          accessibilityLabel={`Velocidade ${speed}x. Toque para mudar.`}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
          className="rounded-full px-2 py-1"
          style={{ backgroundColor: buttonBackground }}
        >
          <Text className="text-[11px] font-semibold" style={{ color: tint }}>
            {speed}x
          </Text>
        </TouchableOpacity>
      </View>

      <View className="mt-1 pl-[50px]">
        <Text className="text-[11px]" style={{ color: muted }}>
          {control === "downloading"
            ? downloadRatio === null
              ? "Baixando…"
              : `Baixando… ${Math.round(downloadRatio * 100)}%`
            : `${formatAudioClock(elapsedMs)} / ${formatAudioClock(
                totalSeconds * 1000,
              )}`}
        </Text>
      </View>
    </View>
  );
};

export { AudioPlayerBubble };
