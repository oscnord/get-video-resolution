import { ManifestParseError } from "../errors";
import type { AudioTrack, SubtitleTrack, VideoInfo } from "../types";
import { getAspectRatio } from "../utils/aspect-ratio";
import type { FetchOptions } from "../utils/fetch";
import { loadManifest } from "../utils/fetch";
import { isHdrCodec } from "../utils/hdr";
import { normalizeLanguage } from "../utils/manifest";
import {
  iterateOpenTags,
  parseDashFrameRate,
  parseIso8601Duration,
  parseXmlAttrs,
} from "./dash-helpers";

export async function parseDash(
  source: string,
  options: FetchOptions,
): Promise<VideoInfo[]> {
  const content = await loadManifest(source, options);
  const duration = extractMpdDuration(content);

  const periodMatch = /<Period\b[^>]*?>([\s\S]*?)<\/Period>/i.exec(content);
  const periodContent = periodMatch ? periodMatch[1] : content;

  const representations = extractRepresentations(periodContent, duration);

  if (representations.length === 0) {
    throw new ManifestParseError("No resolution found in DASH manifest", {
      context: { format: "dash", source },
    });
  }

  const encrypted = detectEncryption(periodContent) ? true : undefined;
  const audioTracks = extractAudioAdaptationSets(periodContent);
  const subtitleTracks = extractSubtitleAdaptationSets(periodContent);

  for (const rep of representations) {
    if (encrypted) rep.encrypted = encrypted;
    if (audioTracks.length > 0) rep.audioTracks = audioTracks;
    if (subtitleTracks.length > 0) rep.subtitleTracks = subtitleTracks;
  }

  return representations;
}

function extractMpdDuration(content: string): number | undefined {
  const match = /mediaPresentationDuration="PT([^"]+)"/.exec(content);
  return match ? parseIso8601Duration(match[1]) : undefined;
}

function extractRepresentations(
  content: string,
  duration: number | undefined,
): VideoInfo[] {
  const representations: VideoInfo[] = [];
  for (const { attrs } of iterateOpenTags(content, "Representation")) {
    const a = parseXmlAttrs(attrs);
    const widthStr = a.get("width");
    const heightStr = a.get("height");
    if (!widthStr || !heightStr) continue;
    const width = parseInt(widthStr, 10);
    const height = parseInt(heightStr, 10);
    if (!(width > 0 && height > 0)) continue;

    const bandwidth = a.get("bandwidth");
    const bitrate = bandwidth ? parseInt(bandwidth, 10) : undefined;
    const codec = a.get("codecs");
    const framerate = parseDashFrameRate(a.get("frameRate"));

    representations.push({
      width,
      height,
      bitrate,
      codec,
      framerate,
      duration,
      aspectRatio: getAspectRatio(width, height),
      hdr: isHdrCodec(codec),
    });
  }
  return representations;
}

function detectEncryption(content: string): boolean {
  return /<ContentProtection\b/i.test(content);
}

function extractAudioAdaptationSets(content: string): AudioTrack[] {
  const tracks: AudioTrack[] = [];
  for (const { attrs, body } of iterateOpenTags(content, "AdaptationSet")) {
    const a = parseXmlAttrs(attrs);
    const mimeType = a.get("mimeType") ?? "";
    if (!mimeType.startsWith("audio/")) continue;

    let codec = a.get("codecs");
    if (!codec && body) {
      for (const { attrs: rAttrs } of iterateOpenTags(body, "Representation")) {
        const ra = parseXmlAttrs(rAttrs);
        codec = ra.get("codecs");
        if (codec) break;
      }
    }

    tracks.push({
      codec,
      language: normalizeLanguage(a.get("lang")),
    });
  }
  return tracks;
}

function extractSubtitleAdaptationSets(content: string): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  for (const { attrs } of iterateOpenTags(content, "AdaptationSet")) {
    const a = parseXmlAttrs(attrs);
    const mimeType = a.get("mimeType") ?? "";
    const contentType = a.get("contentType") ?? "";
    const isText =
      contentType === "text" ||
      mimeType === "application/ttml+xml" ||
      mimeType.startsWith("text/vtt");
    if (!isText) continue;

    let codec = a.get("codecs");
    if (!codec) {
      if (mimeType.includes("ttml")) codec = "stpp";
      else if (mimeType.includes("vtt")) codec = "wvtt";
    }

    tracks.push({
      language: normalizeLanguage(a.get("lang")),
      codec,
    });
  }
  return tracks;
}
