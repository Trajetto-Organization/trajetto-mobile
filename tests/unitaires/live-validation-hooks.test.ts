import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two hooks every validated form on the phone is composed of (decision
 * 16.700): which messages show (`useLiveFields`) and how a failed submit
 * brings the first invalid field into view (`useFieldFocus`). They run for
 * real on the minimal hook runtime (support/hook-runtime); the ScrollView,
 * the field's View and the TextInput are plain objects with the methods
 * React Native gives them.
 */

vi.mock("react", async () => (await import("./support/hook-runtime")).reactShim);

// The native AccessibilityInfo is the boundary: what reaches it is the proof.
const screenReader = vi.hoisted(() => ({
  moveScreenReaderTo: vi.fn(),
  announceToScreenReader: vi.fn(),
}));
vi.mock("@/features/forms/screen-reader", () => screenReader);

const { renderHook } = await import("./support/hook-runtime");
const { useLiveFields, useLiveFieldState, useLiveFieldMessages } = await import(
  "@/features/forms/use-live-fields"
);
const { useFieldFocus, FOCUS_DELAY_MS, SCROLL_MARGIN } = await import("@/features/forms/use-field-focus");

describe("useLiveFields", () => {
  const ORDER = ["note", "photo"] as const;

  const render = (issues: Record<string, string | null>) =>
    renderHook((props: { issues: Record<string, string | null> }) => useLiveFields({ issues: props.issues, order: ORDER }), {
      issues,
    });

  it("says nothing while the first try is typed, then follows the value after the blur", () => {
    const hook = render({ note: "Use no máximo 120 caracteres.", photo: null });

    expect(hook.result.current.errorOf("note")).toBeUndefined();

    hook.result.current.touch("note");
    expect(hook.result.current.errorOf("note")).toBe("Use no máximo 120 caracteres.");

    // The keystroke that fixes it takes the message away; breaking it brings it back.
    hook.rerender({ issues: { note: null, photo: null } });
    expect(hook.result.current.errorOf("note")).toBeUndefined();
    hook.rerender({ issues: { note: "Use no máximo 120 caracteres.", photo: null } });
    expect(hook.result.current.errorOf("note")).toBe("Use no máximo 120 caracteres.");
  });

  it("a submit shows every message and names the first invalid field in screen order", () => {
    const hook = render({ note: null, photo: "Adicione a foto." });

    expect(hook.result.current.visible).toEqual({});

    let first: string | null = null;
    first = hook.result.current.attempt();

    expect(first).toBe("photo");
    expect(hook.result.current.attempted).toBe(true);
    expect(hook.result.current.errorOf("photo")).toBe("Adicione a foto.");

    hook.rerender({ issues: { note: null, photo: null } });
    expect(hook.result.current.attempt()).toBeNull();
  });

  it("another form on the screen starts with nothing visited", () => {
    const hook = render({ note: "Erro", photo: null });

    hook.result.current.attempt();
    hook.result.current.reset();
    expect(hook.result.current.visible).toEqual({});

    hook.result.current.reset({ attempted: true });
    expect(hook.result.current.errorOf("note")).toBe("Erro");
  });

  it("visiting a field twice renders once", () => {
    const hook = render({ note: "Erro", photo: null });

    hook.result.current.touch("note");
    const renders = hook.renders();
    hook.result.current.touch("note");

    expect(hook.renders()).toBe(renders);
  });
});

describe("useLiveFieldState + useLiveFieldMessages (state declared above its issues)", () => {
  // The delivery proof and the occurrence keep the state with their other
  // state and derive the messages far below, after the form is known.
  const useScreen = (props: { issues: Record<string, string | null> }) => {
    const state = useLiveFieldState();
    return useLiveFieldMessages(state, { issues: props.issues, order: ["@type", "@received_by"] });
  };

  it("a review prefill marks the attempt before any message exists, then every message shows", () => {
    const hook = renderHook(useScreen, { issues: { "@type": null, "@received_by": null } as Record<string, string | null> });

    hook.result.current.setAttempted(true);
    hook.rerender({ issues: { "@type": null, "@received_by": "Informe quem recebeu." } });

    expect(hook.result.current.errorOf("@received_by")).toBe("Informe quem recebeu.");
  });

  it("touch, attempt and reset behave exactly like useLiveFields", () => {
    const hook = renderHook(useScreen, { issues: { "@type": "Escolha o tipo.", "@received_by": "Informe quem recebeu." } });

    hook.result.current.touch("@received_by");
    expect(hook.result.current.visible).toEqual({ "@received_by": "Informe quem recebeu." });

    expect(hook.result.current.attempt()).toBe("@type");
    expect(Object.keys(hook.result.current.visible)).toEqual(["@type", "@received_by"]);

    // Another type is another form.
    hook.result.current.reset();
    expect(hook.result.current.visible).toEqual({});
    expect(hook.result.current.attempted).toBe(false);
  });
});

