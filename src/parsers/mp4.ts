import { MediaParseError } from "../errors";
import type { AudioTrack, ParsedMetadata, SubtitleTrack } from "../types";
import { getAspectRatio } from "../utils/aspect-ratio";
import {
  readFourCC,
  readI32BE as readI32,
  readU16BE as readU16,
  readU32BE as readU32,
  readU64BE as readU64,
} from "../utils/binary";
import { isDefiniteHdrCodec, isHdrTransfer } from "../utils/hdr";

interface CodecInfo {
  codec: string;
  bitDepth?: number;
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

function getTrackHandler(data: Uint8Array, trak: Box): string | null {
  const trakStart = trak.offset + trak.headerSize;
  const trakEnd = trak.offset + trak.size;

  const mdia = findBox(data, trakStart, trakEnd, "mdia");
  if (!mdia) return null;

  const hdlr = findBox(
    data,
    mdia.offset + mdia.headerSize,
    mdia.offset + mdia.size,
    "hdlr",
  );
  if (!hdlr) return null;

  const handlerOffset = hdlr.offset + hdlr.headerSize + 8;
  if (handlerOffset + 4 > data.length) return null;

  return readFourCC(data, handlerOffset);
}

function parseMdhd(
  data: Uint8Array,
  box: Box,
): { timescale: number; duration: number; language?: string } | null {
  const start = box.offset + box.headerSize;
  if (start >= data.length) return null;

  const version = data[start];

  if (version === 0) {
    if (start + 22 > data.length) return null;
    return {
      timescale: readU32(data, start + 12),
      duration: readU32(data, start + 16),
      language: decodePackedLanguage(data, start + 20),
    };
  }

  if (start + 34 > data.length) return null;
  return {
    timescale: readU32(data, start + 20),
    duration: readU64(data, start + 24),
    language: decodePackedLanguage(data, start + 32),
  };
}

function decodePackedLanguage(
  data: Uint8Array,
  offset: number,
): string | undefined {
  const packed = readU16(data, offset);
  if (packed === 0 || packed === 0x7fff) return undefined;

  const c1 = ((packed >> 10) & 0x1f) + 0x60;
  const c2 = ((packed >> 5) & 0x1f) + 0x60;
  const c3 = (packed & 0x1f) + 0x60;
  const lang = String.fromCharCode(c1, c2, c3);

  return lang === "und" ? undefined : lang;
}

function parseTkhdRotation(data: Uint8Array, box: Box): number | undefined {
  const start = box.offset + box.headerSize;
  if (start >= data.length) return undefined;

  const version = data[start];
  const matrixOffset = start + (version === 0 ? 40 : 52);
  if (matrixOffset + 36 > data.length) return undefined;

  const a = readI32(data, matrixOffset) / 65536;
  const b = readI32(data, matrixOffset + 4) / 65536;

  const degrees = Math.round(Math.atan2(b, a) * (180 / Math.PI));
  return degrees < 0 ? degrees + 360 : degrees;
}

function parseStts(
  data: Uint8Array,
  box: Box,
  timescale: number,
): number | undefined {
  const start = box.offset + box.headerSize;
  const end = Math.min(box.offset + box.size, data.length);
  // version(1) + flags(3) + entry_count(4)
  if (start + 8 > end) return undefined;

  const entryCount = readU32(data, start + 4);

  let samples = 0;
  let ticks = 0;
  for (let i = 0; i < entryCount; i++) {
    const entry = start + 8 + i * 8;
    if (entry + 8 > end) break;
    const count = readU32(data, entry);
    samples += count;
    ticks += count * readU32(data, entry + 4);
  }

  if (samples === 0 || ticks === 0) return undefined;

  return (samples * timescale) / ticks;
}

// The first sample entry, bounded to the stsd box. Callers must still check
// `size` before reading fields past the 8-byte box header.
function firstSampleEntry(data: Uint8Array, stsd: Box): Box | null {
  const start = stsd.offset + stsd.headerSize;
  const stsdEnd = Math.min(stsd.offset + stsd.size, data.length);
  // version(1) + flags(3) + entry_count(4) = 8 bytes, then the first entry
  if (start + 8 > stsdEnd) return null;
  if (readU32(data, start + 4) === 0) return null;

  const entry = readBoxHeader(data, start + 8);
  if (!entry || entry.size < 8 || entry.offset + entry.size > stsdEnd)
    return null;

  return entry;
}

function parseDimensions(
  data: Uint8Array,
  stsd: Box,
): { width: number; height: number; fourcc: string } | null {
  const entry = firstSampleEntry(data, stsd);
  if (!entry || entry.size < 36) return null;

  return {
    width: readU16(data, entry.offset + 32),
    height: readU16(data, entry.offset + 34),
    fourcc: entry.type,
  };
}

function parsePasp(
  data: Uint8Array,
  stsd: Box,
): { hSpacing: number; vSpacing: number } | null {
  const entry = firstSampleEntry(data, stsd);
  if (!entry || entry.size < 86) return null;

  const pasp = findBox(
    data,
    entry.offset + 86,
    entry.offset + entry.size,
    "pasp",
  );
  if (!pasp || pasp.size < 16) return null;

  const hSpacing = readU32(data, pasp.offset + pasp.headerSize);
  const vSpacing = readU32(data, pasp.offset + pasp.headerSize + 4);
  if (hSpacing === 0 || vSpacing === 0) return null;

  return { hSpacing, vSpacing };
}

function parseColr(data: Uint8Array, stsd: Box): boolean | null {
  const entryBox = firstSampleEntry(data, stsd);
  if (!entryBox || entryBox.size < 86) return null;

  // Child boxes of visual sample entry start at +86 from entry box start
  const childrenStart = entryBox.offset + 86;
  const childrenEnd = entryBox.offset + entryBox.size;

  const colr = findBox(data, childrenStart, childrenEnd, "colr");
  if (!colr) return null;

  const colrData = colr.offset + colr.headerSize;
  if (colrData + 8 > data.length) return null;

  const colrType = readFourCC(data, colrData);
  if (colrType !== "nclx") return null;

  return isHdrTransfer(readU16(data, colrData + 6));
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

function buildHevcCodec(data: Uint8Array, box: Box): CodecInfo {
  const bodyStart = box.offset + box.headerSize;
  if (bodyStart + 13 > data.length) return { codec: "hvc1" };

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

  const constraintBytes: number[] = [];
  for (let i = 6; i < 12; i++) {
    constraintBytes.push(data[bodyStart + i]);
  }
  while (
    constraintBytes.length > 0 &&
    constraintBytes[constraintBytes.length - 1] === 0
  ) {
    constraintBytes.pop();
  }
  for (const b of constraintBytes) {
    codec += `.${b.toString(16).toUpperCase()}`;
  }

  // hvcC layout: bit_depth_luma_minus8 lives in the lower 3 bits of byte 17
  // (bodyStart-relative) per ISO/IEC 14496-15. Fall back to profileIdc when
  // the box is too short to carry the field.
  let bitDepth: number;
  if (bodyStart + 18 <= data.length) {
    bitDepth = (data[bodyStart + 17] & 0x07) + 8;
  } else {
    bitDepth = profileIdc === 2 ? 10 : 8;
  }

  return { codec, bitDepth };
}

function buildAv1Codec(data: Uint8Array, box: Box): CodecInfo {
  const bodyStart = box.offset + box.headerSize;
  if (bodyStart + 4 > data.length) return { codec: "av01" };

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

  return {
    codec: `av01.${seqProfile}.${levelStr}${tierChar}.${bitDepthStr}`,
    bitDepth,
  };
}

function hex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

function parseCodecInfo(data: Uint8Array, stsd: Box): CodecInfo {
  const entryBox = firstSampleEntry(data, stsd);
  if (!entryBox || entryBox.size < 86) return { codec: "unknown" };

  const childrenStart = entryBox.offset + 86;
  const childrenEnd = entryBox.offset + entryBox.size;
  const fourcc = entryBox.type;

  if (fourcc === "avc1" || fourcc === "avc3") {
    const avcC = findBox(data, childrenStart, childrenEnd, "avcC");
    if (avcC) return { codec: buildAvcCodecString(data, avcC), bitDepth: 8 };
    return { codec: fourcc, bitDepth: 8 };
  }

  if (
    fourcc === "hvc1" ||
    fourcc === "hev1" ||
    fourcc === "dvh1" ||
    fourcc === "dvhe"
  ) {
    const hvcC = findBox(data, childrenStart, childrenEnd, "hvcC");
    if (hvcC) return buildHevcCodec(data, hvcC);
    return { codec: fourcc };
  }

  if (fourcc === "av01") {
    const av1C = findBox(data, childrenStart, childrenEnd, "av1C");
    if (av1C) return buildAv1Codec(data, av1C);
    return { codec: fourcc };
  }

  return { codec: fourcc };
}

function parseAudioSampleEntry(
  data: Uint8Array,
  stsd: Box,
): { codec: string; channels: number } | null {
  const entryBox = firstSampleEntry(data, stsd);
  if (!entryBox) return null;

  // Audio sample entry layout:
  //   +0..7   box header (size + fourcc)
  //   +8..13  6 reserved
  //   +14..15 data_reference_index
  //   +16..17 version (QuickTime sound sample description; 0 in ISO BMFF)
  //
  // For version 0/1 the channelcount lives at body+16 (= entry+24) as a 16-bit
  // BE int. For QuickTime v2 that field is a sentinel (always 3), and the real
  // channel count is a 32-bit BE int at body+40 (= entry+48).
  if (entryBox.size < 18) return null;
  const version = readU16(data, entryBox.offset + 16);

  if (version === 2) {
    if (entryBox.size < 52) return null;
    return {
      codec: entryBox.type,
      channels: readU32(data, entryBox.offset + 48),
    };
  }

  if (entryBox.size < 26) return null;
  return {
    codec: entryBox.type,
    channels: readU16(data, entryBox.offset + 24),
  };
}

function parseAudioTrak(data: Uint8Array, trak: Box): AudioTrack {
  const trakStart = trak.offset + trak.headerSize;
  const trakEnd = trak.offset + trak.size;

  const stsd = findBoxRecursive(data, trakStart, trakEnd, "stsd");
  const mdhd = findBoxRecursive(data, trakStart, trakEnd, "mdhd");

  const mdhdInfo = mdhd ? parseMdhd(data, mdhd) : null;
  const audio = stsd ? parseAudioSampleEntry(data, stsd) : null;

  return {
    codec: audio?.codec,
    language: mdhdInfo?.language,
    channels: audio?.channels,
  };
}

function parseSubtitleEntryCodec(
  data: Uint8Array,
  stsd: Box,
): string | undefined {
  return firstSampleEntry(data, stsd)?.type;
}

function parseSubtitleTrak(data: Uint8Array, trak: Box): SubtitleTrack {
  const trakStart = trak.offset + trak.headerSize;
  const trakEnd = trak.offset + trak.size;
  const stsd = findBoxRecursive(data, trakStart, trakEnd, "stsd");
  const mdhd = findBoxRecursive(data, trakStart, trakEnd, "mdhd");
  const mdhdInfo = mdhd ? parseMdhd(data, mdhd) : null;
  return {
    codec: stsd ? parseSubtitleEntryCodec(data, stsd) : undefined,
    language: mdhdInfo?.language,
  };
}

export function parseMP4(data: Uint8Array): ParsedMetadata {
  const moov = findBox(data, 0, data.length, "moov");
  if (!moov) {
    throw new MediaParseError("No moov box found — not a valid MP4 file", {
      context: { format: "mp4", reason: "no-moov" },
    });
  }

  const moovStart = moov.offset + moov.headerSize;
  const moovEnd = moov.offset + moov.size;

  let videoTrak: Box | undefined;
  const audioTraks: Box[] = [];
  const subtitleTraks: Box[] = [];
  for (const box of iterateBoxes(data, moovStart, moovEnd)) {
    if (box.type !== "trak") continue;
    const handler = getTrackHandler(data, box);
    if (handler === "vide" && !videoTrak) videoTrak = box;
    else if (handler === "soun") audioTraks.push(box);
    else if (handler === "subt" || handler === "text" || handler === "sbtl")
      subtitleTraks.push(box);
  }
  if (!videoTrak) {
    throw new MediaParseError("No video track found in MP4 file", {
      context: { format: "mp4", reason: "no-video-track" },
    });
  }

  const trakStart = videoTrak.offset + videoTrak.headerSize;
  const trakEnd = videoTrak.offset + videoTrak.size;

  const mdhd = findBoxRecursive(data, trakStart, trakEnd, "mdhd");
  const timing = mdhd ? parseMdhd(data, mdhd) : null;
  const duration =
    timing && timing.timescale > 0
      ? timing.duration / timing.timescale
      : undefined;

  const stsd = findBoxRecursive(data, trakStart, trakEnd, "stsd");
  if (!stsd) {
    throw new MediaParseError(
      "No sample description (stsd) found in video track",
      { context: { format: "mp4", reason: "no-sample-description" } },
    );
  }

  const dims = parseDimensions(data, stsd);
  if (!dims) {
    throw new MediaParseError("Could not read video dimensions from stsd", {
      context: { format: "mp4", reason: "no-dimensions" },
    });
  }

  const stts = findBoxRecursive(data, trakStart, trakEnd, "stts");
  const framerate =
    stts && timing ? parseStts(data, stts, timing.timescale) : undefined;

  const codecInfo = parseCodecInfo(data, stsd);
  const codec = codecInfo.codec === "unknown" ? undefined : codecInfo.codec;
  const bitDepth = codecInfo.bitDepth;

  // colr box is the authoritative HDR signal (PQ/HLG transfer characteristics).
  // When colr is missing, only fall back to codec strings that unambiguously
  // indicate HDR (Dolby Vision). Probable-but-ambiguous patterns like Main 10
  // are NOT used here, so SDR Main 10 sources don't get falsely flagged.
  const colrHdr = parseColr(data, stsd);
  const hdr = colrHdr ?? isDefiniteHdrCodec(codec);

  const tkhd = findBox(data, trakStart, trakEnd, "tkhd");
  const rotation = tkhd ? parseTkhdRotation(data, tkhd) : undefined;

  const audioTracks = audioTraks.map((t) => parseAudioTrak(data, t));
  const subtitleTracks = subtitleTraks.map((t) => parseSubtitleTrak(data, t));

  const pasp = parsePasp(data, stsd);

  return {
    width: dims.width,
    height: dims.height,
    aspectRatio: pasp
      ? getAspectRatio(dims.width * pasp.hSpacing, dims.height * pasp.vSpacing)
      : undefined,
    duration,
    codec,
    framerate: framerate ? Math.round(framerate * 1000) / 1000 : undefined,
    hdr,
    rotation,
    bitDepth,
    audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
    subtitleTracks: subtitleTracks.length > 0 ? subtitleTracks : undefined,
  };
}
