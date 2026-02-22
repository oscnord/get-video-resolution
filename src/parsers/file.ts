import { parseMedia } from "@remotion/media-parser";
import { nodeReader } from "@remotion/media-parser/node";
import type { VideoInfo } from "../types";
import type { GetVideoResolutionOptions } from "../types";
import { MediaParseError } from "../errors";
import { getAspectRatio } from "../utils/aspect-ratio";

/**
 * Parse a local or remote video file and return its VideoInfo.
 * Uses @remotion/media-parser for zero-dependency parsing.
 */
export async function parseFile(
  source: string | Buffer | Blob | ReadableStream,
  options: Pick<GetVideoResolutionOptions, "signal" | "timeout">,
): Promise<VideoInfo> {
  const isUrl =
    typeof source === "string" &&
    (source.startsWith("http://") || source.startsWith("https://"));

  try {
    const result = await parseMedia({
      src: typeof source === "string" ? source : (source as Blob),
      fields: {
        dimensions: true,
        durationInSeconds: true,
        fps: true,
        videoCodec: true,
        isHdr: true,
      },
      ...(isUrl || typeof source !== "string" ? {} : { reader: nodeReader }),
    });

    if (!result.dimensions) {
      throw new MediaParseError("No video dimensions found in file");
    }

    return {
      width: result.dimensions.width,
      height: result.dimensions.height,
      duration: result.durationInSeconds ?? undefined,
      codec: result.videoCodec ?? undefined,
      framerate: result.fps ?? undefined,
      aspectRatio: getAspectRatio(
        result.dimensions.width,
        result.dimensions.height,
      ),
      hdr: result.isHdr ?? false,
    };
  } catch (error) {
    if (error instanceof MediaParseError) throw error;
    throw new MediaParseError(
      `Failed to parse file: ${(error as Error).message}`,
      { cause: error },
    );
  }
}
