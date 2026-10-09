import { useCallback, useEffect, useRef } from "react";
import type { ScrollView, TextInput } from "react-native";

import { announceToScreenReader, moveScreenReaderTo } from "./screen-reader";

/**
 * Brings a field into view after a failed submit (decision 16.700): scrolls
 * the form's ScrollView so the field's label sits near the top, then focuses
 * it when it is a text input (the keyboard opens on it). A photo area, a
 * select or a Sim/Não only scrolls — focusing them would open a sheet the
 * driver did not ask for. Those get the screen reader instead: TalkBack is
 * moved to the field and the message is announced, so a blind driver hears
 * why the tap did nothing.
 *
 * Each field is marked with an anchor (a View around it, `collapsable={false}`
 * so Android keeps the node to measure) and, for text, the input's ref. The
 * refs are created once per field name, so passing them every render never
 * re-attaches anything.
 */

/** What a View offers to be measured against the ScrollView's content. */
interface MeasurableNode {
  measureLayout: (
    relativeTo: unknown,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail?: () => void,
  ) => void;
}

interface FocusableNode {
  focus: () => void;
}

/** The part of a ScrollView this needs. */
interface ScrollableNode {
  scrollTo: (options: { x?: number; y?: number; animated?: boolean }) => void;
  getInnerViewRef?: () => unknown;
}

/** Room above the field, so its label is not under the top edge. */
const SCROLL_MARGIN = 24;

/** Focus waits for the scroll, or Android's own focus scroll fights it. */
const FOCUS_DELAY_MS = 250;

function useFieldFocus() {
  const scrollRef = useRef<ScrollView | null>(null);
  const anchors = useRef(new Map<string, MeasurableNode>());
  const anchorCallbacks = useRef(new Map<string, (node: unknown) => void>());
  const inputs = useRef(new Map<string, { current: FocusableNode | null }>());
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
    },
    [],
  );

  /** `ref` for the View around a field. */
  const anchorRef = useCallback((field: string) => {
    let callback = anchorCallbacks.current.get(field);

    if (!callback) {
      callback = (node: unknown) => {
        if (node) anchors.current.set(field, node as MeasurableNode);
        else anchors.current.delete(field);
      };
      anchorCallbacks.current.set(field, callback);
    }

    return callback;
  }, []);

  /** `inputRef` for a text field; the same object every render. */
  const inputRef = useCallback(<T extends FocusableNode = TextInput>(field: string) => {
    let ref = inputs.current.get(field);

    if (!ref) {
      ref = { current: null };
      inputs.current.set(field, ref);
    }

    return ref as { current: T | null };
  }, []);

  /**
   * Scrolls to the field and, when it is a text input, focuses it; any other
   * field gets the screen reader's focus. `message` is announced to it.
   */
  const focusField = useCallback((field: string | null | undefined, message?: string) => {
    if (!field) return;

    const scroll = scrollRef.current as ScrollableNode | null;
    const anchor = anchors.current.get(field);
    const input = inputs.current.get(field)?.current ?? null;

    // After the scroll lands, or Android's own focus scroll fights it.
    const land = () => {
      if (focusTimer.current) clearTimeout(focusTimer.current);

      focusTimer.current = setTimeout(() => {
        focusTimer.current = null;
        if (input) input.focus();
        else if (anchor) moveScreenReaderTo(anchor);
        if (message) announceToScreenReader(message);
      }, FOCUS_DELAY_MS);
    };

    const content = scroll?.getInnerViewRef?.() ?? null;

    if (!scroll || !anchor || !content) {
      // Nothing to scroll (a modal, a short screen): focus alone.
      land();
      return;
    }

    anchor.measureLayout(
      content,
      (_x, y) => {
        scroll.scrollTo({ y: Math.max(0, y - SCROLL_MARGIN), animated: true });
        land();
      },
      land,
    );
  }, []);

  return { scrollRef, anchorRef, inputRef, focusField };
}

type FieldFocus = ReturnType<typeof useFieldFocus>;

export { FOCUS_DELAY_MS, SCROLL_MARGIN, useFieldFocus };
export type { FieldFocus, FocusableNode, MeasurableNode, ScrollableNode };
