import { useCallback, useMemo, useRef, useState } from "react";

import {
  FlatList,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { KeyboardAvoidingView } from "../../../components/ui/keyboard-avoiding-view";

import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";

import { ProtectedRoute } from "../../../components/protected-route";
import { StatusBanners } from "../../../components/status-banners";

import { Button, LoadingSpinner } from "../../../components/ui";
import {
  ChatComposer,
  TicketPickerSheet,
  ChatImageGrid,
  ChatMediaViewer,
  ChatMessageBubble,
  ChatRecordingIndicator,
  ChatTypingIndicator,
} from "../../../components/screens/chat";

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

import {
  contextOfTicket,
  useChatWithContext,
} from "@/features/chat/hooks/use-chat-with-context";
import { useDriverTickets } from "@/features/chat/hooks/use-driver-tickets";
import { useMyDeliveries } from "@/features/deliveries/hooks/use-my-deliveries";
import { deliveryCodeIndex } from "@/features/deliveries/delivery-identity-rules";
import Toast from "react-native-toast-message";
import {
  needsTicketSeparator,
  readCursorOf,
  ticketSeparatorLabel,
} from "@/features/chat/ticket-rules";

import type { ChatContextParams } from "@/features/chat/chat-context";
import { useThemeColors } from "@/hooks/use-theme";

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
  const colors = useThemeColors();

  const params =
    useLocalSearchParams<Record<keyof ChatContextParams, string>>();

  // The conversation and what the driver's messages are about (decision
  // 6.7), wired where the tests can mount them.
  const { chip, chat, composerContext, contextIsAutomatic } =
    useChatWithContext(params);

  // "Sobre o quê?" (decision 14.5, design §8.2): the driver picks the subject.
  const [isSubjectSheetOpen, setIsSubjectSheetOpen] = useState<boolean>(false);
  const driverTickets = useDriverTickets(isSubjectSheetOpen);

  // The order code on each message's delivery chip: the chat payload names a
  // delivery by recipient only, the cached day knows its code (the same
  // query the deliveries tab reads, nothing fetched for this).
  const { deliveries } = useMyDeliveries();
  const deliveryCodes = useMemo(
    () => deliveryCodeIndex(deliveries),
    [deliveries],
  );

  const handleNewSubject = async () => {
    try {
      const opened = await driverTickets.openNewSubject();

      chip.choose(contextOfTicket(opened.data));
      setIsSubjectSheetOpen(false);

      Toast.show({
        type: "success",
        text1: opened.created
          ? `Novo assunto #${opened.data.number}`
          : `Assunto #${opened.data.number}`,
        text2: opened.data.subject,
        position: "top",
      });
    } catch {
      Toast.show({
        type: "error",
        text1: "Não foi possível abrir um novo assunto",
        text2: "Verifique a conexão e tente de novo.",
        position: "top",
      });
    }
  };

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

  const { setViewingLatest } = chat;

  // Leaving the conversation silences the voice note that was playing and
  // releases the one native player the thread holds. A bubble that is no
  // longer on screen has no business still talking over whatever the driver
  // opened next, nor holding a decoder nobody is listening to.
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

      const nearBottom =
        contentSize.height - contentOffset.y - layoutMeasurement.height < 120;

      nearBottomRef.current = nearBottom;

      // Only what the driver can see is reported as read to the SAC.
      setViewingLatest(nearBottom);
    },
    [setViewingLatest],
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

  // The manual escape hatch: whatever the socket missed is fetched and folded
  // in, and the history on screen stays where it is. The empty conversation
  // gets it too — it is exactly where a missed first message would hide.
  const refreshControl = (
    <RefreshControl
      refreshing={chat.isRefreshing}
      onRefresh={() => void chat.refresh()}
      colors={[colors.primarySurface]}
      tintColor={colors.primary}
      progressBackgroundColor={colors.card}
    />
  );

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
            <View className="rounded-full border border-border bg-card px-3 py-1 shadow-sm">
              <Text className="text-xs text-muted">
                {formatDayLabel(first.created_at)}
              </Text>
            </View>
          </View>
        )}

        {/* Decision 14.5: one conversation, split by subject. */}
        {needsTicketSeparator(previous, first) && (
          <View className="items-center py-1.5" accessibilityRole="header">
            <Text
              className="px-4 text-center text-xs font-medium text-muted"
              numberOfLines={2}
            >
              {ticketSeparatorLabel(chat.tickets.get(first.ticketId ?? ""))}
            </Text>
          </View>
        )}

        {item.messages.length > 1 ? (
          <ChatImageGrid
            messages={item.messages}
            isMine={isMine}
            showSenderName={showSenderName}
            counterpartReadAt={readCursorOf(
              item.messages[item.messages.length - 1],
              chat.readCursors,
            )}
            counterpartDeliveredAt={chat.counterpartDeliveredAt}
            onPressImage={handlePressImage}
            onPressDelivery={handlePressDelivery}
            deliveryCodes={deliveryCodes}
          />
        ) : (
          <ChatMessageBubble
            message={first}
            isMine={isMine}
            showSenderName={showSenderName}
            counterpartReadAt={readCursorOf(first, chat.readCursors)}
            counterpartDeliveredAt={chat.counterpartDeliveredAt}
            onPressImage={handlePressImage}
            onPressDelivery={handlePressDelivery}
            onRetry={chat.retry}
            deliveryCodes={deliveryCodes}
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
          <Ionicons name="chatbubbles-outline" size={44} color={colors.muted} />
          <Text className="mt-3 text-center text-base font-medium text-ink-soft">
            O chat não está disponível
          </Text>
          <Text className="mt-1 text-center text-sm text-muted">
            O módulo Entregas não está habilitado para a sua empresa.
          </Text>
        </View>
      );
    }

    if (chat.loadError) {
      return (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons
            name="cloud-offline-outline"
            size={44}
            color={colors.muted}
          />
          <Text className="mb-4 mt-3 text-center text-sm text-muted">
            {chat.loadError}
          </Text>
          <Button onPress={() => void chat.reload()}>Tentar de novo</Button>
        </View>
      );
    }

    if (chat.messages.length === 0) {
      return (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: 32,
          }}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          <View className="items-center">
            <Ionicons
              name="chatbubbles-outline"
              size={44}
              color={colors.muted}
            />
            <Text className="mt-3 text-center text-base font-medium text-ink-soft">
              Fale com a operação
            </Text>
            <Text className="mt-1 text-center text-sm text-muted">
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
        </ScrollView>
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
        refreshControl={refreshControl}
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
                border-border bg-card px-3 py-1.5"
              >
                <Ionicons name="chevron-up" size={14} color={colors.inkSoft} />
                <Text className="text-xs font-medium text-ink-soft">
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
      <View className="flex-1 bg-background">
        <SafeAreaView className="flex-1">
          {/* Header */}
          <View
            className="flex-row items-center gap-3 border-b border-border
          bg-surface px-4 py-3"
          >
            <TouchableOpacity
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel="Voltar"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="arrow-back" size={22} color={colors.ink} />
            </TouchableOpacity>

            <View
              className="h-10 w-10 items-center justify-center rounded-full
            bg-primary-soft"
            >
              <Ionicons
                name="headset-outline"
                size={20}
                color={colors.primary}
              />
            </View>

            <View className="flex-1">
              <Text className="text-lg font-semibold text-ink">
                Chat com a operação
              </Text>
              {chat.staffHint ? (
                <Text className="text-xs font-medium text-primary">
                  {chatPresenceHintLabel(chat.staffHint)}
                </Text>
              ) : (
                <Text className="text-xs text-muted">
                  Central da sua empresa
                </Text>
              )}
            </View>
          </View>

          <StatusBanners />

          {/* "padding" like every other screen with a field: with edge-to-edge
            (SDK 54) Android no longer resizes the window for the keyboard,
            and `undefined` here left the composer under it (MOB-17). Not
            "height": on a flex-1 view the height it sets is ignored, and the
            Maestro chat flow found the composer still under the keyboard. */}
          <KeyboardAvoidingView className="flex-1" behavior="padding">
            {renderBody()}

            {!chat.moduleDisabled && (
              <ChatComposer
                onSend={chat.send}
                onSendMany={chat.sendMany}
                onTyping={chat.emitTyping}
                onRecording={chat.emitRecording}
                context={composerContext}
                contextIsAutomatic={contextIsAutomatic}
                onClearContext={chip.clear}
                onPressContext={() => setIsSubjectSheetOpen(true)}
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

        <TicketPickerSheet
          visible={isSubjectSheetOpen}
          onClose={() => setIsSubjectSheetOpen(false)}
          tickets={driverTickets.tickets}
          isLoading={driverTickets.isLoading}
          isError={driverTickets.isError}
          onRetry={() => void driverTickets.refetch()}
          currentTicketId={composerContext?.ticket?.id ?? null}
          onChoose={(ticket) => {
            chip.choose(contextOfTicket(ticket));
            setIsSubjectSheetOpen(false);
          }}
          onNewSubject={() => void handleNewSubject()}
          isOpening={driverTickets.isOpening}
        />
      </View>
    </ProtectedRoute>
  );
};

export default ChatScreen;
