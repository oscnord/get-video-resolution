import { ManifestParseError } from "../errors";
import type { AudioTrack, SubtitleTrack, VideoInfo } from "../types";
import { getAspectRatio } from "../utils/aspect-ratio";
import type { FetchOptions } from "../utils/fetch";
import { loadManifest } from "../utils/fetch";
import { isHdrCodec } from "../utils/hdr";
import { normalizeLanguage } from "../utils/manifest";
import {
  isAudioCodec,
  iterateTagLines,
  parseAttrs,
  parsePositiveFloat,
  parsePositiveInt,
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
    throw new ManifestParseError("No RESOLUTION found in HLS manifest");
  }

  const encrypted = detectEncryption(content) ? true : undefined;
  let audioTracks = extractAudioTracks(content);
  const subtitleTracks = extractSubtitleTracks(content);

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
    const videoCodec = splitCodecs(raw.codecs).find((c) => !isAudioCodec(c));
    return {
      width: raw.width,
      height: raw.height,
      bitrate: raw.bandwidth,
      codec: videoCodec,
      framerate: raw.frameRate,
      aspectRatio: getAspectRatio(raw.width, raw.height),
      hdr: isHdrCodec(videoCodec),
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
    });
  }
  return variants;
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
    const key = language ?? "default";
    if (seen.has(key)) continue;
    seen.add(key);

    tracks.push({
      language,
      channels: parsePositiveInt(attrs.get("CHANNELS")),
    });
  }

  return tracks;
}

function extractSubtitleTracks(content: string): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  for (const line of iterateTagLines(content, "EXT-X-MEDIA")) {
    const attrs = parseAttrs(line);
    if (attrs.get("TYPE") !== "SUBTITLES") continue;
    tracks.push({
      language: normalizeLanguage(attrs.get("LANGUAGE")),
      codec: "wvtt",
    });
  }
  return tracks;
}
