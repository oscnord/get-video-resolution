import { MediaParseError, VideoResolutionError } from "../errors";
import type { GetVideoResolutionOptions, VideoInfo } from "../types";
import { getAspectRatio } from "../utils/aspect-ratio";
import { readU32BE } from "../utils/binary";
import type { FetchOptions } from "../utils/fetch";
import type { RangeReader } from "../utils/range-reader";
import {
  blobReader,
  bufferReader,
  diskReader,
  httpReader,
  PROBE_SIZE,
  streamReader,
} from "../utils/range-reader";
import { parseAVI } from "./avi";
import { parseMP4 } from "./mp4";
import { EBML_MAGIC, parseWebM } from "./webm";

// Ceiling on the recovery reads below. A moov can legitimately reach tens of MB
// on a long recording, but a corrupt box size must not be trusted to allocate.
const MAX_RECOVERY_READ = 64 * 1024 * 1024;

type Format = "mp4" | "webm" | "avi" | "unknown";

function detectFormat(data: Uint8Array): Format {
  if (data.length < 4) return "unknown";

  const magic = readU32BE(data, 0);
  if (magic === EBML_MAGIC) return "webm";

  if (data.length >= 12) {
    const riff = String.fromCharCode(data[0], data[1], data[2], data[3]);
    const avi = String.fromCharCode(data[8], data[9], data[10], data[11]);
    if (riff === "RIFF" && avi === "AVI ") return "avi";
  }

  // Walk top-level boxes looking for an MP4 ftyp/moov/mdat. Cap iterations to
  // avoid pathological inputs that claim valid box sizes forever.
  let pos = 0;
  let iterations = 0;
  while (pos + 8 <= data.length && iterations < 16) {
    const fourcc = String.fromCharCode(
      data[pos + 4],
      data[pos + 5],
      data[pos + 6],
      data[pos + 7],
    );
    if (fourcc === "ftyp" || fourcc === "moov" || fourcc === "mdat")
      return "mp4";
    const size = readU32BE(data, pos);
    if (size < 8) break;
    pos += size;
    iterations++;
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
    aspectRatio:
      result.aspectRatio ?? getAspectRatio(result.width, result.height),
  };
}

function findMoovInProbe(
  data: Uint8Array,
): { offset: number; size: number } | null {
  let pos = 0;
  while (pos + 8 <= data.length) {
    const size = readU32BE(data, pos);
    if (
      data[pos + 4] === 0x6d &&
      data[pos + 5] === 0x6f &&
      data[pos + 6] === 0x6f &&
      data[pos + 7] === 0x76
    ) {
      return { offset: pos, size };
    }
    if (size < 8) break;
    pos += size;
  }
  return null;
}

function findMoovInTail(data: Uint8Array): number {
  // Scan backwards for a "moov" fourcc whose preceding 4 bytes form a plausible
  // big-endian box size that fits within the buffer. Iterating last-to-first
  // matches files with a "moov at end" layout; the size check filters out
  // false matches where the bytes appear inside payload data.
  for (let i = data.length - 8; i >= 0; i--) {
    if (
      data[i + 4] === 0x6d &&
      data[i + 5] === 0x6f &&
      data[i + 6] === 0x6f &&
      data[i + 7] === 0x76
    ) {
      const size = readU32BE(data, i);
      if (size >= 8 && i + size <= data.length) return i;
    }
  }
  return -1;
}

/** Never request beyond the source, and never trust a box size to allocate. */
const readCeiling = (size: number | undefined): number =>
  Math.min(size ?? MAX_RECOVERY_READ, MAX_RECOVERY_READ);

/**
 * The two MP4 layouts a single probe cannot satisfy. The first is detected
 * structurally (the moov header is visible but its box runs past the probe); the
 * second is gated on the parser's `reason`, so a moov that is present and simply
 * unusable reports its own failure instead of being masked by a pointless tail
 * read.
 */
