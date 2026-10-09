import { describe, expect, it } from "vitest";

import {
  clearGapMarks,
  findOptimisticCopy,
  mergeNewestPage,
  readCursorFor,
  takeNewestPage,
} from "@/features/chat/chat-rules";

import type { ChatMessage, ClientChatMessage } from "@/features/chat/types";

/**
 * The conversation catching up with what it missed (MOB-05), and the read
 * cursor it reports afterwards.
 *
 * The screen used to load once, on mount. The tab stays mounted and the socket
 * is paused in the background, and the API has no replay: whatever the SAC
 * sent while the app was away, in a tunnel or mid-reconnect simply never
 * appeared until the app was restarted — while `mark-read` without `readAt`
 * told the SAC the driver had read it.
 */
const DRIVER = "user-driver";
const AGENT = "user-agent";

function at(minute: number): string {
  return new Date(Date.UTC(2026, 8, 28, 12, minute)).toISOString();
}

function message(
  id: string,
  minute: number,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    kind: "TEXT",
    body: id,
    attachment_url: null,
    duration_ms: null,
    deliveryId: null,
    broadcast_id: null,
    client_submission_id: null,
    threadId: "thread-1",
    senderId: AGENT,
    sender: { id: AGENT, name: "Central" },
    delivery: null,
    created_at: at(minute),
    ...overrides,
  };
}

/** A page as the API answers it: newest first. */
function page(
  messages: ChatMessage[],
  nextCursor: { created_at: string; id: string } | null = null,
) {
  return { data: [...messages].reverse(), nextCursor };
}

const ids = (list: ClientChatMessage[]) => list.map((entry) => entry.id);

