import {
  View,
  Text,
  KeyboardAvoidingView,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import Ionicons from "@expo/vector-icons/Ionicons";
import { Controller } from "react-hook-form";

import { Button, Input } from "../../components/ui";
import { useForgotPassword } from "@/features/auth/hooks";

const ForgotPasswordScreen = () => {
  const {
    control,
    handleSubmit,
    errors,
    isSubmitting,
    emailSent,
    emailMessage,
    onSubmit,
    navigateBack,
    resendEmail,
  } = useForgotPassword();

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
      <KeyboardAvoidingView behavior={"height"} className="flex-1">
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
