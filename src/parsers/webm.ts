import type { ParsedMetadata } from "../types";
import { isHdrCodec } from "../utils/hdr";

// Matroska element IDs
export const EBML_MAGIC = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const INFO_ID = 0x1549a966;
const TIMESTAMP_SCALE_ID = 0x2ad7b1;
const DURATION_ID = 0x4489;
const TRACKS_ID = 0x1654ae6b;
const TRACK_ENTRY_ID = 0xae;
const TRACK_TYPE_ID = 0x83;
const CODEC_ID_ID = 0x86;
const VIDEO_ID = 0xe0;
const PIXEL_WIDTH_ID = 0xb0;
const PIXEL_HEIGHT_ID = 0xba;
const DEFAULT_DURATION_ID = 0x23e383;

interface VINTResult {
  value: number;
  length: number;
}

function readVINT(data: Uint8Array, offset: number): VINTResult | null {
  if (offset >= data.length) return null;

  const first = data[offset];
  if (first === 0) return null;

  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length++;
    mask >>= 1;
  }

  if (length > 8 || offset + length > data.length) return null;

  let value = first & (mask - 1);
  for (let i = 1; i < length; i++) {
    value = value * 256 + data[offset + i];
  }

  return { value, length };
}

function readElementID(data: Uint8Array, offset: number): VINTResult | null {
  if (offset >= data.length) return null;

  const first = data[offset];
  if (first === 0) return null;

  let length = 1;
  let mask = 0x80;
  while (length <= 4 && (first & mask) === 0) {
    length++;
    mask >>= 1;
  }

  if (length > 4 || offset + length > data.length) return null;

  let value = first;
  for (let i = 1; i < length; i++) {
    value = value * 256 + data[offset + i];
  }

  return { value, length };
}

function readUint(data: Uint8Array, offset: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i++) {
    value = value * 256 + data[offset + i];
  }
  return value;
}

function readFloat(data: Uint8Array, offset: number, size: number): number {
  const view = new DataView(data.buffer, data.byteOffset + offset, size);
  if (size === 4) return view.getFloat32(0);
  if (size === 8) return view.getFloat64(0);
  return 0;
}

function readString(data: Uint8Array, offset: number, size: number): string {
  let str = "";
  for (let i = 0; i < size; i++) {
    if (data[offset + i] === 0) break;
    str += String.fromCharCode(data[offset + i]);
  }
  return str;
}

const CODEC_MAP: Record<string, string> = {
  V_VP8: "vp08",
  V_VP9: "vp09",
  V_AV1: "av01",
  "V_MPEG4/ISO/AVC": "avc1",
  "V_MPEGH/ISO/HEVC": "hvc1",
  "V_MPEG4/ISO/SP": "mp4v",
  "V_MPEG4/ISO/ASP": "mp4v",
  V_MPEG1: "mp1v",
  V_MPEG2: "mp2v",
  V_THEORA: "theora",
};

function mapCodecId(codecId: string): string {
  return CODEC_MAP[codecId] ?? codecId;
}

interface TrackInfo {
  width: number;
  height: number;
  codecId?: string;
  defaultDuration?: number;
}

function parseTrackEntry(
  data: Uint8Array,
  start: number,
  end: number,
): TrackInfo | null {
  let trackType: number | null = null;
  let codecId: string | undefined;
  let width = 0;
  let height = 0;
  let defaultDuration: number | undefined;

  let pos = start;
  while (pos < end) {
    const id = readElementID(data, pos);
    if (!id) break;
    pos += id.length;

    const size = readVINT(data, pos);
    if (!size) break;
    pos += size.length;

    const elementEnd = pos + size.value;
    if (elementEnd > end) break;

    switch (id.value) {
      case TRACK_TYPE_ID:
        trackType = readUint(data, pos, size.value);
        break;
      case CODEC_ID_ID:
        codecId = readString(data, pos, size.value);
        break;
      case DEFAULT_DURATION_ID:
        defaultDuration = readUint(data, pos, size.value);
        break;
      case VIDEO_ID:
        ({ width, height } = parseVideoElement(data, pos, elementEnd));
        break;
    }

    pos = elementEnd;
  }

  if (trackType !== 1) return null;
  if (width === 0 || height === 0) return null;

  return { width, height, codecId, defaultDuration };
}

