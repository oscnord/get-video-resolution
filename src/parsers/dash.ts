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
  const file = Bun.file(source);
  return file.text();
}

function extractResolutions(content: string): Resolution[] {
  const regex = /<Representation[^>]*?\bwidth=["'](\d+)["'][^>]*?\bheight=["'](\d+)["'][^>]*?\/?>/gi;
  const resolutions: Resolution[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    resolutions.push({
      width: parseInt(match[1], 10),
      height: parseInt(match[2], 10),
    });
  }

  // Also handle height before width
  const reverseRegex = /<Representation[^>]*?\bheight=["'](\d+)["'][^>]*?\bwidth=["'](\d+)["'][^>]*?\/?>/gi;
  while ((match = reverseRegex.exec(content)) !== null) {
    const width = parseInt(match[2], 10);
    const height = parseInt(match[1], 10);
    // Avoid duplicates from the first regex
    if (!resolutions.some(r => r.width === width && r.height === height)) {
      resolutions.push({ width, height });
    }
  }

  return resolutions;
}
