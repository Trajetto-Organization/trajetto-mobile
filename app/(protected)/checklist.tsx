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
  ImagePickerBottomSheet,
  LoadingSpinner,
  UploadProgressBar,
} from "../../components/ui";

import { BranchSelection, DriverSelection } from "../../components/shared";
import { ChecklistForm } from "../../components/screens/checklist";

import { useChecklist } from "@/features/checklist/hooks/use-checklist";
import { PrecheckNotice } from "../../components/screens/ai-precheck/precheck-notice";

const ChecklistScreen = () => {
  const {
    user,
    isDriver,
    currentStep,
    stepData,
    setStepData,
    isSubmitting,
    uploadProgress,
    isDraftReady,
    hasDraft,
    showDiscardDraftModal,
    isDiscardingDraft,
    showImagePickerModal,
    setShowImagePickerModal,
    currentPhotoField,
    checklistImages,
    mileagePrecheckWarning,
    dismissMileagePrecheck,
    vehicleData,
    isLoadingVehicle,
    control,
    errors,
    photoErrors,
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
    getPhotoTitle,
    removeImage,
    requestDiscardDraft,
    cancelDiscardDraft,
    confirmDiscardDraft,
  } = useChecklist();

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
      <ProtectedRoute>
        <SafeAreaView className="flex-1 bg-background">
          <View className="flex-1 justify-center items-center px-6">
            <Text className="text-xl font-bold text-ink mb-4 text-center">
              Acesso Negado
            </Text>
            <Text className="text-muted text-center mb-8">
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

          {currentStep === "form" && (
            <ScrollView
              ref={fieldFocus.scrollRef}
              className="flex-1"
              contentContainerStyle={{ flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
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
                fieldFocus={fieldFocus}
                photoErrors={photoErrors}
                isDriver={isDriver}
                mileagePrecheckNotice={
                  mileagePrecheckWarning ? (
                    <PrecheckNotice
                      message={mileagePrecheckWarning}
                      disabled={isSubmitting}
                      actions={[
                        // The warning goes; a new km is checked again.
                        { label: "Corrigir km", onPress: dismissMileagePrecheck },
                        {
                          label: "Tirar outra",
                          onPress: () => showImagePicker("current_mileage"),
                        },
                        { label: "Enviar assim", onPress: dismissMileagePrecheck },
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
                testID="checklist-submit"
                onPress={() => void submitForm()}
                loading={isSubmitting}
                // Enabled while idle (decision 16.701): the tap shows what is missing.
                disabled={!canSubmit}
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

        <DiscardDraftModal
          visible={showDiscardDraftModal}
          message="Os dados preenchidos e as fotos salvas neste dispositivo serão removidos. Esta ação não pode ser desfeita."
          isLoading={isDiscardingDraft}
          onClose={cancelDiscardDraft}
          onConfirm={() => void confirmDiscardDraft()}
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default ChecklistScreen;
