/**
 * When the open conversation goes back to the server for the head of the
 * thread (MOB-05).
 *
 * Six things ask: the first load (and its retry from the error screen), the
 * socket connecting, the socket announcing a reconnection (the API has no
 * replay, so anything sent while it was down is only on the server), the app
 * returning to the foreground with the chat on screen, the chat tab being
 * focused again, and the driver pulling the list down. This decides which of
 * them is worth a request.
 *
 * - Only one sync runs at a time, the first load included. A request that
 *   lands while one is in flight is not dropped: exactly one more runs when it
 *   ends, because the one in flight may have been answered before the thing
 *   that prompted the new request happened (a reconnection during the first
 *   GET is the classic case).
 * - A reconnection while the conversation is NOT on screen (another tab, app
 *   in the background) fetches nothing: nobody is looking, and the socket
 *   merges live arrivals meanwhile. It is owed instead, and the next focus or
 *   foreground runs it — never skipped, whatever the floor says.
 * - The live list is trusted only when the last sync BEGAN with the socket
 *   connected and nothing dropped or failed since: that answer plus what the
 *   socket delivered is the whole thread. Focus and foreground are hints,
 *   skipped while it is trusted and the socket is still up (a hint that
 *   lands during such a sync is covered by it). Otherwise they run, but
 *   share a floor, so the pair that lands together (opening the app from a
 *   chat push is a foreground AND a focus) costs one request.
 * - A connection is a reconnection once the socket has dropped under this
 *   conversation, and `utils/socket.ts` announces those (spread over a couple
 *   of seconds) — nothing to do on `connect` itself. The socket's FIRST
 *   connection is not announced, yet a list loaded before it misses whatever
 *   was sent until the room was joined (the cold start from a chat push): it
 *   runs a resync right away, unless the list is already trusted. A sync that
 *   began after a connection answers for it, so that connection's
 *   announcement, when one comes anyway (a first connection after failed
 *   attempts), is skipped.
 * - Otherwise a reconnection on screen, a pull and the first load are never
 *   skipped. A foreground followed by the reconnection it causes is therefore
 *   two requests, on purpose: the foreground one is answered before the
 *   socket is back, and anything sent in between is only caught by the
 *   second.
 */

type ConversationSyncTrigger =
  | "initial"
  | "focus"
  | "foreground"
  | "resync"
  | "manual";

/** Keeps a focus and a foreground landing together from costing two requests. */
const CONVERSATION_SYNC_FLOOR_MS = 5_000;

interface ConversationSync {
  request: (trigger: ConversationSyncTrigger) => Promise<void>;

  /**
   * Something may have been missed: the socket dropped. The next hint runs
   * instead of trusting the live list, and every later connection is a
   * reconnection `utils/socket.ts` announces.
   */
  markStale: () => void;

  /**
   * The socket connected (or was found connected when the conversation
   * started listening). Catches up at once when the list was loaded without
   * it and no announcement is coming.
   */
  noteConnected: () => Promise<void>;

  /**
   * Whether a message the socket delivers now continues the history on
   * screen without a hole: a sync that began with the socket connected has
   * LANDED and the socket has not dropped since. Otherwise the arrival is
   * marked `afterGap` — while the catch-up is still on its way, the stretch
   * it brings is not on screen yet either.
   */
  trustsLiveArrivals: () => boolean;

  /**
   * Asked by `run` once its page is in hand: this sync began with the socket
   * connected and nothing dropped since, so the page plus what the socket
   * delivered meanwhile is the whole thread, and the arrivals marked
   * `afterGap` no longer sit above a hole.
   */
  closesGap: () => boolean;
}

function isHint(trigger: ConversationSyncTrigger): boolean {
  return trigger === "focus" || trigger === "foreground";
}

