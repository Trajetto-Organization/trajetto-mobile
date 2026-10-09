import {
  View,
  Text,
  TouchableOpacity,
} from "react-native";

import { KeyboardAvoidingView } from "../../components/ui/keyboard-avoiding-view";
import { SafeAreaView } from "react-native-safe-area-context";

import Ionicons from "@expo/vector-icons/Ionicons";
import { Controller } from "react-hook-form";

import { Button, Input } from "../../components/ui";
import { useThemeColors } from "@/hooks/use-theme";
import { useForgotPassword } from "@/features/auth/hooks";

const ForgotPasswordScreen = () => {
  const {
    control,
    errors,
    isSubmitting,
    emailSent,
    emailMessage,
    submit,
    emailInputRef,
    navigateBack,
    resendEmail,
  } = useForgotPassword();
  const colors = useThemeColors();

  if (emailSent) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 px-6 justify-center">
          <View className="items-center">
            {/* Success Icon */}
            <View
              className="w-20 h-20 bg-success-soft
              rounded-full items-center justify-center mb-6"
            >
              <Text className="text-success text-3xl">✓</Text>
            </View>

            <Text
              className="text-2xl font-bold
              text-ink mb-3 text-center"
            >
              E-mail enviado!
            </Text>

            <Text
              className="text-muted
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
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <View className="flex-1 px-6 justify-center">
          {/* Header */}
          <View className="mb-10">
            <TouchableOpacity
              onPress={navigateBack}
              className="mb-8 flex-row items-center
              bg-subtle border border-border rounded-full px-4 py-3 self-start"
              hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            >
              <Ionicons name="arrow-back" size={20} color={colors.inkSoft} />
              <Text
                className="text-ink-soft
                text-base font-medium ml-2"
              >
                Voltar
              </Text>
            </TouchableOpacity>

            <Text
              className="text-3xl font-bold
              text-ink mb-3"
            >
              Esqueci minha senha
            </Text>
            <Text className="text-muted text-base">
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
                  inputRef={emailInputRef}
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
              onPress={submit}
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
