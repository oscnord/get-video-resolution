import type { Resolution } from "./types";
import { parseHls } from "./parsers/hls";
import { parseDash } from "./parsers/dash";
import { parseFile } from "./parsers/file";

/**
 * Get the resolution of a video from a local file path or URL.
 *
 * Automatically detects the input type:
 * - `.m3u8` → HLS manifest parser
 * - `.mpd` → DASH manifest parser
 * - Everything else → file parser (MP4, WebM, MKV, AVI, etc.)
 */
export async function getVideoResolution(
  source: string,
): Promise<Resolution> {
  if (!source) {
    throw new Error("Source is required");
  }

  const type = detectType(source);

  switch (type) {
    case "hls":
      return parseHls(source);
    case "dash":
      return parseDash(source);
    case "file":
      return parseFile(source);
  }
}

type InputType = "hls" | "dash" | "file";

function detectType(source: string): InputType {
  // Strip query string and fragment for extension detection
  const clean = source.split("?")[0].split("#")[0].toLowerCase();

  if (clean.endsWith(".m3u8")) return "hls";
  if (clean.endsWith(".mpd")) return "dash";
  return "file";
}
