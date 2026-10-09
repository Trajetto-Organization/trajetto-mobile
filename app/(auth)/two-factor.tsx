import {
  View,
  Text,
  TouchableOpacity,
} from "react-native";

import { KeyboardAvoidingView } from "../../components/ui/keyboard-avoiding-view";
import { SafeAreaView } from "react-native-safe-area-context";

import { Controller } from "react-hook-form";
import { OtpInput } from "react-native-otp-entry";

import { Button, ConfirmModal } from "../../components/ui";
import { useThemeColors } from "@/hooks/use-theme";
import { useTwoFactor } from "@/features/auth/hooks";
import { twoFactorCellColors } from "@/features/auth/two-factor-cells";

const TwoFactorScreen = () => {
  const {
    email,
    control,
    errors,
    isSubmitting,
    isCodeComplete,
    resendTimer,
    showBackModal,
    submit,
    codeInputRef,
    handleResendCode,
    handleBackToLogin,
    confirmBackToLogin,
    cancelBackToLogin,
  } = useTwoFactor();
  const colors = useThemeColors();
  const cells = twoFactorCellColors(colors, Boolean(errors.code));

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <View className="flex-1 px-6 justify-center">
          {/* Header */}
          <View className="items-center mb-8">
            <View
              className="w-24 h-24 bg-primary
              rounded-full items-center justify-center mb-6"
            >
              <Text
                className="text-primary-foreground
                text-3xl font-bold"
              >
                🔐
              </Text>
            </View>
            <Text
              className="text-3xl font-bold
              text-ink mb-2 text-center"
            >
              Autenticação em Duas Etapas
            </Text>
            <Text
              className="text-muted
              text-center text-base mb-2"
            >
              Digite o código de 6 dígitos enviado para:
            </Text>
            <Text
              className="text-primary
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
              render={({ field: { onChange, onBlur } }) => (
                <View className="items-center">
                  <OtpInput
                    ref={codeInputRef}
                    numberOfDigits={6}
                    focusColor={colors.primary}
                    focusStickBlinkingDuration={500}
                    onTextChange={onChange}
                    onFilled={(text) => {
                      onChange(text);
                    }}
                    onBlur={onBlur}
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
                        ...cells.base,
                        borderWidth: 2,
                        borderRadius: 8,
                        width: 48,
                        height: 56,
                      },
                      focusedPinCodeContainerStyle: cells.focused,
                      filledPinCodeContainerStyle: cells.filled,
                      pinCodeTextStyle: {
                        fontSize: 18,
                        fontWeight: "600",
                        color: colors.ink,
                      },
                      focusStickStyle: {
                        backgroundColor: colors.primary,
                        width: 2,
                        height: 24,
                      },
                    }}
                  />
                  {errors.code?.message && (
                    <Text
                      style={{
                        color: colors.destructive,
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
                      ? "text-muted"
                      : "text-primary"
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
              onPress={submit}
              testID="two-factor-submit"
              loading={isSubmitting}
              fullWidth
              className={isCodeComplete ? "bg-success" : ""}
            >
              {isSubmitting ? "Verificando..." : "Verificar código"}
            </Button>

            <TouchableOpacity
              onPress={handleBackToLogin}
              disabled={isSubmitting}
              className="items-center py-3"
            >
              <Text
                className="text-muted
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
