/**
 * A tiny hook runtime for the composed form hooks (MOB-30).
 *
 * The app's tests run in plain Node with no React renderer installed, and
 * adding one (react-test-renderer is deprecated in React 19) for a handful of
 * hooks is not worth a dependency. The hooks under test only use the basic
 * primitives, so this file implements exactly those with React's semantics:
 * state persists by call order, a setState re-renders, callbacks/memos and
 * effects follow their dependency arrays (Object.is), effects run after the
 * render and clean up before re-running and on unmount.
 *
 * Wire it with `vi.mock("react", () => reactShim)` before importing the hook.
 * What it does not do (concurrent rendering, batching across awaits, context)
 * no hook tested with it relies on.
 */

type Deps = readonly unknown[] | undefined;

interface EffectSlot {
  deps: Deps;
  cleanup?: (() => void) | void;
}

interface Instance {
  slots: unknown[];
  index: number;
  pendingEffects: Array<() => void>;
  rerender: () => void;
  rendering: boolean;
  dirty: boolean;
}

let current: Instance | null = null;

function active(): Instance {
  if (!current) throw new Error("Hook chamado fora do renderHook.");
  return current;
}

function depsChanged(previous: Deps, next: Deps): boolean {
  if (!previous || !next) return true;
  if (previous.length !== next.length) return true;
  return next.some((value, index) => !Object.is(value, previous[index]));
}

function useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
  const instance = active();
  const index = instance.index++;

  if (!(index in instance.slots)) {
    const value = typeof initial === "function" ? (initial as () => T)() : initial;
    const setter = (next: T | ((previous: T) => T)) => {
      const [previous] = instance.slots[index] as [T, unknown];
      const value = typeof next === "function" ? (next as (p: T) => T)(previous) : next;
      if (Object.is(value, previous)) return;

      (instance.slots[index] as [T, unknown])[0] = value;
      if (instance.rendering) {
        instance.dirty = true;
      } else {
        instance.rerender();
      }
    };
    instance.slots[index] = [value, setter];
  }

  const [value, setter] = instance.slots[index] as [T, (next: T | ((previous: T) => T)) => void];
  return [value, setter];
}

function useRef<T>(initial: T): { current: T } {
  const instance = active();
  const index = instance.index++;
  if (!(index in instance.slots)) instance.slots[index] = { current: initial };
  return instance.slots[index] as { current: T };
}

function useMemo<T>(factory: () => T, deps: Deps): T {
  const instance = active();
  const index = instance.index++;
  const slot = instance.slots[index] as { value: T; deps: Deps } | undefined;

  if (!slot || depsChanged(slot.deps, deps)) {
    instance.slots[index] = { value: factory(), deps };
  }

  return (instance.slots[index] as { value: T }).value;
}

function useCallback<T>(callback: T, deps: Deps): T {
  return useMemo(() => callback, deps);
}

function useEffect(effect: () => (() => void) | void, deps?: Deps): void {
  const instance = active();
  const index = instance.index++;
  const slot = instance.slots[index] as EffectSlot | undefined;

  if (slot && !depsChanged(slot.deps, deps)) return;

  instance.pendingEffects.push(() => {
    if (typeof slot?.cleanup === "function") slot.cleanup();
    instance.slots[index] = { deps, cleanup: effect() };
  });
}

const reactShim = {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect: useEffect,
  default: {} as Record<string, unknown>,
};
reactShim.default = { ...reactShim };

interface RenderedHook<TProps, TResult> {
  result: { current: TResult };
  rerender: (props?: TProps) => void;
  unmount: () => void;
  /** How many times the hook body ran. */
  renders: () => number;
}

function renderHook<TProps, TResult>(
  hook: (props: TProps) => TResult,
  initialProps?: TProps,
): RenderedHook<TProps, TResult> {
  let props = initialProps as TProps;
  let count = 0;
  const result = { current: undefined as unknown as TResult };

  const instance: Instance = {
    slots: [],
    index: 0,
    pendingEffects: [],
    rendering: false,
    dirty: false,
    rerender: () => render(),
  };

  function render(): void {
    // A setState during render renders again, as React does, with a bound.
    for (let pass = 0; pass < 25; pass++) {
      const previous = current;
      current = instance;
      instance.index = 0;
      instance.rendering = true;
      instance.dirty = false;
      try {
        count++;
        result.current = hook(props);
      } finally {
        instance.rendering = false;
        current = previous;
      }
      if (!instance.dirty) break;
      instance.pendingEffects = [];
    }

    const effects = instance.pendingEffects;
    instance.pendingEffects = [];
    for (const run of effects) run();
  }

  render();

  return {
    result,
    rerender: (next?: TProps) => {
      if (next !== undefined) props = next;
      render();
    },
    unmount: () => {
      for (const slot of instance.slots) {
        const effect = slot as EffectSlot | undefined;
        if (effect && typeof effect === "object" && "cleanup" in effect && typeof effect.cleanup === "function") {
          effect.cleanup();
        }
      }
    },
    renders: () => count,
  };
}

export { reactShim, renderHook };
