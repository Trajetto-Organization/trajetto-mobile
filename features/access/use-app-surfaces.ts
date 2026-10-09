import { useMemo } from "react";

import { useAuthStore } from "@/store/auth-store";

import {
  appSurfaces,
  appTabs,
  homeState,
  type AppSurfaces,
  type AppTab,
  type HomeState,
} from "./app-surfaces";

/**
 * What this session may open, read from the same `/user/me` the session keeps
 * fresh (foreground, `entitlementsChanged`, `permissions_changed`): a change
 * of plan or profile redraws every consumer at once.
 */
function useAppSurfaces(): AppSurfaces & { home: HomeState; tabs: AppTab[] } {
  const user = useAuthStore((state) => state.user);

  return useMemo(
    () => ({
      ...appSurfaces(user),
      home: homeState(user),
      tabs: appTabs(user),
    }),
    [user],
  );
}

export { useAppSurfaces };
