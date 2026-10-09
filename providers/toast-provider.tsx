import React, { useMemo } from "react";
import Toast, { BaseToast, type ToastConfig, type ToastConfigParams } from "react-native-toast-message";

import { useColorSchemeName } from "../hooks/use-theme";
import { toastColors, type ColorScheme, type ToastKind } from "../utils/theme-rules";

interface ToastProviderProps {
  children: React.ReactNode;
}

/** One themed card per kind; the library's own are white whatever the scheme. */
function themedToast(scheme: ColorScheme, kind: ToastKind) {
  const colors = toastColors(scheme, kind);

  const ThemedToast = (props: ToastConfigParams<unknown>) => (
    <BaseToast
      {...props}
      style={{
        backgroundColor: colors.background,
        borderLeftColor: colors.accent,
        borderColor: colors.border,
        borderWidth: 1,
        borderLeftWidth: 5,
      }}
      text1Style={{ color: colors.title, fontSize: 15, fontWeight: "600" }}
      text2Style={{ color: colors.message, fontSize: 13 }}
      text2NumberOfLines={3}
    />
  );

  return ThemedToast;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const scheme = useColorSchemeName();

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
      <Toast config={config} />
    </>
  );
};
