import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One native player per conversation, at the bubble level (MOB-06).
 *
 * `useAudioPlayer` builds an ExoPlayer — its own playback thread, and for a
 * downloaded note a prepared decoder and a status loop — and every voice-note
 * bubble used to call it on mount. The bubble now draws an idle note from
 * plain props and only renders the live player while it is the armed note.
 *
 * The bubble function is called directly under a minimal hook runtime (one
 * slot list per bubble), and what it RETURNS is inspected: the live player is
 * a child element, so building it is React's job and never happens here —
 * which is exactly what makes "the bubble itself creates no player" testable.
 */
const runtime = vi.hoisted(() => {
  interface Instance {
    slots: unknown[];
    cursor: number;
    id: string;
  }

  let current: Instance | null = null;
  let idCounter = 0;

  const changed = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !a ||
    !b ||
    a.length !== b.length ||
    a.some((value, index) => !Object.is(value, b[index]));

  const slot = () => {
    const instance = current!;
    const index = instance.cursor++;

    return { instance, index };
  };

  const react = {
    useState<T>(initial: T | (() => T)) {
      const { instance, index } = slot();

      if (!(index in instance.slots)) {
        instance.slots[index] = {
          value:
            typeof initial === "function" ? (initial as () => T)() : initial,
        };
      }

      const cell = instance.slots[index] as { value: T };

      const set = (next: T | ((value: T) => T)) => {
        cell.value =
          typeof next === "function" ? (next as (value: T) => T)(cell.value) : next;
      };

      return [cell.value, set] as const;
    },

    useRef<T>(initial: T) {
      const { instance, index } = slot();

      if (!(index in instance.slots)) instance.slots[index] = { current: initial };

      return instance.slots[index] as { current: T };
    },

    useCallback<T>(callback: T, deps: readonly unknown[]) {
      const { instance, index } = slot();
      const previous = instance.slots[index] as
        | { callback: T; deps: readonly unknown[] }
        | undefined;

      if (previous && !changed(previous.deps, deps)) return previous.callback;

      instance.slots[index] = { callback, deps };

      return callback;
    },

    useMemo<T>(factory: () => T, deps: readonly unknown[]) {
      const { instance, index } = slot();
      const previous = instance.slots[index] as
        | { value: T; deps: readonly unknown[] }
        | undefined;

      if (previous && !changed(previous.deps, deps)) return previous.value;

      const value = factory();
      instance.slots[index] = { value, deps };

      return value;
    },

    // Effects are the lifecycle React would run after commit; the choices
    // under test are made during render, so they are not needed here.
    useEffect: () => undefined,

    useId() {
      const { instance, index } = slot();

      if (!(index in instance.slots)) instance.slots[index] = `:r${idCounter++}:`;

      return instance.slots[index] as string;
    },

    useSyncExternalStore<T>(_subscribe: unknown, getSnapshot: () => T) {
      slot();

      return getSnapshot();
    },
  };

  return {
    react,

    render<T>(instance: Instance, fn: () => T): T {
      current = instance;
      instance.cursor = 0;

      try {
        return fn();
      } finally {
        current = null;
      }
    },

    instance(): Instance {
      return { slots: [], cursor: 0, id: String(idCounter) };
    },
  };
});

vi.mock("react", () => runtime.react);

// The test transform compiles JSX to `React.createElement`; an element only
// has to say what it is and with which props.
vi.hoisted(() => {
  (globalThis as { React?: unknown }).React = {
    createElement: (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ) => ({ type, props: { ...(props ?? {}), children } }),
  };
});

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  Text: "Text",
  TouchableOpacity: "TouchableOpacity",
  View: "View",
}));

vi.mock("react-native-gesture-handler", () => {
  const chain: Record<string, unknown> = new Proxy(
    {},
    { get: () => () => chain },
  );

  return {
    Gesture: { Pan: () => chain, Tap: () => chain, Race: () => chain },
    GestureDetector: "GestureDetector",
  };
});

vi.mock("react-native-reanimated", () => ({
  default: { View: "Animated.View" },
  Easing: { linear: (value: number) => value },
  cancelAnimation: () => undefined,
  runOnJS: (fn: unknown) => fn,
  useAnimatedReaction: () => undefined,
  useAnimatedStyle: () => ({}),
  useSharedValue: <T,>(value: T) => ({ value }),
  withTiming: <T,>(value: T) => value,
}));

vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
// The theme hook reads NativeWind's scheme, which needs a React Native
// runtime; the palette it returns is plain data.
vi.mock("@/hooks/use-theme", async () => {
  const { themeColors } = await import("@/utils/theme-rules");
  return { useThemeColors: () => themeColors("light") };
});

