import { ManifestParseError } from "../errors";
import type { VideoInfo } from "../types";
import { getAspectRatio } from "../utils/aspect-ratio";
import type { FetchOptions } from "../utils/fetch";
import { loadManifest } from "../utils/fetch";
import { isHdrCodec } from "../utils/hdr";

export async function parseHls(
  source: string,
  options: FetchOptions,
): Promise<VideoInfo[]> {
  const content = await loadManifest(source, options);
  const variants = extractVariants(content);

  if (variants.length === 0) {
    throw new ManifestParseError("No RESOLUTION found in HLS manifest");
  }

  return variants;
}

interface RawVariant {
  width: number;
  height: number;
  bandwidth?: number;
  codecs?: string;
  frameRate?: number;
}

function extractVariants(content: string): VideoInfo[] {
  const regex = /#EXT-X-STREAM-INF:([^\n]+)/g;
  const variants: VideoInfo[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const line = match[1];
    const raw = parseStreamInf(line);
    if (!raw) continue;

    const videoCodec = extractVideoCodec(raw.codecs);

    variants.push({
      width: raw.width,
      height: raw.height,
      bitrate: raw.bandwidth,
      codec: videoCodec,
      framerate: raw.frameRate,
      aspectRatio: getAspectRatio(raw.width, raw.height),
      hdr: isHdrCodec(videoCodec),
    });
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
