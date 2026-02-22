import { describe, expect, test, mock } from "bun:test";
import { parseDash } from "../src/parsers/dash";
import { ManifestParseError } from "../src/errors";
import { join } from "path";

const fixturesDir = join(import.meta.dir, "fixtures");

describe("DASH parser", () => {
  test("returns all representations from an MPD manifest", async () => {
    const results = await parseDash(join(fixturesDir, "manifest.mpd"), {});
    expect(results).toHaveLength(4);
    expect(results[0].width).toBe(640);
    expect(results[0].height).toBe(360);
  });

  test("extracts codec, bitrate, framerate, duration, and aspectRatio", async () => {
    const results = await parseDash(join(fixturesDir, "manifest.mpd"), {});
    const hd = results.find((r) => r.width === 1920)!;
    expect(hd.codec).toBe("avc1.640028");
    expect(hd.bitrate).toBe(5000000);
    expect(hd.framerate).toBe(30);
    expect(hd.duration).toBe(60);
    expect(hd.aspectRatio).toBe("16:9");
    expect(hd.hdr).toBe(false);
  });

  test("throws ManifestParseError on manifest with no representations", async () => {
    await expect(
      parseDash(join(fixturesDir, "empty.mpd"), {}),
    ).rejects.toBeInstanceOf(ManifestParseError);
  });

  test("uses custom fetch for remote URLs", async () => {
    const mpd = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT30S">
  <Period><AdaptationSet mimeType="video/mp4">
    <Representation width="3840" height="2160" bandwidth="15000000" codecs="hvc1.2.4.L153.B0" frameRate="60"/>
  </AdaptationSet></Period>
</MPD>`;
    const mockFetch = mock(() =>
      Promise.resolve(new Response(mpd, { status: 200 })),
    );
    const results = await parseDash("https://example.com/manifest.mpd", {
      fetch: mockFetch,
    });
    expect(results).toHaveLength(1);
    expect(results[0].width).toBe(3840);
    expect(results[0].hdr).toBe(true);
    expect(results[0].duration).toBe(30);
  });
});
