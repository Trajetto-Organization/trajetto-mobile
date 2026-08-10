import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const SECURE_KEYS = {
  SESSION_V1: "session_v1",
  LEGACY_ACCESS_TOKEN: "tkey",
  LEGACY_REFRESH_TOKEN: "rkey",
} as const;

interface StoredTokenSession {
  version: 1;
  accessToken: string;
  refreshToken: string;
}

const ASYNC_KEYS = {
  USER_DATA: "user_data",
  APP_SETTINGS: "app_settings",
  AUTH_LOGGED_OUT: "auth_logged_out",
  AUTH_STORE: "auth-store",
  TWO_FACTOR_STORE: "two-factor-store",
} as const;

let tokenMutationEpoch = 0;
let tokenMutationQueue: Promise<void> = Promise.resolve();

let authMarkerEpoch = 0;
let authMarkerQueue: Promise<void> = Promise.resolve();

const enqueueTokenMutation = async <T>(
  operation: () => Promise<T>,
): Promise<T> => {
  const result = tokenMutationQueue.then(operation, operation);
  tokenMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
};

const createStaleSessionError = (): Error => {
  const error = new Error("Session changed while updating credentials");
  error.name = "AbortError";

  return error;
};

const parseStoredTokenSession = (
  value: string | null,
): StoredTokenSession | null => {
  if (!value) return null;
  try {
    const session = JSON.parse(value) as Partial<StoredTokenSession>;
    if (
      session.version === 1 &&
      typeof session.accessToken === "string" &&
      session.accessToken.length > 0 &&
      typeof session.refreshToken === "string" &&
      session.refreshToken.length > 0
    ) {
      return session as StoredTokenSession;
    }
  } catch {
    // An invalid envelope is ignored and removed during legacy migration.
  }

  return null;
};

const readOrMigrateTokenSession =
  async (): Promise<StoredTokenSession | null> => {
    const serializedSession = await secureStorage.getItem(
      SECURE_KEYS.SESSION_V1,
    );

    const session = parseStoredTokenSession(serializedSession);
    if (session) return session;

    const [legacyAccessToken, legacyRefreshToken] = await Promise.all([
      secureStorage.getItem(SECURE_KEYS.LEGACY_ACCESS_TOKEN),
      secureStorage.getItem(SECURE_KEYS.LEGACY_REFRESH_TOKEN),
    ]);

    if (!legacyAccessToken || !legacyRefreshToken) {
      await Promise.allSettled([
        secureStorage.removeItem(SECURE_KEYS.SESSION_V1),
        secureStorage.removeItem(SECURE_KEYS.LEGACY_ACCESS_TOKEN),
        secureStorage.removeItem(SECURE_KEYS.LEGACY_REFRESH_TOKEN),
      ]);

      return null;
    }

    const migratedSession: StoredTokenSession = {
      version: 1,
      accessToken: legacyAccessToken,
      refreshToken: legacyRefreshToken,
    };

    await secureStorage.setItem(
      SECURE_KEYS.SESSION_V1,
      JSON.stringify(migratedSession),
    );
    await Promise.allSettled([
      secureStorage.removeItem(SECURE_KEYS.LEGACY_ACCESS_TOKEN),
      secureStorage.removeItem(SECURE_KEYS.LEGACY_REFRESH_TOKEN),
    ]);

    return migratedSession;
  };

const enqueueAuthMarkerMutation = async <T>(
  operation: () => Promise<T>,
): Promise<T> => {
  const result = authMarkerQueue.then(operation, operation);
  authMarkerQueue = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
};

export const secureStorage = {
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  },

  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  },

  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  },

  async clear(): Promise<void> {
    const results = await Promise.allSettled(
      Object.values(SECURE_KEYS).map((key) => this.removeItem(key)),
    );
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    if (failed) {
      throw failed.reason;
    }
  },
};

