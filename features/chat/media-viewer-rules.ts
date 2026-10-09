/**
 * The decisions behind the fullscreen photo viewer, kept apart from the
 * component that draws it.
 *
 * Two very different kinds of rule live here, and both are here for the same
 * reason: they are the parts that can be WRONG in a way nobody catches by
 * looking at the screen once.
 *
 * The first is IDENTITY. The gallery is derived from a conversation that moves
 * under the viewer — `loadOlder` prepends forty messages at a time and a socket
 * arrival can sort itself into the middle — so a raw numeric index silently
 * starts pointing at a different photo. The anchor below is a message identity,
 * and the index is derived from it on every render. That identity is not one
 * field either: a photo the driver just sent is born optimistic with a
 * `local-…` id that is REPLACED by the server's when the send confirms, and the
 * `client_submission_id` is the only thing that survives that swap.
 *
 * The second is GEOMETRY AND INTENT, read on the UI thread by the gesture. The
 * axis lock is the one that decides whether the component feels finished: the
 * direction is chosen once, from the first few pixels, and never re-opened for
 * the rest of the drag. A viewer that changes its mind halfway through — paging
 * a little, then dismissing a little — is the classic defect of this control,
 * and it is a defect of arithmetic, not of rendering.
 */

// The same predicate a voice note uses to tell a file it already holds from one
// it has to fetch. A pending photo points at the picker's file, and reusing the
// audio rule here is deliberate: two copies of `^file://` is one copy too many.
import { isLocalFileUri } from "./audio-cache-rules";

import type { ClientChatMessage } from "./types";

/**
 * What the viewer is pinned to. Never an index — see the note above.
 *
 * Both fields are kept because neither alone is enough: the id is what exists
 * for every message on the wire, and the submission id is what bridges the
 * instant an optimistic photo becomes a server one.
 */
interface MediaViewerAnchor {
  messageId: string;
  clientSubmissionId: string | null;
}

/** One photo of the conversation, as the viewer needs it. */
interface MediaViewerPhoto {
  anchor: MediaViewerAnchor;

  /** Signed and expiring, or a `file://` the picker handed over. */
  url: string;

  /**
   * The caption of THIS photo, never the batch's. The grid bubble shows the
   * one caption a batch carries on whichever tile holds it; here each photo
   * speaks only for itself, or the viewer would print the same sentence under
   * every sister image and claim it describes each of them.
   */
  caption: string | null;

  senderName: string;
  createdAt: string;

  pending: boolean;
  failed: boolean;
}

/** Which way a drag was resolved to go, decided once and then held. */
type MediaDragAxis = "undecided" | "horizontal" | "vertical";

/**
 * How far a finger has to travel before the pan takes the touch at all.
 *
 * Small, and NOT the same number as the lock below: the recogniser has to
 * claim the gesture early, while the decision it can never take back waits for
 * more evidence. The few pixels between the two are the price of that wait and
 * are not perceptible.
 */
const MEDIA_PAN_ACTIVATION = 8;

/**
 * How far the DOMINANT axis has to travel before the axis is chosen.
 *
 * Deliberately past the activation distance. Choosing at 8 px means choosing
 * from the first thing the hand did, and the first thing a hand does is not
 * what it meant — see the dominance ratio below.
 */
const MEDIA_AXIS_LOCK_THRESHOLD = 12;

/**
 * How many times longer the dominant axis has to be before it is believed.
 *
 * A thumb pivots at the base of the hand, so the opening pixels of a drag DOWN
 * come out sideways: `dx=9, dy=6` is a dismissal that has not finished turning
 * yet. Deciding it by `horizontal >= vertical` locks the whole gesture into
 * paging on a 3 px difference, and then the drag does NOTHING — `dragY` is
 * never written, the backdrop never clears, and the release resolves to no
 * page change either. A silent failure of the main gesture, decided by an
 * accident of anatomy.
 *
 * This is the same principle the voice-note scrubber uses with
 * `activeOffsetX([-4,4])` against `failOffsetY([-14,14])`, but not the same
 * number: there one axis is legitimate and the other is a list being scrolled,
 * which justifies 3.5:1. Here BOTH directions are things the driver means, so
 * the ratio only has to be wide enough that an arc cannot pass for a straight
 * line, and narrow enough that an honest slanted swipe still resolves at once.
 */
const MEDIA_AXIS_DOMINANCE = 1.5;

/**
 * The travel past which a drag that still picked no side is given to paging.
 *
 * Without it a near-perfect diagonal would stay undecided for the whole
 * gesture — the same silent nothing the dominance ratio exists to remove. A
 * tie goes to paging because this is a pager: dismissing on a movement that
 * was just as much sideways throws the conversation open on a gesture nobody
 * asked for.
 */
const MEDIA_AXIS_TIE_THRESHOLD = 20;

