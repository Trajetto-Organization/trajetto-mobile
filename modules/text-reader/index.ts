import { requireOptionalNativeModule } from "expo";

/**
 * The local Expo module `text-reader` (decision 14.2): ML Kit Text
 * Recognition v2, Latin, bundled — the photo is read on the phone, offline.
 *
 * Optional on purpose: a binary built before the module (or Expo Go) has no
 * native side, and the pre-check then simply does not run. It never blocks
 * the driver, so neither may its absence.
 */

interface ReadTextLine {
  text: string;
  /** 0–1 as ML Kit reports it; null when the engine gave none. */
  confidence: number | null;
}

interface ReadTextBlock {
  text: string;
  lines: ReadTextLine[];
}

interface ReadTextResult {
  blocks: ReadTextBlock[];
  /** Wall time of the native read, decode included. */
  durationMs: number;
}

interface TextReaderNativeModule {
  readText(uri: string): Promise<ReadTextResult>;
}

const native = requireOptionalNativeModule<TextReaderNativeModule>("TextReader");

/** The ML Kit artifact this module is built with (android/build.gradle). */
const TEXT_READER_ENGINE_VERSION = "16.0.1";

function isTextReaderAvailable(): boolean {
  return native !== null;
}

/** Reads the text of a local photo (a file:// URI the app wrote). */
async function readText(uri: string): Promise<ReadTextResult> {
  if (!native) throw new Error("TEXT_READER_UNAVAILABLE");

  return native.readText(uri);
}

export { TEXT_READER_ENGINE_VERSION, isTextReaderAvailable, readText };
export type { ReadTextBlock, ReadTextLine, ReadTextResult };
