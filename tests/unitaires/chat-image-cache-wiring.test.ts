import { beforeAll, describe, expect, it, vi } from "vitest";

import type { ClientChatMessage } from "@/features/chat/types";

/**
 * The photos in the thread are cached by message, not by their signed url
 * (MOB-08).
 *
 * The API signs attachment urls per request, so every listing, resync and
 * re-signature hands the same photo over under a new url. The bubbles drew
 * with the RN `Image`, whose cache is keyed by url: each load of the thread
 * downloaded every thumbnail again on the driver's data plan. The bubble and
 * the grid are called directly and the image they draw is inspected.
 */
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
  Image: "RNImage",
  Text: "Text",
  TouchableOpacity: "TouchableOpacity",
  View: "View",
}));

vi.mock("expo-image", () => ({ Image: "ExpoImage" }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
// The theme hook reads NativeWind's scheme, which needs a React Native
// runtime; the palette it returns is plain data.
vi.mock("@/hooks/use-theme", async () => {
  const { themeColors } = await import("@/utils/theme-rules");
  return { useThemeColors: () => themeColors("light") };
});
vi.mock("@/components/screens/chat/audio-player", () => ({
  AudioPlayerBubble: "AudioPlayerBubble",
}));

type Element = { type: unknown; props: Record<string, unknown> };

let ChatMessageBubble: (props: Record<string, unknown>) => Element;
let ChatImageGrid: (props: Record<string, unknown>) => Element;

beforeAll(async () => {
  ({ ChatMessageBubble } = (await import(
    "@/components/screens/chat/message-bubble"
  )) as unknown as { ChatMessageBubble: typeof ChatMessageBubble });

  ({ ChatImageGrid } = (await import(
    "@/components/screens/chat/image-grid-bubble"
  )) as unknown as { ChatImageGrid: typeof ChatImageGrid });
});

function findImages(node: unknown, found: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    node.forEach((child) => findImages(child, found));

    return found;
  }

  if (!node || typeof node !== "object") return found;

  const element = node as Element;

  if (element.type === "ExpoImage" || element.type === "RNImage") {
    found.push(element);
  }

  findImages(element.props?.children, found);

  return found;
}

function photo(id: string, signature: string, minute = 0): ClientChatMessage {
  return {
    id,
    kind: "IMAGE",
    body: null,
    attachment_url: `https://storage.example.com/chat/${id}.jpg?X-Signature=${signature}`,
    duration_ms: null,
    deliveryId: null,
    broadcast_id: null,
    client_submission_id: null,
    threadId: "thread-1",
    senderId: "user-agent",
    sender: { id: "user-agent", name: "Central" },
    delivery: null,
    created_at: new Date(Date.UTC(2026, 8, 28, 12, minute)).toISOString(),
  };
}

const common = {
  isMine: false,
  showSenderName: false,
  counterpartReadAt: null,
  counterpartDeliveredAt: null,
  onPressImage: () => undefined,
  onPressDelivery: () => undefined,
  onRetry: () => undefined,
};

const sourceOf = (element: Element) =>
  element.props.source as { uri: string; cacheKey?: string };

describe("a photo bubble", () => {
  it("keeps one cache identity across two signatures of the same photo", () => {
    const [first] = findImages(
      ChatMessageBubble({ ...common, message: photo("p1", "aaa") }),
    );
    const [again] = findImages(
      ChatMessageBubble({ ...common, message: photo("p1", "bbb") }),
    );

    expect(sourceOf(first).uri).not.toBe(sourceOf(again).uri);
    expect(sourceOf(first).cacheKey, "a miniatura é cacheada pela URL assinada").toBeDefined();
    expect(sourceOf(first).cacheKey).toBe(sourceOf(again).cacheKey);
  });
});

describe("a grid of photos", () => {
  it("keys every tile by its message, so a re-signed batch is not downloaded again", () => {
    const batch = (signature: string) =>
      [photo("g1", signature, 1), photo("g2", signature, 2), photo("g3", signature, 3)];

    const before = findImages(ChatImageGrid({ ...common, messages: batch("aaa") }));
    const after = findImages(ChatImageGrid({ ...common, messages: batch("bbb") }));

    expect(before).toHaveLength(3);

    before.forEach((tile, index) => {
      expect(sourceOf(tile).cacheKey).toBeDefined();
      expect(sourceOf(tile).cacheKey).toBe(sourceOf(after[index]).cacheKey);
    });

    // Three photos, three identities.
    expect(new Set(before.map((tile) => sourceOf(tile).cacheKey)).size).toBe(3);
  });
});
