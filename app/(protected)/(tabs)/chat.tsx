import { useCallback, useMemo, useRef, useState } from "react";

import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";

import { ProtectedRoute } from "../../../components/protected-route";
import { StatusBanners } from "../../../components/status-banners";

import { Button, LoadingSpinner } from "../../../components/ui";
import {
  ChatComposer,
  ChatImageGrid,
  ChatMediaViewer,
  ChatMessageBubble,
  ChatRecordingIndicator,
  ChatTypingIndicator,
  type DeliveryChip,
} from "../../../components/screens/chat";

import { useChatConversation } from "@/features/chat/hooks/use-chat-conversation";
import {
  chatPresenceHintLabel,
  formatDayLabel,
  groupChatMessages,
  needsDaySeparator,
} from "@/features/chat/chat-rules";

import {
  buildMediaGallery,
  mediaViewerAnchor,
} from "@/features/chat/media-viewer-rules";

import { stopChatAudio } from "@/features/chat/audio-focus";

import type { ChatFeedItem } from "@/features/chat/chat-rules";
import type { MediaViewerAnchor } from "@/features/chat/media-viewer-rules";
import type { ClientChatMessage } from "@/features/chat/types";

/**
 * The driver's one conversation with the operation. It owns the whole
 * bottom of the screen — the glass tab bar steps aside while this tab is
 * focused, so the composer, the keyboard and the recorder breathe; the
 * arrow up top returns to the tabs.
 */
