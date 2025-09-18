import React, { useState } from "react";
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Image,
} from "react-native";

import TrajettoLogo from "../../assets/images/trajetto-logo.png";
import { SafeAreaView } from "react-native-safe-area-context";

import { useRouter } from "expo-router";
import { useForm, Controller } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import Toast from "react-native-toast-message";

import * as Haptics from "expo-haptics";

import { useAuthStore } from "../../store";
import { loginSchema, LoginFormData } from "../../schemas";

import { Button, Input } from "../../components/ui";

const LoginScreen = () => {
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
        // Success haptic feedback
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        Toast.show({
          type: "success",
          text1: "Login realizado com sucesso!",
          text2: "Bem-vindo ao Trajetto",
          position: "top",
          visibilityTime: 3000,
        });

        // Navigation will be handled automatically by the auth state change
        router.replace("/vehicles");
      } else if (result.requiresTwoFactor) {
        // Navigate to two-factor screen
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
        // Error haptic feedback
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

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <View className="flex-1 px-6 justify-center">
          {/* Logo and Title */}
          <View className="items-center mb-8">
            <View
              className="w-24 h-24 bg-primary-600
              rounded-full items-center justify-center mb-6 overflow-hidden"
            >
              <Image
                source={TrajettoLogo}
                style={{
                  width: 60,
                  height: 60,
                }}
                resizeMode="contain"
                alt="trajetto-logo"
              />
            </View>
            <Text
              className="text-3xl font-bold 
              text-gray-900 mb-2"
            >
              Trajetto
            </Text>
            <Text
              className="text-gray-600 
              text-center text-base"
            >
              Gestão de frota inteligente
            </Text>
          </View>

          {/* Login Form */}
          <View className="gap-6">
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

            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Senha"
                  placeholder="Digite sua senha"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.password?.message}
                  secureTextEntry
                  showPasswordToggle
                  editable={!isSubmitting}
                />
              )}
            />
          </View>

          <View className="gap-2">
            <Button
              onPress={handleSubmit(onSubmit)}
              loading={isSubmitting}
              fullWidth
              className="mt-8"
            >
              {isSubmitting ? "Entrando..." : "Entrar"}
            </Button>

            {/* Forgot Password Link */}
            <TouchableOpacity
              onPress={navigateToForgotPassword}
              disabled={isSubmitting}
              className="items-center py-3"
            >
              <Text
                className="text-primary-600 
                font-medium"
              >
                Esqueci minha senha
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default LoginScreen;