describe("useFieldFocus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    screenReader.moveScreenReaderTo.mockClear();
    screenReader.announceToScreenReader.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const content = { node: "scroll-content" };

  const scrollView = () => ({
    scrollTo: vi.fn(),
    getInnerViewRef: () => content,
  });

  /** A field View laid out `y` below the top of the scroll content. */
  const fieldAt = (y: number) => ({
    measureLayout: vi.fn((relativeTo: unknown, onSuccess: (x: number, y: number, w: number, h: number) => void) => {
      expect(relativeTo).toBe(content);
      onSuccess(0, y, 300, 48);
    }),
  });

  it("scrolls the field's label into view, then focuses its input", () => {
    const hook = renderHook(() => useFieldFocus());
    const scroll = scrollView();
    const input = { focus: vi.fn() };

    (hook.result.current.scrollRef as { current: unknown }).current = scroll;
    hook.result.current.anchorRef("liters")(fieldAt(640));
    hook.result.current.inputRef("liters").current = input as never;

    hook.result.current.focusField("liters");

    expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 640 - SCROLL_MARGIN, animated: true });

    // Focus waits for the scroll, or Android's own focus scroll fights it.
    expect(input.focus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FOCUS_DELAY_MS);
    expect(input.focus).toHaveBeenCalledTimes(1);
  });

  it("a photo area or a select only scrolls, never opens anything", () => {
    const hook = renderHook(() => useFieldFocus());
    const scroll = scrollView();

    (hook.result.current.scrollRef as { current: unknown }).current = scroll;
    hook.result.current.anchorRef("photo")(fieldAt(10));

    hook.result.current.focusField("photo");
    vi.runAllTimers();

    // Near the top: never a negative offset.
    expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  it("a field with no keyboard gets TalkBack's focus and its message announced after the scroll", () => {
    const hook = renderHook(() => useFieldFocus());
    const scroll = scrollView();
    const area = fieldAt(900);

    (hook.result.current.scrollRef as { current: unknown }).current = scroll;
    hook.result.current.anchorRef("odometer_photo")(area);

    hook.result.current.focusField("odometer_photo", "Adicione a foto do odômetro.");
    expect(screenReader.moveScreenReaderTo).not.toHaveBeenCalled();

    vi.advanceTimersByTime(FOCUS_DELAY_MS);
    expect(screenReader.moveScreenReaderTo).toHaveBeenCalledWith(area);
    expect(screenReader.announceToScreenReader).toHaveBeenCalledWith("Adicione a foto do odômetro.");
  });

  it("a text field takes the keyboard focus, not the screen reader's, and still announces", () => {
    const hook = renderHook(() => useFieldFocus());
    const input = { focus: vi.fn() };

    hook.result.current.anchorRef("note")(fieldAt(0));
    hook.result.current.inputRef("note").current = input as never;
    hook.result.current.focusField("note", "Use no máximo 120 caracteres.");
    vi.advanceTimersByTime(FOCUS_DELAY_MS);

    expect(input.focus).toHaveBeenCalledTimes(1);
    expect(screenReader.moveScreenReaderTo).not.toHaveBeenCalled();
    expect(screenReader.announceToScreenReader).toHaveBeenCalledWith("Use no máximo 120 caracteres.");
  });

  it("without a scroll view (a modal) the input is focused alone", () => {
    const hook = renderHook(() => useFieldFocus());
    const input = { focus: vi.fn() };

    hook.result.current.inputRef("note").current = input as never;
    hook.result.current.focusField("note");
    vi.advanceTimersByTime(FOCUS_DELAY_MS);

    expect(input.focus).toHaveBeenCalledTimes(1);
  });

  it("keeps the same refs across renders and forgets an unmounted field", () => {
    const hook = renderHook(() => useFieldFocus());
    const scroll = scrollView();
    (hook.result.current.scrollRef as { current: unknown }).current = scroll;

    const anchor = hook.result.current.anchorRef("km");
    const input = hook.result.current.inputRef("km");
    hook.rerender();

    expect(hook.result.current.anchorRef("km")).toBe(anchor);
    expect(hook.result.current.inputRef("km")).toBe(input);

    anchor(fieldAt(300));
    anchor(null);
    hook.result.current.focusField("km");
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it("closing the screen before the focus lands cancels it", () => {
    const hook = renderHook(() => useFieldFocus());
    const input = { focus: vi.fn() };

    hook.result.current.inputRef("km").current = input as never;
    hook.result.current.focusField("km");
    hook.unmount();
    vi.runAllTimers();

    expect(input.focus).not.toHaveBeenCalled();
  });

  it("nothing invalid, nothing moves", () => {
    const hook = renderHook(() => useFieldFocus());
    const scroll = scrollView();
    (hook.result.current.scrollRef as { current: unknown }).current = scroll;

    hook.result.current.focusField(null);
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });
});
