import { parseMedia } from "@remotion/media-parser";
import { nodeReader } from "@remotion/media-parser/node";
import type { Resolution } from "../types";

/**
 * Parse a local or remote video file and return its resolution.
 * Uses @remotion/media-parser for zero-dependency parsing.
 */
export async function parseFile(source: string): Promise<Resolution> {
  const isUrl = source.startsWith("http://") || source.startsWith("https://");

  const result = await parseMedia({
    src: source,
    fields: { dimensions: true },
    ...(isUrl ? {} : { reader: nodeReader }),
  });

  if (!result.dimensions) {
    throw new Error("No video dimensions found in file");
  }

  return {
    width: result.dimensions.width,
    height: result.dimensions.height,
  };
}