describe("folding the newest page into the conversation on screen", () => {
  it("adds what was missed and keeps the history the driver paged in", () => {
    // m1..m3 were paged in with "Mensagens anteriores"; m4..m5 are the head.
    const onScreen = ["m1", "m2", "m3", "m4", "m5"].map((id, index) =>
      message(id, index),
    );
    const olderCursor = { created_at: at(0), id: "m1" };

    const head = [message("m4", 3), message("m5", 4), message("m6", 5), message("m7", 6)];

    const result = mergeNewestPage(
      onScreen,
      olderCursor,
      page(head, { created_at: at(3), id: "m4" }),
    );

    expect(ids(result.messages)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "m7"]);

    // "Mensagens anteriores" keeps paging from where the loaded history ends.
    expect(result.nextCursor).toEqual(olderCursor);
  });

  it("refreshes a message already on screen in place (its attachment comes back freshly signed)", () => {
    const photo = message("p1", 1, {
      kind: "IMAGE",
      attachment_url: "https://storage/p1.jpg?sig=old",
    });

    const result = mergeNewestPage([photo], null, page([
      { ...photo, attachment_url: "https://storage/p1.jpg?sig=new" },
      message("m2", 2),
    ]));

    expect(ids(result.messages)).toEqual(["p1", "m2"]);
    expect(result.messages[0].attachment_url).toBe("https://storage/p1.jpg?sig=new");
  });

  it("swaps an optimistic send the page already confirms, instead of showing it twice", () => {
    const optimistic: ClientChatMessage = {
      ...message("local-a", 2, { senderId: DRIVER, client_submission_id: "sub-a" }),
      pending: true,
    };

    const result = mergeNewestPage(
      [message("m1", 1), optimistic],
      null,
      page([
        message("m1", 1),
        message("srv-a", 2, { senderId: DRIVER, client_submission_id: "sub-a" }),
      ]),
    );

    expect(ids(result.messages)).toEqual(["m1", "srv-a"]);
    expect(result.messages[1].pending).toBeUndefined();
  });

  it("keeps a send that only exists on this phone", () => {
    const failed: ClientChatMessage = {
      ...message("local-b", 9, { senderId: DRIVER, client_submission_id: "sub-b" }),
      failed: true,
    };

    const result = mergeNewestPage(
      [message("m1", 1), failed],
      null,
      page([message("m1", 1), message("m2", 2)]),
    );

    expect(ids(result.messages)).toEqual(["m1", "m2", "local-b"]);
  });

  it("replaces the confirmed history when more arrived than a page holds (no hole in the thread)", () => {
    const onScreen = [message("m1", 1), message("m2", 2)];
    const pending: ClientChatMessage = {
      ...message("local-c", 3, { senderId: DRIVER, client_submission_id: "sub-c" }),
      pending: true,
    };

    // Forty messages arrived while away: the newest page starts well after m2.
    const head = [message("m50", 50), message("m51", 51)];
    const headCursor = { created_at: at(50), id: "m50" };

    const result = mergeNewestPage([...onScreen, pending], null, page(head, headCursor));

    expect(ids(result.messages)).toEqual(["local-c", "m50", "m51"]);

    // Paging back now walks through the stretch that was missed.
    expect(result.nextCursor).toEqual(headCursor);
  });

  it("takes the page as the history when nothing confirmed was on screen", () => {
    const result = mergeNewestPage(
      [],
      null,
      page([message("m1", 1)], { created_at: at(1), id: "m1" }),
    );

    expect(ids(result.messages)).toEqual(["m1"]);
    expect(result.nextCursor).toEqual({ created_at: at(1), id: "m1" });
  });

  it("does not let a message the socket delivered after a drop hide the gap below it", () => {
    // m3..m49 were sent while the socket was down; it came back and
    // delivered m60 live before this catch-up ran.
    const afterDrop: ClientChatMessage = { ...message("m60", 60), afterGap: true };
    const onScreen = [message("m1", 1), message("m2", 2), afterDrop];

    const head = [message("m50", 50), message("m51", 51), message("m60", 60)];
    const headCursor = { created_at: at(50), id: "m50" };

    const result = mergeNewestPage(onScreen, null, page(head, headCursor));

    // No m1, m2 | hole | m50.. stitched together: the page is the history
    // and "Mensagens anteriores" walks back through the missing stretch.
    expect(ids(result.messages)).toEqual(["m50", "m51", "m60"]);
    expect(result.nextCursor).toEqual(headCursor);

    // The server's copy replaced the marked one.
    expect(result.messages[2].afterGap).toBeUndefined();
  });

  it("keeps, across a gap, what the socket delivered after the page's snapshot", () => {
    const onScreen: ClientChatMessage[] = [
      message("m1", 1),
      message("m2", 2),
      { ...message("m61", 61), afterGap: true },
    ];

    const head = [message("m50", 50), message("m51", 51)];
    const headCursor = { created_at: at(50), id: "m50" };

    const result = mergeNewestPage(onScreen, null, page(head, headCursor));

    expect(ids(result.messages)).toEqual(["m50", "m51", "m61"]);
    expect(result.nextCursor).toEqual(headCursor);
  });

  it("trusts a message the live socket delivered without a drop as part of the history", () => {
    const olderCursor = { created_at: at(0), id: "m0" };
    const onScreen = [message("m1", 1), message("m2", 2), message("m60", 60)];

    const head = [message("m50", 50), message("m60", 60)];

    const result = mergeNewestPage(
      onScreen,
      olderCursor,
      page(head, { created_at: at(50), id: "m50" }),
    );

    // Merged, and the paged-in history stays.
    expect(ids(result.messages)).toEqual(["m1", "m2", "m50", "m60"]);
    expect(result.nextCursor).toEqual(olderCursor);
  });

  it("an empty page changes nothing", () => {
    const onScreen = [message("m1", 1)];
    const cursor = { created_at: at(0), id: "m0" };

    const result = mergeNewestPage(onScreen, cursor, page([]));

    expect(result.messages).toBe(onScreen);
    expect(result.nextCursor).toBe(cursor);
  });
});

describe("the optimistic copy an arriving message replaces", () => {
  it("is found by submission id while the server id is not on screen yet", () => {
    const optimistic: ClientChatMessage = {
      ...message("local-a", 1, { senderId: DRIVER, client_submission_id: "sub-a", kind: "AUDIO" }),
      pending: true,
      localUri: "file:///voice.m4a",
    };

    const echo = message("srv-a", 1, { senderId: DRIVER, client_submission_id: "sub-a", kind: "AUDIO" });

    expect(findOptimisticCopy([optimistic], echo)).toBe(optimistic);
  });

  it("is nothing once the server copy is already there, or without a submission id", () => {
    const confirmed = message("srv-a", 1, { client_submission_id: "sub-a" });

    expect(findOptimisticCopy([confirmed], confirmed)).toBeNull();
    expect(findOptimisticCopy([confirmed], message("m2", 2))).toBeNull();
  });
});

