import { useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import * as Haptics from "expo-haptics";

import { useRouter } from "expo-router";
import { useForm } from "react-hook-form";

import Toast from "react-native-toast-message";

import { loginSchema, type LoginFormData } from "@/schemas";
import { useAuthStore } from "@/store";

import { LIVE_VALIDATION_FORM_OPTIONS, firstInvalidField } from "@/features/forms/live-validation";
import { useFieldFocus } from "@/features/forms/use-field-focus";

/** Screen order: a failed submit focuses the first invalid one. */
const LOGIN_FIELDS = ["email", "password"] as const;

export const useLogin = () => {
  const router = useRouter();

  const login = useAuthStore((state) => state.login);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const focus = useFieldFocus();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    ...LIVE_VALIDATION_FORM_OPTIONS,
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

        // No imperative navigation here: `login()` flipped isAuthenticated and
        // the root Stack.Protected guard already routes to the protected area.
        // A replace on top of that navigated TWICE and remounted the screen —
        // the visible stutter/flash right as the success toast appeared.
        return;
      }

      if (result.requiresEmailVerification) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Toast.show({
          type: "info",
          text1: "Verificação de e-mail necessária",
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
          text1: "Verificação em duas etapas",
          text2: result.error || "Código enviado para seu e-mail",
          position: "top",
          visibilityTime: 3_000,
        });

        // navigate (not push): a resubmit while the toast shows must not
        // stack a second two-factor screen.
        router.navigate({
          pathname: "/two-factor",
          params: { email: result.email || data.email },
        });

        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: "error",
        text1: "Erro no login",
        text2: result.error || "Credenciais inválidas",
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

  // Everything is checked on the tap; the first invalid field takes focus.
  const submit = handleSubmit(onSubmit, (invalid) =>
    focus.focusField(firstInvalidField(LOGIN_FIELDS, invalid)),
  );

  return {
    control,
    errors,
    isSubmitting,
    submit,
    inputRef: focus.inputRef,
    // navigate (not push): double-tapping the link must not stack screens.
    navigateToForgotPassword: () => router.navigate("/forgot-password"),
  };
};
