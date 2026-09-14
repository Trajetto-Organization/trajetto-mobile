import { Directory, File, Paths } from "expo-file-system";
import { createDownloadResumable } from "expo-file-system/legacy";

import {
  audioCacheFileName,
  downloadRatio,
  isLocalFileUri,
  selectAudioCacheEvictions,
  type AudioCacheEntry,
} from "./audio-cache-rules";

/**
 * Voice notes on disk.
 *
 * TWO APIS ON PURPOSE. `expo-file-system` 19 (SDK 54) replaced the old
 * function API with the `File`/`Directory`/`Paths` classes, and those handle
 * everything here except one thing: `File.downloadFileAsync` reports no
 * progress and cannot be cancelled. A driver on 3G watching a frozen button
 * is exactly what this feature exists to avoid, so the transfer itself goes
 * through `expo-file-system/legacy`'s `createDownloadResumable`, which still
 * ships in the same package and still gives byte-by-byte progress and a
 * cancel. The repo already mixes the two the same way (see
 * `features/media/upload-to-storage.ts`).
 */

/** Under `Paths.cache`: the OS may reclaim this, and losing it costs a fetch. */
const AUDIO_CACHE_DIRECTORY = "trajetto-chat-audio";

/**
 * Bytes land here first and are renamed into place only once the transfer is
 * complete. On Android the legacy download streams straight into its target,
 * so a connection dropping halfway would otherwise leave a truncated file
 * that `exists` happily reports as cached — a note that plays as two seconds
 * of noise and never repairs itself.
 */
const PARTIAL_SUFFIX = ".part";

interface ChatAudioDownloadInput {
  /** The cache key. Never the signed url — see `audioCacheFileName`. */
  messageId: string;

  sourceUrl: string;

  /** Ratio 0..1, or null while the size is unknown. */
  onProgress: (ratio: number | null) => void;
}

interface ChatAudioDownload {
  /** Resolves with the local `file://` uri of the finished note. */
  promise: Promise<string>;

  /** Aborts the transfer; the promise then rejects. */
  cancel: () => void;
}

function audioCacheDirectory(): Directory {
  const directory = new Directory(Paths.cache, AUDIO_CACHE_DIRECTORY);

  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }

  return directory;
}

function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // A file that cannot be deleted is a file the next prune will find again.
  }
}

/**
 * Files a note the driver just recorded under its confirmed message id.
 *
 * Without this, the driver's own voice note asks to be downloaded seconds
 * after he recorded it: while the send is optimistic the bubble plays the
 * local recording, but confirmation swaps the optimistic id for the server's,
 * the row remounts, and the cache — keyed on the message — has never heard of
 * the new id. The file is already on this phone; copying it in is the whole
 * fix, and it also means the note plays back later with no network at all.
 *
 * Silent and best-effort: a cache that could not be seeded costs a download,
 * never a failed send.
 */
function seedChatAudioCache(messageId: string, localUri: string): void {
  if (!isLocalFileUri(localUri)) return;

  try {
    const recorded = new File(localUri);

    if (!recorded.exists) return;

    // The extension has to come from the recording, not from the signed url
    // the server handed back — they are the same file, but only one of them
    // is on disk here.
    const target = new File(
      audioCacheDirectory(),
      audioCacheFileName(messageId, localUri),
    );

    if (target.exists) return;

    recorded.copy(target);

    pruneChatAudioCache();
  } catch {
    // Best-effort by design — see above.
  }
}

/**
 * The local copy of a note, or null if this device does not have it.
 *
 * Cheap enough to call while a bubble mounts: `exists` is a synchronous
 * filesystem stat, and nothing is fetched.
 */
function findCachedChatAudio(
  messageId: string,
  sourceUrl: string,
): string | null {
  // The driver's own note, still uploading, is already a local file.
  if (isLocalFileUri(sourceUrl)) return sourceUrl;

  try {
    const file = new File(
      audioCacheDirectory(),
      audioCacheFileName(messageId, sourceUrl),
    );

    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/**
 * Brings the cache back under its ceiling, oldest note first.
 *
 * Called after a successful download rather than on a timer: that is the only
 * moment the cache grows, and doing it there means the limit is enforced
 * without anything having to remember to run.
 */
function pruneChatAudioCache(): void {
  try {
    const directory = audioCacheDirectory();
    const entries: AudioCacheEntry[] = [];

    for (const item of directory.list()) {
      if (!(item instanceof File)) continue;

      entries.push({
        name: item.name,
        size: item.size,
        // No readable time sorts as oldest, which is the safe direction: the
        // worst case is evicting a note that has to be fetched again.
        modifiedAt: item.modificationTime ?? 0,
      });
    }

    for (const name of selectAudioCacheEvictions(entries)) {
      deleteQuietly(new File(directory, name));
    }
  } catch {
    // A cache that could not be trimmed is not a reason to fail a playback.
  }
}

/**
 * Fetches a voice note into the cache, reporting progress as it goes.
 *
 * Returns a handle rather than a bare promise so the bubble can cancel when
 * it leaves the screen — a driver who scrolls past a note should not keep
 * paying for it.
 */
function downloadChatAudio(input: ChatAudioDownloadInput): ChatAudioDownload {
  const directory = audioCacheDirectory();
  const name = audioCacheFileName(input.messageId, input.sourceUrl);

  const target = new File(directory, name);
  const partial = new File(directory, `${name}${PARTIAL_SUFFIX}`);

  // Whatever a previous attempt left behind is not resumable: the range would
  // be replayed against a NEWLY signed url, which is a different request as
  // far as storage is concerned. Start clean.
  deleteQuietly(partial);

  const task = createDownloadResumable(
    input.sourceUrl,
    partial.uri,
    {},
    (progress) => {
      input.onProgress(
        downloadRatio(
          progress.totalBytesWritten,
          progress.totalBytesExpectedToWrite,
        ),
      );
    },
  );

  const promise = (async (): Promise<string> => {
    let result;

    try {
      result = await task.downloadAsync();
    } catch (error) {
      deleteQuietly(partial);
      throw error;
    }

    // `undefined` is how the legacy task reports its own cancellation.
    if (!result) {
      deleteQuietly(partial);
      throw new Error("chat-audio-download-cancelled");
    }

    // The legacy download writes whatever the server answered, status and
    // all: an expired signature comes back as a 403 with an XML body, and
    // that body would sit in the cache pretending to be a voice note.
    if (result.status < 200 || result.status >= 300) {
      deleteQuietly(partial);
      throw new Error(`chat-audio-download-${result.status}`);
    }

    deleteQuietly(target);
    partial.move(target);

    pruneChatAudioCache();

    return target.uri;
  })();

  return {
    promise,
    cancel: () => {
      void task.cancelAsync().catch(() => undefined);
    },
  };
}

export {
  downloadChatAudio,
  findCachedChatAudio,
  pruneChatAudioCache,
  seedChatAudioCache,
};
export type { ChatAudioDownload, ChatAudioDownloadInput };
