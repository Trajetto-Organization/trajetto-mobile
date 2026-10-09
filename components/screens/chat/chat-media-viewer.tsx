import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ActivityIndicator,
  BackHandler,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@expo/vector-icons/Ionicons";

import { formatMessageClock } from "@/features/chat/chat-rules";
import { isLocalFileUri } from "@/features/chat/audio-cache-rules";

import {
  MEDIA_PAN_ACTIVATION,
  backdropOpacity,
  chromeOpacity,
  dismissProgress,
  dismissScale,
  hasNextPhoto,
  hasPreviousPhoto,
  mediaPositionLabel,
  mediaSlotKey,
  mediaWindowIndexes,
  chatImageSource,
  resistedPagePan,
  resolveAnchorIndex,
  resolveDragAxis,
  resolvePageStep,
  shouldDismissDrag,
  type MediaDragAxis,
  type MediaViewerAnchor,
  type MediaViewerPhoto,
} from "@/features/chat/media-viewer-rules";

/**
 * The one spring the viewer uses, for paging and for a drag that came back.
 * Overshoot is clamped on purpose: a bounce past the resting place would flash
 * a sliver of the neighbouring photo at the very moment the strip settles.
 */
const MEDIA_SPRING = {
  damping: 26,
  stiffness: 240,
  mass: 0.7,
  overshootClamping: true,
} as const;

/** How long the photo takes to leave the screen once the drag committed. */
const MEDIA_EXIT_MS = 180;

/** The fade-in of a photo that had to be fetched. */
const MEDIA_FADE_MS = 120;

/** Half the side of the round buttons, to centre them by hand on the axis. */
const CONTROL_HALF = 20;

/**
 * What one slot is doing.
 *
 * `renewing` is not a flavour of `loading`: while a fresh signature is being
 * fetched the image view must stay UNMOUNTED, or it spends a second refusal
 * on the very url that just failed.
 */
type MediaSlotStatus = "loading" | "renewing" | "ready" | "error";

interface MediaViewerSlotProps {
  photo: MediaViewerPhoto;

  /** The photo's position in the GALLERY, not in the window. See the note in
   * `ChatMediaViewer` about why the slot is placed by an absolute index. */
  index: number;

  width: number;
  reduceMotion: boolean;

  /**
   * Re-signs THIS photo and patches the conversation with the new url.
   * Answers whether a fresh signature actually arrived.
   */
  onRenewUrl: (messageId: string) => Promise<boolean>;
}

/**
 * One photo of the window.
 *
 * Drawn with `expo-image`, like the bubbles, and from the SAME cache entry:
 * the source carries the message's cache key (`chatImageSource`), so a photo
 * whose thumbnail was already downloaded opens from disk. What the viewer adds
 * is a typed `onError` (an attachment url is signed and expires, and a silent
 * black rectangle is the worst possible answer to that) and a `recyclingKey`
 * so a recycled view never shows the previous photo for a frame.
 *
 * It is also its own component so that zoom — deliberately out of scope for
 * now — has somewhere to land later: a pinch belongs to a single photo, not to
 * the strip that carries three of them.
 */
