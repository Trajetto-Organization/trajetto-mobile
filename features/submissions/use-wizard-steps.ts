import { useCallback, useState } from "react";

interface UseWizardStepsInput<TStep extends string> {
  /** In order. The last one is the form itself. */
  steps: readonly TStep[];

  /**
   * True for a driver, who inherits branch, vehicle and fuel type from the
   * assignment and therefore starts — and stays — on the form.
   */
  isCollapsed: boolean;

  /** Whether the current step has what it needs to move on. */
  canLeaveStep: (step: TStep) => boolean;

  /** Called instead of going back when there is no earlier step. */
  onExit: () => void;

  /** Runs before any navigation, to drop work the driver is walking away from. */
  onNavigate?: () => void;
}

interface WizardSteps<TStep extends string> {
  currentStep: TStep;
  setCurrentStep: (step: TStep) => void;
  goToNextStep: () => void;
  goToPrevStep: () => void;
  canProceedToNext: () => boolean;
}

/**
 * Walks a submission through its selection steps.
 *
 * Both forms are the same wizard with a different middle: a checklist picks
 * branch and driver, a refuelling also picks a fuel type. Collapsing to a
 * single step for drivers is the rule that made both copies fiddly, so it lives
 * here once — a driver never sees a chooser, and "back" means leaving.
 */
function useWizardSteps<TStep extends string>({
  steps,
  isCollapsed,
  canLeaveStep,
  onExit,
  onNavigate,
}: UseWizardStepsInput<TStep>): WizardSteps<TStep> {
  const [currentStep, setCurrentStep] = useState<TStep>(
    isCollapsed ? steps[steps.length - 1] : steps[0],
  );

  const goToNextStep = useCallback(() => {
    if (isCollapsed) return;

    const index = steps.indexOf(currentStep);
    if (index < steps.length - 1) setCurrentStep(steps[index + 1]);
  }, [currentStep, isCollapsed, steps]);

  const goToPrevStep = useCallback(() => {
    onNavigate?.();

    if (isCollapsed) {
      onExit();
      return;
    }

    const index = steps.indexOf(currentStep);
    if (index > 0) {
      setCurrentStep(steps[index - 1]);
      return;
    }

    onExit();
  }, [currentStep, isCollapsed, onExit, onNavigate, steps]);

  // The last step is the form, which is submitted rather than advanced past.
  const canProceedToNext = useCallback(
    () =>
      currentStep !== steps[steps.length - 1] && canLeaveStep(currentStep),
    [canLeaveStep, currentStep, steps],
  );

  return {
    currentStep,
    setCurrentStep,
    goToNextStep,
    goToPrevStep,
    canProceedToNext,
  };
}

export { useWizardSteps };
export type { UseWizardStepsInput, WizardSteps };