/** How much of the width has to be crossed for a release to change photo. */
const MEDIA_PAGE_DISTANCE_RATIO = 0.28;

/** The flick that changes photo without crossing that distance, in px/s. */
const MEDIA_PAGE_VELOCITY = 500;

/**
 * How much of a drag survives past the first or last photo.
 *
 * Not zero on purpose: a strip that refuses to move at all at the ends reads
 * as a frozen screen, and a strip that wraps around lies about how many photos
 * there are. A short, heavy pull says "this is the end" and springs back.
 */
const MEDIA_EDGE_RESISTANCE = 0.25;

/** How much of the height has to be crossed for a release to dismiss. */
const MEDIA_DISMISS_DISTANCE_RATIO = 0.2;

/** The fling that dismisses without crossing that distance, in px/s. */
const MEDIA_DISMISS_VELOCITY = 900;

/**
 * The drag, as a share of the height, at which the black backdrop is fully
 * gone and the conversation behind it is fully readable.
 *
 * Deliberately shorter than the screen: the point of the gesture is that the
 * driver SEES the chat coming back while still holding the photo, and decides
 * from that. A backdrop that only clears at the very bottom of the screen
 * would never show it in time.
 */
const MEDIA_DISMISS_FULL_RATIO = 0.5;

/** How small the photo gets at the far end of a dismiss drag. */
const MEDIA_DISMISS_MIN_SCALE = 0.6;

/**
 * How fast the chrome fades relative to the backdrop.
 *
 * Faster than the backdrop, so the counter and the caption are gone well
 * before the photo is — text sliding down the screen at a third of its size is
 * the part that reads as broken rather than as animated.
 */
const MEDIA_CHROME_FADE_FACTOR = 3;

function clampNumber(value: number, min: number, max: number): number {
  "worklet";

  return Math.min(max, Math.max(min, value));
}

/**
 * Whether a message is a photo the viewer can show.
 *
 * Wider than `isGroupableImage` on purpose. That rule answers "may this share
 * a grid", and excludes a failed send and a broadcast because of what their
 * BUBBLES have to say. Both of those still show a full photo on screen, so
 * both belong to the gallery — excluding them would build a gallery with a
 * hole the driver can tap straight into.
 */
function isViewableImage(message: ClientChatMessage): boolean {
  return message.kind === "IMAGE" && Boolean(message.attachment_url);
}

/** The identity to pin the viewer to when a bubble is tapped. */
function mediaViewerAnchor(message: ClientChatMessage): MediaViewerAnchor {
  return {
    messageId: message.id,
    clientSubmissionId: message.client_submission_id,
  };
}

/**
 * Every photo of the conversation, in the order the thread renders them.
 *
 * The list arrives ascending and the grouping into grid rows never reorders
 * anything, so a plain filter is exactly the order on screen — which is what
 * makes "the third photo of that batch" and "position 3 of the gallery" the
 * same photo.
 */
function buildMediaGallery(messages: ClientChatMessage[]): MediaViewerPhoto[] {
  return messages.filter(isViewableImage).map((message) => ({
    anchor: mediaViewerAnchor(message),
    url: message.attachment_url as string,
    caption: message.body,
    senderName: message.sender.name,
    createdAt: message.created_at,
    pending: Boolean(message.pending),
    failed: Boolean(message.failed),
  }));
}

/**
 * Where the anchored photo sits now, or -1 when it is gone.
 *
 * The submission id is the fallback and not the primary key because it is the
 * rarer of the two: only a message this device sent has one. The id match is
 * the normal path; the fallback exists for the single instant in which a send
 * confirms and the photo the driver is looking at is replaced by another
 * object holding the same picture.
 *
 * -1 is a real answer, not a failure: a gallery that no longer contains the
 * photo — a reload that dropped it out of the loaded window — has to close the
 * viewer, not show a neighbour and pretend nothing happened.
 */
function resolveAnchorIndex(
  gallery: MediaViewerPhoto[],
  anchor: MediaViewerAnchor,
): number {
  const byId = gallery.findIndex(
    (photo) => photo.anchor.messageId === anchor.messageId,
  );

  if (byId >= 0) return byId;

  if (!anchor.clientSubmissionId) return -1;

  return gallery.findIndex(
    (photo) =>
      photo.anchor.clientSubmissionId !== null &&
      photo.anchor.clientSubmissionId === anchor.clientSubmissionId,
  );
}

/**
 * The identity a mounted slot is keyed and recycled by.
 *
 * NOT the message id. A photo the driver just sent is born with a `local-…`
 * id that the server's id REPLACES the moment the send confirms, so keying by
 * it unmounts a slot that is already drawing the file from this device and
 * remounts it as a spinner in front of a driver who did nothing. The anchor
 * survives that swap through the submission id, and so must the view.
 *
 * A message that never had a submission id — anything the operation sent — can
 * only be its own id, which never changes for those.
 */
