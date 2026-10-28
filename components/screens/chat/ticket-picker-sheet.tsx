import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import { Sheet } from "../../ui";
import { sheetTickets, type TicketLike } from "@/features/chat/ticket-rules";
import { useThemeColors } from "@/hooks/use-theme";

// Opens at half the screen and expands for a long list; the list scrolls in
// either height (a fixed height with a scrolling body, rule 14).
const SNAP_POINTS = ["55%", "90%"];

interface TicketPickerSheetProps {
  visible: boolean;
  onClose: () => void;

  tickets: ReadonlyArray<TicketLike>;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;

  /** The subject the composer points at now, marked in the list. */
  currentTicketId: string | null;

  onChoose: (ticket: TicketLike) => void;

  /** "Novo assunto": the API opens it (the running route's, else a general one). */
  onNewSubject: () => void;
  isOpening: boolean;
}

/**
 * "Sobre o quê?" (decision 14.5, design §8.2): the driver's open subjects and
 * "Novo assunto". The driver never manages tickets — choosing one only says
 * where the next words go; closing is the central's job.
 */
const TicketPickerSheet = ({
  visible,
  onClose,
  tickets,
  isLoading,
  isError,
  onRetry,
  currentTicketId,
  onChoose,
  onNewSubject,
  isOpening,
}: TicketPickerSheetProps) => {
  const colors = useThemeColors();

  const list = sheetTickets(tickets, currentTicketId);

  return (
    <Sheet visible={visible} onClose={onClose} snapPoints={SNAP_POINTS}>
      <View className="px-6 pb-3 pt-1">
        <Text className="text-lg font-bold text-ink">Sobre o quê?</Text>
        <Text className="text-sm text-muted">
          Escolha o assunto da sua próxima mensagem.
        </Text>
      </View>

      <View className="gap-2 px-6">
        <TouchableOpacity
          onPress={onNewSubject}
          disabled={isOpening}
          accessibilityRole="button"
          accessibilityLabel="Novo assunto"
          accessibilityState={{ disabled: isOpening, busy: isOpening }}
          className={`flex-row items-center rounded-2xl border border-primary/40
          bg-primary-soft p-4 ${isOpening ? "opacity-60" : ""}`}
        >
          {isOpening ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons
              name="add-circle-outline"
              size={22}
              color={colors.primary}
            />
          )}
          <Text className="ml-3 text-base font-semibold text-primary">
            Novo assunto
          </Text>
        </TouchableOpacity>

        {isLoading ? (
          <View className="items-center py-6">
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : isError ? (
          <TouchableOpacity
            onPress={onRetry}
            accessibilityRole="button"
            className="items-center py-6"
          >
            <Text className="text-sm text-muted">
              Não foi possível carregar os assuntos. Toque para tentar de novo.
            </Text>
          </TouchableOpacity>
        ) : list.length === 0 ? (
          <Text className="py-6 text-center text-sm text-muted">
            Nenhum assunto aberto com a central.
          </Text>
        ) : (
          list.map((ticket) => {
            const current = ticket.id === currentTicketId;

            return (
              <TouchableOpacity
                key={ticket.id}
                onPress={() => onChoose(ticket)}
                accessibilityRole="button"
                accessibilityLabel={`Assunto ${ticket.number}: ${ticket.subject}`}
                accessibilityState={{ selected: current }}
                className={`flex-row items-center rounded-2xl border p-4 ${
                  current
                    ? "border-primary/40 bg-primary-soft"
                    : "border-border bg-card"
                }`}
              >
                <View className="flex-1">
                  <Text className="text-xs font-medium text-muted">
                    #{ticket.number}
                  </Text>
                  <Text className="text-base text-ink" numberOfLines={2}>
                    {ticket.subject}
                  </Text>
                </View>
                {current && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </Sheet>
  );
};

export { TicketPickerSheet };
