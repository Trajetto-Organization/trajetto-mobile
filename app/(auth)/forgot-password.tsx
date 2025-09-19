import { useState } from "react";
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";

import { forgotPasswordSchema, ForgotPasswordFormData } from "../../schemas";
import { Button, Input } from "../../components/ui";

import { ForgotPasswordResponse } from "../../types";
import apiClient, { ApiError } from "../../utils/api";

const ForgotPasswordScreen = () => {
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
        false // No auth required
      );

      // Success haptic feedback
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

  if (emailSent) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 px-6 justify-center">
          <View className="items-center">
            {/* Success Icon */}
            <View
              className="w-20 h-20 bg-success-100 
              rounded-full items-center justify-center mb-6"
            >
              <Text className="text-success-600 text-3xl">✓</Text>
            </View>

            <Text
              className="text-2xl font-bold 
              text-gray-900 mb-3 text-center"
            >
              E-mail enviado!
            </Text>

            <Text
              className="text-gray-600 
              text-center text-base mb-8"
            >
              {emailMessage}
            </Text>

            <Button
              onPress={resendEmail}
              variant="outline"
              loading={isSubmitting}
              fullWidth
              className="mb-4"
            >
              Reenviar e-mail
            </Button>

            <Button onPress={navigateBack} variant="ghost" fullWidth>
              Voltar ao login
            </Button>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <View className="flex-1 px-6 justify-center">
          {/* Header */}
          <View className="mb-10">
            <TouchableOpacity
              onPress={navigateBack}
              className="mb-8 flex-row items-center 
              bg-gray-100 rounded-full px-4 py-3 self-start"
              hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            >
              <Ionicons name="arrow-back" size={20} color="#374151" />
              <Text
                className="text-gray-700 
                text-base font-medium ml-2"
              >
                Voltar
              </Text>
            </TouchableOpacity>

            <Text
              className="text-3xl font-bold 
              text-gray-900 mb-3"
            >
              Esqueci minha senha
            </Text>
            <Text className="text-gray-600 text-base">
              Digite seu e-mail abaixo e enviaremos instruções para redefinir
              sua senha.
            </Text>
          </View>

          {/* Form */}
          <View>
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="E-mail"
                  placeholder="Digite seu e-mail"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.email?.message}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!isSubmitting}
                />
              )}
            />

            <Button
              onPress={handleSubmit(onSubmit)}
              loading={isSubmitting}
              fullWidth
              className="mt-8"
            >
              {isSubmitting ? "Enviando..." : "Recuperar minha senha"}
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default ForgotPasswordScreen;
