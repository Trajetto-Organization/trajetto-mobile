import { useState } from "react";
import {
  Modal,
  Pressable,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";

import { KeyboardAvoidingView } from "../../ui/keyboard-avoiding-view";

import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, ConfirmModal, Input } from "../../ui";
import { useThemeColors } from "../../../hooks/use-theme";

import {
  PAUSE_NOTE_MAX_LENGTH,
  formatPauseDuration,
  formatPauseElapsed,
  openPauseTitle,
  pauseChoicesOf,
  type PauseChoice,
  type PauseKind,
} from "@/features/pauses/pause-rules";
import type { DriverPauseType } from "@/features/deliveries/types";
import { pauseNoteFormSchema } from "@/features/pauses/pause-schemas";
import { formatClock } from "@/features/deliveries/delivery-rules";
import { useNow } from "@/features/pauses/use-now";
import { useLiveFields } from "@/features/forms/use-live-fields";
import { useFieldFocus } from "@/features/forms/use-field-focus";
import type { DriverPauseControl } from "@/features/pauses/use-driver-pause";

/** The modal's only validated field. */
const PAUSE_FIELDS = ["note"] as const;

const KIND_ICON: Record<PauseKind, keyof typeof Ionicons.glyphMap> = {
  MEAL: "restaurant-outline",
  REST: "bed-outline",
  OTHER: "pause-circle-outline",
};

interface PauseStartModalProps {
  visible: boolean;
  isSending: boolean;
  /** The company's pause types from the cached day (decision 14.4). */
  pauseTypes?: DriverPauseType[];
  onClose: () => void;
  onConfirm: (choice: PauseChoice, note: string) => void;
}

/**
 * Which pause, and a note if the driver wants one. The type is required
 * (its legal nature is what the report's law alerts read); nothing else is.
 * The company's pause types when the cached day has them, the three fixed
 * natures otherwise.
 */
