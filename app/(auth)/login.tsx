import {
  View,
  Text,
  KeyboardAvoidingView,
  TouchableOpacity,
  Image,
} from "react-native";

import TrajettoLogo from "../../assets/images/trajetto-logo.png";
import { SafeAreaView } from "react-native-safe-area-context";

import { Controller } from "react-hook-form";

import { Button, Input } from "../../components/ui";
import { useLogin } from "@/features/auth/hooks";

const LoginScreen = () => {
  const {
    control,
    handleSubmit,
    errors,
    isSubmitting,
    onSubmit,
    navigateToForgotPassword,
  } = useLogin();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView behavior={"height"} className="flex-1">
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
