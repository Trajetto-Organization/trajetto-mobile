import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
} from "react-native";

import { KeyboardAvoidingView } from "../../components/ui/keyboard-avoiding-view";

import { SafeAreaView } from "react-native-safe-area-context";
import { ProtectedRoute } from "../../components/protected-route";
import { StatusBanners } from "../../components/status-banners";

import {
  Button,
  DiscardDraftModal,
  LogoutModal,
  ImagePickerBottomSheet,
  LoadingSpinner,
  UploadProgressBar,
} from "../../components/ui";
import {
  BranchSelection,
  DriverSelection,
  FuelTypeSelection,
} from "../../components/shared";

import { FuelForm } from "../../components/screens/fuel";
import { useFuel } from "@/features/fuel/hooks/use-fuel";
import { PrecheckNotice } from "../../components/screens/ai-precheck/precheck-notice";

const FuelScreen = () => {
  const {
    user,
    currentStep,
    stepData,
    setStepData,
    isSubmitting,
    uploadProgress,
    showLogoutModal,
    setShowLogoutModal,
    showImagePickerModal,
    setShowImagePickerModal,
    calculatedTotal,
    setCalculatedTotal,
    odometerImage,
    removeOdometerImage,
    odometerPrecheckWarning,
    dismissOdometerPrecheck,
    isDraftReady,
    hasDraft,
    showDiscardDraftModal,
    isDiscardingDraft,
    isLocationLoading,
    vehicleData,
    isLoadingVehicle,
    control,
    errors,
    odometerPhotoError,
    fieldFocus,
    setValue,
    trigger,
    permissions,
    stepInfo,
    submitForm,
    canSubmit,
    goToNextStep,
    goToPrevStep,
    canProceedToNext,
    takePhoto,
    pickFromGallery,
    showImagePicker,
    requestDiscardDraft,
    cancelDiscardDraft,
    confirmDiscardDraft,
    confirmLogout,
    handleLocationChange,
    handleLocationLoadingChange,
    isDriver,
  } = useFuel();

  if (!isDraftReady) {
    return (
      <ProtectedRoute>
        <SafeAreaView className="flex-1 bg-background">
          <LoadingSpinner text="Restaurando rascunho..." />
        </SafeAreaView>
      </ProtectedRoute>
    );
  }

  if (!permissions.canWrite) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 justify-center items-center px-6">
          <Text className="text-xl font-bold text-ink mb-4 text-center">
            Acesso negado
          </Text>
          <Text className="text-muted text-center mb-8">
            Você não tem permissão para criar abastecimentos.
          </Text>
          <Button onPress={goToPrevStep} variant="primary">
            Voltar
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <ProtectedRoute>
      <SafeAreaView className="flex-1 bg-background">
        {/* Step Indicator */}
        <View className="px-6 py-4 bg-surface border-b border-border">
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-1">
              <Text className="text-lg font-bold text-ink">
                {stepInfo.title}
              </Text>
              <Text className="text-sm text-muted">
                {stepInfo.description}
              </Text>
              {currentStep === "form" && hasDraft ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={requestDiscardDraft}
                  className="self-start mt-2"
                >
                  <Text className="text-sm font-medium text-destructive">
                    Descartar rascunho
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View className="bg-primary-soft rounded-full px-3 py-1">
              <Text className="text-xs font-medium text-primary">
                {stepInfo.step} de {stepInfo.total}
              </Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View className="w-full bg-border rounded-full h-2">
            <View
              className="bg-primary h-2 rounded-full transition-all"
              style={{ width: `${(stepInfo.step / stepInfo.total) * 100}%` }}
            />
          </View>
        </View>

        <StatusBanners />

        {/* Step Content */}
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          {currentStep === "branch" && (
            <BranchSelection
              businessId={user?.businessId || ""}
              selectedBranchId={stepData.branchId}
              onSelectBranch={(branch) => {
                setStepData((prev) => ({
                  ...prev,
                  branchId: branch.id,
                  branchName: branch.corporate_reason,
                }));
                setValue("branchId", branch.id);
              }}
            />
          )}

          {currentStep === "driver" && (
            <DriverSelection
              businessId={user?.businessId || ""}
              selectedDriverId={stepData.driverId}
              onSelectDriver={(driver) => {
                setStepData((prev) => ({
                  ...prev,
                  driverId: driver.id,
                  driverName: driver.name,
                  driverCnh: driver.cnh,
                }));
                setValue("driverId", driver.id);
              }}
            />
          )}

          {currentStep === "fuelType" && (
            <FuelTypeSelection
              businessId={user?.businessId || ""}
              selectedFuelTypeId={stepData.fuelTypeId}
              onSelectFuelType={(fuelType) => {
                setStepData((prev) => ({
                  ...prev,
                  fuelTypeId: fuelType.id,
                  fuelTypeName: fuelType.description,
                }));
                setValue("fuelTypeId", fuelType.id);
              }}
            />
          )}

          {currentStep === "form" && (
            <ScrollView
              ref={fieldFocus.scrollRef}
              className="flex-1"
              contentContainerStyle={{ flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <FuelForm
                control={control}
                errors={errors}
                odometerImage={odometerImage}
                onImagePicker={showImagePicker}
                onRemoveImage={removeOdometerImage}
                stepData={stepData}
                calculatedTotal={calculatedTotal}
                onTotalChange={setCalculatedTotal}
                vehicleData={vehicleData}
                isLoadingVehicle={isLoadingVehicle}
                trigger={trigger}
                fieldFocus={fieldFocus}
                odometerPhotoError={odometerPhotoError}
                isDriver={isDriver}
                onLocationChange={handleLocationChange}
                onLocationLoadingChange={handleLocationLoadingChange}
                locationError={
                  errors.latitude?.message || errors.longitude?.message
                }
                precheckNotice={
                  odometerPrecheckWarning ? (
                    <PrecheckNotice
                      message={odometerPrecheckWarning}
                      disabled={isSubmitting}
                      actions={[
                        // The warning goes; a new km is checked again.
                        { label: "Corrigir km", onPress: dismissOdometerPrecheck },
                        { label: "Tirar outra", onPress: showImagePicker },
                        { label: "Enviar assim", onPress: dismissOdometerPrecheck },
                      ]}
                    />
                  ) : null
                }
              />
            </ScrollView>
          )}
        </KeyboardAvoidingView>

        {/* Navigation Buttons */}
        <View className="px-6 py-4 bg-surface border-t border-border">
          <UploadProgressBar progress={uploadProgress} />

          <View className="flex-row gap-4">
            <Button onPress={goToPrevStep} variant="outline" className="flex-1">
              {currentStep === "branch" ? "Cancelar" : "Voltar"}
            </Button>

            {currentStep === "form" ? (
              <Button
                onPress={() => void submitForm()}
                testID="fuel-submit"
                loading={isSubmitting}
                // Enabled while idle (decision 16.701): the tap shows what is missing.
                disabled={!canSubmit}
                className="flex-1"
              >
                {isSubmitting ? "Criando..." : "Abastecer"}
              </Button>
            ) : (
              <Button
                onPress={goToNextStep}
                testID="fuel-next"
                disabled={!canProceedToNext()}
                className="flex-1"
              >
                Prosseguir
              </Button>
            )}
          </View>
        </View>

        {/* Logout Modal */}
        <LogoutModal
          visible={showLogoutModal}
          onClose={() => setShowLogoutModal(false)}
          onConfirm={confirmLogout}
        />

        <DiscardDraftModal
          visible={showDiscardDraftModal}
          message="Os dados preenchidos e a foto salva neste dispositivo serão removidos. Esta ação não pode ser desfeita."
          isLoading={isDiscardingDraft}
          onClose={cancelDiscardDraft}
          onConfirm={() => void confirmDiscardDraft()}
        />

        {/* Image Picker Bottom Sheet */}
        <ImagePickerBottomSheet
          visible={showImagePickerModal}
          onClose={() => setShowImagePickerModal(false)}
          onTakePhoto={takePhoto}
          onPickFromGallery={pickFromGallery}
          title="Foto do Odômetro"
          description="Como deseja adicionar a foto?"
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default FuelScreen;