const MediaViewerSlot = ({
  photo,
  index,
  width,
  reduceMotion,
  onRenewUrl,
}: MediaViewerSlotProps) => {
  const [status, setStatus] = useState<MediaSlotStatus>("loading");

  // Bumping this remounts the image view, which is the only way to ask for the
  // same source again.
  const [attempt, setAttempt] = useState<number>(0);

  const isLocal = isLocalFileUri(photo.url);

  /**
   * The error state must never outlive the url that caused it.
   *
   * The same photo arrives here with a NEW signature whenever it is re-signed
   * — by the retry below, or by a reload of the conversation. While `status`
   * is `error` the image view is unmounted, so without this reset nothing
   * would ever ask for the fresh url and the slot would stay broken for good.
   *
   * Adjusting state during render is React's own answer to "reset state when a
   * prop changes": it costs one extra render pass and, unlike an effect, never
   * shows the stale error for a frame first.
   */
  const shownUrlRef = useRef<string>(photo.url);

  if (shownUrlRef.current !== photo.url) {
    shownUrlRef.current = photo.url;
    setStatus("loading");
  }

  const handleRetry = useCallback(() => {
    // A photo still sitting on this device has no signature to renew: asking
    // the image view for the file again is everything a retry can do for it.
    if (isLocal) {
      setStatus("loading");
      setAttempt((current) => current + 1);

      return;
    }

    // An expired signature cannot be revived by asking for the same url again,
    // so ONE photo is re-signed — never the conversation. Reloading the thread
    // from here is what used to close the viewer on top of the driver.
    setStatus("renewing");

    void onRenewUrl(photo.anchor.messageId).then((renewed) => {
      if (!renewed) {
        setStatus("error");

        return;
      }

      // The patched url normally arrives as a prop and the reset above mounts
      // the image on its own. The remount is asked for here as well because a
      // signature that came back byte-identical changes no prop at all, and
      // the slot would otherwise spin forever.
      setAttempt((current) => current + 1);
      setStatus("loading");
    });
  }, [isLocal, onRenewUrl, photo.anchor.messageId]);

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        width,
        transform: [{ translateX: index * width }],
      }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={photo.caption ?? `Foto de ${photo.senderName}`}
    >
      {(status === "loading" || status === "ready") && (
        <Image
          key={`${mediaSlotKey(photo.anchor)}-${attempt}`}
          // The url is NOT an identity here — it is signed and comes back
          // different on every load of the same photo. The cache is keyed by
          // the message (the same key the bubble used), and the view is
          // recycled by the anchor, which survives an optimistic photo being
          // confirmed: see `mediaSlotKey`.
          source={chatImageSource(photo.url, photo.anchor.messageId)}
          recyclingKey={mediaSlotKey(photo.anchor)}
          contentFit="contain"
          cachePolicy="memory-disk"
          priority="high"
          transition={reduceMotion ? 0 : MEDIA_FADE_MS}
          onLoadStart={() => setStatus("loading")}
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
          style={{ flex: 1 }}
        />
      )}

      {(status === "loading" || status === "renewing") && (
        <View style={StyleSheet.absoluteFill} className="items-center justify-center">
          <ActivityIndicator color="#ffffff" />
        </View>
      )}

      {status === "error" && (
        <View
          style={StyleSheet.absoluteFill}
          className="items-center justify-center px-10"
        >
          <Ionicons name="image-outline" size={44} color="#9ca3af" />

          <Text className="mt-3 text-center text-base font-medium text-white">
            Não foi possível carregar a foto
          </Text>

          <Text className="mt-1 text-center text-sm text-white/70">
            {isLocal
              ? "O arquivo não está mais no aparelho."
              : "O link da imagem pode ter expirado."}
          </Text>

          <TouchableOpacity
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Tentar carregar a foto de novo"
            className="mt-4 flex-row items-center gap-1.5 rounded-full
            bg-white/20 px-4 py-2"
          >
            <Ionicons name="refresh" size={16} color="#ffffff" />
            <Text className="text-sm font-medium text-white">
              Tentar de novo
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

interface ChatMediaViewerProps {
  /** Every photo of the loaded conversation, in the order the thread shows. */
  gallery: MediaViewerPhoto[];

  /** Which photo is on screen — an identity, never a position. */
  anchor: MediaViewerAnchor;

  onChangeAnchor: (anchor: MediaViewerAnchor) => void;
  onClose: () => void;

  /**
   * Re-signs ONE photo and patches the conversation with the new url.
   *
   * Never a reload of the thread: that replaces the list with the forty newest
   * messages, drops the anchored photo out of the gallery and closes this
   * viewer while the driver is still looking at it.
   */
  onRenewUrl: (messageId: string) => Promise<boolean>;
}

/**
 * The fullscreen photo viewer: swipe sideways through the conversation's
 * photos, drag up or down to throw the current one away.
 *
 * THREE THINGS DECIDE THE SHAPE OF THIS COMPONENT.
 *
 * It is an absolute overlay and never an RN `Modal` — a Modal sits above the
 * root portal and would hide the toasts. It lives inside the chat screen's own
 * tree for the same reason the dismissal works at all: the conversation is
 * already drawn behind it, so revealing the chat is nothing but fading the
 * black backdrop out. There is no snapshot and no placeholder involved.
 *
 * Its parent has to be a box with NO padding of its own. Yoga 3 positions an
 * absolute child from the PADDING box, so a `SafeAreaView` for a parent would
 * leave the status bar and the gesture bar strips uncovered and this
 * "fullscreen" viewer would sit between two pale bands.
 *
 * Only three photos exist as views at any moment — the one on screen and its
 * two neighbours. A thread with three hundred photos would otherwise mount
 * three hundred image views on a phone that has other work to do.
 *
 * And the strip is positioned by ABSOLUTE gallery index, not by a position
 * inside the window. That is what makes recycling invisible: when the window
 * slides from {4,5,6} to {5,6,7}, every photo that stayed keeps the exact
 * `index * width` offset it already had, so the React commit that swaps the
 * mounted set cannot move anything on screen. The alternative — offsets
 * relative to the window's centre — needs the strip's translation and the
 * mounted set to change in the same frame, and the one frame where they
 * disagree is a full screen width of jump.
 *
 * Nothing in the gesture path crosses into React. The finger writes shared
 * values on the UI thread; the only trips back to JS are one per committed
 * page change and one on close.
 */
const ChatMediaViewer = ({
  gallery,
  anchor,
  onChangeAnchor,
  onClose,
  onRenewUrl,
}: ChatMediaViewerProps) => {
  const reduceMotion = useReducedMotion();
  const screen = useWindowDimensions();

  // The window is the honest starting guess; `onLayout` replaces it with what
  // the overlay actually got, which is what the paging arithmetic needs.
  const [viewport, setViewport] = useState<{ width: number; height: number }>({
    width: screen.width,
    height: screen.height,
  });

  const length = gallery.length;

  // Derived on every render, never stored: the conversation moves underneath.
  const index = resolveAnchorIndex(gallery, anchor);
  const photo = index >= 0 ? gallery[index] : undefined;

  /** The committed photo, UI-thread side. The gesture reads it every frame. */
  const page = useSharedValue<number>(Math.max(0, index));

  /** The strip's translation in pixels. Rest for photo i is `-i * width`. */
  const offset = useSharedValue<number>(-Math.max(0, index) * viewport.width);

  const dragY = useSharedValue<number>(0);
  const axis = useSharedValue<MediaDragAxis>("undecided");

  /**
   * True from the moment a dismissal starts flying out.
   *
   * The exit is a `withTiming` whose callback closes the viewer only when it
   * reports `finished`. Any later write to `dragY` cancels it, the callback
   * arrives with `finished === false` and the viewer simply stays open — and
   * `onFinalize` writes to `dragY` for every gesture that did not succeed,
   * which includes a touch that never travelled far enough to activate the
   * pan. A finger brushing the screen during those 180 ms is enough, and the
   * chat is already showing through by then, so brushing it is the natural
   * thing to do.
   */
  const leaving = useSharedValue<boolean>(false);

  const parkedWidth = useRef<number>(viewport.width);

  // The gesture must not capture the gallery: cloning a three-hundred entry
  // array into a worklet on every render is exactly the cost this component
  // exists to avoid. It hands back an index, and the anchor is looked up here.
  const galleryRef = useRef<MediaViewerPhoto[]>(gallery);
  galleryRef.current = gallery;

  const commitPage = useCallback(
    (target: number) => {
      const next = galleryRef.current[target];

      if (!next) return;

      onChangeAnchor(next.anchor);
    },
    [onChangeAnchor],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;

    setViewport((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, []);

  // A photo that left the gallery — a reload that dropped it out of the loaded
  // window — has nothing left to show. Closing is the honest answer; sliding to
  // a neighbour would silently show a photo nobody asked for.
  useEffect(() => {
    if (index < 0) onClose();
  }, [index, onClose]);

  /**
   * Parks the strip when something OTHER than navigation moved it.
   *
   * Two causes: the gallery re-indexed under the viewer (older messages
   * prepended, a socket arrival sorted into the middle), or the screen changed
   * size. Neither is a swipe, so neither animates.
   *
   * The guard is `page.value`, not the index the effect was fired for, and
   * that is the whole point: a page change agrees on its own index ON THE UI
   * THREAD before React ever hears about it, so by the time this runs the two
   * already match and the spring in flight is left alone.
   */
  useEffect(() => {
    if (index < 0) return;

    const resized = parkedWidth.current !== viewport.width;
    const reindexed = page.value !== index;

    if (!resized && !reindexed) return;

    parkedWidth.current = viewport.width;

    cancelAnimation(offset);

    page.value = index;
    offset.value = -index * viewport.width;
  }, [index, viewport.width, offset, page]);

  // No `Image.prefetch` of the ring outside the window any more: in this
  // expo-image version it caches by URL and cannot take a cache key, so with
  // signed urls it downloaded a copy nobody would ever read (MOB-08). The
  // neighbours are mounted as real views, and any photo whose bubble was on
  // screen is already on disk under the key the viewer reads.

  // With the viewer open the hardware back button closes the PHOTO. Without
  // this it would run the router's navigation and leave the chat screen
  // entirely, which is not what a driver pressing back on a photo means. The
  // listener only exists while the overlay is mounted.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        onClose();

        return true;
      },
    );

    return () => subscription.remove();
  }, [onClose]);

  // Nothing may outlive the overlay: a spring still running on a closed viewer
  // is a driver's battery being spent on a photo nobody is looking at.
  useEffect(
    () => () => {
      cancelAnimation(offset);
      cancelAnimation(dragY);
    },
    [offset, dragY],
  );

  const width = viewport.width;
  const height = viewport.height;

  const pan = useMemo(() => {
    return (
      Gesture.Pan()
        // Both axes activate, because both are real gestures here. Which one
        // this drag IS gets decided once, below, and then held.
        .activeOffsetX([-MEDIA_PAN_ACTIVATION, MEDIA_PAN_ACTIVATION])
        .activeOffsetY([-MEDIA_PAN_ACTIVATION, MEDIA_PAN_ACTIVATION])
        .onStart(() => {
          axis.value = "undecided";
        })
        .onUpdate((event) => {
          // THE LOCK. Once an axis is chosen it is not reconsidered for the
          // rest of the drag — a viewer that pages a little and then dismisses
          // a little is the classic broken version of this control.
          if (axis.value === "undecided") {
            axis.value = resolveDragAxis(
              event.translationX,
              event.translationY,
            );
          }

          if (axis.value === "horizontal") {
            offset.value =
              -page.value * width +
              resistedPagePan(event.translationX, page.value, length, width);

            return;
          }

          if (axis.value === "vertical") {
            dragY.value = event.translationY;
          }
        })
        .onEnd((event) => {
          if (axis.value === "vertical") {
            const dismissing = shouldDismissDrag({
              dy: event.translationY,
              velocityY: event.velocityY,
              height,
            });

            if (!dismissing) {
              dragY.value = reduceMotion ? 0 : withSpring(0, MEDIA_SPRING);

              return;
            }

            if (reduceMotion) {
              runOnJS(onClose)();

              return;
            }

            leaving.value = true;

            const exitTo = event.translationY < 0 ? -height : height;

            dragY.value = withTiming(
              exitTo,
              { duration: MEDIA_EXIT_MS },
              (finished) => {
                if (finished) runOnJS(onClose)();
              },
            );

            return;
          }

          if (axis.value !== "horizontal") return;

          const step = resolvePageStep({
            dx: event.translationX,
            velocityX: event.velocityX,
            width,
            index: page.value,
            length,
          });

          const target = page.value + step;

          // The committed index moves here, on the UI thread, so the very next
          // frame of the spring already measures from the new resting place.
          page.value = target;

          offset.value = reduceMotion
            ? -target * width
            : withSpring(-target * width, MEDIA_SPRING);

          // The only crossing into React in the whole gesture, and it happens
          // once per photo change rather than once per frame.
          if (step !== 0) runOnJS(commitPage)(target);
        })
        .onFinalize((_event, success) => {
          axis.value = "undecided";

          if (success) return;

          // A photo already flying off the screen is not parked — touching
          // `dragY` here would cancel its exit, the timing callback would
          // report `finished === false`, and the viewer would stay open over
          // a photo the driver already threw away.
          if (leaving.value) return;

          // A cancelled touch — the losing side of a race, a call coming in —
          // must never leave the photo parked between two states.
          offset.value = reduceMotion
            ? -page.value * width
            : withSpring(-page.value * width, MEDIA_SPRING);

          dragY.value = reduceMotion ? 0 : withSpring(0, MEDIA_SPRING);
        })
    );
  }, [
    axis,
    commitPage,
    dragY,
    height,
    leaving,
    length,
    offset,
    onClose,
    page,
    reduceMotion,
    width,
  ]);

  const backdropStyle = useAnimatedStyle(
    () => ({
      opacity: backdropOpacity(dismissProgress(dragY.value, height)),
    }),
    [height],
  );

  const contentStyle = useAnimatedStyle(() => {
    const progress = dismissProgress(dragY.value, height);

    return {
      transform: [
        { translateY: dragY.value },
        { scale: dismissScale(progress) },
      ],
    };
  }, [height]);

  const stripStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const chromeStyle = useAnimatedStyle(
    () => ({
      opacity: chromeOpacity(dismissProgress(dragY.value, height)),
    }),
    [height],
  );

  const goTo = useCallback(
    (step: -1 | 1) => {
      const target = index + step;

      if (target < 0 || target >= length) return;

      cancelAnimation(offset);

      page.value = target;

      offset.value = reduceMotion
        ? -target * width
        : withSpring(-target * width, MEDIA_SPRING);

      commitPage(target);
    },
    [commitPage, index, length, offset, page, reduceMotion, width],
  );

  const windowIndexes = useMemo(
    () => mediaWindowIndexes(index, length),
    [index, length],
  );

  // The close effect above is already on its way out; rendering nothing keeps
  // this render from reaching into an index that is not there.
  if (!photo || index < 0) return null;

  const showsPaging = length > 1;

  return (
    <View
      className="absolute inset-0 z-50"
      onLayout={handleLayout}
      accessibilityViewIsModal
    >
      {/* The viewer is black in both themes: light icons while it is open,
      and the root's themed bar comes back when it unmounts. */}
      <StatusBar style="light" />

      {/* The only thing between the photo and the conversation. Fading it is
      the whole trick: the chat behind is the real screen, not a picture of
      one. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: "#000000" }, backdropStyle]}
        pointerEvents="none"
      />

      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flex: 1 }, contentStyle]}>
          {/* Clipped, so the neighbours never peek in while the photo shrinks
          under a dismissal. */}
          <View style={{ flex: 1, overflow: "hidden" }}>
            <Animated.View style={[StyleSheet.absoluteFill, stripStyle]}>
              {windowIndexes.map((slot) => (
                <MediaViewerSlot
                  key={mediaSlotKey(gallery[slot].anchor)}
                  photo={gallery[slot]}
                  index={slot}
                  width={width}
                  reduceMotion={reduceMotion}
                  onRenewUrl={onRenewUrl}
                />
              ))}
            </Animated.View>
          </View>
        </Animated.View>
      </GestureDetector>

      {/* The chrome stays put while the photo is dragged away, and fades out
      ahead of it. `box-none` so everything except the buttons themselves lets
      the drag through to the photo underneath. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, chromeStyle]}
        pointerEvents="box-none"
      >
        <SafeAreaView className="flex-1" pointerEvents="box-none">
          <View
            className="flex-row items-center justify-between px-4 py-2"
            pointerEvents="box-none"
          >
            {showsPaging ? (
              <View
                className="rounded-full bg-black/40 px-3 py-1"
                pointerEvents="none"
              >
                <Text
                  className="text-sm font-medium text-white"
                  accessibilityLabel={`Foto ${index + 1} de ${length}`}
                >
                  {mediaPositionLabel(index, length)}
                </Text>
              </View>
            ) : (
              <View />
            )}

            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Fechar imagem"
              className="h-10 w-10 items-center justify-center rounded-full
              bg-white/20"
            >
              <Ionicons name="close" size={22} color="#ffffff" />
            </TouchableOpacity>
          </View>

          <View className="flex-1" pointerEvents="box-none">
            {/* At the ends the arrow is GONE, not greyed out: there is no
            previous photo before the first one, and an inert button is a
            promise the gallery cannot keep. */}
            {showsPaging && hasPreviousPhoto(index) && (
              <TouchableOpacity
                onPress={() => goTo(-1)}
                accessibilityRole="button"
                accessibilityLabel="Foto anterior"
                className="absolute left-3 h-10 w-10 items-center justify-center
                rounded-full bg-white/20"
                style={{ top: "50%", marginTop: -CONTROL_HALF }}
              >
                <Ionicons name="chevron-back" size={22} color="#ffffff" />
              </TouchableOpacity>
            )}

            {showsPaging && hasNextPhoto(index, length) && (
              <TouchableOpacity
                onPress={() => goTo(1)}
                accessibilityRole="button"
                accessibilityLabel="Próxima foto"
                className="absolute right-3 h-10 w-10 items-center
                justify-center rounded-full bg-white/20"
                style={{ top: "50%", marginTop: -CONTROL_HALF }}
              >
                <Ionicons name="chevron-forward" size={22} color="#ffffff" />
              </TouchableOpacity>
            )}
          </View>

          {/* Who sent it, when, and what they wrote — the caption of THIS
          photo, never the batch's. */}
          <View className="px-4 pb-2" pointerEvents="none">
            <View className="flex-row items-center gap-2">
              <Text className="text-sm font-medium text-white">
                {photo.senderName}
              </Text>

              <Text className="text-xs text-white/70">
                {formatMessageClock(photo.createdAt)}
              </Text>

              {photo.pending && (
                <Text className="text-xs text-white/70">· Enviando...</Text>
              )}

              {photo.failed && (
                <Text className="text-xs text-red-300">· Não enviada</Text>
              )}
            </View>

            {photo.caption ? (
              <Text
                numberOfLines={4}
                className="mt-1 text-[15px] leading-5 text-white"
              >
                {photo.caption}
              </Text>
            ) : null}
          </View>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
};

export { ChatMediaViewer };
export type { ChatMediaViewerProps };
