/**
 * Who is allowed to make noise right now — and who holds the one native
 * player the conversation is allowed to have.
 *
 * Two facts, kept apart on purpose.
 *
 * The HOLDER is the note that is sounding. Without an arbiter, two taps mean
 * two notes playing over each other — and the one the driver forgot about
 * keeps talking while they read something else.
 *
 * The ARMED note is the one bubble that owns a native player at all. Every
 * `expo-audio` player is an ExoPlayer with its own playback thread, and a
 * prepared one also holds a decoder and a status loop. One per bubble meant a
 * thread with thirty voice notes kept thirty of them alive on a phone that
 * has none to spare (MOB-06). Now a bubble only builds its player once it is
 * armed, and arming one disarms whichever was armed before — so the whole
 * conversation owns at most one, however many notes it shows. A paused note
 * stays armed (resuming it costs nothing) until another note takes over.
 *
 * Deliberately a module singleton rather than a context: there is exactly one
 * audio output on the device, so the state being global is not a shortcut,
 * it is the fact being modelled. It also lets the screen stop playback on
 * blur without every bubble subscribing to navigation.
 */

type StopPlayback = () => void;

let holderId: string | null = null;
let stopHolder: StopPlayback | null = null;

let armedId: string | null = null;

const armedListeners = new Set<() => void>();

function notifyArmed(): void {
  [...armedListeners].forEach((listener) => {
    try {
      listener();
    } catch {
      // One broken bubble must not keep the others on a stale player.
    }
  });
}

function setArmed(id: string | null): void {
  if (armedId === id) return;

  armedId = id;
  notifyArmed();
}

/** Silences the holder, if it is somebody other than `id`. */
function stopOtherHolder(id: string | null): void {
  if (!holderId || holderId === id) return;

  const stop = stopHolder;

  holderId = null;
  stopHolder = null;

  stop?.();
}

/**
 * Hands the conversation's one native player to `id`.
 *
 * Whatever was sounding stops first, and whichever bubble was armed loses its
 * player — its own render reads `armedAudioPlayerId()` and tears it down.
 */
function armAudioPlayer(id: string): void {
  stopOtherHolder(id);
  setArmed(id);
}

/** Gives the player back, but only if `id` still holds it. */
function disarmAudioPlayer(id: string): void {
  if (armedId !== id) return;

  if (holderId === id) {
    holderId = null;
    stopHolder = null;
  }

  setArmed(null);
}

/**
 * Takes the floor for `id`, stopping whoever had it. Re-claiming with the
 * same id only refreshes the handler — a player resuming itself must not
 * pause itself. A note that makes noise is by definition the armed one.
 */
function claimAudioFocus(id: string, stop: StopPlayback): void {
  stopOtherHolder(id);

  holderId = id;
  stopHolder = stop;

  setArmed(id);
}

/**
 * Gives the floor back, but only if `id` still holds it. The note stays
 * armed: pausing is not a reason to rebuild the player on the next tap.
 */
function releaseAudioFocus(id: string): void {
  if (holderId !== id) return;

  holderId = null;
  stopHolder = null;
}

/**
 * Silences whatever is playing and releases the player. Called when the
 * conversation loses focus and when the microphone opens: audio that outlives
 * the screen it belongs to is the bug this prevents, and a player nobody can
 * hear is memory nobody is using.
 */
function stopChatAudio(): void {
  stopOtherHolder(null);
  setArmed(null);
}

/**
 * Whether `id` still has the floor. An asynchronous start (a seek that has to
 * land before the sound begins) asks this before playing, so a note the
 * driver replaced in the meantime does not burst back into sound.
 */
function holdsAudioFocus(id: string): boolean {
  return holderId === id;
}

/** Which bubble owns the native player right now, if any. */
function armedAudioPlayerId(): string | null {
  return armedId;
}

/** Shaped for `useSyncExternalStore`: returns the unsubscribe. */
function subscribeArmedAudioPlayer(listener: () => void): () => void {
  armedListeners.add(listener);

  return () => {
    armedListeners.delete(listener);
  };
}

export {
  armAudioPlayer,
  armedAudioPlayerId,
  claimAudioFocus,
  disarmAudioPlayer,
  holdsAudioFocus,
  releaseAudioFocus,
  stopChatAudio,
  subscribeArmedAudioPlayer,
};
