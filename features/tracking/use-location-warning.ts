import { Linking } from "react-native";

import * as Location from "expo-location";

import {
  locationAccessOf,
  locationWarning,
  type LocationWarning,
} from "./location-access-rules";
import { useTrackingStatus } from "./tracking-status";

/**
 * The warning a screen shows while a route runs without location, and the
 * one gesture that fixes it (MOB-TRK-5).
 *
 * "Permitir" asks again in the app while Android still allows it; once the
 * driver chose "não perguntar novamente" only the system settings can, and
 * the tracking hook re-checks when the app comes back to the foreground.
 */
function useLocationWarning(): {
  warning: LocationWarning | null;
  resolve: () => Promise<void>;
} {
  const wanted = useTrackingStatus((state) => state.wanted);
  const access = useTrackingStatus((state) => state.access);

  const warning = locationWarning({ wanted, access });

  const resolve = async () => {
    if (!warning) return;

    if (warning.action === "settings") {
      await Linking.openSettings().catch(() => undefined);
      return;
    }

    const permission = await Location.requestForegroundPermissionsAsync().catch(
      () => null,
    );

    if (!permission) return;

    const { report, retry } = useTrackingStatus.getState();

    report({ access: locationAccessOf(permission) });

    if (permission.granted) retry();
  };

  return { warning, resolve };
}

export { useLocationWarning };
