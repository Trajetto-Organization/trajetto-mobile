import { describe, expect, it } from "vitest";

import {
  MEDIA_DISMISS_VELOCITY,
  MEDIA_PAGE_VELOCITY,
  backdropOpacity,
  buildMediaGallery,
  chromeOpacity,
  clampGalleryIndex,
  dismissProgress,
  dismissScale,
  hasNextPhoto,
  hasPreviousPhoto,
  isViewableImage,
  mediaPositionLabel,
  mediaViewerAnchor,
  mediaWindowIndexes,
  chatImageCacheKey,
  chatImageSource,
  resistedPagePan,
  resolveAnchorIndex,
  resolveDragAxis,
  resolvePageStep,
  shouldDismissDrag,
} from "@/features/chat/media-viewer-rules";

import type { ChatMessage, ClientChatMessage } from "@/features/chat/types";

const DRIVER_USER = "user-driver";
const AGENT_USER = "user-agent";

function makeMessage(
  overrides: Partial<ChatMessage> & { id: string },
): ChatMessage {
  return {
    kind: "TEXT",
    body: "olá",
    attachment_url: null,
    duration_ms: null,
    deliveryId: null,
    broadcast_id: null,
    client_submission_id: null,
    threadId: "thread-1",
    senderId: AGENT_USER,
    sender: { id: AGENT_USER, name: "Atendente" },
    delivery: null,
    created_at: "2026-08-31T12:00:00.000Z",
    ...overrides,
  };
}

/** A photo message, at a given minute of the same hour. */
const photo = (
  id: string,
  minute: number,
  overrides: Partial<ClientChatMessage> = {},
): ClientChatMessage =>
  ({
    ...makeMessage({
      id,
      kind: "IMAGE",
      body: null,
      attachment_url: `https://cdn.example.com/${id}.jpg?sig=abc`,
      created_at: `2026-08-31T12:${String(minute).padStart(2, "0")}:00.000Z`,
    }),
    ...overrides,
  }) as ClientChatMessage;

// ------------------------------------------------------------------ gallery
describe("the gallery is the conversation, in the conversation's order", () => {
  it("keeps only photos, in the order they were given", () => {
    const gallery = buildMediaGallery([
      photo("p1", 0),
      makeMessage({ id: "t1" }) as ClientChatMessage,
      photo("p2", 1),
      makeMessage({
        id: "a1",
        kind: "AUDIO",
        attachment_url: "https://cdn.example.com/a1.m4a",
      }) as ClientChatMessage,
      photo("p3", 2),
    ]);

    expect(gallery.map((item) => item.anchor.messageId)).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
  });

  it("drops an image message that carries no attachment", () => {
    const orphan = makeMessage({
      id: "p1",
      kind: "IMAGE",
      attachment_url: null,
    }) as ClientChatMessage;

    expect(isViewableImage(orphan)).toBe(false);
    expect(buildMediaGallery([orphan])).toEqual([]);
  });

  it("includes the photos a grid refuses: a failed send and a broadcast", () => {
    const gallery = buildMediaGallery([
      photo("p1", 0, { failed: true }),
      photo("p2", 1, { broadcast_id: "b1" }),
    ]);

    // Both still draw a full photo in the thread, so both are reachable — a
    // gallery that skipped them would have a hole the driver can tap into.
    expect(gallery.map((item) => item.anchor.messageId)).toEqual(["p1", "p2"]);
    expect(gallery[0].failed).toBe(true);
  });

  it("gives every photo its OWN caption, never the batch's", () => {
    const gallery = buildMediaGallery([
      photo("p1", 0),
      photo("p2", 1),
      photo("p3", 2, { body: "chegamos no portão" }),
    ]);

    expect(gallery.map((item) => item.caption)).toEqual([
      null,
      null,
      "chegamos no portão",
    ]);
  });

  it("carries the sender and the instant of each photo", () => {
    const [first] = buildMediaGallery([
      photo("p1", 7, {
        senderId: DRIVER_USER,
        sender: { id: DRIVER_USER, name: "Você" },
      }),
    ]);

    expect(first.senderName).toBe("Você");
    expect(first.createdAt).toBe("2026-08-31T12:07:00.000Z");
  });
});

