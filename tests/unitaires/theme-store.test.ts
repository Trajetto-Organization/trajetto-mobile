import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";

import { THEME_STORAGE_KEY, createThemeStore } from "../../store/create-theme-store";
import type { ThemePreference } from "../../utils/theme-rules";

/** AsyncStorage's shape: async, string values. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));

  const storage: StateStorage = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };

  return { storage, data };
}

const saved = (preference: unknown) =>
  JSON.stringify({ state: { preference }, version: 1 });

/** Lets the async read and the deferred hydration mark settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(initial?: Record<string, string>, storageOverride?: StateStorage) {
  const memory = memoryStorage(initial);
  const applied: ThemePreference[] = [];
  const store = createThemeStore(storageOverride ?? memory.storage, (preference) => {
    applied.push(preference);
  });

  return { store, applied, data: memory.data };
}

describe("the theme store", () => {
  it("starts unhydrated and follows the system when nothing was saved", async () => {
    const { store, applied } = setup();

    expect(store.getState().hydrated).toBe(false);

    await settle();

    expect(store.getState()).toMatchObject({ preference: "system", hydrated: true });
    expect(applied).toEqual(["system"]);
  });

  it("restores the saved choice and applies it once it is read", async () => {
    const { store, applied } = setup({ [THEME_STORAGE_KEY]: saved("dark") });

    await settle();

    expect(store.getState()).toMatchObject({ preference: "dark", hydrated: true });
    expect(applied).toEqual(["dark"]);
  });

  it("turns a saved value it does not know into the default", async () => {
    const { store, applied } = setup({ [THEME_STORAGE_KEY]: saved("sepia") });

    await settle();

    expect(store.getState().preference).toBe("system");
    expect(applied).toEqual(["system"]);
  });

  it("still lets the app start when the storage read fails", async () => {
    const broken: StateStorage = {
      getItem: async () => {
        throw new Error("disk");
      },
      setItem: async () => undefined,
      removeItem: async () => undefined,
    };
    const { store, applied } = setup(undefined, broken);

    await settle();

    expect(store.getState()).toMatchObject({ preference: "system", hydrated: true });
    expect(applied).toEqual(["system"]);
  });

  it("applies and saves a new choice immediately, and never re-applies the same one", async () => {
    const { store, applied, data } = setup();
    await settle();

    store.getState().setPreference("dark");
    store.getState().setPreference("dark");
    store.getState().setPreference("light");
    await settle();

    expect(applied).toEqual(["system", "dark", "light"]);
    expect(JSON.parse(data.get(THEME_STORAGE_KEY)!)).toEqual({ state: { preference: "light" }, version: 1 });
  });

  it("saves only the preference, not the hydration flag", async () => {
    const { store, data } = setup();
    await settle();

    store.getState().setPreference("dark");
    await settle();

    expect(Object.keys(JSON.parse(data.get(THEME_STORAGE_KEY)!).state)).toEqual(["preference"]);
  });

  // Found on the emulator: back on the root screen finishes the Activity but
  // keeps the JS runtime; reopening creates a new Activity whose onCreate
  // (expo-system-ui) resets the native night mode to "follow system". The
  // once-only apply then never ran again and "Escuro" painted light.
  it("re-applies the saved choice on demand, even when it was already applied", async () => {
    const { store, applied } = setup({ [THEME_STORAGE_KEY]: saved("dark") });
    await settle();

    store.getState().reapply();
    store.getState().reapply();

    expect(applied).toEqual(["dark", "dark", "dark"]);
  });

  it("does not re-apply before the saved choice is read", async () => {
    const { store, applied } = setup({ [THEME_STORAGE_KEY]: saved("dark") });

    store.getState().reapply();
    expect(applied).toEqual([]);

    await settle();
    expect(applied).toEqual(["dark"]);
  });

  it("keeps the once-only rule for a choice made after a re-apply", async () => {
    const { store, applied } = setup({ [THEME_STORAGE_KEY]: saved("dark") });
    await settle();

    store.getState().reapply();
    store.getState().setPreference("dark");
    store.getState().setPreference("light");

    expect(applied).toEqual(["dark", "dark", "light"]);
  });
});
