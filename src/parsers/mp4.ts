import { isHdrCodec } from "../utils/hdr";

export interface MP4Metadata {
  width: number;
  height: number;
  duration?: number;
  codec?: string;
  framerate?: number;
  hdr: boolean;
}

interface Box {
  type: string;
  offset: number;
  size: number;
  headerSize: number;
}

const CONTAINER_TYPES = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "mvex",
  "moof",
  "traf",
  "edts",
  "dinf",
  "sinf",
  "schi",
  "udta",
]);

function readU16(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

function readU32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  );
}

function readU64(data: Uint8Array, offset: number): number {
  const high = readU32(data, offset);
  const low = readU32(data, offset + 4);
  return high * 0x100000000 + low;
}

function readFourCC(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3],
  );
}

function readBoxHeader(data: Uint8Array, offset: number): Box | null {
  if (offset + 8 > data.length) return null;

  const size32 = readU32(data, offset);
  const type = readFourCC(data, offset + 4);

  if (size32 === 1) {
    if (offset + 16 > data.length) return null;
    const size64 = readU64(data, offset + 8);
    return { type, offset, size: size64, headerSize: 16 };
  }

  if (size32 === 0) {
    return { type, offset, size: data.length - offset, headerSize: 8 };
  }

  return { type, offset, size: size32, headerSize: 8 };
}

function* iterateBoxes(
  data: Uint8Array,
  start: number,
  end: number,
): Generator<Box> {
  let pos = start;
  while (pos < end) {
    const box = readBoxHeader(data, pos);
    if (!box || box.size < 8) break;
    yield box;
    pos += box.size;
  }
}

function findBox(
  data: Uint8Array,
  start: number,
  end: number,
  type: string,
): Box | null {
  for (const box of iterateBoxes(data, start, end)) {
    if (box.type === type) return box;
  }
  return null;
}

function _findBoxPath(data: Uint8Array, path: string[]): Box | null {
  let start = 0;
  let end = data.length;
  let box: Box | null = null;

  for (const type of path) {
    box = findBox(data, start, end, type);
    if (!box) return null;
    start = box.offset + box.headerSize;
    end = box.offset + box.size;
  }

  return box;
}

function findAllBoxes(
  data: Uint8Array,
  start: number,
  end: number,
  type: string,
): Box[] {
  const results: Box[] = [];
  for (const box of iterateBoxes(data, start, end)) {
    if (box.type === type) results.push(box);
  }
  return results;
}

function findBoxRecursive(
  data: Uint8Array,
  start: number,
  end: number,
  type: string,
): Box | null {
  for (const box of iterateBoxes(data, start, end)) {
    if (box.type === type) return box;
    if (CONTAINER_TYPES.has(box.type)) {
      const found = findBoxRecursive(
        data,
        box.offset + box.headerSize,
        box.offset + box.size,
        type,
      );
      if (found) return found;
    }
  }
  return null;
}

function isVideoTrack(data: Uint8Array, trak: Box): boolean {
  const trakStart = trak.offset + trak.headerSize;
  const trakEnd = trak.offset + trak.size;

  const mdia = findBox(data, trakStart, trakEnd, "mdia");
  if (!mdia) return false;

  const hdlr = findBox(
    data,
    mdia.offset + mdia.headerSize,
    mdia.offset + mdia.size,
    "hdlr",
  );
  if (!hdlr) return false;

  // hdlr body: version/flags(4) + pre_defined(4) + handler_type(4)
  const handlerOffset = hdlr.offset + hdlr.headerSize + 8;
  if (handlerOffset + 4 > data.length) return false;

  return readFourCC(data, handlerOffset) === "vide";
}

function parseMdhd(
  data: Uint8Array,
  box: Box,
): { timescale: number; duration: number } | null {
  const start = box.offset + box.headerSize;
  if (start >= data.length) return null;

  const version = data[start];

  if (version === 0) {
    if (start + 20 > data.length) return null;
    return {
      timescale: readU32(data, start + 12),
      duration: readU32(data, start + 16),
    };
  }

  if (start + 28 > data.length) return null;
  return {
    timescale: readU32(data, start + 20),
    duration: readU64(data, start + 24),
  };
}

