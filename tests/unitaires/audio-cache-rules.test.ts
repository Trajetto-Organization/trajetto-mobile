import { describe, expect, it } from "vitest";

import {
  AUDIO_CACHE_LIMITS,
  audioCacheExtension,
  audioCacheFileName,
  downloadRatio,
  isLocalFileUri,
  resolveAudioControl,
  selectAudioCacheEvictions,
  type AudioCacheEntry,
  type AudioControlInput,
} from "@/features/chat/audio-cache-rules";

const MESSAGE_ID = "cm4voice0001abcd";

/** The same object, signed twice — which is what the API really returns. */
const FIRST_SIGNATURE =
  "https://storage.example.com/tenant-1/chat/voice-note.m4a?X-Amz-Signature=aaa111&X-Amz-Expires=900";

const SECOND_SIGNATURE =
  "https://storage.example.com/tenant-1/chat/voice-note.m4a?X-Amz-Signature=bbb222&X-Amz-Expires=900";

function makeControlInput(
  overrides: Partial<AudioControlInput> = {},
): AudioControlInput {
  return {
    isCached: true,
    isDownloading: false,
    hasFailed: false,
    isPreparing: false,
    isPlaying: false,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<AudioCacheEntry> & { name: string }) {
  return {
    size: 1024,
    modifiedAt: 0,
    ...overrides,
  };
}

describe("recognising a note that is already local", () => {
  it("treats a file uri as its own cache", () => {
    expect(isLocalFileUri("file:///data/user/0/cache/voice.m4a")).toBe(true);
    expect(isLocalFileUri("  file:///tmp/voice.m4a  ")).toBe(true);
    expect(isLocalFileUri("FILE:///tmp/voice.m4a")).toBe(true);
  });

  it("does not mistake a remote url for a local one", () => {
    expect(isLocalFileUri(FIRST_SIGNATURE)).toBe(false);
    expect(isLocalFileUri("content://media/audio/1")).toBe(false);
    expect(isLocalFileUri("")).toBe(false);
  });
});

describe("naming a cached voice note", () => {
  it("keeps the same name when the url is signed again", () => {
    // The whole point of the cache: a fresh signature must not create a
    // second copy of a file this device already holds.
    expect(audioCacheFileName(MESSAGE_ID, FIRST_SIGNATURE)).toBe(
      audioCacheFileName(MESSAGE_ID, SECOND_SIGNATURE),
    );
  });

  it("gives different messages different names", () => {
    expect(audioCacheFileName("message-a", FIRST_SIGNATURE)).not.toBe(
      audioCacheFileName("message-b", FIRST_SIGNATURE),
    );
  });

  it("builds the name from the message id", () => {
    expect(audioCacheFileName(MESSAGE_ID, FIRST_SIGNATURE)).toBe(
      `${MESSAGE_ID}.m4a`,
    );
  });

  it("refuses anything that could climb out of the cache directory", () => {
    expect(audioCacheFileName("../../etc/passwd", FIRST_SIGNATURE)).toBe(
      "______etc_passwd.m4a",
    );

    expect(audioCacheFileName("  ", FIRST_SIGNATURE)).toBe("unknown.m4a");
  });

  it("takes the extension from the path and never from the query", () => {
    expect(audioCacheExtension(FIRST_SIGNATURE)).toBe(".m4a");

    expect(
      audioCacheExtension("https://storage.example.com/note.mp3?sig=abc.wav"),
    ).toBe(".mp3");

    expect(audioCacheExtension("https://storage.example.com/note.OGG")).toBe(
      ".ogg",
    );
  });

  it("falls back to the format the app itself records", () => {
    expect(audioCacheExtension("https://storage.example.com/note")).toBe(
      ".m4a",
    );

    expect(audioCacheExtension("https://storage.example.com/note.php")).toBe(
      ".m4a",
    );

    expect(audioCacheExtension("https://storage.example.com/.hidden")).toBe(
      ".m4a",
    );
  });
});

describe("download progress", () => {
  it("reports a ratio when the size is known", () => {
    expect(downloadRatio(0, 2000)).toBe(0);
    expect(downloadRatio(500, 2000)).toBe(0.25);
    expect(downloadRatio(2000, 2000)).toBe(1);
  });

  it("never runs past the end", () => {
    expect(downloadRatio(3000, 2000)).toBe(1);
  });

  it("answers null rather than a fake zero when the size is unknown", () => {
    expect(downloadRatio(500, 0)).toBeNull();
    expect(downloadRatio(500, -1)).toBeNull();
    expect(downloadRatio(500, Number.NaN)).toBeNull();
  });
});

describe("what the button offers", () => {
  it("shows the download arrow for a note this device does not have", () => {
    expect(resolveAudioControl(makeControlInput({ isCached: false }))).toBe(
      "download",
    );
  });

  it("shows play for a cached note and pause while it sounds", () => {
    expect(resolveAudioControl(makeControlInput())).toBe("play");

    expect(resolveAudioControl(makeControlInput({ isPlaying: true }))).toBe(
      "pause",
    );
  });

  it("shows the spinner between the tap and the first sound", () => {
    expect(
      resolveAudioControl(
        makeControlInput({ isPreparing: true, isPlaying: true }),
      ),
    ).toBe("buffering");
  });

  it("puts the transfer ahead of the missing file", () => {
    expect(
      resolveAudioControl(
        makeControlInput({ isCached: false, isDownloading: true }),
      ),
    ).toBe("downloading");
  });

  it("puts a failure ahead of everything else", () => {
    expect(
      resolveAudioControl(
        makeControlInput({
          hasFailed: true,
          isDownloading: true,
          isCached: false,
          isPlaying: true,
        }),
      ),
    ).toBe("retry");
  });
});

describe("keeping the cache inside its ceiling", () => {
  it("evicts nothing while the cache fits", () => {
    const entries = [
      makeEntry({ name: "a.m4a", modifiedAt: 1 }),
      makeEntry({ name: "b.m4a", modifiedAt: 2 }),
    ];

    expect(selectAudioCacheEvictions(entries)).toEqual([]);
  });

  it("drops the oldest first when there are too many files", () => {
    const entries = [
      makeEntry({ name: "new.m4a", modifiedAt: 300 }),
      makeEntry({ name: "old.m4a", modifiedAt: 100 }),
      makeEntry({ name: "middle.m4a", modifiedAt: 200 }),
    ];

    expect(
      selectAudioCacheEvictions(entries, { maxFiles: 1, maxBytes: Infinity }),
    ).toEqual(["old.m4a", "middle.m4a"]);
  });

  it("drops the oldest first when the bytes are over the ceiling", () => {
    const entries = [
      makeEntry({ name: "old.m4a", modifiedAt: 100, size: 600 }),
      makeEntry({ name: "new.m4a", modifiedAt: 200, size: 600 }),
    ];

    expect(
      selectAudioCacheEvictions(entries, { maxFiles: 100, maxBytes: 1000 }),
    ).toEqual(["old.m4a"]);
  });

  it("never evicts the note that was just written", () => {
    // Pruning runs right after a download, so the newest file being the last
    // candidate is what makes that safe.
    const entries = [
      makeEntry({ name: "just-downloaded.m4a", modifiedAt: 999, size: 900 }),
      makeEntry({ name: "old-1.m4a", modifiedAt: 1, size: 900 }),
      makeEntry({ name: "old-2.m4a", modifiedAt: 2, size: 900 }),
    ];

    const evicted = selectAudioCacheEvictions(entries, {
      maxFiles: 100,
      maxBytes: 1000,
    });

    expect(evicted).toEqual(["old-1.m4a", "old-2.m4a"]);
    expect(evicted).not.toContain("just-downloaded.m4a");
  });

  it("breaks ties on the name so the choice is deterministic", () => {
    const entries = [
      makeEntry({ name: "b.m4a", modifiedAt: 5 }),
      makeEntry({ name: "a.m4a", modifiedAt: 5 }),
    ];

    expect(
      selectAudioCacheEvictions(entries, { maxFiles: 1, maxBytes: Infinity }),
    ).toEqual(["a.m4a"]);
  });

  it("defaults to a ceiling that fits a shift of voice notes", () => {
    expect(AUDIO_CACHE_LIMITS.maxFiles).toBe(50);
    expect(AUDIO_CACHE_LIMITS.maxBytes).toBe(100 * 1024 * 1024);
  });
});
