import { useEffect } from "react";

import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";

import { useAuthStore } from "@/store/auth-store";

import { recoverDeliveryCapture } from "../delivery-draft";
import { screenOfTarget } from "../delivery-draft-rules";

/**
 * Takes the driver back to the proof or occurrence they were photographing
 * when Android killed the app (MOB-12).
 *
 * After such a kill the app starts from its home, not from the screen that
 * opened the camera. The photo is put into that screen's draft and the
 * driver is taken there, instead of having to remember which delivery it was
 * and find the photo gone.
 */
function useRecoverDeliveryCapture(): void {
  const router = useRouter();
  const userId = useAuthStore((state) => state.user?.id ?? null);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    void recoverDeliveryCapture(userId)
      .then((target) => {
        if (!target || cancelled) return;

        Toast.show({
          type: "info",
          text1: "Foto recuperada",
          text2:
            target.kind === "delivery-proof"
              ? "O aplicativo foi fechado durante a foto. Continue a comprovação."
              : "O aplicativo foi fechado durante a foto. Continue o registro da ocorrência.",
          position: "top",
          visibilityTime: 5000,
        });

        router.navigate({
          pathname: screenOfTarget(target),
          params: { id: target.deliveryId },
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [router, userId]);
}

export { useRecoverDeliveryCapture };