function mediaSlotKey(anchor: MediaViewerAnchor): string {
  return anchor.clientSubmissionId ?? anchor.messageId;
}

/** An index forced back inside the gallery. An empty gallery has no index. */
function clampGalleryIndex(index: number, length: number): number {
  "worklet";

  if (length <= 0) return 0;

  return clampNumber(Math.round(index), 0, length - 1);
}

/**
 * The only photos allowed to exist as views: the one on screen and its two
 * immediate neighbours.
 *
 * This is a requirement rather than a tuning knob. A thread with three hundred
 * photos mounting three hundred image views is a driver's phone running out of
 * memory, and the neighbours are here so that the next photo is already drawn
 * when the finger starts moving rather than after it stops.
 */
function mediaWindowIndexes(index: number, length: number): number[] {
  if (length <= 0) return [];

  const centre = clampGalleryIndex(index, length);

  return [centre - 1, centre, centre + 1].filter(
    (candidate) => candidate >= 0 && candidate < length,
  );
}

function hasPreviousPhoto(index: number): boolean {
  return index > 0;
}

function hasNextPhoto(index: number, length: number): boolean {
  return index < length - 1;
}

/** "3 / 12", the position the driver reads while paging. */
function mediaPositionLabel(index: number, length: number): string {
  if (length <= 0) return "";

  return `${clampGalleryIndex(index, length) + 1} / ${length}`;
}

/** What `expo-image` is handed for a chat photo. */
interface ChatImageSource {
  uri: string;

  /** The disk/memory cache identity, when the uri cannot be one. */
  cacheKey?: string;
}

/**
 * The cache identity of a chat photo: the MESSAGE, never the url (MOB-08).
 *
 * Attachment urls are signed per request, so the same photo comes back under
 * a new url on every listing, resync and re-signature. Cached by url — the
 * RN `Image` in the bubbles, and `expo-image` without a key in the viewer —
 * every one of those was a fresh download of every thumbnail on the driver's
 * data plan. Keyed by message, the bubble's download is also what the viewer
 * reads from disk when the photo is opened.
 */
function chatImageCacheKey(messageId: string): string {
  return `chat-image:${messageId}`;
}

/**
 * The source to draw a chat photo from. A `file://` the picker handed over is
 * read straight from disk and needs no key; anything remote gets the stable
 * one above — in the bubble, the grid and the viewer alike, so all three
 * share one cached copy.
 */
function chatImageSource(url: string, messageId: string): ChatImageSource {
  if (isLocalFileUri(url)) return { uri: url };

  return { uri: url, cacheKey: chatImageCacheKey(messageId) };
}

/**
 * Which way this drag is going — decided ONCE and then held by the caller for
 * the rest of the gesture.
 *
 * Three gates, in order. Not enough travel yet: no answer. One axis clearly
 * longer than the other: that one. Neither clearly longer, but far enough
 * along that waiting would itself be a bug: paging, because a tie on a pager
 * reads as paging.
 *
 * The middle gate is the one that matters. "Whoever crossed the threshold
 * first" is not a decision, it is a coin toss taken at the exact moment a hand
 * is least representative of what it is about to do.
 */
function resolveDragAxis(dx: number, dy: number): MediaDragAxis {
  "worklet";

  const horizontal = Math.abs(dx);
  const vertical = Math.abs(dy);

  const travelled = Math.max(horizontal, vertical);

  if (travelled < MEDIA_AXIS_LOCK_THRESHOLD) return "undecided";

  if (horizontal >= vertical * MEDIA_AXIS_DOMINANCE) return "horizontal";
  if (vertical >= horizontal * MEDIA_AXIS_DOMINANCE) return "vertical";

  // Still ambiguous: give the arc a little longer to declare itself.
  if (travelled < MEDIA_AXIS_TIE_THRESHOLD) return "undecided";

  return "horizontal";
}

/**
 * How far the strip may actually follow a horizontal drag.
 *
 * Two things happen here. Past the first or the last photo the movement is
 * damped, because there is nothing to page to and the gallery never wraps. And
 * the travel is capped at one full width, so a single flick can never expose a
 * fourth photo the window has not mounted.
 */
function resistedPagePan(
  dx: number,
  index: number,
  length: number,
  width: number,
): number {
  "worklet";

  const atFirst = index <= 0 && dx > 0;
  const atLast = index >= length - 1 && dx < 0;

  const travelled = atFirst || atLast ? dx * MEDIA_EDGE_RESISTANCE : dx;

  const span = Math.abs(width);

  return clampNumber(travelled, -span, span);
}

interface PageStepInput {
  dx: number;
  velocityX: number;
  width: number;
  index: number;
  length: number;
}

