import { useEffect } from "react";
import NetInfo from "@react-native-community/netinfo";

import { useConnectionStore } from "@/store/connection-store";

/**
 * Keeps the device half of the connection state in sync with NetInfo.
 *
 * `isInternetReachable` rather than `isConnected` alone: being attached to a
 * wifi network says nothing about that network reaching anything, and a captive
 * portal in a hotel or a truck stop is exactly the case where the two disagree.
 * It is null while the check is still running, which is treated as connected —
 * flashing an offline banner during startup would be wrong far more often than
 * it would be right.
 */
function useNetworkStatus(): void {
  const setDeviceOffline = useConnectionStore(
    (state) => state.setDeviceOffline,
  );

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const isOffline =
        state.isConnected === false || state.isInternetReachable === false;

      setDeviceOffline(isOffline);
    });

    return unsubscribe;
  }, [setDeviceOffline]);
}

export { useNetworkStatus };
