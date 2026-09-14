import Toast from "react-native-toast-message";

import { useConnectionStore } from "@/store/connection-store";

/**
 * With the app offline, React Query does not fail a refetch — it pauses it,
 * and the returned promise stays pending until connectivity returns. Awaited
 * naively from a pull-to-refresh handler, that is a spinner that never stops.
 */
const REFRESH_TIMEOUT_MS = 15_000;

/**
 * Android's RefreshControl misses a `refreshing` true→false toggle that lands
 * in the same frame (the offline path resolves instantly) and leaves the
 * native spinner stuck spinning forever. Every exit of this helper waits out
 * this minimum, so the native animation always gets a full beat before the
 * screen flips `refreshing` back to false.
 */
const MIN_VISIBLE_SPIN_MS = 500;

/**
 * Runs a pull-to-refresh refetch that is guaranteed to end.
 *
 * With no radio it does not even try — the driver gets told the data on
 * screen is the saved copy, instantly, instead of watching a spinner spin at
 * nothing. With a connection that looks fine but is not, the timeout puts a
 * ceiling on the wait and says so. A refetch that merely errors resolves
 * normally and is reported by the screen's own error state, not here.
 */
async function refreshWithConnectionFeedback(
  refetch: () => Promise<unknown>,
): Promise<void> {
  const startedAt = Date.now();

  const settleSpinner = async () => {
    const remaining = MIN_VISIBLE_SPIN_MS - (Date.now() - startedAt);

    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  };

  if (useConnectionStore.getState().isDeviceOffline) {
    Toast.show({
      type: "info",
      text1: "Sem conexão",
      text2: "Mostrando os dados salvos no aparelho.",
    });

    await settleSpinner();
    return;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timedOut = await Promise.race([
    refetch().then(() => false),
    new Promise<true>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(true), REFRESH_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timeoutHandle));

  await settleSpinner();

  if (timedOut) {
    Toast.show({
      type: "error",
      text1: "Tempo limite excedido",
      text2: "Não foi possível atualizar agora. Tente novamente.",
    });
  }
}

export { refreshWithConnectionFeedback };