const PauseStartModal = ({
  visible,
  isSending,
  pauseTypes,
  onClose,
  onConfirm,
}: PauseStartModalProps) => {
  const { width } = useWindowDimensions();
  const colors = useThemeColors();

  const choices = pauseChoicesOf(pauseTypes);

  const [selected, setSelected] = useState<number>(0);
  const [note, setNote] = useState<string>("");

  const choice = choices[Math.min(selected, choices.length - 1)];

  const parsed = pauseNoteFormSchema.safeParse({ note });
  const noteIssue = parsed.success ? null : (parsed.error.issues[0]?.message ?? null);

  // The note is judged once the driver leaves it, or on "Iniciar pausa"
  // (decision 16.700) — never while the first try is typed.
  const live = useLiveFields({ issues: { note: noteIssue }, order: PAUSE_FIELDS });
  const noteError = live.errorOf("note");
  const fieldFocus = useFieldFocus();

  const confirm = () => {
    const firstInvalid = live.attempt();

    if (firstInvalid) {
      fieldFocus.focusField(firstInvalid, noteIssue ?? undefined);
      return;
    }

    onConfirm(choice, note);
  };

  const close = () => {
    if (!isSending) onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
    >
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <Pressable
          accessible={false}
          className="flex-1 items-center justify-center bg-black/50 px-6"
          onPress={close}
        >
          <Pressable
            accessibilityViewIsModal
            className="overflow-hidden rounded-3xl border border-border bg-card shadow-2xl"
            style={{ width: Math.min(width - 48, 360) }}
            onPress={(event) => event.stopPropagation()}
          >
            <View className="bg-subtle px-6 pb-4 pt-6">
              <Text className="text-center text-xl font-bold text-ink">
                Iniciar pausa
              </Text>
              <Text className="mt-1 text-center text-sm text-muted">
                O tempo começa a contar agora, mesmo sem sinal.
              </Text>
            </View>

            <View className="gap-2 px-6 pt-4">
              <Text className="font-medium text-ink-soft">
                Tipo de pausa<Text className="text-destructive"> *</Text>
              </Text>

              <View accessibilityRole="radiogroup" className="gap-2">
                {choices.map((option, index) => {
                  const isSelected = index === selected;

                  return (
                    <TouchableOpacity
                      key={option.occurrenceTypeId ?? option.kind}
                      onPress={() => setSelected(index)}
                      disabled={isSending}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: isSelected, disabled: isSending }}
                      accessibilityLabel={`${option.label}. ${option.description}`}
                      className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${
                        isSelected ? "border-primary bg-primary-soft" : "border-border bg-card"
                      }`}
                    >
                      <Ionicons
                        name={KIND_ICON[option.kind]}
                        size={20}
                        color={isSelected ? colors.primary : colors.muted}
                      />
                      <View className="flex-1">
                        <Text className="text-sm font-semibold text-ink">
                          {option.label}
                        </Text>
                        <Text className="text-xs text-muted">{option.description}</Text>
                      </View>
                      <Ionicons
                        name={isSelected ? "radio-button-on" : "radio-button-off"}
                        size={20}
                        color={isSelected ? colors.primary : colors.muted}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Input
                className="mt-2"
                label="Observação (opcional)"
                placeholder="Ex.: almoço no posto"
                value={note}
                onChangeText={(text) => setNote(text.slice(0, PAUSE_NOTE_MAX_LENGTH + 50))}
                onBlur={() => live.touch("note")}
                inputRef={fieldFocus.inputRef("note")}
                error={noteError}
                editable={!isSending}
              />
            </View>

            <View className="gap-3 px-6 py-6">
              <Button
                onPress={confirm}
                loading={isSending}
                // Enabled while idle (decision 16.701): the tap shows what is wrong.
                disabled={isSending}
                fullWidth
              >
                Iniciar pausa
              </Button>
              <TouchableOpacity
                onPress={close}
                disabled={isSending}
                accessibilityRole="button"
                className={`rounded-lg border border-border bg-subtle py-3 ${isSending ? "opacity-50" : ""}`}
              >
                <Text className="text-center font-medium text-ink-soft">Cancelar</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

/**
 * The header's way into a pause, when none is open. Compact on purpose: the
 * list below is the screen's work, the pause is an interruption of it.
 *
 * Decision 14.4: hidden outside a journey (`allowed`, isPauseAllowed over
 * the cached day). Ending an open pause is the banner's, never hidden.
 */
const PauseHeaderAction = ({
  pause,
  allowed,
  pauseTypes,
}: {
  pause: DriverPauseControl;
  allowed: boolean;
  pauseTypes?: DriverPauseType[];
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const colors = useThemeColors();

  if (!pause.canStart || !allowed) return null;

  const handleConfirm = async (choice: PauseChoice, note: string) => {
    const started = await pause.start(choice.kind, note, choice);
    if (started) setIsOpen(false);
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setIsOpen(true)}
        disabled={pause.isSending}
        accessibilityRole="button"
        accessibilityLabel="Iniciar pausa"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        className="flex-row items-center gap-1 rounded-full border border-input px-3 py-1.5"
      >
        <Ionicons name="cafe-outline" size={16} color={colors.inkSoft} />
        <Text className="text-sm font-medium text-ink-soft">Pausa</Text>
      </TouchableOpacity>

      {/* Mounted only while open: each pause starts from a clean form. */}
      {isOpen ? (
        <PauseStartModal
          visible
          isSending={pause.isSending}
          pauseTypes={pauseTypes}
          onClose={() => setIsOpen(false)}
          onConfirm={(choice, note) => void handleConfirm(choice, note)}
        />
      ) : null}
    </>
  );
};

/**
 * The open pause, under the header: what, since when, the running timer, and
 * the way out. Survives the app being killed — it reads the phone's record.
 */
const PauseBanner = ({ pause }: { pause: DriverPauseControl }) => {
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);
  const colors = useThemeColors();

  const open = pause.enabled ? pause.open : null;
  const now = useNow(open !== null);

  if (!open) return null;

  const handleEnd = async () => {
    await pause.end(open);
    setIsConfirmOpen(false);
  };

  const since = `Iniciada às ${formatClock(open.startedAt)}${
    pause.startQueued ? " · salva no aparelho" : ""
  }`;

  return (
    <>
      <View
        accessibilityRole="summary"
        className="flex-row items-center gap-3 border-b border-warning/40 bg-warning-soft px-4 py-3"
      >
        <Ionicons name={KIND_ICON[open.kind]} size={22} color={colors.warning} />
        <View className="flex-1">
          <Text className="text-sm font-semibold text-warning">{openPauseTitle(open)}</Text>
          <Text
            className="text-lg font-bold text-warning"
            accessibilityLabel={`Tempo de pausa ${formatPauseElapsed(open.startedAt, now)}`}
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {formatPauseElapsed(open.startedAt, now)}
          </Text>
          <Text className="text-xs text-warning" numberOfLines={1}>
            {since}
          </Text>
        </View>
        <Button
          size="sm"
          onPress={() => setIsConfirmOpen(true)}
          disabled={pause.isSending}
        >
          Encerrar
        </Button>
      </View>

      <ConfirmModal
        visible={isConfirmOpen}
        emoji="⏱️"
        title="Encerrar a pausa?"
        message={`${openPauseTitle(open)} em andamento há ${formatPauseDuration(
          open.startedAt,
          now,
        )}. O fim fica registrado agora, mesmo sem sinal.`}
        confirmText="Encerrar pausa"
        cancelText="Continuar em pausa"
        isLoading={pause.isSending}
        onConfirm={() => void handleEnd()}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </>
  );
};

export { PauseBanner, PauseHeaderAction };
