import { ManifestParseError } from "../errors";
import type { AudioTrack, SubtitleTrack, VideoInfo } from "../types";
import { getAspectRatio } from "../utils/aspect-ratio";
import type { FetchOptions } from "../utils/fetch";
import { loadManifest } from "../utils/fetch";
import { isDefiniteHdrCodec, isHdrTransfer } from "../utils/hdr";
import { normalizeLanguage, parsePositiveInt } from "../utils/manifest";
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

  for (const { attrs, body } of iterateOpenTags(content, "AdaptationSet")) {
    const set = parseXmlAttrs(attrs);
    // Common attributes may sit on the AdaptationSet with the Representation
    // carrying only id/bandwidth — the DASH-IF live profile packages this way.
    const inherited = (key: string, rep: Map<string, string>) =>
      rep.get(key) ?? set.get(key);
    const setHdr = parseCicpHdr(body ?? "");

    for (const { attrs: repAttrs, body: repBody } of iterateOpenTags(
      body ?? "",
      "Representation",
    )) {
      const rep = parseXmlAttrs(repAttrs);
      const width = parsePositiveInt(inherited("width", rep));
      const height = parsePositiveInt(inherited("height", rep));
      if (!width || !height) continue;

      const codec = inherited("codecs", rep);
      const bitrate = parsePositiveInt(rep.get("bandwidth"));
      const rate = parseDashFrameRate(inherited("frameRate", rep));
      const framerate = rate ? Math.round(rate * 1000) / 1000 : undefined;
      const sar = parseRatio(inherited("sar", rep));

      representations.push({
        width,
        height,
        bitrate,
        codec,
        framerate,
        duration,
        aspectRatio: sar
          ? getAspectRatio(width * sar[0], height * sar[1])
          : (parseRatioString(inherited("par", rep)) ??
            getAspectRatio(width, height)),
        hdr: parseCicpHdr(repBody ?? "") ?? setHdr ?? isDefiniteHdrCodec(codec),
      });
    }
  }

  return representations;
}

// urn:mpeg:mpegB:cicp:TransferCharacteristics on an Essential/Supplemental
// property is the DASH equivalent of the MP4 `colr` box. Absent -> null so the
// caller can fall back rather than treating "no descriptor" as "not HDR".
function parseCicpHdr(scope: string): boolean | null {
  for (const tag of ["EssentialProperty", "SupplementalProperty"]) {
    for (const { attrs } of iterateOpenTags(scope, tag)) {
      const a = parseXmlAttrs(attrs);
      if (!a.get("schemeIdUri")?.endsWith("cicp:TransferCharacteristics"))
        continue;
      const transfer = parsePositiveInt(a.get("value"));
      if (transfer !== undefined) return isHdrTransfer(transfer);
    }
  }
  return null;
}

function parseRatio(value: string | undefined): [number, number] | null {
  if (!value) return null;
  const match = /^(\d+)[:/](\d+)$/.exec(value.trim());
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const den = parseInt(match[2], 10);
  return num > 0 && den > 0 ? [num, den] : null;
}

function parseRatioString(value: string | undefined): string | undefined {
  const ratio = parseRatio(value);
  return ratio ? getAspectRatio(ratio[0], ratio[1]) : undefined;
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