// ------------------------------------------------------------------- anchor
describe("the anchor is an identity, because the gallery moves", () => {
  it("finds the photo by its message id", () => {
    const gallery = buildMediaGallery([photo("p1", 0), photo("p2", 1)]);

    expect(resolveAnchorIndex(gallery, mediaViewerAnchor(photo("p2", 1)))).toBe(
      1,
    );
  });

  it("survives loadOlder prepending forty older messages", () => {
    const opened = [photo("p3", 3), photo("p4", 4)];
    const anchor = mediaViewerAnchor(opened[1]);

    expect(resolveAnchorIndex(buildMediaGallery(opened), anchor)).toBe(1);

    const older = [photo("p1", 1), photo("p2", 2), ...opened];

    // Same photo, different position: an index kept in state would now be
    // pointing at p2.
    expect(resolveAnchorIndex(buildMediaGallery(older), anchor)).toBe(3);
  });

  it("survives an own photo being confirmed and given a server id", () => {
    const optimistic = photo("local-abc", 5, {
      client_submission_id: "abc",
      attachment_url: "file:///data/user/0/cache/pic.jpg",
      pending: true,
    });

    const anchor = mediaViewerAnchor(optimistic);

    const confirmed = photo("srv-77", 5, { client_submission_id: "abc" });

    // The id the viewer opened on no longer exists anywhere; the submission
    // id is the only thread between the two objects.
    expect(
      resolveAnchorIndex(buildMediaGallery([photo("p1", 1), confirmed]), anchor),
    ).toBe(1);
  });

  it("does not pair two unrelated photos that both lack a submission id", () => {
    const anchor = mediaViewerAnchor(photo("gone", 9));

    expect(
      resolveAnchorIndex(buildMediaGallery([photo("p1", 1)]), anchor),
    ).toBe(-1);
  });

  it("reports -1 when the photo left the loaded conversation", () => {
    const anchor = mediaViewerAnchor(
      photo("local-zzz", 9, { client_submission_id: "zzz" }),
    );

    expect(resolveAnchorIndex([], anchor)).toBe(-1);
    expect(
      resolveAnchorIndex(buildMediaGallery([photo("p1", 1)]), anchor),
    ).toBe(-1);
  });
});

// ------------------------------------------------------------------- window
describe("only three photos ever exist", () => {
  it("mounts the current photo and its two neighbours", () => {
    expect(mediaWindowIndexes(5, 300)).toEqual([4, 5, 6]);
  });

  it("has no previous at the start and no next at the end", () => {
    expect(mediaWindowIndexes(0, 300)).toEqual([0, 1]);
    expect(mediaWindowIndexes(299, 300)).toEqual([298, 299]);
  });

  it("is a single slot for a conversation with one photo", () => {
    expect(mediaWindowIndexes(0, 1)).toEqual([0]);
    expect(hasPreviousPhoto(0)).toBe(false);
    expect(hasNextPhoto(0, 1)).toBe(false);
  });

  it("has nothing to mount for an empty gallery", () => {
    expect(mediaWindowIndexes(0, 0)).toEqual([]);
    expect(mediaPositionLabel(0, 0)).toBe("");
  });

  it("clamps an index that fell outside the gallery", () => {
    expect(clampGalleryIndex(-3, 10)).toBe(0);
    expect(clampGalleryIndex(99, 10)).toBe(9);
    expect(mediaWindowIndexes(99, 10)).toEqual([8, 9]);
  });

  it("counts from one for the driver, not from zero", () => {
    expect(mediaPositionLabel(2, 12)).toBe("3 / 12");
  });
});