/**
 * What a released horizontal drag asked for: the previous photo (-1), the next
 * one (1), or the one already on screen (0).
 *
 * Never wraps. At either end the answer is 0 and the strip springs back, which
 * is the honest way to say "there is nothing after this" — the alternative,
 * jumping to the other end of the conversation, is a photo the driver did not
 * ask for.
 */
function resolvePageStep(input: PageStepInput): -1 | 0 | 1 {
  "worklet";

  const direction: -1 | 0 | 1 = input.dx < 0 ? 1 : input.dx > 0 ? -1 : 0;

  if (direction === 0) return 0;

  // A flick back the way it came cancels the drag however far it had gone —
  // the driver changed their mind mid-gesture, and the last thing their hand
  // did is what they meant.
  const flungBack =
    direction === 1
      ? input.velocityX >= MEDIA_PAGE_VELOCITY
      : input.velocityX <= -MEDIA_PAGE_VELOCITY;

  if (flungBack) return 0;

  const farEnough =
    Math.abs(input.dx) >= Math.abs(input.width) * MEDIA_PAGE_DISTANCE_RATIO;

  const fastEnough = Math.abs(input.velocityX) >= MEDIA_PAGE_VELOCITY;

  if (!farEnough && !fastEnough) return 0;

  const target = input.index + direction;

  if (target < 0 || target >= input.length) return 0;

  return direction;
}

interface DismissInput {
  dy: number;
  velocityY: number;
  height: number;
}

/**
 * Whether a released vertical drag closes the viewer.
 *
 * Up and down both dismiss, which is what the driver described and what
 * WhatsApp does: the photo goes away in whichever direction it was pushed.
 */
function shouldDismissDrag(input: DismissInput): boolean {
  "worklet";

  const direction = input.dy < 0 ? -1 : input.dy > 0 ? 1 : 0;

  if (direction === 0) return false;

  const flungBack =
    direction === 1
      ? input.velocityY <= -MEDIA_DISMISS_VELOCITY
      : input.velocityY >= MEDIA_DISMISS_VELOCITY;

  if (flungBack) return false;

  const farEnough =
    Math.abs(input.dy) >= Math.abs(input.height) * MEDIA_DISMISS_DISTANCE_RATIO;

  const fastEnough = Math.abs(input.velocityY) >= MEDIA_DISMISS_VELOCITY;

  return farEnough || fastEnough;
}

/** How far along the dismissal a drag is, 0..1. Up and down count the same. */
function dismissProgress(dy: number, height: number): number {
  "worklet";

  const full = Math.abs(height) * MEDIA_DISMISS_FULL_RATIO;

  if (full <= 0) return 0;

  return clampNumber(Math.abs(dy) / full, 0, 1);
}

/** How opaque the black behind the photo is — 0 is the conversation itself. */
function backdropOpacity(progress: number): number {
  "worklet";

  return clampNumber(1 - progress, 0, 1);
}

/** How big the photo is drawn as it is pushed away. */
function dismissScale(progress: number): number {
  "worklet";

  const shrink = 1 - MEDIA_DISMISS_MIN_SCALE;

  return clampNumber(
    1 - clampNumber(progress, 0, 1) * shrink,
    MEDIA_DISMISS_MIN_SCALE,
    1,
  );
}

/** How visible the counter, the caption and the buttons are during a drag. */
function chromeOpacity(progress: number): number {
  "worklet";

  return clampNumber(1 - progress * MEDIA_CHROME_FADE_FACTOR, 0, 1);
}

export {
  MEDIA_PAN_ACTIVATION,
  MEDIA_AXIS_LOCK_THRESHOLD,
  MEDIA_AXIS_DOMINANCE,
  MEDIA_AXIS_TIE_THRESHOLD,
  MEDIA_PAGE_DISTANCE_RATIO,
  MEDIA_PAGE_VELOCITY,
  MEDIA_EDGE_RESISTANCE,
  MEDIA_DISMISS_DISTANCE_RATIO,
  MEDIA_DISMISS_VELOCITY,
  MEDIA_DISMISS_FULL_RATIO,
  MEDIA_DISMISS_MIN_SCALE,
  MEDIA_CHROME_FADE_FACTOR,
  isViewableImage,
  mediaViewerAnchor,
  buildMediaGallery,
  resolveAnchorIndex,
  mediaSlotKey,
  clampGalleryIndex,
  mediaWindowIndexes,
  hasPreviousPhoto,
  hasNextPhoto,
  mediaPositionLabel,
  chatImageCacheKey,
  chatImageSource,
  resolveDragAxis,
  resistedPagePan,
  resolvePageStep,
  shouldDismissDrag,
  dismissProgress,
  backdropOpacity,
  dismissScale,
  chromeOpacity,
};

export type {
  ChatImageSource,
  MediaViewerAnchor,
  MediaViewerPhoto,
  MediaDragAxis,
  PageStepInput,
  DismissInput,
};
