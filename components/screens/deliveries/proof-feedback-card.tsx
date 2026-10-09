import { Text, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import { Button } from "../../ui";
import { useThemeColors } from "../../../hooks/use-theme";

import type { DeliveryProofFeedback } from "@/features/notifications/use-proof-feedback";

interface ProofFeedbackCardProps {
  proof: DeliveryProofFeedback;

  /** Opens the proof screen; offered only when the delivery can be proven. */
  onRetake?: () => void;
}

/** "29/09 às 14:02", on the phone's clock. */
function formatWarningMoment(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return "";

  const day = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return `${day} às ${time}`;
}

/**
 * The automatic reading's warning on the delivery it is about (decision 6.9):
 * what it pointed at and what the driver can do. A suggestion, never a
 * verdict — the office decides, and the words say so.
 */
const ProofFeedbackCard = ({ proof, onRetake }: ProofFeedbackCardProps) => {
  const { feedback, problems, step, guidance } = proof;
  const moment = formatWarningMoment(feedback.at);
  const colors = useThemeColors();

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className="rounded-xl border border-warning/40 bg-warning-soft p-4"
    >
      <View className="flex-row items-center gap-2">
        <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
        <Text className="flex-1 text-sm font-semibold text-warning">
          {feedback.title}
        </Text>
      </View>

      {problems.length > 0 ? (
        <View className="mt-2">
          <Text className="text-sm text-ink-soft">
            A leitura automática apontou:
          </Text>
          {problems.map((problem) => (
            <Text key={problem} className="mt-0.5 text-sm text-ink-soft">
              • {problem}
            </Text>
          ))}
        </View>
      ) : (
        <Text className="mt-2 text-sm text-ink-soft">{feedback.message}</Text>
      )}

      <Text className="mt-2 text-sm text-ink-soft">{guidance}</Text>

      {moment ? (
        <Text className="mt-2 text-xs text-muted">Aviso de {moment}</Text>
      ) : null}

      {step === "retake" && onRetake ? (
        <View className="mt-3">
          <Button onPress={onRetake} fullWidth>
            Comprovar novamente
          </Button>
        </View>
      ) : null}
    </View>
  );
};

export { ProofFeedbackCard };