function parseStts(
  data: Uint8Array,
  box: Box,
  timescale: number,
): number | undefined {
  const start = box.offset + box.headerSize;
  // version(1) + flags(3) + entry_count(4) + first entry: sample_count(4) + sample_delta(4)
  if (start + 16 > data.length) return undefined;

  const entryCount = readU32(data, start + 4);
  if (entryCount === 0) return undefined;

  const sampleDelta = readU32(data, start + 12);
  if (sampleDelta === 0) return undefined;

  return timescale / sampleDelta;
}

function parseDimensions(
  data: Uint8Array,
  stsd: Box,
): { width: number; height: number; fourcc: string } | null {
  const start = stsd.offset + stsd.headerSize;
  // version(1) + flags(3) + entry_count(4) = 8 bytes, then first sample entry
  const entryStart = start + 8;

  if (entryStart + 36 > data.length) return null;

  const entryBox = readBoxHeader(data, entryStart);
  if (!entryBox) return null;

  // Visual sample entry: width at +32, height at +34 from box start
  if (entryStart + 36 > data.length) return null;

  return {
    width: readU16(data, entryStart + 32),
    height: readU16(data, entryStart + 34),
    fourcc: entryBox.type,
  };
}

function parseColr(data: Uint8Array, stsd: Box): boolean | null {
  const entryStart = stsd.offset + stsd.headerSize + 8;
  const entryBox = readBoxHeader(data, entryStart);
  if (!entryBox) return null;

  // Child boxes of visual sample entry start at +86 from entry box start
  const childrenStart = entryStart + 86;
  const childrenEnd = entryStart + entryBox.size;

  const colr = findBox(data, childrenStart, childrenEnd, "colr");
  if (!colr) return null;

  const colrData = colr.offset + colr.headerSize;
  if (colrData + 6 > data.length) return null;

  const colrType = readFourCC(data, colrData);
  if (colrType !== "nclx") return null;

  const transferCharacteristics = readU16(data, colrData + 6);
  // PQ (HDR10) = 16, HLG = 18
  return transferCharacteristics === 16 || transferCharacteristics === 18;
}

function buildAvcCodecString(data: Uint8Array, box: Box): string {
  const bodyStart = box.offset + box.headerSize;
  if (bodyStart + 4 > data.length) return "avc1";

  const profile = data[bodyStart + 1];
  const constraints = data[bodyStart + 2];
  const level = data[bodyStart + 3];

  return `avc1.${hex(profile)}${hex(constraints)}${hex(level)}`;
}

function reverseBits32(n: number): number {
  let result = 0;
  for (let i = 0; i < 32; i++) {
    result = (result << 1) | (n & 1);
    n >>>= 1;
  }
  return result >>> 0;
}

function buildHevcCodecString(data: Uint8Array, box: Box): string {
  const bodyStart = box.offset + box.headerSize;
  if (bodyStart + 13 > data.length) return "hvc1";

  const byte1 = data[bodyStart + 1];
  const profileSpace = (byte1 >> 6) & 0x3;
  const tierFlag = (byte1 >> 5) & 0x1;
  const profileIdc = byte1 & 0x1f;

  const profileCompat = readU32(data, bodyStart + 2);
  const reversed = reverseBits32(profileCompat);

  const levelIdc = data[bodyStart + 12];

  const spaceChar =
    profileSpace === 0 ? "" : String.fromCharCode(0x40 + profileSpace);
  const tierChar = tierFlag ? "H" : "L";

  let codec = `hvc1.${spaceChar}${profileIdc}.${reversed.toString(16).toUpperCase()}.${tierChar}${levelIdc}`;

  // Append non-zero constraint bytes
  if (bodyStart + 12 > data.length) return codec;
  const constraintBytes: number[] = [];
  for (let i = 6; i < 12; i++) {
    constraintBytes.push(data[bodyStart + i]);
  }
  // Trim trailing zeros
  while (
    constraintBytes.length > 0 &&
    constraintBytes[constraintBytes.length - 1] === 0
  ) {
    constraintBytes.pop();
  }
  for (const b of constraintBytes) {
    codec += `.${b.toString(16).toUpperCase()}`;
  }

  return codec;
}

