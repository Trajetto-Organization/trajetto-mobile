import { useCallback, useEffect, useRef, useState } from "react";

import {
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { useFocusEffect } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";

import { ImagePickerBottomSheet } from "../../ui";

import { useChatImages } from "@/features/chat/hooks/use-chat-images";
import { useVoiceRecorder } from "@/features/chat/hooks/use-voice-recorder";

import {
  MAX_AUDIO_DURATION_MS,
  MAX_CHAT_IMAGES_PER_SEND,
  MAX_CHAT_MESSAGE_LENGTH,
  chatHintPulseMs,
  formatAudioClock,
  presencePulseIsDue,
  recordingCountdownSeconds,
  whyRecordingIsNotSendable,
} from "@/features/chat/chat-rules";

import {
  chatContextLabel,
  composeImageBatch,
  type ChatContext,
} from "@/features/chat/chat-context";

import type { SendInput } from "@/features/chat/hooks/use-chat-conversation";

import Toast from "react-native-toast-message";
import { truncateText } from "@/utils/truncate-text";
import { useThemeColors } from "@/hooks/use-theme";

/** The ceiling as the driver reads it — "2:00". Derived, never retyped. */
const AUDIO_LIMIT_LABEL = formatAudioClock(MAX_AUDIO_DURATION_MS);

interface ChatComposerProps {
  onSend: (input: SendInput) => void;

  /** One bubble per photo, sent in order. */
  onSendMany: (inputs: SendInput[]) => void;

  onTyping: () => void;

  /**
   * One pulse of "gravando um áudio" while the microphone is capturing, and
   * the courtesy `false` at a clean end. Repetition is the contract, not an
   * accident: see the effects below.
   */
  onRecording: (recording: boolean) => void;

  /**
   * What the messages are about ("Falar com a base" from a delivery or a
   * route). It stays until the driver removes it (DLVP-CHAT-1): consumed by
   * the first message, every follow-up about the same stop went out with no
   * link to it.
   */
  context: ChatContext | null;
  onClearContext: () => void;

  /**
   * Decision 14.5: the context is the composer's default subject, not one the
   * driver or a screen put up — there is nothing to remove, only to change.
   */
  contextIsAutomatic?: boolean;

  /** Opens "Sobre o quê?" (design §8.2). Absent: the chip is not tappable. */
  onPressContext?: () => void;
}

/**
 * Text, photos and voice in one bar. The mic replaces the send button while
 * the field is empty — tap to record, then send or discard: an explicit stop
 * beats hold-to-record on the road, where a graze against the screen must not
 * throw a half note away.
 *
 * Photos are staged as a strip, up to ten at a time. What the driver types
 * while a strip is up is the caption for the batch, and it travels with the
 * last photo — one caption, at the end, the way every messenger does it.
 */
const ChatComposer = ({
  onSend,
  onSendMany,
  onTyping,
  onRecording,
  context,
  onClearContext,
  contextIsAutomatic = false,
  onPressContext,
}: ChatComposerProps) => {
  const colors = useThemeColors();
  const [text, setText] = useState<string>("");
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);

  const recorder = useVoiceRecorder();
  const photos = useChatImages();

  /**
   * The recording is HELD when the driver leaves the conversation.
   *
   * Changing tabs does not unmount this bar, so a recording left running goes
   * on capturing behind another screen — with no UI anywhere to stop it, and
   * with the ceiling firing where nobody can see it. Holding is the honest
   * answer: the microphone stops capturing, everything already said is kept,
   * and the bar reads "Pausado" when the driver comes back. Discarding would
   * throw their words away for the crime of glancing at the map.
   *
   * Through a ref because `pause` is rebuilt as the recorder's state moves:
   * naming it as a dependency would re-run this effect — cleanup included —
   * mid-recording, holding the very recording the driver is still speaking
   * into.
   */
  const holdRecording = useRef(recorder.pause);

  useEffect(() => {
    holdRecording.current = recorder.pause;
  }, [recorder.pause]);

  useFocusEffect(useCallback(() => () => holdRecording.current(), []));

  // The hardware stop is in flight. The bar stays up through it: the recording
  // is on its way out, and swapping back to the text composer for those few
  // frames would hand the microphone button back over a stop nobody finished.
  const isFinishing = recorder.isFinishing;

  const captured = recorder.captured;

  /**
   * Whether a recording exists at all — capturing, held, on its way out, or
   * parked on the send button by the ceiling. It is what keeps the recording
   * bar on screen further down, and the only thing here that can say a
   * recording is OVER rather than merely quiet.
   */
  const hasLiveRecording =
    recorder.isRecording ||
    recorder.isPaused ||
    isFinishing ||
    Boolean(captured);

  /** The recorded length, which is also this composer's proof of capture. */
  const recordedMs = recorder.recordingMs;

  const lastRecordingPulseRef = useRef<number | null>(null);

  /**
   * The "gravando um áudio" pulse on the other side's screen.
   *
   * It is keyed on the RECORDED LENGTH and on nothing else, because that is
   * the closest thing this app has to "the microphone captured something just
   * now". `expo-audio` advances `durationMillis` between its own explicit
   * record/pause/stop calls and freezes it on each of them, so a hold, the app
   * going to the background or the system handing the microphone to a phone
   * call all stop the clock — and stop the pulse with it. The phase is what
   * the driver ASKED for; this is at least what the module did.
   *
   * Being exact about what it is NOT: the native side measures wall time
   * between those calls rather than sampling the encoder, and on Android it
   * does not clear its own recording flag when the microphone dies without a
   * pause. A device taken away that silently is the one case this misses, and
   * the window behind the pulse is what covers it — five seconds of a stale
   * hint, not a stuck one.
   *
   * React does the stall detection for free: this only re-runs when the
   * reported length actually changed, so a recorder that stopped capturing for
   * any reason at all simply stops pulsing, and the bubble on the other side
   * goes out on its own a window later. Nothing has to notice it, announce it
   * or clean up after it — which is the whole point, since the cases that
   * matter are exactly the ones where this app is in no position to announce
   * anything.
   */
  useEffect(() => {
    if (recordedMs <= 0) {
      // Nothing on tape: the recorder is idle or only just starting, and the
      // next capture is a new recording that deserves its pulse at once.
      lastRecordingPulseRef.current = null;
      return;
    }

    const now = Date.now();

    if (
      !presencePulseIsDue({
        nowMs: now,
        lastPulseAtMs: lastRecordingPulseRef.current,
        everyMs: chatHintPulseMs("recording"),
      })
    ) {
      return;
    }

    lastRecordingPulseRef.current = now;
    onRecording(true);
  }, [recordedMs, onRecording]);

  /**
   * The courtesy `false` when the recording is definitively over: sent,
   * discarded, or this bar unmounted with the microphone still open.
   *
   * Politeness, nothing more. It buys the other side the window it would
   * otherwise spend watching a bubble for a recording that already ended, and
   * NOTHING is built on it — delete it and every case above still corrects
   * itself, just less promptly.
   *
   * A hold is deliberately not one of these ends: the pulses stop on their own
   * while the recorder is held, which is the same answer arrived at the same
   * way. Worth knowing that the SAC panel decides the opposite and sends its
   * `false` on a pause, so a held recording clears there at once and here
   * within the window. Both are correct under the pulse — the difference is
   * promptness, not truth — and the ordering hazard that made the instant
   * version wrong here does not exist there.
   */
  useEffect(() => {
    if (!hasLiveRecording) return;

    return () => onRecording(false);
  }, [hasLiveRecording, onRecording]);

  const handleSend = () => {
    const body = text.trim();

    if (photos.images.length > 0) {
      // Caption on the last photo, the context on every one of them.
      onSendMany(composeImageBatch(photos.images, body, context));

      photos.clear();
      setText("");

      return;
    }

    if (!body) return;

    onSend({ kind: "TEXT", body, context });
    setText("");
  };

  const handleStartRecording = () => {
    // Fired and forgotten on purpose: `start()` never rejects. It silences
    // whatever note is playing (the arbiter in `use-voice-recorder`, which
    // every caller of the microphone goes through, not just this bar), and it
    // reports its own refusals — permission, microphone busy — with a toast,
    // leaving the recorder ready for the next tap.
    void recorder.start();
  };

  /**
   * A send already under way.
   *
   * The hardware stop is asynchronous and the bar stays up through it, so the
   * send button is still under the driver's thumb while the recorder is
   * finishing — and `finish()` hands every caller the SAME recording. Without
   * this, one impatient second tap puts the note on the thread twice.
   *
   * A ref and not state: two taps can land in the same frame, and a flag the
   * second tap only sees after a re-render is no guard at all.
   */
  const isSendingRef = useRef<boolean>(false);

  /** Stops the recorder, checks what came back, and puts it on the thread. */
  const sendRecording = async () => {
    const finished = await recorder.finish();

    if (!finished) {
      recorder.reset();

      Toast.show({
        type: "error",
        text1: "Não foi possível gravar o áudio",
        position: "top",
      });

      return;
    }

    /**
     * The last gate before the upload. The recorder stops itself at the
     * ceiling, so reaching here with an oversized note means the timer was
     * starved by the OS — rare, but the alternative is spending the driver's
     * data on bytes the API is going to refuse anyway.
     */
    const rejection = whyRecordingIsNotSendable(finished.durationMs);

    if (rejection) {
      recorder.reset();

      Toast.show({
        type: "error",
        text1:
          rejection === "too-short" ? "Áudio muito curto" : "Áudio muito longo",
        text2:
          rejection === "too-short"
            ? "Segure um instante a mais e fale à vontade."
            : `O limite é de ${AUDIO_LIMIT_LABEL}. Grave um recado mais curto.`,
        position: "top",
      });

      return;
    }

    // The chip travels with the note exactly as with text and photos: what
    // the bar shows is what the message is linked to.
    onSend({
      kind: "AUDIO",
      uri: finished.uri,
      durationMs: finished.durationMs,
      fileSize: finished.fileSize,
      context,
    });

    recorder.reset();
  };

  const handleSendRecording = async () => {
    if (isSendingRef.current) return;

    isSendingRef.current = true;

    try {
      await sendRecording();
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleTakePhoto = () => {
    setIsPickerOpen(false);
    void photos.takePhoto();
  };

  const handlePickFromGallery = () => {
    setIsPickerOpen(false);
    void photos.pickFromGallery();
  };

  const canSend = Boolean(text.trim() || photos.images.length > 0);

  // ------------------------------------------------------ recording bar
  if (hasLiveRecording) {
    // Shown only in the last stretch, so the driver can land the sentence
    // instead of being cut off in the middle of it. A recording already on its
    // way out has nothing left to count down.
    const countdown =
      captured || isFinishing
        ? null
        : recordingCountdownSeconds(recorder.recordingMs);

    return (
      <View className="border-t border-border bg-surface px-4 py-3">
        <View className="flex-row items-center gap-3">
          {/*
            Inert while the stop is in flight, and visibly so. The recording is
            already on its way out: discarding it there would race the send
            that is fetching the very same file.
          */}
          <TouchableOpacity
            onPress={() => void recorder.cancel()}
            disabled={isFinishing}
            accessibilityRole="button"
            accessibilityLabel="Descartar gravação"
            className={`h-10 w-10 items-center justify-center rounded-full
            bg-subtle ${isFinishing ? "opacity-50" : ""}`}
          >
            <Ionicons name="trash-outline" size={20} color={colors.muted} />
          </TouchableOpacity>

          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <View
                className={`h-2.5 w-2.5 rounded-full ${
                  captured || isFinishing
                    ? "bg-muted"
                    : recorder.isPaused
                      ? "bg-warning"
                      : "bg-destructive"
                }`}
              />
              <Text className="text-base font-medium text-ink">
                {captured
                  ? `Gravação de ${formatAudioClock(captured.durationMs)}`
                  : isFinishing
                    ? `Finalizando ${formatAudioClock(recorder.recordingMs)}`
                    : recorder.isPaused
                      ? `Pausado ${formatAudioClock(recorder.recordingMs)}`
                      : `Gravando... ${formatAudioClock(recorder.recordingMs)}`}
              </Text>
            </View>

            {captured ? (
              <Text
                className="mt-0.5 text-xs text-muted"
                accessibilityLiveRegion="polite"
              >
                Limite de {AUDIO_LIMIT_LABEL} atingido. Envie ou descarte.
              </Text>
            ) : countdown !== null ? (
              <Text
                className="mt-0.5 text-xs font-medium text-warning"
                accessibilityLiveRegion="polite"
              >
                {recorder.isPaused
                  ? `Faltam ${countdown}s de gravação.`
                  : `Faltam ${countdown}s — conclua a frase.`}
              </Text>
            ) : recorder.isPaused ? (
              <Text className="mt-0.5 text-xs text-muted">
                Continue quando puder — o tempo parado não conta.
              </Text>
            ) : null}
          </View>

          {/*
            Hold and pick up again — a driver is interrupted by the radio, by
            a customer, by a manoeuvre. The recorder keeps the same file open,
            so this costs nothing but the tap. A recording the ceiling already
            stopped has nothing left to hold, and neither has one whose stop is
            already in flight.
          */}
          {!captured && !isFinishing && (
            <TouchableOpacity
              onPress={recorder.isPaused ? recorder.resume : recorder.pause}
              accessibilityRole="button"
              accessibilityLabel={
                recorder.isPaused ? "Continuar gravação" : "Pausar gravação"
              }
              className="h-10 w-10 items-center justify-center rounded-full bg-subtle"
            >
              <Ionicons
                name={recorder.isPaused ? "mic" : "pause"}
                size={20}
                color={colors.inkSoft}
              />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={() => void handleSendRecording()}
            disabled={isFinishing}
            accessibilityRole="button"
            accessibilityLabel="Enviar mensagem de voz"
            className={`h-10 w-10 items-center justify-center rounded-full
            bg-primary ${isFinishing ? "opacity-50" : ""}`}
          >
            <Ionicons name="send" size={18} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View className="border-t border-border bg-surface px-3 py-2">
      {!context && onPressContext && (
        <TouchableOpacity
          onPress={onPressContext}
          accessibilityRole="button"
          accessibilityLabel="Escolher o assunto da mensagem"
          className="mb-2 flex-row items-center gap-1.5 self-start rounded-full
          border border-dashed border-input px-3 py-1"
        >
          <Ionicons name="chatbox-ellipses-outline" size={13} color={colors.muted} />
          <Text className="text-xs text-muted">Novo assunto · Escolher</Text>
        </TouchableOpacity>
      )}

      {context && (
        <View
          className="mb-2 flex-row items-center gap-1.5 self-start rounded-full
          border border-border bg-subtle px-3 py-1"
        >
          <TouchableOpacity
            onPress={onPressContext}
            disabled={!onPressContext}
            accessibilityRole="button"
            accessibilityLabel={`${chatContextLabel(context)}. Toque para mudar o assunto`}
            className="flex-row items-center gap-1.5"
          >
            <Ionicons
              name={
                context.ticket
                  ? "chatbox-ellipses-outline"
                  : context.delivery
                    ? "cube-outline"
                    : "map-outline"
              }
              size={13}
              color={colors.muted}
            />
            <Text className="max-w-[220px] text-xs text-ink-soft" numberOfLines={1}>
              {chatContextLabel(context)}
            </Text>
            {onPressContext && <Ionicons name="chevron-down" size={12} color={colors.muted} />}
          </TouchableOpacity>
          {!contextIsAutomatic && (
            <TouchableOpacity
              onPress={onClearContext}
              accessibilityRole="button"
              accessibilityLabel={
                context.ticket
                  ? "Remover o assunto"
                  : context.delivery
                    ? "Remover referência da entrega"
                    : "Remover referência da rota"
              }
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={14} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {photos.images.length > 0 && (
        <View className="mb-2">
          <View className="mb-1.5 flex-row items-center justify-between pr-1">
            <Text className="text-xs font-medium text-muted">
              {photos.images.length}/{MAX_CHAT_IMAGES_PER_SEND}
            </Text>

            <TouchableOpacity
              onPress={photos.clear}
              accessibilityRole="button"
              accessibilityLabel="Remover todas as fotos"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text className="text-xs font-medium text-muted">
                Limpar
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // Room for the remove buttons, which sit outside each thumbnail.
            contentContainerStyle={{ paddingTop: 8, paddingRight: 10, gap: 10 }}
          >
            {photos.images.map((image, index) => (
              <View key={`${image.uri}-${index}`}>
                <Image
                  source={{ uri: image.uri }}
                  className="h-20 w-20 rounded-lg"
                  resizeMode="cover"
                />
                <TouchableOpacity
                  onPress={() => photos.remove(index)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remover foto ${index + 1}`}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  className="absolute -right-2 -top-2 h-6 w-6 items-center
                  justify-center rounded-full border border-border bg-card"
                >
                  <Ionicons name="close" size={14} color={colors.inkSoft} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <View className="flex-row items-end gap-2">
        <TouchableOpacity
          onPress={() => setIsPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Anexar fotos"
          className="h-10 w-10 items-center justify-center"
        >
          <Ionicons name="camera-outline" size={24} color={colors.muted} />
        </TouchableOpacity>

        <View
          className="max-h-28 flex-1 justify-center rounded-3xl
          border border-input bg-subtle px-4"
        >
          <TextInput
            value={text}
            onChangeText={(value) => {
              setText(truncateText(value, MAX_CHAT_MESSAGE_LENGTH));
              onTyping();
            }}
            placeholder={
              photos.images.length > 0
                ? "Legenda (opcional)..."
                : "Escreva uma mensagem..."
            }
            placeholderTextColor={colors.muted}
            selectionColor={colors.primary}
            cursorColor={colors.primary}
            multiline
            className="min-h-[40px] py-2 text-[15px] text-ink"
            accessibilityLabel="Mensagem"
            testID="chat-input"
          />
        </View>

        {canSend ? (
          <TouchableOpacity
            onPress={handleSend}
            accessibilityRole="button"
            accessibilityLabel="Enviar mensagem"
            testID="chat-send"
            className="h-10 w-10 items-center justify-center rounded-full bg-primary"
          >
            <Ionicons name="send" size={18} color={colors.primaryForeground} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleStartRecording}
            accessibilityRole="button"
            accessibilityLabel="Gravar mensagem de voz"
            className="h-10 w-10 items-center justify-center rounded-full bg-primary"
          >
            <Ionicons name="mic" size={20} color={colors.primaryForeground} />
          </TouchableOpacity>
        )}
      </View>

      <ImagePickerBottomSheet
        visible={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onTakePhoto={handleTakePhoto}
        onPickFromGallery={handlePickFromGallery}
        title="Fotos para o chat"
        description={`Envie até ${MAX_CHAT_IMAGES_PER_SEND} fotos para a operação.`}
      />
    </View>
  );
};

export { ChatComposer };
