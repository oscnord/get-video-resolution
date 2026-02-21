import { readFile } from "fs/promises";
import type { Resolution } from "../types";

/**
 * Parse a DASH MPD manifest and return the highest resolution found.
 * Extracts width/height attributes from <Representation> elements.
 */
export async function parseDash(source: string): Promise<Resolution> {
  const content = await loadManifest(source);
  const resolutions = extractResolutions(content);

  if (resolutions.length === 0) {
    throw new Error("No resolution found in DASH manifest");
  }

  return resolutions.reduce((best, r) =>
    r.width * r.height > best.width * best.height ? r : best
  );
}

async function loadManifest(source: string): Promise<string> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch DASH manifest: ${response.status}`);
    }
    return response.text();
  }
  return readFile(source, "utf-8");
}

function extractResolutions(content: string): Resolution[] {
  const regex =
    /<Representation[^>]*?\b(?:width=["'](\d+)["'][^>]*?\bheight=["'](\d+)["']|height=["'](\d+)["'][^>]*?\bwidth=["'](\d+)["'])/gi;
  const resolutions: Resolution[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const width = match[1] ?? match[4];
    const height = match[2] ?? match[3];

    if (!width || !height) continue;

    resolutions.push({
      width: parseInt(width, 10),
      height: parseInt(height, 10),
    });
  }

  return resolutions;
}
