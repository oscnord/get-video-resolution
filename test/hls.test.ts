import { describe, expect, test, mock } from "bun:test";
import { parseHls } from "../src/parsers/hls";
import { ManifestParseError } from "../src/errors";
import { join } from "path";

const fixturesDir = join(import.meta.dir, "fixtures");

describe("HLS parser", () => {
  test("returns all variants from a manifest", async () => {
    const results = await parseHls(join(fixturesDir, "master.m3u8"), {});
    expect(results).toHaveLength(4);
    expect(results[0].width).toBe(640);
    expect(results[0].height).toBe(360);
  });

  test("extracts codec, bitrate, framerate, and aspectRatio", async () => {
    const results = await parseHls(join(fixturesDir, "master.m3u8"), {});
    const hd = results.find((r) => r.width === 1920)!;
    expect(hd.codec).toBe("avc1.640028");
    expect(hd.bitrate).toBe(5000000);
    expect(hd.framerate).toBe(30);
    expect(hd.aspectRatio).toBe("16:9");
    expect(hd.hdr).toBe(false);
  });

  test("throws ManifestParseError on empty manifest", async () => {
    await expect(
      parseHls(join(fixturesDir, "empty.m3u8"), {}),
    ).rejects.toBeInstanceOf(ManifestParseError);
  });

  test("uses custom fetch for remote URLs", async () => {
    const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028",FRAME-RATE=60
1080p/playlist.m3u8`;
    const mockFetch = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    const results = await parseHls("https://example.com/master.m3u8", {
      fetch: mockFetch,
    });
    expect(results).toHaveLength(1);
    expect(results[0].framerate).toBe(60);
  });
});