// ---------------------------------------------------------------- cache key
describe("a chat photo is cached by message, not by its signed url", () => {
  it("keeps the same cache identity across two signatures of the same photo", () => {
    const first = chatImageSource(
      "https://cdn.example.com/p1.jpg?sig=abc&expires=1",
      "p1",
    );
    const resigned = chatImageSource(
      "https://cdn.example.com/p1.jpg?sig=xyz&expires=2",
      "p1",
    );

    // The url changes on every listing; the key must not, or every thumbnail
    // is downloaded again on each load of the thread.
    expect(first.uri).not.toBe(resigned.uri);
    expect(first.cacheKey).toBeDefined();
    expect(first.cacheKey).toBe(resigned.cacheKey);
  });

  it("gives two different photos two different identities", () => {
    expect(chatImageSource("https://cdn.example.com/a.jpg?sig=1", "a").cacheKey).not.toBe(
      chatImageSource("https://cdn.example.com/a.jpg?sig=1", "b").cacheKey,
    );
  });

  it("is the same identity the viewer uses for the photo the bubble shows", () => {
    const [shown] = buildMediaGallery([photo("p1", 1)]);

    expect(chatImageSource(shown.url, shown.anchor.messageId).cacheKey).toBe(
      chatImageCacheKey("p1"),
    );
  });

  it("reads a photo still on this device straight from disk, with no key", () => {
    expect(chatImageSource("file:///cache/pending.jpg", "local-1")).toEqual({
      uri: "file:///cache/pending.jpg",
    });
  });
});

// --------------------------------------------------------------- axis lock
describe("the drag picks one direction and keeps it", () => {
  it("stays undecided while the finger has barely moved", () => {
    expect(resolveDragAxis(0, 0)).toBe("undecided");
    expect(resolveDragAxis(5, 4)).toBe("undecided");
  });

  it("pages on a mostly sideways drag", () => {
    expect(resolveDragAxis(-30, 6)).toBe("horizontal");
  });

  it("dismisses on a mostly vertical drag, up or down", () => {
    expect(resolveDragAxis(4, 40)).toBe("vertical");
    expect(resolveDragAxis(-4, -40)).toBe("vertical");
  });

  it("gives a perfect diagonal to paging", () => {
    // Ambiguous by construction; on a pager, paging is what the hand meant.
    expect(resolveDragAxis(20, 20)).toBe("horizontal");
    expect(resolveDragAxis(-20, 20)).toBe("horizontal");
  });

  it("answers the same for the same drag, however far it went after", () => {
    // The lock lives in the gesture, but it can only hold if the rule is
    // deterministic: the component asks once and reuses the answer.
    expect(resolveDragAxis(-30, 6)).toBe(resolveDragAxis(-30, 6));
    expect(resolveDragAxis(-300, 200)).toBe("horizontal");
  });
});

// -------------------------------------------------------------- the paging
describe("the strip follows the finger, and stops at the ends", () => {
  it("follows a drag in the middle of the gallery one to one", () => {
    expect(resistedPagePan(-120, 5, 12, 400)).toBe(-120);
  });

  it("damps a pull before the first photo", () => {
    const pulled = resistedPagePan(200, 0, 12, 400);

    expect(pulled).toBeGreaterThan(0);
    expect(pulled).toBeLessThan(200);
  });

  it("damps a pull past the last photo", () => {
    const pulled = resistedPagePan(-200, 11, 12, 400);

    expect(pulled).toBeLessThan(0);
    expect(pulled).toBeGreaterThan(-200);
  });

  it("still follows a drag AWAY from the edge at full travel", () => {
    expect(resistedPagePan(-200, 0, 12, 400)).toBe(-200);
    expect(resistedPagePan(200, 11, 12, 400)).toBe(200);
  });

  it("never exposes a fourth photo the window has not mounted", () => {
    expect(resistedPagePan(-9000, 5, 12, 400)).toBe(-400);
    expect(resistedPagePan(9000, 5, 12, 400)).toBe(400);
  });
});

