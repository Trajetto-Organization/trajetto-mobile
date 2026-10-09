import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The hooks both submission forms (checklist and refuelling) are composed of
 * (MOB-30): the wizard, the discard dialog and the draft autosave. Each holds
 * a rule a driver feels — "back" leaves for a driver, a double tap does not
 * delete twice, typing is saved once per burst and never after the hand-off —
 * so they run here for real, on a minimal hook runtime (support/hook-runtime).
 */

vi.mock("react", async () => (await import("./support/hook-runtime")).reactShim);

const toast = vi.fn();
vi.mock("react-native-toast-message", () => ({
  default: { show: (...args: unknown[]) => toast(...args) },
}));

type AppStateListener = (state: string) => void;
const appStateListeners = new Set<AppStateListener>();
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, listener: AppStateListener) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    },
  },
}));

// The submission id lives in AsyncStorage; its own tests cover it.
vi.mock("@/features/submissions/submission-id", () => ({
  getOrCreateSubmissionId: async (key: string) => `id-of-${key}`,
}));

const { renderHook } = await import("./support/hook-runtime");
const { useWizardSteps } = await import("@/features/submissions/use-wizard-steps");
const { useDiscardConfirmation } = await import("@/features/submissions/use-discard-confirmation");
const { useDraftAutosave } = await import("@/features/submissions/use-draft-autosave");

const STEPS = ["branch", "driver", "form"] as const;
type Step = (typeof STEPS)[number];

beforeEach(() => {
  toast.mockClear();
  appStateListeners.clear();
});

