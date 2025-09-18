import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";

import { useForm, Controller } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import Toast from "react-native-toast-message";

import * as Haptics from "expo-haptics";
import { OtpInput } from "react-native-otp-entry";

import { useAuthStore, useTwoFactorStore } from "../../store";
import { twoFactorSchema, TwoFactorFormData } from "../../schemas";

import { Button, ConfirmModal } from "../../components/ui";

const TwoFactorScreen = () => {
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
        // Success haptic feedback
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        Toast.show({
          type: "success",
          text1: "Autenticação concluída!",
          text2: "Bem-vindo ao Trajetto",
          position: "top",
          visibilityTime: 3000,
        });

        // Navigation will be handled automatically by the auth state change
        router.replace("/vehicles");
      } else {
        // Error haptic feedback
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

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <View className="flex-1 px-6 justify-center">
          {/* Header */}
          <View className="items-center mb-8">
            <View
              className="w-24 h-24 bg-primary-600
              rounded-full items-center justify-center mb-6"
            >
              <Text
                className="text-white
                text-3xl font-bold"
              >
                🔐
              </Text>
            </View>
            <Text
              className="text-3xl font-bold
              text-gray-900 mb-2 text-center"
            >
              Autenticação em Duas Etapas
            </Text>
            <Text
              className="text-gray-600
              text-center text-base mb-2"
            >
              Digite o código de 6 dígitos enviado para:
            </Text>
            <Text
              className="text-primary-600
              font-semibold text-base"
            >
              {email}
            </Text>
          </View>

          {/* Two Factor Form */}
          <View className="gap-6">
            <Controller
              control={control}
              name="code"
              render={({ field: { onChange, value } }) => (
                <View className="items-center">
                  <OtpInput
                    numberOfDigits={6}
                    focusColor="#3b82f6"
                    focusStickBlinkingDuration={500}
                    onTextChange={onChange}
                    onFilled={(text) => {
                      onChange(text);
                    }}
                    disabled={isSubmitting}
                    autoFocus
                    theme={{
                      containerStyle: {
                        marginVertical: 20,
                      },
                      inputsContainerStyle: {
                        gap: 8,
                      },
                      pinCodeContainerStyle: {
                        backgroundColor: errors.code ? "#fef2f2" : "#ffffff",
                        borderColor: errors.code ? "#ef4444" : "#d1d5db",
                        borderWidth: 2,
                        borderRadius: 8,
                        width: 48,
                        height: 56,
                      },
                      focusedPinCodeContainerStyle: {
                        borderColor: "#3b82f6",
                        backgroundColor: "#eff6ff",
                      },
                      filledPinCodeContainerStyle: {
                        borderColor: "#6b7280",
                        backgroundColor: "#ffffff",
                      },
                      pinCodeTextStyle: {
                        fontSize: 18,
                        fontWeight: "600",
                        color: "#111827",
                      },
                      focusStickStyle: {
                        backgroundColor: "#3b82f6",
                        width: 2,
                        height: 24,
                      },
                    }}
                  />
                  {errors.code?.message && (
                    <Text
                      style={{
                        color: "#dc2626",
                        fontSize: 14,
                        marginTop: 8,
                        textAlign: "center",
                      }}
                    >
                      {errors.code.message}
                    </Text>
                  )}
                </View>
              )}
            />

            {/* Resend Code Button */}
            <View className="items-center">
              <TouchableOpacity
                onPress={handleResendCode}
                disabled={resendTimer > 0 || isSubmitting}
                className="py-3"
              >
                <Text
                  className={`text-base font-medium ${
                    resendTimer > 0 || isSubmitting
                      ? "text-gray-400"
                      : "text-primary-600"
                  }`}
                >
                  {resendTimer > 0
                    ? `Reenviar código em ${resendTimer}s`
                    : "Reenviar código"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Actions */}
          <View className="gap-3 mt-8">
            <Button
              onPress={handleSubmit(onSubmit)}
              loading={isSubmitting}
              disabled={!isCodeComplete}
              fullWidth
              className={isCodeComplete ? "bg-green-600" : ""}
            >
              {isSubmitting
                ? "Verificando..."
                : isCodeComplete
                ? "✓ Verificar Código"
                : `Código ${watchedCode.length}/6`}
            </Button>

            <TouchableOpacity
              onPress={handleBackToLogin}
              disabled={isSubmitting}
              className="items-center py-3"
            >
              <Text
                className="text-gray-600
                font-medium"
              >
                Voltar ao login
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Confirmation modal to return to login */}
      <ConfirmModal
        visible={showBackModal}
        title="Voltar ao login"
        message={`Tem certeza que deseja voltar para a tela de login? 
        Você precisará inserir suas credenciais novamente.`}
        confirmText="Voltar"
        cancelText="Cancelar"
        confirmVariant="danger"
        onConfirm={confirmBackToLogin}
        onCancel={cancelBackToLogin}
      />
    </SafeAreaView>
  );
};

export default TwoFactorScreen;
