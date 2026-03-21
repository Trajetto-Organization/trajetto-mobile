import { View, Text, ScrollView, KeyboardAvoidingView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProtectedRoute } from "../../components/protected-route";
import { Button, ImagePickerBottomSheet } from "../../components/ui";

import { BranchSelection, DriverSelection } from "../../components/shared";
import { ChecklistForm } from "../../components/screens/checklist";

import { useChecklist } from "./hooks/use-checklist";

const ChecklistScreen = () => {
  const {
    user,
    isDriver,
    currentStep,
    stepData,
    setStepData,
    isSubmitting,
    showImagePickerModal,
    setShowImagePickerModal,
    currentPhotoField,
    checklistImages,
    vehicleData,
    isLoadingVehicle,
    control,
    handleSubmit,
    errors,
    setValue,
    trigger,
    permissions,
    stepInfo,
    onSubmit,
    goToNextStep,
    goToPrevStep,
    canProceedToNext,
    areAllRequiredFieldsFilled,
    takePhoto,
    pickFromGallery,
    showImagePicker,
    getPhotoTitle,
    removeImage,
  } = useChecklist();

  if (!permissions.canWrite) {
    return (
      <ProtectedRoute>
        <SafeAreaView className="flex-1 bg-gray-50">
          <View className="flex-1 justify-center items-center px-6">
            <Text className="text-xl font-bold text-gray-900 mb-4 text-center">
              Acesso Negado
            </Text>
            <Text className="text-gray-600 text-center mb-8">
              Você não tem permissão para criar checklists veiculares.
            </Text>
            <Button onPress={() => goToPrevStep()}>Voltar</Button>
          </View>
        </SafeAreaView>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <SafeAreaView className="flex-1 bg-gray-50">
        {/* Step Indicator */}
        <View className="px-6 py-4 bg-white border-b border-gray-200">
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-1">
              <Text className="text-lg font-bold text-gray-900">
                {stepInfo.title}
              </Text>
              <Text className="text-sm text-gray-600">
                {stepInfo.description}
              </Text>
            </View>
            <View className="bg-primary-100 rounded-full px-3 py-1">
              <Text className="text-xs font-medium text-primary-800">
                {stepInfo.step} de {stepInfo.total}
              </Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View className="w-full bg-gray-200 rounded-full h-2">
            <View
              className="bg-primary-500 h-2 rounded-full transition-all"
              style={{ width: `${(stepInfo.step / stepInfo.total) * 100}%` }}
            />
          </View>
        </View>

        {/* Step Content */}
        <KeyboardAvoidingView behavior={"height"} className="flex-1">
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {currentStep === "branch" && (
              <BranchSelection
                businessId={user?.businessId || user?.selectedBusiness || ""}
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
                businessId={user?.businessId || user?.selectedBusiness || ""}
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

            {currentStep === "form" && (
              <ChecklistForm
                control={control}
                errors={errors}
                checklistImages={checklistImages}
                onImagePicker={showImagePicker}
                onRemoveImage={removeImage}
                stepData={stepData}
                vehicleData={vehicleData}
                isLoadingVehicle={isLoadingVehicle}
                trigger={trigger}
                isDriver={isDriver}
              />
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Navigation Buttons */}
        <View className="px-6 py-4 bg-white border-t border-gray-200">
          <View className="flex-row gap-4">
            <Button
              onPress={goToPrevStep}
              variant="outline"
              className="flex-1"
              disabled={isSubmitting}
            >
              {currentStep === "branch" ? "Cancelar" : "Voltar"}
            </Button>

            {currentStep === "form" ? (
              <Button
                onPress={handleSubmit(onSubmit)}
                loading={isSubmitting}
                disabled={
                  isSubmitting ||
                  !areAllRequiredFieldsFilled ||
                  Object.keys(errors).length > 0
                }
                className="flex-1"
              >
                {isSubmitting ? "Criando..." : "Criar Checklist"}
              </Button>
            ) : (
              <Button
                onPress={goToNextStep}
                disabled={!canProceedToNext()}
                className="flex-1"
              >
                Prosseguir
              </Button>
            )}
          </View>
        </View>

        {/* Image Picker Bottom Sheet */}
        <ImagePickerBottomSheet
          visible={showImagePickerModal}
          onClose={() => setShowImagePickerModal(false)}
          onTakePhoto={takePhoto}
          onPickFromGallery={pickFromGallery}
          title={getPhotoTitle(currentPhotoField)}
          description="Como deseja adicionar a foto?"
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default ChecklistScreen;
