/**
 * Who is allowed to make noise right now.
 *
 * A conversation renders one player per voice note, and every one of them is
 * an independent native object that knows nothing about the others. Without
 * an arbiter, two taps mean two notes playing over each other — and the one
 * the driver forgot about keeps talking while they read something else.
 *
 * Deliberately a module singleton rather than a context: there is exactly one
 * audio output on the device, so the state being global is not a shortcut,
 * it is the fact being modelled. It also lets the screen stop playback on
 * blur without every bubble subscribing to navigation.
 */

type StopPlayback = () => void;

let holderId: string | null = null;
let stopHolder: StopPlayback | null = null;

/**
 * Takes the floor for `id`, stopping whoever had it. Re-claiming with the
 * same id only refreshes the handler — a player resuming itself must not
 * pause itself.
 */
function claimAudioFocus(id: string, stop: StopPlayback): void {
  if (holderId && holderId !== id) stopHolder?.();

  holderId = id;
  stopHolder = stop;
}

/** Gives the floor back, but only if `id` still holds it. */
function releaseAudioFocus(id: string): void {
  if (holderId !== id) return;

  holderId = null;
  stopHolder = null;
}

/**
 * Silences whatever is playing. Called when the conversation loses focus:
 * audio that outlives the screen it belongs to is the bug this prevents.
 */
function stopChatAudio(): void {
  stopHolder?.();

  holderId = null;
  stopHolder = null;
}

export { claimAudioFocus, releaseAudioFocus, stopChatAudio };
