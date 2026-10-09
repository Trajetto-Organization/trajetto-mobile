import { useCallback, useEffect, useRef, useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import * as Haptics from "expo-haptics";

import { useLocalSearchParams, useRouter } from "expo-router";
import { useForm } from "react-hook-form";

import { AppState, type AppStateStatus } from "react-native";
import Toast from "react-native-toast-message";

import { twoFactorSchema, type TwoFactorFormData } from "@/schemas";
import { useAuthStore, useTwoFactorStore } from "@/store";

import { LIVE_VALIDATION_FORM_OPTIONS } from "@/features/forms/live-validation";
import { useFieldFocus } from "@/features/forms/use-field-focus";
import type { OtpInputRef } from "react-native-otp-entry";

export const useTwoFactor = () => {
  const router = useRouter();

  const { email: routeEmail } = useLocalSearchParams<{ email?: string }>();
  const storedEmail = useTwoFactorStore((state) => state.email);

  const email = routeEmail || storedEmail || undefined;
  const verifyTwoFactor = useAuthStore((state) => state.verifyTwoFactor);

  const resendTwoFactorCode = useAuthStore(
    (state) => state.resendTwoFactorCode,
  );

  const resendTimer = useTwoFactorStore((state) => state.resendTimer);
  const setResendTimer = useTwoFactorStore((state) => state.setResendTimer);

  const setLastResendTime = useTwoFactorStore(
    (state) => state.setLastResendTime,
  );
  const setStoreEmail = useTwoFactorStore((state) => state.setEmail);
  const calculateRemainingTime = useTwoFactorStore(
    (state) => state.calculateRemainingTime,
  );

  const resetTimer = useTwoFactorStore((state) => state.resetTimer);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showBackModal, setShowBackModal] = useState<boolean>(false);

  const resendInFlight = useRef(false);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const focus = useFieldFocus();

  const {
    control,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<TwoFactorFormData>({
    resolver: zodResolver(twoFactorSchema),
    defaultValues: { code: "" },
    ...LIVE_VALIDATION_FORM_OPTIONS,
  });

  const watchedCode = watch("code");
  const isCodeComplete = watchedCode.length === 6;

  const syncRemainingTime = useCallback(() => {
    setResendTimer(calculateRemainingTime());
  }, [calculateRemainingTime, setResendTimer]);

  useEffect(() => {
    if (email) setStoreEmail(email);
  }, [email, setStoreEmail]);

  useEffect(syncRemainingTime, [syncRemainingTime]);

  useEffect(() => {
    if (resendTimer <= 0) return;

    const timer = setTimeout(syncRemainingTime, 1_000);
    return () => clearTimeout(timer);
  }, [resendTimer, syncRemainingTime]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const becameActive =
        appState.current !== "active" && nextState === "active";
      appState.current = nextState;

      if (becameActive) syncRemainingTime();
    });

    return () => subscription.remove();
  }, [syncRemainingTime]);

  const onSubmit = async (data: TwoFactorFormData) => {
    if (!email) {
      Toast.show({
        type: "error",
        text1: "Erro",
        text2: "E-mail não encontrado. Faça login novamente.",
        position: "top",
        visibilityTime: 4_000,
      });

      router.replace("/login");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await verifyTwoFactor(email, data.code);
      if (result.success) {
        resetTimer();
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Toast.show({
          type: "success",
          text1: "Autenticação concluída!",
          text2: "Bem-vindo ao Trajetto",
          position: "top",
          visibilityTime: 3_000,
        });

        // Declarative: the Stack.Protected guard flip already navigates to
        // the protected area — replacing again caused a remount flash.
        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: "error",
        text1: "Código inválido",
        text2: result.error || "Verifique o código e tente novamente",
        position: "top",
        visibilityTime: 4_000,
      });
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: "error",
        text1: "Erro de verificação",
        text2: "Ocorreu um erro inesperado. Tente novamente.",
        position: "top",
        visibilityTime: 4_000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendCode = async () => {
    if (resendTimer > 0 || !email || resendInFlight.current) return;
    resendInFlight.current = true;
    try {
      const result = await resendTwoFactorCode(email);
      if (result.success) {
        setLastResendTime(Date.now());
        setResendTimer(15);

        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Toast.show({
          type: "success",
          text1: "Código reenviado",
          text2: "Verifique seu e-mail para o novo código",
          position: "top",
          visibilityTime: 3_000,
        });
      } else {
        Toast.show({
          type: "error",
          text1: "Erro ao reenviar",
          text2: result.error || "Não foi possível reenviar o código",
          position: "top",
          visibilityTime: 4_000,
        });
      }
    } catch {
      Toast.show({
        type: "error",
        text1: "Erro ao reenviar",
        text2: "Não foi possível reenviar o código. Tente novamente.",
        position: "top",
        visibilityTime: 4_000,
      });
    } finally {
      resendInFlight.current = false;
    }
  };

  // The button is enabled with any number of digits (decision 16.701): the
  // tap says what is missing and puts the cursor back in the code.
  const submit = handleSubmit(onSubmit, () => focus.focusField("code"));

  return {
    email,
    control,
    errors,
    isSubmitting,
    isCodeComplete,
    resendTimer,
    showBackModal,
    submit,
    codeInputRef: focus.inputRef<OtpInputRef>("code"),
    handleResendCode,
    handleBackToLogin: () => setShowBackModal(true),
    confirmBackToLogin: () => {
      setShowBackModal(false);
      router.replace("/login");
    },
    cancelBackToLogin: () => setShowBackModal(false),
  };
};