async function recoverMp4(
  reader: RangeReader,
  probe: Uint8Array,
  size: number | undefined,
  original: MediaParseError,
): Promise<VideoInfo> {
  const moov = findMoovInProbe(probe);
  if (moov && moov.size > probe.length - moov.offset) {
    if (moov.offset + moov.size <= readCeiling(size)) {
      // The probe already holds the front of the box; fetch only the remainder.
      const head = probe.subarray(moov.offset);
      const rest = await reader.read(probe.length, moov.size - head.length);
      const full = new Uint8Array(head.length + rest.length);
      full.set(head, 0);
      full.set(rest, head.length);
      try {
        return parseData(full, "mp4");
      } catch {}
    }
  }

  if (
    original.context?.reason === "no-moov" &&
    size !== undefined &&
    size > probe.length
  ) {
    const tailLength = Math.min(PROBE_SIZE, size);
    const tail = await reader.read(size - tailLength, tailLength);
    const offset = findMoovInTail(tail);
    return parseData(offset >= 0 ? tail.subarray(offset) : tail, "mp4");
  }

  throw original;
}

/**
 * True when the top-level box walk ran off the end of the probe but lands back
 * inside the file, meaning a larger read could still identify the container.
 * Random bytes claim implausible sizes and are rejected here rather than
 * triggering a pointless full read.
 */
function boxWalkOverran(probe: Uint8Array, size: number): boolean {
  let pos = 0;
  for (let i = 0; i < 16 && pos + 8 <= probe.length; i++) {
    const boxSize = readU32BE(probe, pos);
    if (boxSize < 8) return false;
    pos += boxSize;
  }
  return pos > probe.length && pos < size;
}

/**
 * Last resort for a container whose signature sits behind a leading box larger
 * than the probe. Only attempted when the walk shows a bigger read could help.
 */
async function parseUnidentified(
  reader: RangeReader,
  probe: Uint8Array,
  size: number | undefined,
): Promise<VideoInfo> {
  if (
    size !== undefined &&
    size > probe.length &&
    size <= readCeiling(size) &&
    boxWalkOverran(probe, size)
  ) {
    return parseData(await reader.read(0, size));
  }
  return parseData(probe);
}

async function parseViaReader(reader: RangeReader): Promise<VideoInfo> {
  try {
    const probe = await reader.read(0, PROBE_SIZE);
    const size = await reader.size();
    const format = detectFormat(probe);

    if (format === "mp4") {
      try {
        return parseData(probe, "mp4");
      } catch (error) {
        if (!(error instanceof MediaParseError)) throw error;
        return await recoverMp4(reader, probe, size, error);
      }
    }

    if (format === "unknown")
      return await parseUnidentified(reader, probe, size);

    // WebM/MKV and AVI both carry their headers at the start.
    return parseData(probe, format);
  } finally {
    await reader.close?.();
  }
}

async function readerFor(
  source: string | Buffer | Blob | ReadableStream,
  options: FetchOptions,
): Promise<RangeReader> {
  if (typeof source === "string") {
    if (source.startsWith("http://") || source.startsWith("https://")) {
      return httpReader(source, options);
    }
    return await diskReader(source);
  }
  if (source instanceof Uint8Array) return bufferReader(source);
  if (source instanceof Blob) return blobReader(source);
  if (source instanceof ReadableStream) return await streamReader(source);
  throw new MediaParseError("Unsupported source type");
}

export async function parseFile(
  source: string | Buffer | Blob | ReadableStream,
  options: Pick<GetVideoResolutionOptions, "signal" | "timeout" | "fetch">,
): Promise<VideoInfo> {
  try {
    return await parseViaReader(await readerFor(source, options));
  } catch (error) {
    // Any of the library's own error types passes through with its class intact;
    // only foreign throws get wrapped.
    if (error instanceof VideoResolutionError) throw error;
    throw new MediaParseError(
      `Failed to parse file: ${(error as Error).message}`,
      { cause: error },
    );
  }
}