const ChatScreen = () => {
  const router = useRouter();

  const params = useLocalSearchParams<{
    deliveryId?: string;
    recipient?: string;
  }>();

  const chat = useChatConversation();

  const [deliveryChip, setDeliveryChip] = useState<DeliveryChip | null>(
    params.deliveryId && params.recipient
      ? { id: params.deliveryId, recipient: params.recipient }
      : null,
  );

  /**
   * Which photo the fullscreen viewer is on, as a message identity.
   *
   * Not a url and not an index. The viewer pages through the whole
   * conversation, and the conversation moves: `loadOlder` prepends forty
   * messages at a time and a confirmed send replaces an optimistic message
   * with another object. A number would quietly start pointing at a different
   * photo; the identity survives both.
   */
  const [viewerAnchor, setViewerAnchor] = useState<MediaViewerAnchor | null>(
    null,
  );

  // Consecutive photos from the same sender collapse into one grid row; the
  // list renders rows, not raw messages.
  const feed = useMemo(() => groupChatMessages(chat.messages), [chat.messages]);

  // Every photo of the thread, in the order the list shows them — the grouping
  // above never reorders anything, so the gallery and the screen agree.
  const gallery = useMemo(
    () => buildMediaGallery(chat.messages),
    [chat.messages],
  );

  const listRef = useRef<FlatList<ChatFeedItem>>(null);
  const nearBottomRef = useRef<boolean>(true);

  // Leaving the conversation silences the voice note that was playing. A
  // player is bound to its bubble, and a bubble that is no longer on screen
  // has no business still talking over whatever the driver opened next.
  useFocusEffect(useCallback(() => () => stopChatAudio(), []));

  const handleBack = () => {
    // Opened as a tab there may be no history — home is the honest fallback.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.navigate("/vehicles");
    }
  };

  const handleScroll = useCallback(
    (event: {
      nativeEvent: {
        contentOffset: { y: number };
        contentSize: { height: number };
        layoutMeasurement: { height: number };
      };
    }) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;

      nearBottomRef.current =
        contentSize.height - contentOffset.y - layoutMeasurement.height < 120;
    },
    [],
  );

  const handleContentSizeChange = useCallback(() => {
    // New content while the reader is at the bottom keeps them there; a
    // reader browsing the past is never yanked down.
    if (nearBottomRef.current) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, []);

  const handlePressImage = useCallback((message: ClientChatMessage) => {
    setViewerAnchor(mediaViewerAnchor(message));
  }, []);

  const handleCloseViewer = useCallback(() => setViewerAnchor(null), []);

  const handlePressDelivery = useCallback(
    (deliveryId: string) => {
      // navigate (not push): a double-tap must not stack two copies.
      router.navigate({
        pathname: "/delivery-detail",
        params: { id: deliveryId },
      });
    },
    [router],
  );

  const renderItem = ({
    item,
    index,
  }: {
    item: ChatFeedItem;
    index: number;
  }) => {
    const previousRow = feed[index - 1];

    // The day pill and the sender name compare against the last message of
    // the row above, not its first — a grid row ends where its newest photo
    // does.
    const previous = previousRow?.messages[previousRow.messages.length - 1];

    const first = item.messages[0];
    const isMine = first.senderId === chat.myUserId;

    const showSenderName =
      !isMine && (!previous || previous.senderId !== first.senderId);

    return (
      <View className="pb-1.5">
        {needsDaySeparator(previous?.created_at, first.created_at) && (
          <View className="items-center py-2">
            <View className="rounded-full bg-white px-3 py-1 shadow-sm">
              <Text className="text-xs text-gray-500">
                {formatDayLabel(first.created_at)}
              </Text>
            </View>
          </View>
        )}

        {item.messages.length > 1 ? (
          <ChatImageGrid
            messages={item.messages}
            isMine={isMine}
            showSenderName={showSenderName}
            counterpartReadAt={chat.counterpartReadAt}
            counterpartDeliveredAt={chat.counterpartDeliveredAt}
            onPressImage={handlePressImage}
            onPressDelivery={handlePressDelivery}
          />
        ) : (
          <ChatMessageBubble
            message={first}
            isMine={isMine}
            showSenderName={showSenderName}
            counterpartReadAt={chat.counterpartReadAt}
            counterpartDeliveredAt={chat.counterpartDeliveredAt}
            onPressImage={handlePressImage}
            onPressDelivery={handlePressDelivery}
            onRetry={chat.retry}
          />
        )}
      </View>
    );
  };

  /**
   * The single bubble the thread shows for whatever the operation is doing
   * right now. Both hints can be lit at the same instant and only one may be
   * drawn, so the choice was already made in `chatPresenceHint` — it is read
   * here, never decided again.
   */
  const renderHintBubble = () => {
    if (chat.staffHint === "recording") return <ChatRecordingIndicator />;
    if (chat.staffHint === "typing") return <ChatTypingIndicator />;

    return null;
  };

  const renderBody = () => {
    if (chat.isLoading) {
      return (
        <View className="flex-1 items-center justify-center">
          <LoadingSpinner />
        </View>
      );
    }

    if (chat.moduleDisabled) {
      return (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="chatbubbles-outline" size={44} color="#9ca3af" />
          <Text className="mt-3 text-center text-base font-medium text-gray-700">
            O chat não está disponível
          </Text>
          <Text className="mt-1 text-center text-sm text-gray-500">
            O módulo Entregas não está habilitado para a sua empresa.
          </Text>
        </View>
      );
    }

    if (chat.loadError) {
      return (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="cloud-offline-outline" size={44} color="#9ca3af" />
          <Text className="mb-4 mt-3 text-center text-sm text-gray-500">
            {chat.loadError}
          </Text>
          <Button onPress={() => void chat.reload()}>Tentar de novo</Button>
        </View>
      );
    }

    if (chat.messages.length === 0) {
      return (
        <View className="flex-1 justify-center px-8">
          <View className="items-center">
            <Ionicons name="chatbubbles-outline" size={44} color="#9ca3af" />
            <Text className="mt-3 text-center text-base font-medium text-gray-700">
              Fale com a operação
            </Text>
            <Text className="mt-1 text-center text-sm text-gray-500">
              Dúvida no endereço? Cliente ausente? Escreva — ou toque no
              microfone e mande um áudio.
            </Text>
          </View>

          {/* The empty state has no list to hang a footer on, and this is
          precisely when the bubble matters most: the very first contact,
          where the driver would otherwise watch a blank screen while the
          base is already writing to him — or already talking into a
          microphone. */}
          {chat.staffHint && (
            <View className="mt-6 items-start">{renderHintBubble()}</View>
          )}
        </View>
      );
    }

    return (
      <FlatList
        ref={listRef}
        data={feed}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        onScroll={handleScroll}
        scrollEventThrottle={64}
        onContentSizeChange={handleContentSizeChange}
        // Prepending the past must not yank the reader's position.
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        contentContainerStyle={{ paddingVertical: 12 }}
        // The hint bubble — "digitando" or "gravando" — rides at the end of
        // the list, so it grows the content the same way a new message does,
        // and the same rule applies: a reader browsing the past is never
        // yanked down by it.
        ListFooterComponent={renderHintBubble()}
        ListHeaderComponent={
          chat.hasOlder ? (
            <View className="items-center pb-2">
              <TouchableOpacity
                onPress={() => void chat.loadOlder()}
                disabled={chat.isLoadingOlder}
                accessibilityRole="button"
                accessibilityLabel="Carregar mensagens anteriores"
                className="flex-row items-center gap-1 rounded-full border
                border-gray-200 bg-white px-3 py-1.5"
              >
                <Ionicons name="chevron-up" size={14} color="#374151" />
                <Text className="text-xs font-medium text-gray-700">
                  {chat.isLoadingOlder
                    ? "Carregando..."
                    : "Mensagens anteriores"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />
    );
  };

  return (
    <ProtectedRoute>
      {/* The plain View is the screen's real edge, and the SafeAreaView sits
      INSIDE it holding only the conversation. The media viewer has to be a
      sibling of that, not a child: with edge-to-edge on, the safe area is
      applied as PADDING, and an `absolute inset-0` child is laid out from the
      padding box — a "fullscreen" viewer would open between two pale bands
      where the status bar and the gesture bar are. */}
      <View className="flex-1 bg-gray-50">
        <SafeAreaView className="flex-1">
        {/* Header */}
        <View
          className="flex-row items-center gap-3 border-b border-gray-200
          bg-white px-4 py-3"
        >
          <TouchableOpacity
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </TouchableOpacity>

          <View
            className="h-10 w-10 items-center justify-center rounded-full
            bg-blue-100"
          >
            <Ionicons name="headset-outline" size={20} color="#2563eb" />
          </View>

          <View className="flex-1">
            <Text className="text-lg font-semibold text-gray-900">
              Chat com a operação
            </Text>
            {chat.staffHint ? (
              <Text className="text-xs font-medium text-blue-600">
                {chatPresenceHintLabel(chat.staffHint)}
              </Text>
            ) : (
              <Text className="text-xs text-gray-500">
                Central da sua empresa
              </Text>
            )}
          </View>
        </View>

        <StatusBanners />

        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {renderBody()}

          {!chat.moduleDisabled && (
            <ChatComposer
              onSend={chat.send}
              onSendMany={chat.sendMany}
              onTyping={chat.emitTyping}
              onRecording={chat.emitRecording}
              deliveryChip={deliveryChip}
              onClearDeliveryChip={() => setDeliveryChip(null)}
            />
          )}
        </KeyboardAvoidingView>

        </SafeAreaView>

        {/* Fullscreen image viewer: an absolute overlay, never an RN Modal —
        a Modal would sit above the root portal and hide the toasts. Being a
        sibling of the conversation is also what makes the drag-to-dismiss
        work: the chat is already drawn behind it, so the photo fades onto the
        real screen rather than onto a stand-in for it. */}
        {viewerAnchor && (
          <ChatMediaViewer
            gallery={gallery}
            anchor={viewerAnchor}
            onChangeAnchor={setViewerAnchor}
            onClose={handleCloseViewer}
            onRenewUrl={chat.renewAttachmentUrl}
          />
        )}
      </View>
    </ProtectedRoute>
  );
};

export default ChatScreen;
