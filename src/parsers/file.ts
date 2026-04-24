import { MediaParseError } from "../errors";
import type { GetVideoResolutionOptions, VideoInfo } from "../types";
import { getAspectRatio } from "../utils/aspect-ratio";
import { parseMP4 } from "./mp4";

async function toUint8Array(
  source: string | Buffer | Blob | ReadableStream,
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
    throw new MediaParseError(`Unsupported source type`);
  }

  const isUrl = source.startsWith("http://") || source.startsWith("https://");

  if (isUrl) {
    const response = await fetch(source);
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

const EBML_HEADER = 0x1a45dfa3;

function detectFormat(data: Uint8Array): "mp4" | "webm" | "unknown" {
  if (data.length < 4) return "unknown";

  const magic =
    ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
  if (magic === EBML_HEADER) return "webm";

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
  _options: Pick<GetVideoResolutionOptions, "signal" | "timeout">,
): Promise<VideoInfo> {
  try {
    const data = await toUint8Array(source);
    const format = detectFormat(data);

    if (format === "webm") {
      throw new MediaParseError(
        "WebM/MKV files are not yet supported. Supported formats: MP4, MOV.",
      );
    }

    if (format === "unknown") {
      throw new MediaParseError(
        "Unrecognized file format. Supported formats: MP4, MOV.",
      );
    }

    const result = parseMP4(data);

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