function buildAv1CodecString(data: Uint8Array, box: Box): string {
  const bodyStart = box.offset + box.headerSize;
  if (bodyStart + 4 > data.length) return "av01";

  const byte1 = data[bodyStart + 1];
  const byte2 = data[bodyStart + 2];

  const seqProfile = (byte1 >> 5) & 0x7;
  const seqLevelIdx = byte1 & 0x1f;
  const seqTier = (byte2 >> 7) & 0x1;
  const highBitdepth = (byte2 >> 6) & 0x1;
  const twelveBit = (byte2 >> 5) & 0x1;
  const bitDepth = highBitdepth ? (twelveBit ? 12 : 10) : 8;

  const tierChar = seqTier ? "H" : "M";
  const levelStr = seqLevelIdx.toString().padStart(2, "0");
  const bitDepthStr = bitDepth.toString().padStart(2, "0");

  return `av01.${seqProfile}.${levelStr}${tierChar}.${bitDepthStr}`;
}

function hex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

function parseCodecString(data: Uint8Array, stsd: Box): string | undefined {
  const entryStart = stsd.offset + stsd.headerSize + 8;
  const entryBox = readBoxHeader(data, entryStart);
  if (!entryBox) return undefined;

  const childrenStart = entryStart + 86;
  const childrenEnd = entryStart + entryBox.size;

  const fourcc = entryBox.type;

  if (fourcc === "avc1" || fourcc === "avc3") {
    const avcC = findBox(data, childrenStart, childrenEnd, "avcC");
    if (avcC) return buildAvcCodecString(data, avcC);
    return fourcc;
  }

  if (fourcc === "hvc1" || fourcc === "hev1") {
    const hvcC = findBox(data, childrenStart, childrenEnd, "hvcC");
    if (hvcC) return buildHevcCodecString(data, hvcC);
    return fourcc;
  }

  if (fourcc === "dvh1" || fourcc === "dvhe") {
    const hvcC = findBox(data, childrenStart, childrenEnd, "hvcC");
    if (hvcC) return buildHevcCodecString(data, hvcC);
    return fourcc;
  }

  if (fourcc === "av01") {
    const av1C = findBox(data, childrenStart, childrenEnd, "av1C");
    if (av1C) return buildAv1CodecString(data, av1C);
    return fourcc;
  }

  return fourcc;
}

export function parseMP4(data: Uint8Array): MP4Metadata {
  const moov = findBox(data, 0, data.length, "moov");
  if (!moov) {
    throw new Error("No moov box found — not a valid MP4 file");
  }

  const moovStart = moov.offset + moov.headerSize;
  const moovEnd = moov.offset + moov.size;

  // Find the first video track
  const traks = findAllBoxes(data, moovStart, moovEnd, "trak");
  const videoTrak = traks.find((t) => isVideoTrack(data, t));
  if (!videoTrak) {
    throw new Error("No video track found in MP4 file");
  }

  // We need to work with absolute offsets, so slice relative paths carefully
  const trakStart = videoTrak.offset + videoTrak.headerSize;
  const trakEnd = videoTrak.offset + videoTrak.size;

  // Duration & timescale from mdhd
  const mdhd = findBoxRecursive(data, trakStart, trakEnd, "mdhd");
  const timing = mdhd ? parseMdhd(data, mdhd) : null;
  const duration =
    timing && timing.timescale > 0
      ? timing.duration / timing.timescale
      : undefined;

  // Dimensions & codec from stsd
  const stsd = findBoxRecursive(data, trakStart, trakEnd, "stsd");
  if (!stsd) {
    throw new Error("No sample description (stsd) found in video track");
  }

  const dims = parseDimensions(data, stsd);
  if (!dims) {
    throw new Error("Could not read video dimensions from stsd");
  }

  // FPS from stts
  const stts = findBoxRecursive(data, trakStart, trakEnd, "stts");
  const framerate =
    stts && timing ? parseStts(data, stts, timing.timescale) : undefined;

  // Codec string
  const codec = parseCodecString(data, stsd);

  // HDR: try colr box first, fall back to codec string pattern
  const colrHdr = parseColr(data, stsd);
  const hdr = colrHdr ?? isHdrCodec(codec);

  return {
    width: dims.width,
    height: dims.height,
    duration,
    codec,
    framerate: framerate ? Math.round(framerate * 1000) / 1000 : undefined,
    hdr,
  };
}