export const asyncStorage = {
  async setItem(key: string, value: unknown): Promise<void> {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },

  async getItem<T>(key: string): Promise<T | null> {
    try {
      const jsonValue = await AsyncStorage.getItem(key);
      return jsonValue ? (JSON.parse(jsonValue) as T) : null;
    } catch {
      return null;
    }
  },

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  },

  async clear(): Promise<void> {
    await AsyncStorage.multiRemove([
      ASYNC_KEYS.USER_DATA,
      ASYNC_KEYS.APP_SETTINGS,
    ]);
  },
};

/**
 * A small, non-sensitive tombstone prevents a failed SecureStore deletion from
 * silently restoring a session after an explicit logout.
 */
export const authSessionStorage = {
  getEpoch(): number {
    return authMarkerEpoch;
  },

  invalidate(): number {
    authMarkerEpoch += 1;
    return authMarkerEpoch;
  },

  async markLoggedOut(expectedEpoch = authMarkerEpoch): Promise<void> {
    await enqueueAuthMarkerMutation(async () => {
      if (expectedEpoch !== authMarkerEpoch) throw createStaleSessionError();
      await AsyncStorage.setItem(ASYNC_KEYS.AUTH_LOGGED_OUT, "true");
    });
  },

  async markActive(expectedEpoch = authMarkerEpoch): Promise<void> {
    await enqueueAuthMarkerMutation(async () => {
      if (expectedEpoch !== authMarkerEpoch) throw createStaleSessionError();
      await AsyncStorage.removeItem(ASYNC_KEYS.AUTH_LOGGED_OUT);
    });
  },

  async wasLoggedOut(): Promise<boolean> {
    try {
      return (
        (await AsyncStorage.getItem(ASYNC_KEYS.AUTH_LOGGED_OUT)) === "true"
      );
    } catch {
      return false;
    }
  },

  async clearPersistedAuth(): Promise<void> {
    await AsyncStorage.multiRemove([
      ASYNC_KEYS.AUTH_STORE,
      ASYNC_KEYS.TWO_FACTOR_STORE,
    ]);
  },
};

export const tokenStorage = {
  getEpoch(): number {
    return tokenMutationEpoch;
  },

  invalidate(): number {
    tokenMutationEpoch += 1;
    return tokenMutationEpoch;
  },

  async setTokens(
    accessToken: string,
    refreshToken: string,
    expectedEpoch = tokenMutationEpoch,
  ): Promise<void> {
    return enqueueTokenMutation(async () => {
      if (expectedEpoch !== tokenMutationEpoch) {
        throw createStaleSessionError();
      }

      const session: StoredTokenSession = {
        version: 1,
        accessToken,
        refreshToken,
      };

      await secureStorage.setItem(
        SECURE_KEYS.SESSION_V1,
        JSON.stringify(session),
      );
      if (expectedEpoch !== tokenMutationEpoch) {
        throw createStaleSessionError();
      }

      // The envelope is authoritative. Removing legacy keys is best-effort and
      // may safely be retried by the next clear/migration.
      await Promise.allSettled([
        secureStorage.removeItem(SECURE_KEYS.LEGACY_ACCESS_TOKEN),
        secureStorage.removeItem(SECURE_KEYS.LEGACY_REFRESH_TOKEN),
      ]);
    });
  },

  async getAccessToken(): Promise<string | null> {
    return enqueueTokenMutation(
      async () => (await readOrMigrateTokenSession())?.accessToken ?? null,
    );
  },

  async getRefreshToken(): Promise<string | null> {
    return enqueueTokenMutation(
      async () => (await readOrMigrateTokenSession())?.refreshToken ?? null,
    );
  },

  async getTokens(): Promise<StoredTokenSession | null> {
    return enqueueTokenMutation(readOrMigrateTokenSession);
  },

  async clearTokens(): Promise<void> {
    await enqueueTokenMutation(() => secureStorage.clear());
  },
};

export { ASYNC_KEYS, SECURE_KEYS };
