import { create } from "zustand";

import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface TwoFactorState {
  resendTimer: number;
  lastResendTime: number | null;
  email: string | null;
  setResendTimer: (timer: number) => void;
  setLastResendTime: (time: number) => void;
  setEmail: (email: string) => void;
  calculateRemainingTime: () => number;
  resetTimer: () => void;
}

export const useTwoFactorStore = create<TwoFactorState>()(
  persist(
    (set, get) => ({
      resendTimer: 0,
      lastResendTime: null,
      email: null,

      setResendTimer: (timer: number) => {
        set({ resendTimer: timer });
      },

      setLastResendTime: (time: number) => {
        set({ lastResendTime: time });
      },

      setEmail: (email: string) => {
        set({ email });
      },

      calculateRemainingTime: () => {
        const state = get();
        if (!state.lastResendTime) return 0;

        const currentTime = Date.now();
        const elapsed = Math.floor((currentTime - state.lastResendTime) / 1000);

        const remaining = Math.max(0, 15 - elapsed); // 15 seconds
        return remaining;
      },

      resetTimer: () => {
        set({
          resendTimer: 0,
          lastResendTime: null,
        });
      },
    }),
    {
      name: "two-factor-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        lastResendTime: state.lastResendTime,
        email: state.email,
      }),
    }
  )
);
