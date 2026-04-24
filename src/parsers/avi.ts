import type { ParsedMetadata } from "../types";

function readU32LE(data: Uint8Array, offset: number): number {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  );
}

function readFourCC(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3],
  );
}

const CODEC_MAP: Record<string, string> = {
  H264: "avc1",
  X264: "avc1",
  AVC1: "avc1",
  HEVC: "hvc1",
  HVC1: "hvc1",
  H265: "hvc1",
  XVID: "xvid",
  DIVX: "divx",
  DX50: "divx",
  FMP4: "mp4v",
  MP4V: "mp4v",
  MJPG: "mjpg",
  VP80: "vp08",
  VP90: "vp09",
  AV01: "av01",
};

function mapCodec(fourcc: string): string {
  const trimmed = fourcc.replace(/\0/g, "").trim();
  return CODEC_MAP[trimmed.toUpperCase()] ?? trimmed.toLowerCase();
}

interface ChunkHeader {
  type: string;
  size: number;
  offset: number;
  headerSize: number;
}

function readChunkHeader(data: Uint8Array, offset: number): ChunkHeader | null {
  if (offset + 8 > data.length) return null;

  const type = readFourCC(data, offset);
  const size = readU32LE(data, offset + 4);

  return { type, size, offset, headerSize: 8 };
}

function findChunk(
  data: Uint8Array,
  start: number,
  end: number,
  type: string,
): ChunkHeader | null {
  let pos = start;
  while (pos + 8 <= end) {
    const chunk = readChunkHeader(data, pos);
    if (!chunk) break;

    if (chunk.type === type) return chunk;

    // Chunks are word-aligned (padded to even size)
    const dataSize = chunk.size + (chunk.size % 2);
    pos += 8 + dataSize;
  }
  return null;
}

function findList(
  data: Uint8Array,
  start: number,
  end: number,
  listType: string,
): ChunkHeader | null {
  let pos = start;
  while (pos + 12 <= end) {
    const chunk = readChunkHeader(data, pos);
    if (!chunk) break;

    if (chunk.type === "LIST" && pos + 12 <= end) {
      const subType = readFourCC(data, pos + 8);
      if (subType === listType) return chunk;
    }

    const dataSize = chunk.size + (chunk.size % 2);
    pos += 8 + dataSize;
  }
  return null;
}

interface StreamHeader {
  fccType: string;
  fccHandler: string;
  dwScale: number;
  dwRate: number;
  dwLength: number;
}

function parseStrh(data: Uint8Array, offset: number): StreamHeader {
  return {
    fccType: readFourCC(data, offset),
    fccHandler: readFourCC(data, offset + 4),
    dwScale: readU32LE(data, offset + 20),
    dwRate: readU32LE(data, offset + 24),
    dwLength: readU32LE(data, offset + 32),
  };
}

interface BitmapInfo {
  biWidth: number;
  biHeight: number;
  biCompression: string;
}

function parseStrf(data: Uint8Array, offset: number): BitmapInfo {
  return {
    biWidth: readU32LE(data, offset + 4),
    biHeight: readU32LE(data, offset + 8),
    biCompression: readFourCC(data, offset + 16),
  };
}

export function parseAVI(data: Uint8Array): ParsedMetadata {
  // Validate RIFF header
  if (data.length < 12) {
    throw new Error("File too small to be a valid AVI");
  }

  const riff = readFourCC(data, 0);
  const aviType = readFourCC(data, 8);
  if (riff !== "RIFF" || aviType !== "AVI ") {
    throw new Error("Not a valid AVI file");
  }

  const riffEnd = Math.min(8 + readU32LE(data, 4), data.length);

  // Find hdrl LIST
  const hdrl = findList(data, 12, riffEnd, "hdrl");
  if (!hdrl) throw new Error("No hdrl list found in AVI");

  const hdrlStart = hdrl.offset + 12; // skip LIST + size + "hdrl"
  const hdrlEnd = hdrl.offset + 8 + hdrl.size;

  // Parse avih (main AVI header) for fallback dimensions and framerate
  const avihChunk = findChunk(data, hdrlStart, hdrlEnd, "avih");
  let fallbackWidth = 0;
  let fallbackHeight = 0;
  let fallbackFps: number | undefined;

  if (avihChunk) {
    const avihData = avihChunk.offset + 8;
    const microSecPerFrame = readU32LE(data, avihData);
    if (microSecPerFrame > 0) {
      fallbackFps = 1_000_000 / microSecPerFrame;
    }
    fallbackWidth = readU32LE(data, avihData + 32);
    fallbackHeight = readU32LE(data, avihData + 36);
  }

  // Find first video stream (strl LIST with strh.fccType == "vids")
  let width = 0;
  let height = 0;
  let codec: string | undefined;
  let fps: number | undefined;
  let totalFrames = 0;

  let pos = hdrlStart;
  while (pos + 12 <= hdrlEnd) {
    const chunk = readChunkHeader(data, pos);
    if (!chunk) break;

    if (chunk.type === "LIST" && pos + 12 <= hdrlEnd) {
      const subType = readFourCC(data, pos + 8);

      if (subType === "strl") {
        const strlStart = pos + 12;
        const strlEnd = pos + 8 + chunk.size;

        const strhChunk = findChunk(data, strlStart, strlEnd, "strh");
        if (strhChunk) {
          const strh = parseStrh(data, strhChunk.offset + 8);

          if (strh.fccType === "vids") {
            codec = mapCodec(strh.fccHandler);
            totalFrames = strh.dwLength;

            if (strh.dwScale > 0 && strh.dwRate > 0) {
              fps = strh.dwRate / strh.dwScale;
            }

            const strfChunk = findChunk(data, strlStart, strlEnd, "strf");
            if (strfChunk) {
              const strf = parseStrf(data, strfChunk.offset + 8);
              width = strf.biWidth;
              height = Math.abs(strf.biHeight | 0); // can be negative (top-down)

              // Prefer compression fourcc if handler was generic
              if (codec === "" || codec === "\0\0\0\0" || codec === "vids") {
                codec = mapCodec(strf.biCompression);
              }
            }

            break; // found video stream
          }
        }
      }
    }

    const dataSize = chunk.size + (chunk.size % 2);
    pos += 8 + dataSize;
  }

  // Apply fallbacks
  if (width === 0) width = fallbackWidth;
  if (height === 0) height = fallbackHeight;
  if (!fps) fps = fallbackFps;

  if (width === 0 || height === 0) {
    throw new Error("No video dimensions found in AVI file");
  }

  const framerate = fps ? Math.round(fps * 1000) / 1000 : undefined;
  const duration =
    framerate && totalFrames > 0 ? totalFrames / framerate : undefined;

  return {
    width,
    height,
    duration,
    codec,
    framerate,
    hdr: false, // AVI predates HDR
  };
}
