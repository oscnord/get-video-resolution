import { ManifestParseError } from "../errors";
import type { AudioTrack, SubtitleTrack, VideoInfo } from "../types";
import { getAspectRatio } from "../utils/aspect-ratio";
import type { FetchOptions } from "../utils/fetch";
import { loadManifest } from "../utils/fetch";
import { isDefiniteHdrCodec } from "../utils/hdr";
import {
  normalizeLanguage,
  parsePositiveFloat,
  parsePositiveInt,
} from "../utils/manifest";
import {
  isAudioCodec,
  isTextCodec,
  iterateTagLines,
  parseAttrs,
  parseResolution,
  splitCodecs,
} from "./hls-helpers";

export async function parseHls(
  source: string,
  options: FetchOptions,
): Promise<VideoInfo[]> {
  const content = await loadManifest(source, options);
  const rawVariants = extractRawVariants(content);

  if (rawVariants.length === 0) {
    throw new ManifestParseError("No RESOLUTION found in HLS manifest", {
      context: { format: "hls", source },
    });
  }

  const allCodecs = rawVariants.flatMap((v) => splitCodecs(v.codecs));
  const encrypted = detectEncryption(content) ? true : undefined;
  let audioTracks = extractAudioTracks(content);
  const subtitleTracks = extractSubtitleTracks(
    content,
    allCodecs.find(isTextCodec)?.split(".")[0].toLowerCase() ?? "wvtt",
  );

  const fallbackAudioCodec = rawVariants
    .map((v) => splitCodecs(v.codecs).find(isAudioCodec))
    .find(Boolean);

  if (audioTracks.length === 0) {
    if (fallbackAudioCodec) {
      audioTracks = [{ codec: fallbackAudioCodec }];
    }
  } else if (fallbackAudioCodec) {
    audioTracks = audioTracks.map((t) => ({
      ...t,
      codec: t.codec ?? fallbackAudioCodec,
    }));
  }

  return rawVariants.map((raw) => {
    const videoCodec = splitCodecs(raw.codecs).find(
      (c) => !isAudioCodec(c) && !isTextCodec(c),
    );
    return {
      width: raw.width,
      height: raw.height,
      bitrate: raw.bandwidth,
      codec: videoCodec,
      framerate: raw.frameRate,
      aspectRatio: getAspectRatio(raw.width, raw.height),
      hdr: raw.videoRange ?? isDefiniteHdrCodec(videoCodec),
      encrypted,
      audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
      subtitleTracks: subtitleTracks.length > 0 ? subtitleTracks : undefined,
    };
  });
}

interface RawVariant {
  width: number;
  height: number;
  bandwidth?: number;
  codecs?: string;
  frameRate?: number;
  videoRange?: boolean;
}

function extractRawVariants(content: string): RawVariant[] {
  const variants: RawVariant[] = [];
  for (const line of iterateTagLines(content, "EXT-X-STREAM-INF")) {
    const attrs = parseAttrs(line);
    const resolution = parseResolution(attrs.get("RESOLUTION"));
    if (!resolution) continue;
    variants.push({
      width: resolution.width,
      height: resolution.height,
      bandwidth: parsePositiveInt(attrs.get("BANDWIDTH")),
      codecs: attrs.get("CODECS"),
      frameRate: parsePositiveFloat(attrs.get("FRAME-RATE")),
      videoRange: parseVideoRange(attrs.get("VIDEO-RANGE")),
    });
  }
  return variants;
}

// VIDEO-RANGE (RFC 8216bis §4.4.6.2) is authoritative: SDR, HLG, or PQ.
// Absent -> undefined so the caller falls back to the codec string.
function parseVideoRange(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const range = value.trim().toUpperCase();
  if (range === "PQ" || range === "HLG") return true;
  if (range === "SDR") return false;
  return undefined;
}

function detectEncryption(content: string): boolean {
  return /#EXT-X-(?:SESSION-)?KEY:[^\n]*METHOD=(?!NONE)\w+/i.test(content);
}

function extractAudioTracks(content: string): AudioTrack[] {
  const tracks: AudioTrack[] = [];
  const seen = new Set<string>();

  for (const line of iterateTagLines(content, "EXT-X-MEDIA")) {
    const attrs = parseAttrs(line);
    if (attrs.get("TYPE") !== "AUDIO") continue;

    const language = normalizeLanguage(attrs.get("LANGUAGE"));
    const channels = parsePositiveInt(attrs.get("CHANNELS"));
    // Renditions repeat once per bitrate group, so dedupe — but a 5.1 mix is a
    // distinct track from the stereo one in the same language.
    const key = `${language ?? ""}|${channels ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    tracks.push({ language, channels });
  }

  return tracks;
}

function extractSubtitleTracks(
  content: string,
  codec: string,
): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  for (const line of iterateTagLines(content, "EXT-X-MEDIA")) {
    const attrs = parseAttrs(line);
    if (attrs.get("TYPE") !== "SUBTITLES") continue;
    tracks.push({
      language: normalizeLanguage(attrs.get("LANGUAGE")),
      codec,
    });
  }
  return tracks;
}
