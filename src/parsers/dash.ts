import { ManifestParseError } from "../errors";
import type { VideoInfo } from "../types";
import { getAspectRatio } from "../utils/aspect-ratio";
import type { FetchOptions } from "../utils/fetch";
import { loadManifest } from "../utils/fetch";
import { isHdrCodec } from "../utils/hdr";

export async function parseDash(
  source: string,
  options: FetchOptions,
): Promise<VideoInfo[]> {
  const content = await loadManifest(source, options);
  const duration = extractDuration(content);
  const representations = extractRepresentations(content, duration);

  if (representations.length === 0) {
    throw new ManifestParseError("No resolution found in DASH manifest");
  }

  return representations;
}

function extractDuration(content: string): number | undefined {
  const match = /mediaPresentationDuration="PT([^"]+)"/.exec(content);
  if (!match) return undefined;
  return parseIso8601Duration(match[1]);
}

function parseIso8601Duration(duration: string): number {
  let seconds = 0;
  const hours = /(\d+(?:\.\d+)?)H/.exec(duration);
  const minutes = /(\d+(?:\.\d+)?)M/.exec(duration);
  const secs = /(\d+(?:\.\d+)?)S/.exec(duration);

  if (hours) seconds += parseFloat(hours[1]) * 3600;
  if (minutes) seconds += parseFloat(minutes[1]) * 60;
  if (secs) seconds += parseFloat(secs[1]);

  return seconds;
}

function extractRepresentations(
  content: string,
  duration: number | undefined,
): VideoInfo[] {
  const regex = /<Representation\b[^>]*?\/?>/gi;
  const representations: VideoInfo[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const tag = match[0];
    const wMatch = /\bwidth=["'](\d+)["']/.exec(tag);
    const hMatch = /\bheight=["'](\d+)["']/.exec(tag);
    if (!wMatch || !hMatch) continue;
    const width = parseInt(wMatch[1], 10);
    const height = parseInt(hMatch[1], 10);

    const bwMatch = /bandwidth=["'](\d+)["']/.exec(tag);
    const bitrate = bwMatch ? parseInt(bwMatch[1], 10) : undefined;

    const codecMatch = /codecs=["']([^"']+)["']/.exec(tag);
    const codec = codecMatch ? codecMatch[1] : undefined;

    const frMatch = /frameRate=["']?([\d.]+(?:\/\d+)?)["']?/.exec(tag);
    let framerate: number | undefined;
    if (frMatch) {
      const frValue = frMatch[1];
      if (frValue.includes("/")) {
        const [num, den] = frValue.split("/").map(Number);
        framerate = num / den;
      } else {
        framerate = parseFloat(frValue);
      }
    }

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
