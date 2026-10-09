import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Text,
  View,
  type AppStateStatus,
} from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import Constants from "expo-constants";
import * as Updates from "expo-updates";

import { Button } from "@/components/ui/button";
import { useThemeColors } from "@/hooks/use-theme";
import {
  performUpgrade,
  storeUrlFor,
  type UpgradeStep,
} from "@/features/app-update/upgrade-rules";
import { claimAutomaticUpgrade, useUpgradeStore } from "@/store/upgrade-store";

const STEP_TEXT: Record<UpgradeStep, string> = {
  checking: "Procurando atualização...",
  downloading: "Baixando atualização...",
  restarting: "Reiniciando o aplicativo...",
  store: "Atualize o Trajetto na loja e abra o aplicativo de novo.",
  "no-store":
    "Procure por Trajetto na Play Store e atualize. Se nenhuma atualização aparecer, fale com o gestor da frota.",
};

const IN_PROGRESS: UpgradeStep[] = ["checking", "downloading", "restarting"];

/**
 * The blocking screen for a build the API no longer accepts (GAP5-2).
 *
 * Raised by the first 426 CLIENT_UPGRADE_REQUIRED any request meets (see
 * `apiClient` and `upgrade-store`). Blocking, unlike the offline banner: an
 * offline driver can keep working and the queue catches up later, but here
 * every request would be refused until the app is updated — carrying on
 * would only pile up errors. What is already queued stays on the phone as a
 * contract failure and goes by itself after the update, which is what the
 * text tells the driver.
 *
 * Tries the way out once on its own per launch (an over-the-air update, else
 * the store), and afterwards only when the driver taps: trying on every
 * mount would reopen the store each time the driver came back from it.
 * Mounted from the root layout, never in the headless launch; and the
 * automatic attempt waits for the app to be in the foreground, since a
 * backgrounded app still has this tree mounted (see `claimAutomaticUpgrade`).
 */
function UpgradeRequiredScreen() {
  const notice = useUpgradeStore((state) => state.notice);
  const colors = useThemeColors();

  const [step, setStep] = useState<UpgradeStep | null>(null);

  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState,
  );

  // Followed only while the screen is up, which is the only time it matters.
  useEffect(() => {
    if (!notice) return;

    setAppState(AppState.currentState);

    const subscription = AppState.addEventListener("change", setAppState);

    return () => subscription.remove();
  }, [notice]);

  const storeUrl = notice
    ? storeUrlFor(notice.storeUrl, Constants.expoConfig?.android?.package)
    : null;

  const attempt = useCallback(async () => {
    await performUpgrade(storeUrl, {
      updatesEnabled: Updates.isEnabled,
      checkForUpdate: () => Updates.checkForUpdateAsync(),
      fetchUpdate: () => Updates.fetchUpdateAsync(),
      reload: () => Updates.reloadAsync(),
      openStore: (url) => Linking.openURL(url),
      onStep: setStep,
    });
  }, [storeUrl]);

  useEffect(() => {
    if (!notice || !claimAutomaticUpgrade(appState)) return;

    void attempt();
  }, [notice, appState, attempt]);

  if (!notice) return null;

  const busy = step !== null && IN_PROGRESS.includes(step);

  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      // The Android back button must not dismiss it: behind it, every
      // request is refused.
      onRequestClose={() => undefined}
    >
      <View
        accessibilityRole="alert"
        className="flex-1 bg-background justify-center items-center px-8"
      >
        <View className="w-20 h-20 rounded-full items-center justify-center mb-6 bg-primary-soft">
          <Ionicons name="cloud-download-outline" size={40} color={colors.primary} />
        </View>

        <Text className="text-2xl font-bold text-ink mb-3 text-center">
          Atualize o aplicativo
        </Text>

        <Text className="text-muted text-center text-base leading-6 mb-2">
          Esta versão do Trajetto não é mais aceita pelo servidor.
        </Text>

        <Text className="text-muted text-center text-base leading-6 mb-8">
          Os envios pendentes continuam salvos no aparelho e serão enviados
          depois da atualização.
        </Text>

        {step && (
          <View className="flex-row items-center gap-2 mb-6">
            {busy && <ActivityIndicator size="small" color={colors.primary} />}
            <Text className="text-sm text-ink-soft text-center flex-shrink">
              {STEP_TEXT[step]}
            </Text>
          </View>
        )}

        <Button onPress={() => void attempt()} loading={busy} fullWidth>
          Atualizar agora
        </Button>
      </View>
    </Modal>
  );
}

export { UpgradeRequiredScreen };
