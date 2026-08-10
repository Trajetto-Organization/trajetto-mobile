import {
  View,
  Text,
  KeyboardAvoidingView,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Controller } from "react-hook-form";
import { OtpInput } from "react-native-otp-entry";

import { Button, ConfirmModal } from "../../components/ui";
import { useTwoFactor } from "@/features/auth/hooks";

const TwoFactorScreen = () => {
  const {
    email,
    control,
    handleSubmit,
    errors,
    isSubmitting,
    isCodeComplete,
    watchedCode,
    resendTimer,
    showBackModal,
    onSubmit,
    handleResendCode,
    handleBackToLogin,
    confirmBackToLogin,
    cancelBackToLogin,
  } = useTwoFactor();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView behavior={"height"} className="flex-1">
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