function createConversationSync(input: {
  /**
   * Fetches and folds the head of the thread. Resolves `false` when it could
   * not (the caller reports its own failures); a rejection counts the same.
   */
  run: (trigger: ConversationSyncTrigger) => Promise<boolean>;

  /** The conversation tab is focused and the app is in the foreground. */
  isOnScreen: () => boolean;

  /** The socket is connected right now. */
  isLive: () => boolean;

  floorMs?: number;
  now?: () => number;
}): ConversationSync {
  const floorMs = input.floorMs ?? CONVERSATION_SYNC_FLOOR_MS;
  const now = input.now ?? Date.now;

  let lastStartedAt: number | null = null;
  let inFlight: Promise<void> | null = null;

  // A sync failed, or the socket dropped, since the last one began.
  let stale = true;

  // The socket was connected when the last sync began.
  let startedLive = false;

  // A sync that began with the socket connected landed, and the socket has
  // not dropped since: the list continues into the live stream. A later sync
  // that fails does not undo it — nothing was lost with the socket up.
  let caughtUp = false;

  // A reconnection happened off screen and nobody has fetched since.
  let owedResync = false;

  // The socket dropped at least once under this conversation: from then on
  // every connection is announced through the resync event.
  let reconnectionsAnnounced = false;

  // `noteConnected` has seen a connection, and a sync began after the latest
  // one: that sync answers for everything the connection could have missed.
  let sawConnection = false;
  let startedSinceConnect = false;

  const liveSinceStart = () => !stale && startedLive;

  // The one extra run owed after the current one, and whoever waits on it.
  let queued: {
    trigger: ConversationSyncTrigger;
    promise: Promise<void>;
    resolve: () => void;
  } | null = null;

  const settled = () => queued?.promise ?? inFlight ?? Promise.resolve();

  const start = (trigger: ConversationSyncTrigger): Promise<void> => {
    lastStartedAt = now();
    startedLive = input.isLive();
    startedSinceConnect = sawConnection;

    if (!startedLive) caughtUp = false;

    // Whatever happens from here on is either in this answer or sets the
    // flags again (a drop during the GET marks it stale once more).
    stale = false;
    owedResync = false;

    const running = input
      .run(trigger)
      .then(
        (synced) => {
          // A drop during the GET already marked it stale.
          if (synced && liveSinceStart()) caughtUp = true;
          if (!synced) stale = true;
        },
        () => {
          stale = true;
        },
      )
      .finally(() => {
        inFlight = null;

        const next = queued;
        queued = null;

        if (next) void start(next.trigger).then(next.resolve);
      });

    inFlight = running;

    return running;
  };

  const enqueue = (trigger: ConversationSyncTrigger): Promise<void> => {
    if (!queued) {
      let resolve: () => void = () => undefined;

      const promise = new Promise<void>((settle) => {
        resolve = settle;
      });

      queued = { trigger, promise, resolve };
    } else if (!isHint(trigger)) {
      // A pull or a reconnection outranks a hint: the run owed is theirs.
      queued.trigger = trigger;
    }

    return queued.promise;
  };

  const request = (requested: ConversationSyncTrigger): Promise<void> => {
    let trigger = requested;

    // The announcement of a connection a sync already began after.
    if (trigger === "resync" && startedSinceConnect && liveSinceStart()) {
      return settled();
    }

    if (trigger === "resync" && !input.isOnScreen()) {
      owedResync = true;

      return settled();
    }

    if (isHint(trigger)) {
      if (owedResync) {
        trigger = "resync";
      } else if (liveSinceStart() && input.isLive()) {
        return settled();
      } else if (
        lastStartedAt !== null &&
        now() - lastStartedAt < floorMs
      ) {
        return settled();
      }
    }

    if (inFlight) return enqueue(trigger);

    return start(trigger);
  };

  return {
    request,

    markStale() {
      stale = true;
      caughtUp = false;
      reconnectionsAnnounced = true;
    },

    noteConnected() {
      sawConnection = true;
      startedSinceConnect = false;

      // Announced, and spread over a couple of seconds: a deploy reconnects
      // the whole fleet at once.
      if (reconnectionsAnnounced) return settled();

      // Found connected with a list that already came through it.
      if (liveSinceStart()) return settled();

      return request("resync");
    },

    trustsLiveArrivals: () => caughtUp,

    closesGap: liveSinceStart,
  };
}

export { CONVERSATION_SYNC_FLOOR_MS, createConversationSync };
export type { ConversationSync, ConversationSyncTrigger };
