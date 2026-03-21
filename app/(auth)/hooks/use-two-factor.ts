import { useState, useEffect } from "react";

import { useRouter, useLocalSearchParams } from "expo-router";
import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import Toast from "react-native-toast-message";

import * as Haptics from "expo-haptics";

import { useAuthStore, useTwoFactorStore } from "@/store";
import { twoFactorSchema, TwoFactorFormData } from "@/schemas";

export const useTwoFactor = () => {
  const router = useRouter();

  const { email } = useLocalSearchParams<{ email: string }>();
  const { verifyTwoFactor, resendTwoFactorCode } = useAuthStore();

  const {
    resendTimer,
    setResendTimer,
    setLastResendTime,
    setEmail: setStoreEmail,
    calculateRemainingTime,
  } = useTwoFactorStore();

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showBackModal, setShowBackModal] = useState<boolean>(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<TwoFactorFormData>({
    resolver: zodResolver(twoFactorSchema),
    defaultValues: {
      code: "",
    },
  });

  const watchedCode = watch("code");
  const isCodeComplete = watchedCode.length === 6;

  // Initialize store with current email
  useEffect(() => {
    if (email) {
      setStoreEmail(email);
    }
  }, [email, setStoreEmail]);

  // Calculate remaining timer when mounting component
  useEffect(() => {
    const remaining = calculateRemainingTime();
    setResendTimer(remaining);
  }, [calculateRemainingTime, setResendTimer]);

  // Timer countdown effect
  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => {
        setResendTimer(resendTimer - 1);
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [resendTimer, setResendTimer]);

  const onSubmit = async (data: TwoFactorFormData) => {
    if (!email) {
      Toast.show({
        type: "error",
        text1: "Erro",
        text2: "E-mail não encontrado. Tente fazer login novamente.",
        position: "top",
        visibilityTime: 4000,
      });

      router.replace("/login");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await verifyTwoFactor(email, data.code);

      if (result.success) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        Toast.show({
          type: "success",
          text1: "Autenticação concluída!",
          text2: "Bem-vindo ao Trajetto",
          position: "top",
          visibilityTime: 3000,
        });

        router.replace("/vehicles");
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

        Toast.show({
          type: "error",
          text1: "Código inválido",
          text2: result.error || "Verifique o código e tente novamente",
          position: "top",
          visibilityTime: 4000,
        });
      }
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      Toast.show({
        type: "error",
        text1: "Erro de verificação",
        text2: "Ocorreu um erro inesperado. Tente novamente.",
        position: "top",
        visibilityTime: 4000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendCode = async () => {
    if (resendTimer > 0 || !email) return;

    try {
      const result = await resendTwoFactorCode(email);

      if (result.success) {
        const currentTime = Date.now();
        setLastResendTime(currentTime);

        setResendTimer(15);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        Toast.show({
          type: "success",
          text1: "Código reenviado",
          text2: "Verifique seu e-mail para o novo código",
          position: "top",
          visibilityTime: 3000,
        });
      } else {
        Toast.show({
          type: "error",
          text1: "Erro ao reenviar",
          text2: result.error || "Não foi possível reenviar o código",
          position: "top",
          visibilityTime: 4000,
        });
      }
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "Erro ao reenviar",
        text2: "Não foi possível reenviar o código. Tente novamente.",
        position: "top",
        visibilityTime: 4000,
      });
    }
  };

  const handleBackToLogin = () => {
    setShowBackModal(true);
  };

  const confirmBackToLogin = () => {
    setShowBackModal(false);
    router.replace("/login");
  };

  const cancelBackToLogin = () => {
    setShowBackModal(false);
  };

  return {
    email,
    control,
    handleSubmit,
    errors,
    isSubmitting,
    isCodeComplete,
    watchedCode,
    resendTimer,
    showBackModal,
    onSubmit,
    handleResendCode,
    handleBackToLogin,
    confirmBackToLogin,
    cancelBackToLogin,
  };
};
