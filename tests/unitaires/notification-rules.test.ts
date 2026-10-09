import { describe, expect, it } from "vitest";

import {
  UNREAD_COUNT_FALLBACK_POLL_MS,
  disconnectNeedsFallbackPoll,
  markPagesRead,
  pushDestination,
  unreadCountRefetchInterval,
} from "@/features/notifications/notification-rules";

/**
 * The unread badge, kept honest by the socket instead of a poll (GAP3-13).
 *
 * The app asked /notification/unread-count every 60 s, unconditionally — the
 * most frequent request a driver makes, for a number that changes a few
 * times a day. New notifications already arrive as `pushNotification`, and
 * the API now also announces `notificationsRead`. So the poll only runs while
 * the socket is down, as the fallback it always should have been.
 */
describe("unreadCountRefetchInterval", () => {
  it("does not poll while the socket is connected", () => {
    expect(unreadCountRefetchInterval(true)).toBe(false);
  });

  it("falls back to the old 60 s poll while it is not", () => {
    expect(unreadCountRefetchInterval(false)).toBe(60_000);
    expect(UNREAD_COUNT_FALLBACK_POLL_MS).toBe(60_000);
  });
});

describe("disconnectNeedsFallbackPoll", () => {
  it("re-arms the poll when the connection was lost", () => {
    expect(disconnectNeedsFallbackPoll("transport close")).toBe(true);
    expect(disconnectNeedsFallbackPoll("ping timeout")).toBe(true);
    expect(disconnectNeedsFallbackPoll("io server disconnect")).toBe(true);
  });

  it("does not when the app closed it itself (background, logout)", () => {
    // Returning to the foreground reconnects and resyncs on its own; a fetch
    // fired while going to background would be wasted.
    expect(disconnectNeedsFallbackPoll("io client disconnect")).toBe(false);
  });
});

describe("markPagesRead", () => {
  const pages = [
    {
      data: [
        { id: "a", read: false },
        { id: "b", read: false },
      ],
      nextCursor: "x",
    },
    { data: [{ id: "c", read: true }], nextCursor: null },
  ];

  it("marks the one that was read elsewhere, and keeps the rest of the page", () => {
    const result = markPagesRead(pages, "b");

    expect(result[0].data).toEqual([
      { id: "a", read: false },
      { id: "b", read: true },
    ]);
    expect(result[0].nextCursor).toBe("x");
    expect(result[1]).toBe(pages[1]);
  });

  it("marks everything when no id is given (mark all)", () => {
    const result = markPagesRead(pages, null);

    expect(result.flatMap((page) => page.data).every((item) => item.read)).toBe(true);
  });

  it("does not mutate what it was given", () => {
    markPagesRead(pages, null);

    expect(pages[0].data[0].read).toBe(false);
  });
});

/**
 * Where a tray tap lands. The API names the screen in `data.url`: the chat,
 * the day's list for a delivery taken off or added to it ("/deliveries"),
 * and the route for one released or cancelled ("/route"). The app sent
 * everything but the chat to the notifications list, so the driver who
 * tapped "Sua rota foi liberada" to start work had to find the list again.
 * The app has no route screen: a route is a section of the day's list.
 */
describe("pushDestination", () => {
  it("opens the conversation for a chat push", () => {
    expect(pushDestination("/chat", true)).toBe("/chat");
  });

  it("opens the day's list for a push about the list or a route", () => {
    expect(pushDestination("/deliveries", true)).toBe("/deliveries");
    expect(pushDestination("/route", true)).toBe("/deliveries");
  });

  it("opens the notifications list without Entregas (no chat, no list to land on)", () => {
    expect(pushDestination("/chat", false)).toBe("/notifications");
    expect(pushDestination("/deliveries", false)).toBe("/notifications");
    expect(pushDestination("/route", false)).toBe("/notifications");
  });

  it("opens the notifications list for anything else", () => {
    expect(pushDestination("/notifications", true)).toBe("/notifications");
    expect(pushDestination(undefined, true)).toBe("/notifications");
    expect(pushDestination("intent://x", true)).toBe("/notifications");
  });
});