describe("the read cursor sent to the SAC", () => {
  it("is the newest message from the operation on screen, as the server stamped it", () => {
    const displayed: ClientChatMessage[] = [
      message("m1", 1),
      message("m2", 2),
      message("mine", 3, { senderId: DRIVER }),
      { ...message("local-x", 9, { senderId: DRIVER }), pending: true },
    ];

    expect(readCursorFor(displayed, DRIVER)).toBe(at(2));
  });

  it("is nothing when the operation said nothing on screen", () => {
    expect(readCursorFor([message("mine", 1, { senderId: DRIVER })], DRIVER)).toBeNull();
    expect(readCursorFor([], DRIVER)).toBeNull();
  });

  it("does not jump over a hole: a message the socket delivered after a drop is left out", () => {
    // m2..m59 were sent while the socket was down; the cursor covers
    // everything before the instant it names.
    const displayed: ClientChatMessage[] = [
      message("m1", 1),
      { ...message("m60", 60), afterGap: true },
    ];

    expect(readCursorFor(displayed, DRIVER)).toBe(at(1));
    expect(readCursorFor([displayed[1]], DRIVER)).toBeNull();
  });
});

describe("closing the gap once the catch-up has landed", () => {
  it("drops the mark from what the socket delivered, and nothing else changes", () => {
    const list: ClientChatMessage[] = [
      message("m1", 1),
      { ...message("m60", 60), afterGap: true },
    ];

    const cleared = clearGapMarks(list);

    expect(ids(cleared)).toEqual(["m1", "m60"]);
    expect(cleared[0]).toBe(list[0]);
    expect("afterGap" in cleared[1]).toBe(false);
    expect(readCursorFor(cleared, DRIVER)).toBe(at(60));
  });

  it("hands back the same list when nothing was marked (no re-render for a catch-up without a gap)", () => {
    const list: ClientChatMessage[] = [message("m1", 1), message("m2", 2)];

    expect(clearGapMarks(list)).toBe(list);
  });
});

describe("the first page becoming the history", () => {
  it("keeps a message the socket delivered while the GET was in flight", () => {
    const socketArrival = message("m3", 3);
    const firstCursor = { created_at: at(1), id: "m1" };

    const result = takeNewestPage(
      [socketArrival],
      page([message("m1", 1), message("m2", 2)], firstCursor),
    );

    expect(ids(result.messages)).toEqual(["m1", "m2", "m3"]);

    // The page's cursor, not whatever the screen had: the history starts here.
    expect(result.nextCursor).toEqual(firstCursor);
  });

  it("does not show twice a socket arrival the page also holds", () => {
    const result = takeNewestPage(
      [message("m2", 2)],
      page([message("m1", 1), message("m2", 2)]),
    );

    expect(ids(result.messages)).toEqual(["m1", "m2"]);
  });

  it("drops confirmed messages the page supersedes (a list left from before), keeps sends only this phone has", () => {
    const stale = message("m0", 0);
    const failed: ClientChatMessage = {
      ...message("local-b", 9, { senderId: DRIVER, client_submission_id: "sub-b" }),
      failed: true,
    };
    const confirmedByPage: ClientChatMessage = {
      ...message("local-c", 2, { senderId: DRIVER, client_submission_id: "sub-c" }),
      pending: true,
    };

    const result = takeNewestPage(
      [stale, confirmedByPage, failed],
      page([
        message("m1", 1),
        message("srv-c", 2, { senderId: DRIVER, client_submission_id: "sub-c" }),
      ]),
    );

    expect(ids(result.messages)).toEqual(["m1", "srv-c", "local-b"]);
  });

  it("keeps what the socket brought when the thread was still empty on the server", () => {
    const result = takeNewestPage([message("m1", 1)], page([]));

    expect(ids(result.messages)).toEqual(["m1"]);
    expect(result.nextCursor).toBeNull();
  });
});
