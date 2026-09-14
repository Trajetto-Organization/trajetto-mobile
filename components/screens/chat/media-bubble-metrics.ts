/**
 * The geometry every bubble that carries a picture shares.
 *
 * It lives in one place because of the rule it encodes: IN A MEDIA BUBBLE THE
 * MEDIA DECIDES THE WIDTH, and the caption wraps inside it. Letting the text
 * decide instead is what produced the reported bug — a long caption stretched
 * the bubble to its 82% ceiling while the photo grid stayed at its natural
 * size, leaving the tiles pinned to the left of a wide empty balloon.
 *
 * So the numbers below are a single truth for both bubbles: one photo and a
 * grid of photos come out exactly the same width, which is also what makes a
 * thread mixing the two look deliberate rather than ragged.
 */

/** Side of one tile in the grid. Two of them plus a gap set the media width. */
const MEDIA_TILE_SIZE = 104;

/** The hairline between tiles — a seam, not a margin. */
const MEDIA_TILE_GAP = 3;

/**
 * What a media bubble puts around the picture. Tight on purpose: a photo
 * floating in generous padding reads as an attachment, a photo hugged by the
 * bubble reads as the message.
 */
const MEDIA_BUBBLE_PADDING = 6;

/** The width of the picture area — the grid, and a single photo alike. */
const MEDIA_CONTENT_WIDTH = MEDIA_TILE_SIZE * 2 + MEDIA_TILE_GAP;

/** The bubble itself. Fixed, because the media is what sets it. */
const MEDIA_BUBBLE_WIDTH = MEDIA_CONTENT_WIDTH + MEDIA_BUBBLE_PADDING * 2;

/**
 * Height of a lone photo. Landscape-ish, so a portrait shot still shows a
 * useful crop and the bubble does not swallow the screen.
 */
const SINGLE_IMAGE_HEIGHT = 176;

export {
  MEDIA_TILE_SIZE,
  MEDIA_TILE_GAP,
  MEDIA_BUBBLE_PADDING,
  MEDIA_CONTENT_WIDTH,
  MEDIA_BUBBLE_WIDTH,
  SINGLE_IMAGE_HEIGHT,
};