function parseVideoElement(
  data: Uint8Array,
  start: number,
  end: number,
): { width: number; height: number } {
  let width = 0;
  let height = 0;

  let pos = start;
  while (pos < end) {
    const id = readElementID(data, pos);
    if (!id) break;
    pos += id.length;

    const size = readVINT(data, pos);
    if (!size) break;
    pos += size.length;

    const elementEnd = pos + size.value;
    if (elementEnd > end) break;

    if (id.value === PIXEL_WIDTH_ID) {
      width = readUint(data, pos, size.value);
    } else if (id.value === PIXEL_HEIGHT_ID) {
      height = readUint(data, pos, size.value);
    }

    pos = elementEnd;
  }

  return { width, height };
}

interface SegmentInfo {
  timestampScale: number;
  duration?: number;
}

function parseInfoElement(
  data: Uint8Array,
  start: number,
  end: number,
): SegmentInfo {
  let timestampScale = 1_000_000; // default: 1ms
  let duration: number | undefined;

  let pos = start;
  while (pos < end) {
    const id = readElementID(data, pos);
    if (!id) break;
    pos += id.length;

    const size = readVINT(data, pos);
    if (!size) break;
    pos += size.length;

    const elementEnd = pos + size.value;
    if (elementEnd > end) break;

    if (id.value === TIMESTAMP_SCALE_ID) {
      timestampScale = readUint(data, pos, size.value);
    } else if (id.value === DURATION_ID) {
      duration = readFloat(data, pos, size.value);
    }

    pos = elementEnd;
  }

  return { timestampScale, duration };
}

export function parseWebM(data: Uint8Array): ParsedMetadata {
  let pos = 0;

  // Validate EBML header
  const headerId = readElementID(data, pos);
  if (!headerId || headerId.value !== EBML_MAGIC) {
    throw new Error("Not a valid EBML file");
  }
  pos += headerId.length;

  const headerSize = readVINT(data, pos);
  if (!headerSize) throw new Error("Invalid EBML header size");
  pos += headerSize.length + headerSize.value;

  // Find Segment
  const segId = readElementID(data, pos);
  if (!segId || segId.value !== SEGMENT_ID) {
    throw new Error("No Segment element found");
  }
  pos += segId.length;

  const segSize = readVINT(data, pos);
  if (!segSize) throw new Error("Invalid Segment size");
  pos += segSize.length;

  // EBML unknown size: all data bits set to 1. For any VINT length,
  // this produces a value >= 2^49-1, well beyond any real file size.
  const isUnknownSize = segSize.value >= Number.MAX_SAFE_INTEGER;
  const segEnd = isUnknownSize ? data.length : pos + segSize.value;

  // Walk top-level Segment children
  let info: SegmentInfo = { timestampScale: 1_000_000 };
  let videoTrack: TrackInfo | null = null;
  let foundInfo = false;

  while (pos < segEnd) {
    const id = readElementID(data, pos);
    if (!id) break;
    pos += id.length;

    const size = readVINT(data, pos);
    if (!size) break;
    pos += size.length;

    const elementEnd = pos + size.value;
    if (elementEnd > data.length) break;

    if (id.value === INFO_ID) {
      info = parseInfoElement(data, pos, elementEnd);
      foundInfo = true;
    } else if (id.value === TRACKS_ID) {
      // Walk TrackEntry children
      let tPos = pos;
      while (tPos < elementEnd) {
        const tId = readElementID(data, tPos);
        if (!tId) break;
        tPos += tId.length;

        const tSize = readVINT(data, tPos);
        if (!tSize) break;
        tPos += tSize.length;

        const tEnd = tPos + tSize.value;

        if (tId.value === TRACK_ENTRY_ID && !videoTrack) {
          videoTrack = parseTrackEntry(data, tPos, tEnd);
        }

        tPos = tEnd;
      }
    }

    if (videoTrack && foundInfo) break;

    pos = elementEnd;
  }

  if (!videoTrack) {
    throw new Error("No video track found in WebM/MKV file");
  }

  const codec = videoTrack.codecId ? mapCodecId(videoTrack.codecId) : undefined;
  const framerate = videoTrack.defaultDuration
    ? Math.round((1e9 / videoTrack.defaultDuration) * 1000) / 1000
    : undefined;
  const duration =
    info.duration !== undefined
      ? (info.duration * info.timestampScale) / 1e9
      : undefined;

  return {
    width: videoTrack.width,
    height: videoTrack.height,
    duration,
    codec,
    framerate,
    hdr: isHdrCodec(codec),
  };
}