describe("what a released drag asked for", () => {
  const middle = { width: 400, index: 5, length: 12 };

  it("does nothing for a drag that went nowhere", () => {
    expect(resolvePageStep({ ...middle, dx: -10, velocityX: 0 })).toBe(0);
  });

  it("goes to the next photo when dragged far enough to the left", () => {
    expect(resolvePageStep({ ...middle, dx: -160, velocityX: 0 })).toBe(1);
  });

  it("goes to the previous photo when dragged far enough to the right", () => {
    expect(resolvePageStep({ ...middle, dx: 160, velocityX: 0 })).toBe(-1);
  });

  it("accepts a short flick as a page change", () => {
    expect(
      resolvePageStep({
        ...middle,
        dx: -20,
        velocityX: -(MEDIA_PAGE_VELOCITY + 1),
      }),
    ).toBe(1);
  });

  it("cancels a long drag that was flicked back the other way", () => {
    expect(
      resolvePageStep({
        ...middle,
        dx: -300,
        velocityX: MEDIA_PAGE_VELOCITY + 1,
      }),
    ).toBe(0);
  });

  it("never wraps around at the first photo", () => {
    expect(
      resolvePageStep({ width: 400, index: 0, length: 12, dx: 300, velocityX: 0 }),
    ).toBe(0);
  });

  it("never wraps around at the last photo", () => {
    expect(
      resolvePageStep({
        width: 400,
        index: 11,
        length: 12,
        dx: -300,
        velocityX: -2000,
      }),
    ).toBe(0);
  });

  it("has nowhere to go in a conversation with a single photo", () => {
    expect(
      resolvePageStep({ width: 400, index: 0, length: 1, dx: -300, velocityX: -2000 }),
    ).toBe(0);
    expect(
      resolvePageStep({ width: 400, index: 0, length: 1, dx: 300, velocityX: 2000 }),
    ).toBe(0);
  });
});

// ------------------------------------------------------------ the dismissal
describe("dragging the photo away", () => {
  const screen = { height: 800 };

  it("keeps the photo when the drag barely moved", () => {
    expect(
      shouldDismissDrag({ ...screen, dy: 40, velocityY: 0 }),
    ).toBe(false);
  });

  it("closes on a long drag down", () => {
    expect(shouldDismissDrag({ ...screen, dy: 260, velocityY: 0 })).toBe(true);
  });

  it("closes on a long drag up, exactly the same way", () => {
    expect(shouldDismissDrag({ ...screen, dy: -260, velocityY: 0 })).toBe(true);
  });

  it("closes on a short fling", () => {
    expect(
      shouldDismissDrag({
        ...screen,
        dy: 30,
        velocityY: MEDIA_DISMISS_VELOCITY + 1,
      }),
    ).toBe(true);
  });

  it("keeps the photo when the drag was flung back to the centre", () => {
    expect(
      shouldDismissDrag({
        ...screen,
        dy: 300,
        velocityY: -(MEDIA_DISMISS_VELOCITY + 1),
      }),
    ).toBe(false);
  });

  it("reveals the conversation as the photo is pushed away", () => {
    // The backdrop is what stands between the photo and the real chat, so its
    // opacity IS the answer to "can the driver see what is behind yet".
    expect(backdropOpacity(dismissProgress(0, 800))).toBe(1);
    expect(backdropOpacity(dismissProgress(200, 800))).toBeCloseTo(0.5);
    expect(backdropOpacity(dismissProgress(400, 800))).toBe(0);

    // Past the point where the chat is fully visible there is nothing left to
    // reveal, and nothing goes negative.
    expect(backdropOpacity(dismissProgress(2000, 800))).toBe(0);
  });

  it("counts up and down as the same amount of dismissal", () => {
    expect(dismissProgress(-200, 800)).toBe(dismissProgress(200, 800));
  });

  it("survives a screen it was never told the size of", () => {
    expect(dismissProgress(200, 0)).toBe(0);
  });

  it("shrinks the photo, but never past the floor", () => {
    expect(dismissScale(0)).toBe(1);
    expect(dismissScale(0.5)).toBeLessThan(1);
    expect(dismissScale(1)).toBeCloseTo(0.6);
    expect(dismissScale(9)).toBeCloseTo(0.6);
  });

  it("takes the counter and the caption away before the photo goes", () => {
    expect(chromeOpacity(0)).toBe(1);
    expect(chromeOpacity(0.34)).toBe(0);
    expect(chromeOpacity(1)).toBe(0);
  });
});
