import type { VideoInfo, GetVideoResolutionOptions } from "./types";
import { parseHls } from "./parsers/hls";
import { parseDash } from "./parsers/dash";
import { parseFile } from "./parsers/file";
import { UnsupportedSourceError } from "./errors";

/**
 * Get the resolution of a video from a local file path, URL, or binary data.
 *
 * Automatically detects the input type:
 * - `.m3u8` -> HLS manifest parser
 * - `.mpd` -> DASH manifest parser
 * - Everything else -> file parser (MP4, WebM, MKV, AVI, etc.)
 *
 * When `sniff: true` and the URL has no recognized extension, a HEAD request
 * is sent to detect the content type.
 */
export async function getVideoResolution(
  source: string | Buffer | Blob | ReadableStream,
  options?: GetVideoResolutionOptions & { pick: "all" },
): Promise<VideoInfo[]>;
export async function getVideoResolution(
  source: string | Buffer | Blob | ReadableStream,
  options?: GetVideoResolutionOptions,
): Promise<VideoInfo>;
export async function getVideoResolution(
  source: string | Buffer | Blob | ReadableStream,
  options: GetVideoResolutionOptions = {},
): Promise<VideoInfo | VideoInfo[]> {
  // Non-string input goes directly to file parser
  if (typeof source !== "string") {
    const info = await parseFile(source, options);
    return options.pick === "all" ? [info] : info;
  }

  validateSource(source);

  const type = await detectType(source, options);

  switch (type) {
    case "hls": {
      const variants = await parseHls(source, options);
      return pickVariants(variants, options.pick);
    }
    case "dash": {
      const variants = await parseDash(source, options);
      return pickVariants(variants, options.pick);
    }
    case "file": {
      const info = await parseFile(source, options);
      return options.pick === "all" ? [info] : info;
    }
  }
}

function validateSource(source: string): void {
  if (!source) {
    throw new UnsupportedSourceError("Source is required");
  }

  const isUrl =
    source.startsWith("http://") || source.startsWith("https://");
  const isAbsolute = source.startsWith("/") || /^[A-Za-z]:[\\/]/.test(source);
  const isRelative = source.startsWith("./") || source.startsWith("../");

  if (!isUrl && !isAbsolute && !isRelative) {
    throw new UnsupportedSourceError(
      `Invalid source: "${source}". Expected an absolute path, relative path (./), or URL (http/https).`,
    );
  }
}

type InputType = "hls" | "dash" | "file";

async function detectType(
  source: string,
  options: GetVideoResolutionOptions,
): Promise<InputType> {
  const clean = source.split("?")[0].split("#")[0].toLowerCase();

  if (clean.endsWith(".m3u8")) return "hls";
  if (clean.endsWith(".mpd")) return "dash";

  if (
    options.sniff &&
    (source.startsWith("http://") || source.startsWith("https://"))
  ) {
    return await sniffContentType(source, options);
  }

  return "file";
}

async function sniffContentType(
  url: string,
  options: GetVideoResolutionOptions,
): Promise<InputType> {
  const fetchFn = options.fetch ?? globalThis.fetch;

  try {
    const response = await fetchFn(url, {
      method: "HEAD",
      signal: options.signal,
    });
    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";

    if (
      contentType.includes("application/vnd.apple.mpegurl") ||
      contentType.includes("audio/mpegurl")
    ) {
      return "hls";
    }
    if (contentType.includes("application/dash+xml")) {
      return "dash";
    }
  } catch {
    // Sniffing failed -- fall through to file parser
  }

  return "file";
}

function pickVariants(
  variants: VideoInfo[],
  pick: GetVideoResolutionOptions["pick"],
): VideoInfo | VideoInfo[] {
  if (pick === "all") return variants;

  const compareFn =
    pick === "lowest"
      ? (a: VideoInfo, b: VideoInfo) =>
          a.width * a.height < b.width * b.height ? a : b
      : (a: VideoInfo, b: VideoInfo) =>
          a.width * a.height > b.width * b.height ? a : b;

  return variants.reduce(compareFn);
}
