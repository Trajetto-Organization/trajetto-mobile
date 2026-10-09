import { useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Pressable,
  Dimensions,
} from "react-native";

import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button } from "./button";

import { useAuthStore } from "@/store/auth-store";
import { useConnectionStore } from "@/store/connection-store";
import { useThemeColors } from "@/hooks/use-theme";
import {
  selectFailedCount,
  selectParkedCount,
  selectPendingCount,
  selectUnclaimedCount,
  useOutboxStore,
} from "@/store/outbox-store";

import { logoutWarning } from "@/features/submissions/logout-rules";
import { countOpenSubmissionDrafts } from "@/features/submissions/submission-id";
import { useSendPendingNow } from "@/features/submissions/use-send-pending-now";

interface LogoutModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;

  /** `false` on the access-denied screen (see LogoutContext.canActOnQueue). */
  canActOnQueue?: boolean;
}

const { width } = Dimensions.get("window");

/**
 * Signing out, with what it leaves behind said first (MOB-15).
 *
 * Queued submissions stay on the phone and only the same account sends them,
 * on its next login; half-filled forms are deleted. On a phone shared between
 * shifts a proof could sit there for good with nobody told — so the modal
 * counts them, offers to send what can go now, and only then "Sair mesmo
 * assim".
 */
export const LogoutModal: React.FC<LogoutModalProps> = ({
  visible,
  onClose,
  onConfirm,
  isLoading = false,
  canActOnQueue = true,
}) => {
  const router = useRouter();
  const colors = useThemeColors();

  const userId = useAuthStore((state) => state.user?.id ?? null);
  const isOffline = useConnectionStore((state) => state.isDeviceOffline);

  const pending = useOutboxStore(selectPendingCount);
  const failed = useOutboxStore(selectFailedCount);
  const parked = useOutboxStore(selectParkedCount);
  const unclaimed = useOutboxStore(selectUnclaimedCount);

  const [drafts, setDrafts] = useState(0);

  // Items waiting on their backoff go too, and what is still here afterwards
  // is said rather than left to look like nothing happened — the same action
  // as the pending screen's "Tentar enviar agora".
  const {
    send: sendNow,
    reset: resetSendNow,
    isSending,
    incomplete: sendIncomplete,
  } = useSendPendingNow();

  // Read when the modal opens: a form started a minute ago counts.
  useEffect(() => {
    if (!visible) return;

    resetSendNow();

    let current = true;

    void countOpenSubmissionDrafts(userId).then((count) => {
      if (current) setDrafts(count);
    });

    return () => {
      current = false;
    };
  }, [visible, userId, resetSendNow]);

  const warning = logoutWarning(
    { pending, failed, parked, unclaimed, drafts },
    { isOffline, sendIncomplete, canActOnQueue },
  );

  const close = () => {
    if (!isLoading) onClose();
  };

  const reviewQueue = () => {
    onClose();
    // navigate (not push): a double tap must not stack two copies.
    router.navigate("/pending-submissions");
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      // Android back button: the same as Cancelar.
      onRequestClose={close}
    >
      <Pressable
        className="flex-1 bg-black/50
        justify-center items-center px-6"
        onPress={close}
      >
        <Pressable
          className="bg-card rounded-3xl overflow-hidden shadow-2xl border border-border"
          style={{ width: Math.min(width - 48, 340) }}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View className="bg-subtle px-6 pt-6 pb-4">
            <View className="items-center">
              <View
                className="w-16 h-16 bg-destructive-soft rounded-full
                items-center justify-center mb-4"
              >
                <Text className="text-3xl">
                  {warning.hasRisk ? "⚠️" : "👋"}
                </Text>
              </View>
              <Text className="text-xl font-bold text-ink mb-2 text-center">
                {warning.title}
              </Text>
              <Text className="text-muted text-center text-sm leading-5">
                Tem certeza que deseja fazer logout? Você precisará inserir suas
                credenciais novamente.
              </Text>
            </View>

            {warning.hasRisk && (
              <View
                className="mt-4 gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3"
                accessibilityRole="alert"
              >
                {warning.lines.map((line) => (
                  <View key={line} className="flex-row gap-2">
                    <Ionicons
                      name="alert-circle-outline"
                      size={16}
                      color={colors.warning}
                      style={{ marginTop: 2 }}
                    />
                    <Text className="flex-1 text-sm leading-5 text-warning">
                      {line}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Actions */}
          <View className="px-6 py-6 space-y-3 gap-3">
            {warning.canSendNow && (
              <Button
                onPress={() => void sendNow()}
                testID="logout-send-now"
                loading={isSending}
                disabled={isSending || isLoading}
                fullWidth
              >
                {isSending ? "Enviando..." : "Enviar agora"}
              </Button>
            )}

            {warning.canReviewQueue && (
              <Button
                variant="outline"
                onPress={reviewQueue}
                testID="logout-review-queue"
                disabled={isLoading}
                fullWidth
              >
                Ver envios pendentes
              </Button>
            )}

            <Button
              onPress={onConfirm}
              testID="logout-confirm"
              variant="danger"
              loading={isLoading}
              fullWidth
              className="shadow-sm"
            >
              {isLoading ? "Saindo..." : warning.confirmLabel}
            </Button>
            <TouchableOpacity
              onPress={close}
              disabled={isLoading}
              testID="logout-cancel"
              accessibilityRole="button"
              className="py-3 bg-subtle border border-border rounded-lg"
            >
              <Text
                className="text-ink-soft
                text-center font-medium"
              >
                Cancelar
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

/**
 * "Sair da conta" for a screen without the drawer: the access-denied state
 * of ProtectedRoute, whose button signed out with no warning at all. The
 * same warning first, without the queue actions that session cannot take.
 */
export const SignOutButton: React.FC = () => {
  const logout = useAuthStore((state) => state.logout);

  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  // No navigation here: clearing the user flips the root guard to /login,
  // as in the drawer's confirmLogout.
  const confirm = async () => {
    setIsSigningOut(true);

    try {
      await logout();
    } catch {
      setIsSigningOut(false);
    }
  };

  return (
    <>
      <Button onPress={() => setIsOpen(true)} variant="danger">
        Sair da conta
      </Button>

      <LogoutModal
        visible={isOpen}
        onClose={() => setIsOpen(false)}
        onConfirm={() => void confirm()}
        isLoading={isSigningOut}
        canActOnQueue={false}
      />
    </>
  );
};
