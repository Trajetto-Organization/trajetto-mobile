import { Text, TouchableOpacity, View } from "react-native";

import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";

import {
  formatMessageClock,
  resolveOwnMessageCheck,
} from "@/features/chat/chat-rules";

import { chatImageSource } from "@/features/chat/media-viewer-rules";

import type { ClientChatMessage } from "@/features/chat/types";
import { bubbleTones } from "@/features/chat/bubble-tones";
import { useThemeColors } from "@/hooks/use-theme";
import { AudioPlayerBubble } from "./audio-player";
import { ChatMessageContextTags } from "./message-context-tags";

import {
  MEDIA_BUBBLE_PADDING,
  MEDIA_BUBBLE_WIDTH,
  MEDIA_CONTENT_WIDTH,
  SINGLE_IMAGE_HEIGHT,
} from "./media-bubble-metrics";

/** What a bubble with no picture in it puts around its text. */
const TEXT_BUBBLE_PADDING_X = 12;
const TEXT_BUBBLE_PADDING_Y = 8;

interface ChatMessageBubbleProps {
  message: ClientChatMessage;
  isMine: boolean;

  /** Shown above operation bubbles when the agent changes. */
  showSenderName: boolean;

  counterpartReadAt: string | null;

  /** How far the SAC has confirmed RECEIVING — the grey double check. */
  counterpartDeliveredAt: string | null;

  /**
   * Opens the fullscreen viewer on THIS photo. The whole message is handed
   * over, not its url: the viewer anchors on the message's identity so it can
   * find the same photo again after the conversation shifts underneath it.
   */
  onPressImage: (message: ClientChatMessage) => void;
  onPressDelivery: (deliveryId: string) => void;
  onRetry: (message: ClientChatMessage) => void;
}

/**
 * One message, WhatsApp-shaped: the driver's own on the right in blue, the
 * operation's on the left in white. Checks derive from the SAC's read
 * cursor — no receipt rows exist anywhere.
 */
const ChatMessageBubble = ({
  message,
  isMine,
  showSenderName,
  counterpartReadAt,
  counterpartDeliveredAt,
  onPressImage,
  onPressDelivery,
  onRetry,
}: ChatMessageBubbleProps) => {
  const colors = useThemeColors();
  const tones = bubbleTones(colors, isMine);

  const check = resolveOwnMessageCheck({
    createdAt: message.created_at,
    pending: message.pending,
    counterpartReadAt,
    counterpartDeliveredAt,
  });

  /**
   * A bubble carrying a photo is sized BY THE PHOTO, and the caption wraps
   * inside that width — the WhatsApp rule, and the inverse of letting the text
   * stretch the balloon while the picture stays put at the left edge.
   */
  const hasImage = message.kind === "IMAGE" && Boolean(message.attachment_url);

  /**
   * Clock, one check, two muted checks, two bright ones. On a blue bubble the
   * muted tone IS the grey of the WhatsApp convention — an actual grey would
   * disappear against blue-600 — so delivered and read differ by colour the
   * same way sent and delivered differ by check count.
   */
  const renderChecks = () => {
    if (!isMine) return null;

    if (check === "pending") {
      return (
        <Ionicons
          name="time-outline"
          size={13}
          color={tones.check}
          accessibilityLabel="Enviando"
        />
      );
    }

    // A send that never landed offers a retry instead of a check.
    if (message.failed) return null;

    if (check === "sent") {
      return (
        <Ionicons
          name="checkmark"
          size={14}
          color={tones.check}
          accessibilityLabel="Enviada"
        />
      );
    }

    return (
      <Ionicons
        name="checkmark-done"
        size={14}
        color={check === "read" ? tones.checkRead : tones.check}
        accessibilityLabel={
          check === "read" ? "Lida pela operação" : "Recebida pela operação"
        }
      />
    );
  };

  return (
    <View className={`w-full ${isMine ? "items-end" : "items-start"} px-4`}>
      <View
        style={
          hasImage
            ? { width: MEDIA_BUBBLE_WIDTH, maxWidth: "100%" }
            : { maxWidth: "82%" }
        }
      >
        {showSenderName && (
          <Text className="mb-0.5 px-1 text-xs font-medium text-muted">
            {message.sender.name}
          </Text>
        )}

        <TouchableOpacity
          activeOpacity={message.failed ? 0.7 : 1}
          onPress={message.failed ? () => onRetry(message) : undefined}
          className={`rounded-2xl ${
            isMine
              ? "rounded-br-md bg-primary"
              : "rounded-bl-md border border-border bg-card"
          } ${message.pending ? "opacity-70" : ""}`}
          style={
            hasImage
              ? { padding: MEDIA_BUBBLE_PADDING }
              : {
                  paddingHorizontal: TEXT_BUBBLE_PADDING_X,
                  paddingVertical: TEXT_BUBBLE_PADDING_Y,
                }
          }
        >
          {message.broadcast_id && (
            <View className="mb-1 flex-row items-center gap-1">
              <Ionicons
                name="megaphone-outline"
                size={12}
                color={tones.meta}
              />
              <Text
                className={`text-[11px] font-medium ${
                  isMine ? "text-primary-foreground/95" : "text-muted"
                }`}
              >
                Aviso em massa
              </Text>
            </View>
          )}

          <ChatMessageContextTags
            delivery={message.delivery}
            route={message.route}
            isMine={isMine}
            onPressDelivery={onPressDelivery}
          />

          {message.kind === "IMAGE" && message.attachment_url && (
            <TouchableOpacity
              onPress={() => onPressImage(message)}
              accessibilityRole="imagebutton"
              accessibilityLabel="Ampliar imagem"
              className="mb-1 overflow-hidden rounded-lg"
            >
              {/* Keyed by message, not by the signed url: a new signature on
              every listing must not mean a new download (MOB-08). */}
              <Image
                source={chatImageSource(message.attachment_url, message.id)}
                recyclingKey={message.id}
                cachePolicy="memory-disk"
                contentFit="cover"
                style={{
                  width: MEDIA_CONTENT_WIDTH,
                  height: SINGLE_IMAGE_HEIGHT,
                }}
              />
            </TouchableOpacity>
          )}

          {message.kind === "AUDIO" && message.attachment_url && (
            <AudioPlayerBubble
              messageId={message.id}
              url={message.attachment_url}
              durationMs={message.duration_ms}
              onDarkBubble={isMine}
            />
          )}

          {message.body ? (
            <Text
              className={`text-[15px] leading-5 ${
                isMine ? "text-primary-foreground" : "text-ink"
              }`}
              style={hasImage ? { width: MEDIA_CONTENT_WIDTH } : undefined}
            >
              {message.body}
            </Text>
          ) : null}

          <View className="mt-0.5 flex-row items-center justify-end gap-1">
            <Text
              className={`text-[10px] ${
                isMine ? "text-primary-foreground/95" : "text-muted"
              }`}
            >
              {formatMessageClock(message.created_at)}
            </Text>
            {renderChecks()}
          </View>
        </TouchableOpacity>

        {message.failed && (
          <TouchableOpacity
            onPress={() => onRetry(message)}
            accessibilityRole="button"
            accessibilityLabel="Reenviar mensagem"
            className="mt-1 flex-row items-center gap-1 px-1"
          >
            <Ionicons name="refresh" size={12} color={colors.destructive} />
            <Text className="text-xs font-medium text-destructive">
              Não enviada — toque para reenviar
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

export { ChatMessageBubble };