const useAudioPlayer = vi.hoisted(() =>
  vi.fn((_source: unknown, _options?: unknown) => ({
    pause: () => undefined,
    play: () => undefined,
    replace: () => undefined,
    setPlaybackRate: () => undefined,
    seekTo: async () => undefined,
    currentTime: 0,
    playing: false,
  })),
);

vi.mock("expo-audio", () => ({
  useAudioPlayer: (source: unknown, options?: unknown) =>
    useAudioPlayer(source, options),
  useAudioPlayerStatus: () => ({
    isLoaded: false,
    playing: false,
    isBuffering: false,
    didJustFinish: false,
    currentTime: 0,
    duration: 0,
  }),
}));

// Every note is already on this phone: the play triangle, not the arrow.
vi.mock("@/features/chat/audio-cache", () => ({
  findCachedChatAudio: (messageId: string) => `file:///cache/${messageId}.m4a`,
  downloadChatAudio: () => ({
    promise: new Promise(() => undefined),
    cancel: () => undefined,
  }),
}));

type Element = { type: unknown; props: Record<string, unknown> };

let AudioPlayerBubble: (props: {
  messageId: string;
  url: string;
  durationMs: number | null;
  onDarkBubble: boolean;
}) => unknown;

let focus: typeof import("@/features/chat/audio-focus");

beforeAll(async () => {
  ({ AudioPlayerBubble } = (await import(
    "@/components/screens/chat/audio-player"
  )) as unknown as { AudioPlayerBubble: typeof AudioPlayerBubble });

  focus = await import("@/features/chat/audio-focus");
});

function mountThread(count: number) {
  return Array.from({ length: count }, (_unused, index) => {
    const instance = runtime.instance();
    const props = {
      messageId: `note-${index}`,
      url: `https://storage/note-${index}.m4a?sig=abc`,
      durationMs: 42_000,
      onDarkBubble: false,
    };

    return {
      render: () =>
        runtime.render(instance, () => AudioPlayerBubble(props)) as Element,
    };
  });
}

const kind = (element: Element) =>
  typeof element.type === "function" ? element.type.name : String(element.type);

beforeEach(() => {
  focus.stopChatAudio();
  useAudioPlayer.mockClear();
});

describe("a conversation with thirty voice notes", () => {
  it("builds no native player at all until the driver asks to hear one", () => {
    const thread = mountThread(30);

    const drawn = thread.map((note) => note.render());

    expect(useAudioPlayer).not.toHaveBeenCalled();
    expect(drawn.every((element) => kind(element) === "IdleAudioNote")).toBe(true);
  });

  it("gives the live player to the note that was tapped, and to that note only", () => {
    const thread = mountThread(30);

    thread.forEach((note) => note.render());

    // The driver taps play on the fourth note.
    (thread[3].render().props.onPressButton as () => void)();

    const drawn = thread.map((note) => note.render());
    const live = drawn.filter((element) => kind(element) === "ArmedAudioPlayer");

    expect(live).toHaveLength(1);
    expect(kind(drawn[3])).toBe("ArmedAudioPlayer");
    expect(live[0].props.localUri).toBe("file:///cache/note-3.m4a");
  });

  it("moves the live player when another note is played, so there is never a second one", () => {
    const thread = mountThread(30);

    thread.forEach((note) => note.render());

    (thread[3].render().props.onPressButton as () => void)();
    thread.forEach((note) => note.render());

    (thread[7].render().props.onPressButton as () => void)();

    const drawn = thread.map((note) => note.render());

    expect(drawn.filter((element) => kind(element) === "ArmedAudioPlayer")).toHaveLength(1);
    expect(kind(drawn[3])).toBe("IdleAudioNote");
    expect(kind(drawn[7])).toBe("ArmedAudioPlayer");
  });

  it("resumes a note where the driver left it after its player was handed to another note", () => {
    const thread = mountThread(2);

    thread.forEach((note) => note.render());

    (thread[0].render().props.onPressButton as () => void)();

    // The live player reports where it was when it goes away.
    const live = thread[0].render();
    (thread[1].render().props.onPressButton as () => void)();
    (live.props.onDetach as (seconds: number) => void)(31);

    const idle = thread[0].render();

    expect(kind(idle)).toBe("IdleAudioNote");
    expect(idle.props.positionSeconds).toBe(31);

    (idle.props.onPressButton as () => void)();

    const rebuilt = thread[0].render();

    expect(kind(rebuilt)).toBe("ArmedAudioPlayer");
    expect(rebuilt.props.startAtSeconds).toBe(31);
  });

  it("releases the live player when the conversation loses focus", () => {
    const thread = mountThread(3);

    thread.forEach((note) => note.render());
    (thread[1].render().props.onPressButton as () => void)();
    expect(kind(thread[1].render())).toBe("ArmedAudioPlayer");

    focus.stopChatAudio();

    expect(thread.every((note) => kind(note.render()) === "IdleAudioNote")).toBe(true);
  });
});
