import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SECURE_KEYS = {
  ACCESS_TOKEN: "tkey",
  REFRESH_TOKEN: "rkey",
} as const;

const ASYNC_KEYS = {
  USER_DATA: "user_data",
  APP_SETTINGS: "app_settings",
} as const;

// Secure Storage (for sensitive data like tokens)
export const secureStorage = {
  async setItem(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      throw error;
    }
  },

  async getItem(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      return null;
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {}
  },

  async clear(): Promise<void> {
    try {
      const keys = Object.values(SECURE_KEYS);
      await Promise.all(keys.map((key) => this.removeItem(key)));
    } catch (error) {}
  },
};

// Regular Storage (for non-sensitive data)
export const asyncStorage = {
  async setItem(key: string, value: any): Promise<void> {
    try {
      const jsonValue = JSON.stringify(value);
      await AsyncStorage.setItem(key, jsonValue);
    } catch (error) {
      throw error;
    }
  },

  async getItem<T>(key: string): Promise<T | null> {
    try {
      const jsonValue = await AsyncStorage.getItem(key);
      return jsonValue ? JSON.parse(jsonValue) : null;
    } catch (error) {
      return null;
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {}
  },

  async clear(): Promise<void> {
    try {
      const keys = Object.values(ASYNC_KEYS);
      await Promise.all(keys.map((key) => this.removeItem(key)));
    } catch (error) {}
  },
};

// Token-specific functions
export const tokenStorage = {
  async setTokens(accessToken: string, refreshToken: string): Promise<void> {
    await Promise.all([
      secureStorage.setItem(SECURE_KEYS.ACCESS_TOKEN, accessToken),
      secureStorage.setItem(SECURE_KEYS.REFRESH_TOKEN, refreshToken),
    ]);
  },

  async getAccessToken(): Promise<string | null> {
    return await secureStorage.getItem(SECURE_KEYS.ACCESS_TOKEN);
  },

  async getRefreshToken(): Promise<string | null> {
    return await secureStorage.getItem(SECURE_KEYS.REFRESH_TOKEN);
  },

  async clearTokens(): Promise<void> {
    await Promise.all([
      secureStorage.removeItem(SECURE_KEYS.ACCESS_TOKEN),
      secureStorage.removeItem(SECURE_KEYS.REFRESH_TOKEN),
    ]);
  },
};

export { SECURE_KEYS, ASYNC_KEYS };