describe("useWizardSteps", () => {
  const wizard = (overrides: Partial<Parameters<typeof useWizardSteps<Step>>[0]> = {}) => {
    const onExit = vi.fn();
    const onNavigate = vi.fn();
    const hook = renderHook(() =>
      useWizardSteps<Step>({
        steps: STEPS,
        isCollapsed: false,
        canLeaveStep: () => true,
        onExit,
        onNavigate,
        ...overrides,
      }),
    );
    return { hook, onExit, onNavigate };
  };

  it("a driver starts on the form, cannot advance and 'back' leaves", () => {
    const { hook, onExit, onNavigate } = wizard({ isCollapsed: true });

    expect(hook.result.current.currentStep).toBe("form");
    expect(hook.result.current.canProceedToNext()).toBe(false);

    hook.result.current.goToNextStep();
    expect(hook.result.current.currentStep).toBe("form");

    hook.result.current.goToPrevStep();
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(hook.result.current.currentStep).toBe("form");
  });

  it("an office user walks the steps in order and leaves from the first", () => {
    const { hook, onExit } = wizard();

    expect(hook.result.current.currentStep).toBe("branch");
    hook.result.current.goToNextStep();
    expect(hook.result.current.currentStep).toBe("driver");
    hook.result.current.goToNextStep();
    expect(hook.result.current.currentStep).toBe("form");

    // The form is submitted, not advanced past.
    hook.result.current.goToNextStep();
    expect(hook.result.current.currentStep).toBe("form");
    expect(hook.result.current.canProceedToNext()).toBe(false);

    hook.result.current.goToPrevStep();
    hook.result.current.goToPrevStep();
    expect(hook.result.current.currentStep).toBe("branch");
    expect(onExit).not.toHaveBeenCalled();

    hook.result.current.goToPrevStep();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("a step without what it needs does not let the user move on", () => {
    const { hook } = wizard({ canLeaveStep: (step) => step !== "branch" });

    expect(hook.result.current.canProceedToNext()).toBe(false);
    hook.result.current.setCurrentStep("driver");
    expect(hook.result.current.canProceedToNext()).toBe(true);
  });
});

describe("useDiscardConfirmation", () => {
  it("opens and closes on request and cancel", () => {
    const hook = renderHook(() => useDiscardConfirmation({ onDiscard: async () => undefined }));

    hook.result.current.request();
    expect(hook.result.current.isVisible).toBe(true);
    hook.result.current.cancel();
    expect(hook.result.current.isVisible).toBe(false);
  });

  it("a double tap deletes once, and cancel waits for the deletion", async () => {
    let finish!: () => void;
    const onDiscard = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const hook = renderHook(() => useDiscardConfirmation({ onDiscard }));

    hook.result.current.request();
    const first = hook.result.current.confirm();
    const second = hook.result.current.confirm();

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(hook.result.current.isDiscarding).toBe(true);

    // Dismissing now would leave the driver on a form being emptied.
    hook.result.current.cancel();
    expect(hook.result.current.isVisible).toBe(true);

    finish();
    await Promise.all([first, second]);

    expect(hook.result.current.isVisible).toBe(false);
    expect(hook.result.current.isDiscarding).toBe(false);
  });

  it("a failed deletion keeps the dialog, says so and can be retried", async () => {
    const onDiscard = vi.fn().mockRejectedValueOnce(new Error("disk")).mockResolvedValueOnce(undefined);
    const hook = renderHook(() => useDiscardConfirmation({ onDiscard }));

    hook.result.current.request();
    await hook.result.current.confirm();

    expect(hook.result.current.isVisible).toBe(true);
    expect(hook.result.current.isDiscarding).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", text1: "Não foi possível descartar o rascunho" }),
    );

    await hook.result.current.confirm();
    expect(onDiscard).toHaveBeenCalledTimes(2);
    expect(hook.result.current.isVisible).toBe(false);
  });
});

describe("useDraftAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  type Draft = { version: number; text: string; submissionId: string };

  const autosave = (initial: { text: string; isEnabled?: boolean; storageKey?: string }) => {
    const save = vi.fn(async (_key: string, _draft: Draft) => undefined);
    const onSchedule = vi.fn();
    const hook = renderHook(
      (props: { text: string; isEnabled?: boolean; storageKey?: string }) =>
        useDraftAutosave<Draft>({
          storageKey: props.storageKey ?? "checklist:user-1",
          isEnabled: props.isEnabled ?? true,
          buildDraft: (submissionId) => ({ version: 1, text: props.text, submissionId }),
          save,
          onSchedule,
        }),
      initial,
    );
    return { hook, save, onSchedule };
  };

  // The write awaits the submission id before saving.
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(0);
  };

  it("a burst of typing is one save, of the form as it is when written", async () => {
    const { hook, save, onSchedule } = autosave({ text: "a" });

    hook.result.current.schedule();
    hook.rerender({ text: "ab" });
    hook.result.current.schedule();
    hook.rerender({ text: "abc" });
    hook.result.current.schedule();

    expect(onSchedule).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("checklist:user-1", {
      version: 1,
      text: "abc",
      submissionId: "id-of-checklist:user-1",
    });
  });

  it("saves nothing before the stored draft is read back", async () => {
    const { hook, save, onSchedule } = autosave({ text: "a", isEnabled: false });

    hook.result.current.schedule();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onSchedule).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("after the hand-off a pending save is dropped and no new one starts, until resumed", async () => {
    const { hook, save } = autosave({ text: "a" });

    hook.result.current.schedule();
    hook.result.current.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();

    hook.result.current.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();

    hook.result.current.resume();
    hook.result.current.schedule();
    await vi.advanceTimersByTimeAsync(500);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("leaving the app writes the pending save at once", async () => {
    const { hook, save } = autosave({ text: "km 50200" });

    hook.result.current.schedule();
    for (const listener of appStateListeners) listener("background");
    await settle();

    expect(save).toHaveBeenCalledTimes(1);

    // Nothing pending is left to write a second time.
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("coming back to the app or flushing with nothing pending writes nothing", async () => {
    const { hook, save } = autosave({ text: "a" });

    for (const listener of appStateListeners) listener("active");
    hook.result.current.flush();
    await settle();

    expect(save).not.toHaveBeenCalled();
  });

  it("closing the screen writes the pending save and stops listening", async () => {
    const { hook, save } = autosave({ text: "a" });

    hook.result.current.schedule();
    expect(appStateListeners.size).toBe(1);

    hook.unmount();
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(appStateListeners.size).toBe(0);
  });
});
