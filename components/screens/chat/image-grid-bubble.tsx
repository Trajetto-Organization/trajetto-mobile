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

import { ChatMessageContextTags } from "./message-context-tags";

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
  const colors = useThemeColors();
  const tones = bubbleTones(colors, isMine);

  const newest = messages[messages.length - 1];

  const tiles = messages.slice(0, VISIBLE_TILES);
  const hidden = messages.length - tiles.length;

  const caption = messages.find((message) => message.body)?.body ?? null;
  const linked = messages.find((message) => message.delivery)?.delivery ?? null;

  // One batch, one route: the photos were sent within minutes of each other.
  const linkedRoute = messages.find((message) => message.route)?.route ?? null;

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
          color={tones.check}
          accessibilityLabel="Enviando"
        />
      );
    }

    if (check === "sent") {
      return (
        <Ionicons
          name="checkmark"
          size={14}
          color={tones.check}
          accessibilityLabel="Enviadas"
        />
      );
    }

    return (
      <Ionicons
        name="checkmark-done"
        size={14}
        color={check === "read" ? tones.checkRead : tones.check}
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
          <Text className="mb-0.5 px-1 text-xs font-medium text-muted">
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
              ? "rounded-br-md bg-primary"
              : "rounded-bl-md border border-border bg-card"
          }`}
          style={{ padding: MEDIA_BUBBLE_PADDING }}
        >
          <ChatMessageContextTags
            delivery={linked}
            route={linkedRoute}
            isMine={isMine}
            onPressDelivery={onPressDelivery}
          />

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
                  {/* Same cache identity as the single bubble and the
                  viewer: the message, never the signed url (MOB-08). */}
                  <Image
                    source={chatImageSource(message.attachment_url!, message.id)}
                    recyclingKey={message.id}
                    cachePolicy="memory-disk"
                    contentFit="cover"
                    style={{ width: MEDIA_TILE_SIZE, height: MEDIA_TILE_SIZE }}
                  />

                  {message.pending && !showsOverflow && (
                    <View className="absolute inset-0 items-center justify-center bg-black/25">
                      <Ionicons
                        name="time-outline"
                        size={20}
                        color={colors.primaryForeground}
                      />
                    </View>
                  )}

                  {showsOverflow && (
                    <View className="absolute inset-0 items-center justify-center bg-black/50">
                      <Text className="text-xl font-semibold text-primary-foreground">
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
                isMine ? "text-primary-foreground" : "text-ink"
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
                isMine ? "text-primary-foreground/95" : "text-muted"
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
