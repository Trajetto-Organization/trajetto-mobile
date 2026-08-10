import { useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import * as Haptics from "expo-haptics";

import { useRouter } from "expo-router";
import { useForm } from "react-hook-form";

import Toast from "react-native-toast-message";

import { loginSchema, type LoginFormData } from "@/schemas";
import { useAuthStore } from "@/store";

export const useLogin = () => {
  const router = useRouter();

  const login = useAuthStore((state) => state.login);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    try {
      const result = await login(data.email, data.password);

      if (result.success) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Toast.show({
          type: "success",
          text1: "Login realizado com sucesso!",
          text2: "Bem-vindo ao Trajetto",
          position: "top",
          visibilityTime: 3_000,
        });

        router.replace("/vehicles");
        return;
      }

      if (result.requiresEmailVerification) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Toast.show({
          type: "info",
          text1: "Verificacao de e-mail necessaria",
          text2: result.error || "Verifique seu e-mail para continuar",
          position: "top",
          visibilityTime: 5_000,
        });

        return;
      }

      if (result.requiresTwoFactor) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Toast.show({
          type: "info",
          text1: "Verificacao de dois fatores",
          text2: result.error || "Codigo enviado para seu e-mail",
          position: "top",
          visibilityTime: 3_000,
        });

        router.push({
          pathname: "/two-factor",
          params: { email: result.email || data.email },
        });

        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: "error",
        text1: "Erro no login",
        text2: result.error || "Credenciais invalidas",
        position: "top",
        visibilityTime: 4_000,
      });
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: "error",
        text1: "Erro no login",
        text2: "Ocorreu um erro inesperado. Tente novamente.",
        position: "top",
        visibilityTime: 4_000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    control,
    handleSubmit,
    errors,
    isSubmitting,
    onSubmit,
    navigateToForgotPassword: () => router.push("/forgot-password"),
  };
};
