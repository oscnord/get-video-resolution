import { UnsupportedSourceError } from "./errors";
import { parseDash } from "./parsers/dash";
import { parseFile } from "./parsers/file";
import { parseHls } from "./parsers/hls";
import type { GetVideoResolutionOptions, VideoInfo } from "./types";
import { buildSignal } from "./utils/fetch";

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
  options: GetVideoResolutionOptions & { pick: "all" },
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

  const isUrl = source.startsWith("http://") || source.startsWith("https://");
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
  const { signal, cleanup } = buildSignal(options);

  try {
    const response = await fetchFn(url, { method: "HEAD", signal });
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

    // Generic content-type — try a tiny Range probe and inspect bytes.
    if (
      !contentType ||
      contentType.includes("application/octet-stream") ||
      contentType.startsWith("text/plain") ||
      contentType.startsWith("text/xml") ||
      contentType.startsWith("application/xml")
    ) {
      const magic = await sniffMagicBytes(url, fetchFn, signal);
      if (magic) return magic;
    }
  } catch {
    // Sniffing failed -- fall through to file parser
  } finally {
    cleanup();
  }

  return "file";
}

async function sniffMagicBytes(
  url: string,
  fetchFn: typeof globalThis.fetch,
  signal: AbortSignal | undefined,
): Promise<InputType | null> {
  try {
    const response = await fetchFn(url, {
      headers: { Range: "bytes=0-2047" },
      signal,
    });
    if (!response.ok && response.status !== 200 && response.status !== 206) {
      return null;
    }
    const buf = new Uint8Array(await response.arrayBuffer());
    const head = new TextDecoder("utf-8", { fatal: false })
      .decode(buf.subarray(0, Math.min(buf.length, 2048)))
      .trimStart();
    if (head.startsWith("#EXTM3U")) return "hls";
    if (head.startsWith("<?xml") || /^<MPD\b/.test(head)) return "dash";
    return "file";
  } catch {
    return null;
  }
}

function pickVariants(
  variants: VideoInfo[],
  pick: GetVideoResolutionOptions["pick"],
): VideoInfo | VideoInfo[] {
  if (pick === "all") return variants;
  const wantHigher = pick !== "lowest";
  return variants.reduce((best, current) => {
    const cmp = compareVariants(current, best);
    if (wantHigher ? cmp > 0 : cmp < 0) return current;
    return best;
  });
}

function compareVariants(a: VideoInfo, b: VideoInfo): number {
  const areaDiff = a.width * a.height - b.width * b.height;
  if (areaDiff !== 0) return areaDiff;
  // Tie on resolution: prefer higher bitrate as the proxy for quality.
  return (a.bitrate ?? 0) - (b.bitrate ?? 0);
}
