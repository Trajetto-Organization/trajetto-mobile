import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCoalescedTrigger,
  createCursorCoalescer,
} from "@/features/chat/coalesce";

import {
  CONVERSATION_SYNC_FLOOR_MS,
  createConversationSync,
  type ConversationSyncTrigger,
} from "@/features/chat/conversation-sync";

/**
 * Bursts become single requests (MOB-09), and the resync triggers of the open
 * conversation (MOB-05) collapse into the requests actually worth making.
 */
const at = (second: number) =>
  new Date(Date.UTC(2026, 8, 28, 12, 0, second)).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a burst of badge refreshes", () => {
  it("is one refetch per window, however many messages landed in it", () => {
    const fire = vi.fn();
    const trigger = createCoalescedTrigger({ windowMs: 800, fire });

    for (let index = 0; index < 20; index += 1) trigger.request();

    expect(fire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(800);
    expect(fire).toHaveBeenCalledTimes(1);

    // A later burst gets its own refresh.
    trigger.request();
    vi.advanceTimersByTime(800);
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it("is never pushed back by a burst that keeps coming (bounded latency)", () => {
    const fire = vi.fn();
    const trigger = createCoalescedTrigger({ windowMs: 800, fire });

    trigger.request();
    vi.advanceTimersByTime(500);
    trigger.request();
    vi.advanceTimersByTime(300);

    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("can be dropped before it fires", () => {
    const fire = vi.fn();
    const trigger = createCoalescedTrigger({ windowMs: 800, fire });

    trigger.request();
    trigger.cancel();
    vi.advanceTimersByTime(800);

    expect(fire).not.toHaveBeenCalled();
  });
});

describe("a burst of read cursors", () => {
  it("posts once, with the newest instant of the burst", async () => {
    const flush = vi.fn(async (_iso: string) => undefined);
    const cursor = createCursorCoalescer({ windowMs: 800, flush });

    // Twenty messages of a broadcast, arriving in any order.
    const burst = Array.from({ length: 20 }, (_unused, index) => at(index));
    [...burst].reverse().forEach((iso) => cursor.push(iso));
    cursor.push(at(3));

    vi.advanceTimersByTime(800);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(at(19));
  });

  it("never posts an instant at or behind the last one it posted", async () => {
    const flush = vi.fn(async (_iso: string) => undefined);
    const cursor = createCursorCoalescer({ windowMs: 800, flush });

    cursor.push(at(10));
    vi.advanceTimersByTime(800);

    cursor.push(at(10));
    cursor.push(at(5));
    vi.advanceTimersByTime(800);

    expect(flush).toHaveBeenCalledTimes(1);

    cursor.push(at(11));
    vi.advanceTimersByTime(800);

    expect(flush).toHaveBeenLastCalledWith(at(11));
  });

  it("tries the same instant again after a failed post", async () => {
    const flush = vi
      .fn(async (_iso: string) => undefined)
      .mockRejectedValueOnce(new Error("offline"));

    const cursor = createCursorCoalescer({ windowMs: 800, flush });

    cursor.push(at(10));
    vi.advanceTimersByTime(800);
    await vi.runAllTimersAsync();

    cursor.push(at(10));
    vi.advanceTimersByTime(800);

    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenLastCalledWith(at(10));
  });

  it("drops what was pending when cancelled", () => {
    const flush = vi.fn(async (_iso: string) => undefined);
    const cursor = createCursorCoalescer({ windowMs: 800, flush });

    cursor.push(at(10));
    cursor.cancel();
    vi.advanceTimersByTime(800);

    expect(flush).not.toHaveBeenCalled();
  });
});

describe("what waits on the read cursor", () => {
  function holdProbe() {
    const events: string[] = [];

    const hold = vi.fn(() => {
      events.push("hold");

      return () => {
        events.push("release");
      };
    });

    return { events, hold };
  }

  it("is held from the first push of a window until that window's post has settled", async () => {
    const { events, hold } = holdProbe();

    let answer: () => void = () => undefined;

    const flush = vi.fn(
      (_iso: string) =>
        new Promise<void>((settle) => {
          answer = settle;
        }),
    );

    const cursor = createCursorCoalescer({ windowMs: 800, flush, hold });

    cursor.push(at(1));
    cursor.push(at(2));
    cursor.push(at(3));

    // One hold for the whole window, not one per push.
    expect(events).toEqual(["hold"]);

    vi.advanceTimersByTime(800);
    await vi.advanceTimersByTimeAsync(0);

    // Posted, not answered yet: still held.
    expect(flush).toHaveBeenCalledWith(at(3));
    expect(events).toEqual(["hold"]);

    answer();
    await vi.advanceTimersByTimeAsync(0);

    expect(events).toEqual(["hold", "release"]);
  });

  it("is released when the post fails, and when the window is dropped", async () => {
    const { events, hold } = holdProbe();

    const flush = vi
      .fn(async (_iso: string) => undefined)
      .mockRejectedValueOnce(new Error("offline"));

    const cursor = createCursorCoalescer({ windowMs: 800, flush, hold });

    cursor.push(at(1));
    vi.advanceTimersByTime(800);
    await vi.advanceTimersByTimeAsync(0);

    expect(events).toEqual(["hold", "release"]);

    cursor.push(at(2));
    cursor.cancel();

    expect(events).toEqual(["hold", "release", "hold", "release"]);
  });

  it("takes no hold for an instant it would not post", () => {
    const { events, hold } = holdProbe();
    const flush = vi.fn(async (_iso: string) => undefined);
    const cursor = createCursorCoalescer({ windowMs: 800, flush, hold });

    cursor.push(at(5));
    vi.advanceTimersByTime(800);

    events.length = 0;

    cursor.push(at(5));
    cursor.push(at(4));

    expect(events).toEqual([]);
  });
});

describe("the open conversation going back for what it missed", () => {
  function deferred() {
    let resolve: (synced: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((settle) => {
      resolve = settle;
    });

    return { promise, resolve };
  }

  function controller(
    options: {
      onScreen?: () => boolean;
      live?: () => boolean;
      clock?: { now: number };
    } = {},
  ) {
    const clock = options.clock ?? { now: 0 };
    const run = vi.fn(async (_trigger: ConversationSyncTrigger) => true);

    const sync = createConversationSync({
      run,
      isOnScreen: options.onScreen ?? (() => true),
      isLive: options.live ?? (() => true),
      now: () => clock.now,
    });

    return { clock, run, sync };
  }

  it("never skips the first load, a reconnection on screen or a pull", async () => {
    const { run, sync } = controller();

    await sync.request("initial");
    await sync.request("resync");
    await sync.request("manual");

    expect(run.mock.calls.map(([trigger]) => trigger)).toEqual([
      "initial",
      "resync",
      "manual",
    ]);
  });

  it("skips a focus or foreground when the socket has stayed connected since the last sync began", async () => {
    const { clock, run, sync } = controller();

    await sync.request("initial");

    clock.now += 60 * 60_000;
    await sync.request("focus");
    await sync.request("foreground");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs a hint once the socket dropped, but lets the floor merge a focus and a foreground landing together", async () => {
    const { clock, run, sync } = controller({ live: () => false });

    await sync.request("initial");
    sync.markStale();

    clock.now += CONVERSATION_SYNC_FLOOR_MS;
    await sync.request("foreground");
    expect(run).toHaveBeenCalledTimes(2);

    clock.now += 1_000;
    await sync.request("focus");
    expect(run).toHaveBeenCalledTimes(2);

    clock.now += CONVERSATION_SYNC_FLOOR_MS;
    await sync.request("focus");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("runs a hint after a sync that failed, even with the socket connected", async () => {
    const { clock, run, sync } = controller();

    run.mockResolvedValueOnce(false);
    await sync.request("initial");

    clock.now += CONVERSATION_SYNC_FLOOR_MS;
    await sync.request("focus");

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("owes a reconnection that happened off screen to the next hint, whatever the floor", async () => {
    let onScreen = true;
    const { clock, run, sync } = controller({ onScreen: () => onScreen });

    await sync.request("initial");

    onScreen = false;
    await sync.request("resync");
    expect(run).toHaveBeenCalledTimes(1);

    onScreen = true;
    clock.now += 1_000;
    await sync.request("focus");

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toBe("resync");

    // Paid once: the next hint is a hint again.
    await sync.request("foreground");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("owes exactly one more run to a reconnection that lands during the first load", async () => {
    const first = deferred();
    const { run, sync } = controller();

    run.mockImplementationOnce(() => first.promise);

    const inFlight = sync.request("initial");

    // The socket came back while the first answer was still on its way: that
    // answer may predate what the reconnection is about.
    const owed = sync.request("resync");
    const alsoOwed = sync.request("resync");

    expect(run).toHaveBeenCalledTimes(1);

    first.resolve(true);
    await inFlight;
    await owed;
    await alsoOwed;

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toBe("resync");
  });

  it("lets a pull take over a queued hint", async () => {
    const first = deferred();
    const { clock, run, sync } = controller({ live: () => false });

    run.mockImplementationOnce(() => first.promise);

    const inFlight = sync.request("initial");

    // A slow first load: the hint lands past the floor and is queued.
    clock.now += CONVERSATION_SYNC_FLOOR_MS;
    sync.markStale();
    const hint = sync.request("foreground");
    const pull = sync.request("manual");

    first.resolve(true);
    await Promise.all([inFlight, hint, pull]);

    expect(run.mock.calls.map(([trigger]) => trigger)).toEqual(["initial", "manual"]);
  });

  it("trusts live arrivals as contiguous only after a sync that began connected, until the next drop", async () => {
    let live = false;
    const { run, sync } = controller({ live: () => live });

    // Nothing synced yet: an arrival may be above anything.
    expect(sync.trustsLiveArrivals()).toBe(false);

    await sync.request("initial");

    // That sync began with the socket down: what it misses is not known.
    expect(sync.trustsLiveArrivals()).toBe(false);

    live = true;
    await sync.request("resync");
    expect(run).toHaveBeenCalledTimes(2);
    expect(sync.trustsLiveArrivals()).toBe(true);

    sync.markStale();
    expect(sync.trustsLiveArrivals()).toBe(false);
  });

  it("runs a hint after a first load that began before the socket connected", async () => {
    let live = false;
    const { clock, run, sync } = controller({ live: () => live });

    await sync.request("initial");

    // Connected now, but what was sent between that page and the room being
    // joined is in neither the page nor the live stream.
    live = true;
    clock.now += 60 * 60_000;
    await sync.request("focus");

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("catches up at once on the socket's first connection after a load made without it", async () => {
    let live = false;
    const { run, sync } = controller({ live: () => live });

    await sync.request("initial");

    live = true;
    await sync.noteConnected();

    expect(run.mock.calls.map(([trigger]) => trigger)).toEqual([
      "initial",
      "resync",
    ]);
    expect(sync.trustsLiveArrivals()).toBe(true);
  });

  it("queues that catch-up behind a first load still on its way", async () => {
    const first = deferred();
    let live = false;
    const { run, sync } = controller({ live: () => live });

    run.mockImplementationOnce(() => first.promise);

    const inFlight = sync.request("initial");

    live = true;
    const owed = sync.noteConnected();

    expect(run).toHaveBeenCalledTimes(1);

    first.resolve(true);
    await inFlight;
    await owed;

    expect(run.mock.calls.map(([trigger]) => trigger)).toEqual([
      "initial",
      "resync",
    ]);
  });

  it("leaves a connection after a drop to the announced resync, which is spread over the fleet", async () => {
    const { run, sync } = controller();

    await sync.request("initial");

    sync.markStale();
    await sync.noteConnected();
    expect(run).toHaveBeenCalledTimes(1);

    await sync.request("resync");
    expect(run.mock.calls.map(([trigger]) => trigger)).toEqual([
      "initial",
      "resync",
    ]);
  });

  it("does nothing for a connection it finds with a list that came through the socket", async () => {
    const { run, sync } = controller();

    await sync.request("initial");
    await sync.noteConnected();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("skips the announcement of a connection a catch-up already began after", async () => {
    let live = false;
    const { run, sync } = controller({ live: () => live });

    await sync.request("initial");

    live = true;
    await sync.noteConnected();

    // A first connection that came after failed attempts is announced too.
    await sync.request("resync");

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("owes the first connection's catch-up to the next focus when the chat is off screen", async () => {
    let live = false;
    let onScreen = true;
    const { clock, run, sync } = controller({
      live: () => live,
      onScreen: () => onScreen,
    });

    await sync.request("initial");

    onScreen = false;
    live = true;
    await sync.noteConnected();
    expect(run).toHaveBeenCalledTimes(1);

    onScreen = true;
    clock.now += 1_000;
    await sync.request("focus");

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toBe("resync");
  });

  it("trusts live arrivals only once a catch-up that began connected has landed", async () => {
    const first = deferred();
    const { run, sync } = controller();

    run.mockImplementationOnce(() => first.promise);

    const inFlight = sync.request("initial");

    // The stretch that page brings is not on screen yet, but once it lands
    // it joins the live stream without a hole.
    expect(sync.trustsLiveArrivals()).toBe(false);
    expect(sync.closesGap()).toBe(true);

    first.resolve(true);
    await inFlight;

    expect(sync.trustsLiveArrivals()).toBe(true);
  });

  it("does not close the gap with a page whose socket dropped while it was on its way", async () => {
    const first = deferred();
    const { run, sync } = controller();

    run.mockImplementationOnce(() => first.promise);

    const inFlight = sync.request("initial");

    sync.markStale();
    expect(sync.closesGap()).toBe(false);

    first.resolve(true);
    await inFlight;

    expect(sync.trustsLiveArrivals()).toBe(false);
  });

  it("keeps trusting the live stream after a pull that failed with the socket up", async () => {
    const { run, sync } = controller();

    await sync.request("initial");

    run.mockResolvedValueOnce(false);
    await sync.request("manual");

    // Nothing dropped: an arrival still continues the list on screen.
    expect(sync.trustsLiveArrivals()).toBe(true);
  });

  it("keeps going after a sync that threw", async () => {
    const { run, sync } = controller();

    run.mockRejectedValueOnce(new Error("offline"));

    await expect(sync.request("resync")).resolves.toBeUndefined();
    await sync.request("resync");

    expect(run).toHaveBeenCalledTimes(2);
  });
});
