import { ManifestParseError } from "../errors";
import type { AudioTrack, SubtitleTrack, VideoInfo } from "../types";
import { getAspectRatio } from "../utils/aspect-ratio";
import type { FetchOptions } from "../utils/fetch";
import { loadManifest } from "../utils/fetch";
import { isHdrCodec } from "../utils/hdr";

export async function parseHls(
  source: string,
  options: FetchOptions,
): Promise<VideoInfo[]> {
  const content = await loadManifest(source, options);
  const rawVariants = extractRawVariants(content);

  if (rawVariants.length === 0) {
    throw new ManifestParseError("No RESOLUTION found in HLS manifest");
  }

  const encrypted = detectEncryption(content) || undefined;
  let audioTracks = extractAudioTracks(content);
  const subtitleTracks = extractSubtitleTracks(content);

  if (audioTracks.length === 0) {
    const firstAudioCodec = rawVariants
      .map((v) => extractAudioCodec(v.codecs))
      .find(Boolean);
    if (firstAudioCodec) {
      audioTracks = [{ codec: firstAudioCodec }];
    }
  } else {
    const audioCodec = rawVariants
      .map((v) => extractAudioCodec(v.codecs))
      .find(Boolean);
    if (audioCodec) {
      audioTracks = audioTracks.map((t) => ({
        ...t,
        codec: t.codec ?? audioCodec,
      }));
    }
  }

  return rawVariants.map((raw) => {
    const videoCodec = extractVideoCodec(raw.codecs);
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
  const regex = /#EXT-X-STREAM-INF:([^\n]+)/g;
  const variants: RawVariant[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const line = match[1];
    const raw = parseStreamInf(line);
    if (raw) variants.push(raw);
  }

  return variants;
}

function parseStreamInf(line: string): RawVariant | null {
  const resMatch = /RESOLUTION=(\d+)x(\d+)/.exec(line);
  if (!resMatch) return null;

  const width = parseInt(resMatch[1], 10);
  const height = parseInt(resMatch[2], 10);

  const bwMatch = /BANDWIDTH=(\d+)/.exec(line);
  const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : undefined;

  const codecsMatch = /CODECS="([^"]+)"/.exec(line);
  const codecs = codecsMatch ? codecsMatch[1] : undefined;

  const frMatch = /FRAME-RATE=([\d.]+)/.exec(line);
  const frameRate = frMatch ? parseFloat(frMatch[1]) : undefined;

  return { width, height, bandwidth, codecs, frameRate };
}

function extractVideoCodec(codecs: string | undefined): string | undefined {
  if (!codecs) return undefined;
  const parts = codecs.split(",").map((s) => s.trim());
  return (
    parts.find(
      (p) =>
        !p.startsWith("mp4a.") &&
        !p.startsWith("ac-3") &&
        !p.startsWith("ec-3"),
    ) ?? parts[0]
  );
}

function extractAudioCodec(codecs: string | undefined): string | undefined {
  if (!codecs) return undefined;
  const parts = codecs.split(",").map((s) => s.trim());
  return parts.find(
    (p) =>
      p.startsWith("mp4a.") ||
      p.startsWith("ac-3") ||
      p.startsWith("ec-3") ||
      p.startsWith("opus") ||
      p.startsWith("flac"),
  );
}

function detectEncryption(content: string): boolean {
  return /#EXT-X-(?:SESSION-)?KEY:.*METHOD=(?!NONE)\w+/i.test(content);
}

function extractAudioTracks(content: string): AudioTrack[] {
  const regex = /#EXT-X-MEDIA:TYPE=AUDIO[^\n]*/g;
  const tracks: AudioTrack[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const line = match[0];
    const langMatch = /LANGUAGE="([^"]+)"/.exec(line);
    const chMatch = /CHANNELS="(\d+)"/.exec(line);

    const key = langMatch?.[1] ?? "default";
    if (seen.has(key)) continue;
    seen.add(key);

    tracks.push({
      language: langMatch?.[1],
      channels: chMatch ? parseInt(chMatch[1], 10) : undefined,
    });
  }

  return tracks;
}

function extractSubtitleTracks(content: string): SubtitleTrack[] {
  const regex = /#EXT-X-MEDIA:TYPE=SUBTITLES[^\n]*/g;
  const tracks: SubtitleTrack[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const line = match[0];
    const langMatch = /LANGUAGE="([^"]+)"/.exec(line);

    tracks.push({
      language: langMatch?.[1],
      codec: "wvtt",
    });
  }

  return tracks;
}
