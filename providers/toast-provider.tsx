import React, { useMemo } from "react";
import Toast, {
  BaseToast,
  type ToastConfig,
  type ToastConfigParams,
} from "react-native-toast-message";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColorSchemeName } from "../hooks/use-theme";
import {
  toastColors,
  type ColorScheme,
  type ToastKind,
} from "../utils/theme-rules";
import { TOAST_LAYOUT, toastTopOffset } from "../utils/toast-layout";

interface ToastProviderProps {
  children: React.ReactNode;
}

/**
 * One themed card per kind; the library's own are white whatever the scheme,
 * and sized for a single short line (utils/toast-layout.ts says why that
 * glued the title to the message). Every kind shares the same geometry.
 */
function themedToast(scheme: ColorScheme, kind: ToastKind) {
  const colors = toastColors(scheme, kind);

  const ThemedToast = (props: ToastConfigParams<unknown>) => (
    <BaseToast
      {...props}
      style={[
        TOAST_LAYOUT.card,
        {
          backgroundColor: colors.background,
          borderLeftColor: colors.accent,
          borderColor: colors.border,
          borderWidth: 1,
          borderLeftWidth: 5,
        },
      ]}
      contentContainerStyle={TOAST_LAYOUT.content}
      text1Style={[TOAST_LAYOUT.title, { color: colors.title }]}
      text2Style={[TOAST_LAYOUT.message, { color: colors.message }]}
      text1NumberOfLines={TOAST_LAYOUT.titleLines}
      text2NumberOfLines={TOAST_LAYOUT.messageLines}
    />
  );

  return ThemedToast;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const scheme = useColorSchemeName();
  const insets = useSafeAreaInsets();

  const config = useMemo<ToastConfig>(
    () => ({
      success: themedToast(scheme, "success"),
      error: themedToast(scheme, "error"),
      info: themedToast(scheme, "info"),
    }),
    [scheme],
  );

  return (
    <>
      {children}
      <Toast config={config} topOffset={toastTopOffset(insets.top)} />
    </>
  );
};
