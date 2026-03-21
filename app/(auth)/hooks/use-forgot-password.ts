import { useState } from "react";

import { useRouter } from "expo-router";
import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import Toast from "react-native-toast-message";

import * as Haptics from "expo-haptics";
import { forgotPasswordSchema, ForgotPasswordFormData } from "@/schemas";

import { ForgotPasswordResponse } from "@/types";
import { apiClient, ApiError } from "@/utils/api";

export const useForgotPassword = () => {
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [emailSent, setEmailSent] = useState<boolean>(false);

  const [emailMessage, setEmailMessage] = useState<string>("");
  const {
    control,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setIsSubmitting(true);

    try {
      const result = await apiClient.post<ForgotPasswordResponse>(
        "/user/forgot/password",
        { email: data.email },
        false,
      );

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      setEmailSent(true);
      setEmailMessage(result.message);

      Toast.show({
        type: "success",
        text1: "E-mail enviado!",
        text2: "Verifique sua caixa de entrada para redefinir sua senha.",
        position: "top",
        visibilityTime: 5000,
      });
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      let errorMessage = "Ocorreu um erro inesperado. Tente novamente.";

      if (error instanceof ApiError) {
        errorMessage = error.message;
      }

      Toast.show({
        type: "error",
        text1: "Erro ao enviar e-mail",
        text2: errorMessage,
        position: "top",
        visibilityTime: 4000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const navigateBack = () => {
    router.back();
  };

  const resendEmail = () => {
    const email = getValues("email");

    if (email) {
      onSubmit({ email });
    }
  };

  return {
    control,
    handleSubmit,
    errors,
    isSubmitting,
    emailSent,
    emailMessage,
    onSubmit,
    navigateBack,
    resendEmail,
  };
};
