import { Image, Text, TouchableOpacity, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import {
  formatMessageClock,
  resolveOwnMessageCheck,
} from "@/features/chat/chat-rules";

import type { ClientChatMessage } from "@/features/chat/types";

import {
  MEDIA_BUBBLE_PADDING,
  MEDIA_BUBBLE_WIDTH,
  MEDIA_CONTENT_WIDTH,
  MEDIA_TILE_GAP,
  MEDIA_TILE_SIZE,
} from "./media-bubble-metrics";

/** How many tiles the grid draws before it starts counting instead. */
const VISIBLE_TILES = 4;

interface ChatImageGridProps {
  /** Two or more consecutive photos from the same sender. */
  messages: ClientChatMessage[];
  isMine: boolean;

  showSenderName: boolean;

  counterpartReadAt: string | null;
  counterpartDeliveredAt: string | null;

  /**
   * Opens the fullscreen viewer on THIS photo — the message, never a position
   * inside the batch. A tile only knows its index within the row, and the
   * gallery the viewer pages through is the whole conversation.
   */
  onPressImage: (message: ClientChatMessage) => void;
  onPressDelivery: (deliveryId: string) => void;
}

/**
 * A batch of photos as one bubble: two columns, at most four tiles, and a
 * "+N" on the last one when there are more.
 *
 * The bubble speaks for its newest message. The clock and the checks come
 * from the last photo of the batch, because that is the one the SAC's cursors
 * have to reach for the whole batch to count as delivered or read — showing
 * the first one's state would claim the batch had arrived while half of it
 * was still uploading. The caption comes from the photo that carries one,
 * which by construction is the last.
 */
const ChatImageGrid = ({
  messages,
  isMine,
  showSenderName,
  counterpartReadAt,
  counterpartDeliveredAt,
  onPressImage,
  onPressDelivery,
}: ChatImageGridProps) => {
  const newest = messages[messages.length - 1];

  const tiles = messages.slice(0, VISIBLE_TILES);
  const hidden = messages.length - tiles.length;

  const caption = messages.find((message) => message.body)?.body ?? null;
  const linked = messages.find((message) => message.delivery)?.delivery ?? null;

  const anyPending = messages.some((message) => message.pending);

  const check = resolveOwnMessageCheck({
    createdAt: newest.created_at,
    pending: anyPending,
    counterpartReadAt,
    counterpartDeliveredAt,
  });

  const renderChecks = () => {
    if (!isMine) return null;

    if (check === "pending") {
      return (
        <Ionicons
          name="time-outline"
          size={13}
          color="#bfdbfe"
          accessibilityLabel="Enviando"
        />
      );
    }

    if (check === "sent") {
      return (
        <Ionicons
          name="checkmark"
          size={14}
          color="#bfdbfe"
          accessibilityLabel="Enviadas"
        />
      );
    }

    return (
      <Ionicons
        name="checkmark-done"
        size={14}
        color={check === "read" ? "#7dd3fc" : "#bfdbfe"}
        accessibilityLabel={
          check === "read" ? "Lidas pela operação" : "Recebidas pela operação"
        }
      />
    );
  };

  return (
    <View className={`w-full ${isMine ? "items-end" : "items-start"} px-4`}>
      <View style={{ width: MEDIA_BUBBLE_WIDTH, maxWidth: "100%" }}>
        {showSenderName && (
          <Text className="mb-0.5 px-1 text-xs font-medium text-gray-500">
            {newest.sender.name}
          </Text>
        )}

        {/*
          The width is fixed to the grid's, and that is the whole fix: nothing
          inside can widen the bubble any more, so a long caption wraps against
          the photos instead of stretching the balloon and leaving the tiles
          stranded on the left of it.
        */}
        <View
          className={`rounded-2xl ${
            isMine
              ? "rounded-br-md bg-blue-600"
              : "rounded-bl-md border border-gray-200 bg-white"
          }`}
          style={{ padding: MEDIA_BUBBLE_PADDING }}
        >
          {linked && (
            <TouchableOpacity
              onPress={() => onPressDelivery(linked.id)}
              accessibilityRole="button"
              accessibilityLabel={`Abrir entrega de ${linked.recipient_name}`}
              className={`mb-1.5 flex-row items-center gap-1.5 rounded-lg px-2
              py-1.5 ${isMine ? "bg-blue-500" : "bg-gray-100"}`}
            >
              <Ionicons
                name="cube-outline"
                size={14}
                color={isMine ? "#ffffff" : "#374151"}
              />
              <Text
                numberOfLines={1}
                className={`flex-1 text-xs ${
                  isMine ? "text-white" : "text-gray-700"
                }`}
              >
                Entrega: {linked.recipient_name}
              </Text>
            </TouchableOpacity>
          )}

          <View
            className="flex-row flex-wrap"
            style={{
              width: MEDIA_CONTENT_WIDTH,
              gap: MEDIA_TILE_GAP,
            }}
          >
            {/*
              The last tile carries the "+N" when the batch outgrew the grid.
              It is NOT a special case here: it opens its own photo like any
              other tile, and the viewer pages on through the ones the grid had
              no room to draw — which is what finally makes the label on it
              ("Ampliar foto 4 e ver mais 3") true.
            */}
            {tiles.map((message, index) => {
              const isLastVisible = index === tiles.length - 1;
              const showsOverflow = hidden > 0 && isLastVisible;

              return (
                <TouchableOpacity
                  key={message.id}
                  onPress={() => onPressImage(message)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={
                    showsOverflow
                      ? `Ampliar foto ${index + 1} e ver mais ${hidden}`
                      : `Ampliar foto ${index + 1} de ${messages.length}`
                  }
                  className="overflow-hidden rounded-md"
                  style={{ width: MEDIA_TILE_SIZE, height: MEDIA_TILE_SIZE }}
                >
                  <Image
                    source={{ uri: message.attachment_url! }}
                    style={{ width: MEDIA_TILE_SIZE, height: MEDIA_TILE_SIZE }}
                    resizeMode="cover"
                  />

                  {message.pending && !showsOverflow && (
                    <View className="absolute inset-0 items-center justify-center bg-black/25">
                      <Ionicons
                        name="time-outline"
                        size={20}
                        color="#ffffff"
                      />
                    </View>
                  )}

                  {showsOverflow && (
                    <View className="absolute inset-0 items-center justify-center bg-black/50">
                      <Text className="text-xl font-semibold text-white">
                        +{hidden}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {caption ? (
            <Text
              className={`mt-1 text-[15px] leading-5 ${
                isMine ? "text-white" : "text-gray-900"
              }`}
              style={{ width: MEDIA_CONTENT_WIDTH }}
            >
              {caption}
            </Text>
          ) : null}

          <View
            className="mt-0.5 flex-row items-center justify-end gap-1"
            style={{ width: MEDIA_CONTENT_WIDTH }}
          >
            <Text
              className={`text-[10px] ${
                isMine ? "text-blue-100" : "text-gray-400"
              }`}
            >
              {formatMessageClock(newest.created_at)}
            </Text>
            {renderChecks()}
          </View>
        </View>
      </View>
    </View>
  );
};

export { ChatImageGrid };
