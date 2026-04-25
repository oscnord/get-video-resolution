import { MediaParseError } from "../errors";
import type { GetVideoResolutionOptions, VideoInfo } from "../types";
import { getAspectRatio } from "../utils/aspect-ratio";
import type { FetchOptions } from "../utils/fetch";
import { buildSignal } from "../utils/fetch";
import { parseAVI } from "./avi";
import { parseMP4 } from "./mp4";
import { EBML_MAGIC, parseWebM } from "./webm";

const PROBE_SIZE = 1024 * 1024; // 1 MB

type Format = "mp4" | "webm" | "avi" | "unknown";

function detectFormat(data: Uint8Array): Format {
  if (data.length < 4) return "unknown";

  const magic =
    ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
  if (magic === EBML_MAGIC) return "webm";

  if (data.length >= 12) {
    const riff = String.fromCharCode(data[0], data[1], data[2], data[3]);
    const avi = String.fromCharCode(data[8], data[9], data[10], data[11]);
    if (riff === "RIFF" && avi === "AVI ") return "avi";
  }

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

const PARSERS = {
  mp4: parseMP4,
  webm: parseWebM,
  avi: parseAVI,
} as const;

function parseData(data: Uint8Array, format?: Format): VideoInfo {
  const fmt = format ?? detectFormat(data);
  const parser = fmt !== "unknown" ? PARSERS[fmt] : undefined;
  if (!parser) {
    throw new MediaParseError(
      "Unrecognized file format. Supported formats: MP4, MOV, WebM, MKV, AVI.",
    );
  }

  const result = parser(data);
  return {
    ...result,
    aspectRatio: getAspectRatio(result.width, result.height),
  };
}

async function fetchRange(
  url: string,
  fetchFn: typeof globalThis.fetch,
  signal: AbortSignal | undefined,
  range: string,
): Promise<Response> {
  const response = await fetchFn(url, {
    signal,
    headers: { Range: range },
  });
  if (!response.ok) {
    throw new MediaParseError(`Failed to fetch ${url}: ${response.status}`);
  }
  return response;
}

async function parseFromUrl(
  url: string,
  options: FetchOptions,
): Promise<VideoInfo> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const { signal, cleanup } = buildSignal(options);

  try {
    const probeResponse = await fetchRange(
      url,
      fetchFn,
      signal,
      `bytes=0-${PROBE_SIZE - 1}`,
    );
    const probeData = new Uint8Array(await probeResponse.arrayBuffer());

    // Server ignored Range header — we have the full file
    if (probeResponse.status !== 206) return parseData(probeData);

    const format = detectFormat(probeData);

    // WebM/MKV/AVI: headers are always at the start
    if (format === "webm" || format === "avi")
      return parseData(probeData, format);

    // MP4: moov might be at the end of the file
    if (format === "mp4") {
      try {
        return parseData(probeData, format);
      } catch (error) {
        if (
          !(error instanceof MediaParseError) ||
          !error.message.includes("No moov box")
        ) {
          throw error;
        }
        const contentRange = probeResponse.headers.get("content-range");
        const totalMatch = contentRange?.match(/\/(\d+)/);
        if (!totalMatch) throw error;

        const totalSize = parseInt(totalMatch[1], 10);
        const start = Math.max(0, totalSize - PROBE_SIZE);
        const tailResponse = await fetchRange(
          url,
          fetchFn,
          signal,
          `bytes=${start}-${totalSize - 1}`,
        );
        return parseData(
          new Uint8Array(await tailResponse.arrayBuffer()),
          "mp4",
        );
      }
    }

    // Unknown format with partial data — fall back to full download
    const fullResponse = await fetchFn(url, { signal });
    if (!fullResponse.ok) {
      throw new MediaParseError(
        `Failed to fetch ${url}: ${fullResponse.status}`,
      );
    }
    return parseData(new Uint8Array(await fullResponse.arrayBuffer()));
  } finally {
    cleanup();
  }
}

async function toUint8Array(
  source: Buffer | Blob | ReadableStream | string,
): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source;

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

  const { readFile } = await import("node:fs/promises");
  return new Uint8Array(await readFile(source));
}

export async function parseFile(
  source: string | Buffer | Blob | ReadableStream,
  options: Pick<GetVideoResolutionOptions, "signal" | "timeout" | "fetch">,
): Promise<VideoInfo> {
  try {
    if (
      typeof source === "string" &&
      (source.startsWith("http://") || source.startsWith("https://"))
    ) {
      return await parseFromUrl(source, options);
    }

    const data = await toUint8Array(source);
    return parseData(data);
  } catch (error) {
    if (error instanceof MediaParseError) throw error;
    throw new MediaParseError(
      `Failed to parse file: ${(error as Error).message}`,
      { cause: error },
    );
  }
}
