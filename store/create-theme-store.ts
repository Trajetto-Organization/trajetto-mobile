import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

import {
  DEFAULT_THEME_PREFERENCE,
  parseThemePreference,
  type ThemePreference,
} from "../utils/theme-rules";

export interface ThemeState {
  preference: ThemePreference;

  /**
   * True once the saved choice is known (or known to be absent). The root
   * layout holds the native splash until then, so a driver who picked
   * "Escuro" on a light phone never sees a light first frame.
   */
  hydrated: boolean;

  setPreference: (preference: ThemePreference) => void;

  /**
   * Applies the saved choice again, even if it was already applied. For a
   * new Android Activity in the same JS runtime (back on the root screen
   * finishes it; opening the app again creates another): expo-system-ui
   * resets the native night mode to "follow system" in every Activity
   * onCreate, so a driver on "Escuro" in a light phone came back to a light
   * app with "Escuro" still selected. A no-op until hydrated.
   */
  reapply: () => void;
}

export const THEME_STORAGE_KEY = "theme-preference";

/**
 * The theme store, with its storage and its side effect passed in.
 *
 * Built by a factory so the tests drive the real zustand persist middleware
 * with an in-memory storage, while the app wires AsyncStorage and
 * NativeWind's colorScheme (store/theme-store.ts). `apply` runs once the
 * saved choice is read and again on every change, never twice for the same
 * value: each call reaches the native night mode.
 *
 * A device preference, not a session one: logout leaves it alone, like the
 * phone's own setting.
 */
export function createThemeStore(storage: StateStorage, apply: (preference: ThemePreference) => void) {
  let applied: ThemePreference | null = null;

  const applyOnce = (preference: ThemePreference) => {
    if (preference === applied) return;
    applied = preference;
    apply(preference);
  };

  const store = create<ThemeState>()(
    persist(
      (set, get) => ({
        preference: DEFAULT_THEME_PREFERENCE,
        hydrated: false,
        setPreference: (preference) => set({ preference: parseThemePreference(preference) }),
        reapply: () => {
          const { preference, hydrated } = get();
          if (!hydrated) return;
          applied = preference;
          apply(preference);
        },
      }),
      {
        name: THEME_STORAGE_KEY,
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: (state) => ({ preference: state.preference }),
        // Whatever is on disk passes through the parser: a value this build
        // does not know becomes the default, not a broken scheme.
        merge: (persisted, current) => ({
          ...current,
          preference: parseThemePreference((persisted as { preference?: unknown } | undefined)?.preference),
        }),
        // Called on success AND on a failed read (zustand skips its
        // onFinishHydration listeners on errors): the app must start either way.
        onRehydrateStorage: () => () => {
          queueMicrotask(markHydrated);
        },
      },
    ),
  );

  function markHydrated() {
    const { preference, hydrated } = store.getState();
    applyOnce(preference);
    if (!hydrated) store.setState({ hydrated: true });
  }

  store.subscribe((state, previous) => {
    if (state.hydrated && state.preference !== previous.preference) applyOnce(state.preference);
  });

  return store;
}
