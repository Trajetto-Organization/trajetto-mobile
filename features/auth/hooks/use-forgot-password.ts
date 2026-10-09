import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";

import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { useForm } from "react-hook-form";
import Toast from "react-native-toast-message";

import { forgotPasswordSchema, type ForgotPasswordFormData } from "@/schemas";

import type { ForgotPasswordResponse } from "@/types";
import { ApiError, apiClient } from "@/utils/api";

import { LIVE_VALIDATION_FORM_OPTIONS } from "@/features/forms/live-validation";
import { useFieldFocus } from "@/features/forms/use-field-focus";

export const useForgotPassword = () => {
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [emailSent, setEmailSent] = useState<boolean>(false);

  const [emailMessage, setEmailMessage] = useState<string>("");
  const focus = useFieldFocus();

  const {
    control,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
    ...LIVE_VALIDATION_FORM_OPTIONS,
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
        visibilityTime: 5_000,
      });
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: "error",
        text1: "Erro ao enviar e-mail",
        text2:
          error instanceof ApiError
            ? error.message
            : "Ocorreu um erro inesperado. Tente novamente.",
        position: "top",
        visibilityTime: 4_000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // One field: a failed submit focuses it.
  const submit = handleSubmit(onSubmit, () => focus.focusField("email"));

  return {
    control,
    errors,
    isSubmitting,
    emailSent,
    emailMessage,
    submit,
    emailInputRef: focus.inputRef("email"),
    navigateBack: () => {
      if (router.canGoBack()) router.back();
      else router.replace("/login");
    },
    resendEmail: () => {
      const email = getValues("email").trim();
      if (email && !isSubmitting) void onSubmit({ email });
    },
  };
};
