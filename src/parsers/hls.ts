import { readFile } from "fs/promises";
import type { Resolution } from "../types";

/**
 * Parse an HLS manifest and return the highest resolution found.
 * Reads RESOLUTION=WxH from #EXT-X-STREAM-INF lines.
 */
export async function parseHls(source: string): Promise<Resolution> {
  const content = await loadManifest(source);
  const resolutions = extractResolutions(content);

  if (resolutions.length === 0) {
    throw new Error("No RESOLUTION found in HLS manifest");
  }

  return resolutions.reduce((best, r) =>
    r.width * r.height > best.width * best.height ? r : best
  );
}

async function loadManifest(source: string): Promise<string> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch HLS manifest: ${response.status}`);
    }
    return response.text();
  }
  return readFile(source, "utf-8");
}

function extractResolutions(content: string): Resolution[] {
  const regex = /RESOLUTION=(\d+)x(\d+)/g;
  const resolutions: Resolution[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    resolutions.push({
      width: parseInt(match[1], 10),
      height: parseInt(match[2], 10),
    });
  }

  return resolutions;
}
