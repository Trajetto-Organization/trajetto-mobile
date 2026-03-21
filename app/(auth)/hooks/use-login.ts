import { useState } from "react";

import { useRouter } from "expo-router";
import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import Toast from "react-native-toast-message";

import * as Haptics from "expo-haptics";

import { useAuthStore } from "@/store";
import { loginSchema, LoginFormData } from "@/schemas";

export const useLogin = () => {
  const router = useRouter();
  const { login } = useAuthStore();

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
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
          visibilityTime: 3000,
        });

        router.replace("/vehicles");
      } else if (result.requiresEmailVerification) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        Toast.show({
          type: "info",
          text1: "Verificação de e-mail necessária",
          text2: result.error || "Verifique seu e-mail para continuar",
          position: "top",
          visibilityTime: 5000,
        });
      } else if (result.requiresTwoFactor) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        Toast.show({
          type: "info",
          text1: "Verificação de dois fatores",
          text2: result.error || "Código enviado para seu e-mail",
          position: "top",
          visibilityTime: 3000,
        });

        router.push({
          pathname: "/two-factor",
          params: { email: result.email || data.email },
        });
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

        Toast.show({
          type: "error",
          text1: "Erro no login",
          text2: result.error || "Credenciais inválidas",
          position: "top",
          visibilityTime: 4000,
        });
      }
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      Toast.show({
        type: "error",
        text1: "Erro no login",
        text2: "Ocorreu um erro inesperado. Tente novamente.",
        position: "top",
        visibilityTime: 4000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const navigateToForgotPassword = () => {
    router.push("/forgot-password");
  };

  return {
    control,
    handleSubmit,
    errors,
    isSubmitting,
    onSubmit,
    navigateToForgotPassword,
  };
};
