import { MediaParseError } from "../errors";
import type {
  GetVideoResolutionOptions,
  ParsedMetadata,
  VideoInfo,
} from "../types";
import { getAspectRatio } from "../utils/aspect-ratio";
import { parseAVI } from "./avi";
import { parseMP4 } from "./mp4";
import { EBML_MAGIC, parseWebM } from "./webm";

interface FileParseOptions {
  signal?: AbortSignal;
  timeout?: number;
  fetch?: typeof globalThis.fetch;
}

async function toUint8Array(
  source: string | Buffer | Blob | ReadableStream,
  options: FileParseOptions,
): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    return source;
  }

  if (source instanceof Blob) {
    return new Uint8Array(await source.arrayBuffer());
  }

  if (source instanceof ReadableStream) {
    const chunks: Uint8Array[] = [];
    const reader = source.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  if (typeof source !== "string") {
    throw new MediaParseError("Unsupported source type");
  }

  const isUrl = source.startsWith("http://") || source.startsWith("https://");

  if (isUrl) {
    const fetchFn = options.fetch ?? globalThis.fetch;
    const response = await fetchFn(source, { signal: options.signal });
    if (!response.ok) {
      throw new MediaParseError(
        `Failed to fetch ${source}: ${response.status}`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  // Local file path — dynamic import to keep browser-compatible
  const { readFile } = await import("node:fs/promises");
  return new Uint8Array(await readFile(source));
}

function detectFormat(data: Uint8Array): "mp4" | "webm" | "avi" | "unknown" {
  if (data.length < 4) return "unknown";

  const magic =
    ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
  if (magic === EBML_MAGIC) return "webm";

  // AVI: RIFF....AVI
  if (data.length >= 12) {
    const riff = String.fromCharCode(data[0], data[1], data[2], data[3]);
    const avi = String.fromCharCode(data[8], data[9], data[10], data[11]);
    if (riff === "RIFF" && avi === "AVI ") return "avi";
  }

  // MP4/MOV: look for ftyp or moov in first few top-level boxes
  let pos = 0;
  while (pos + 8 <= data.length && pos < 64) {
    const fourcc = String.fromCharCode(
      data[pos + 4],
      data[pos + 5],
      data[pos + 6],
      data[pos + 7],
    );
    if (fourcc === "ftyp" || fourcc === "moov" || fourcc === "mdat")
      return "mp4";
    const size =
      ((data[pos] << 24) |
        (data[pos + 1] << 16) |
        (data[pos + 2] << 8) |
        data[pos + 3]) >>>
      0;
    if (size < 8) break;
    pos += size;
  }

  return "unknown";
}

export async function parseFile(
  source: string | Buffer | Blob | ReadableStream,
  options: Pick<GetVideoResolutionOptions, "signal" | "timeout" | "fetch">,
): Promise<VideoInfo> {
  try {
    const data = await toUint8Array(source, options);
    const format = detectFormat(data);

    let result: ParsedMetadata;

    switch (format) {
      case "mp4":
        result = parseMP4(data);
        break;
      case "webm":
        result = parseWebM(data);
        break;
      case "avi":
        result = parseAVI(data);
        break;
      default:
        throw new MediaParseError(
          "Unrecognized file format. Supported formats: MP4, MOV, WebM, MKV, AVI.",
        );
    }

    return {
      width: result.width,
      height: result.height,
      duration: result.duration,
      codec: result.codec,
      framerate: result.framerate,
      aspectRatio: getAspectRatio(result.width, result.height),
      hdr: result.hdr,
    };
  } catch (error) {
    if (error instanceof MediaParseError) throw error;
    throw new MediaParseError(
      `Failed to parse file: ${(error as Error).message}`,
      { cause: error },
    );
  }
}
