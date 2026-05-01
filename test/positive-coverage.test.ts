import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { ManifestParseError } from "../src/errors";
import { parseDash } from "../src/parsers/dash";
import { parseHls } from "../src/parsers/hls";
import { getVideoResolution } from "../src/resolver";

const fixturesDir = join(import.meta.dir, "fixtures");

describe("DASH multi-Period manifest", () => {
  test("uses the first Period only", async () => {
    const variants = await parseDash(
      join(fixturesDir, "manifest_multiperiod.mpd"),
      {},
    );
    // Multi-period fixture has Period A (1080p+720p) and Period B (480p).
    // We should see only the first Period's representations.
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every((v) => v.height >= 720)).toBe(true);
  });
});

describe("DASH audio-only manifest", () => {
  test("throws ManifestParseError when no video Representation has dimensions", async () => {
    const manifest = `<?xml version="1.0"?>
<MPD>
  <Period>
    <AdaptationSet mimeType="audio/mp4">
      <Representation id="a1" bandwidth="128000" codecs="mp4a.40.2"/>
    </AdaptationSet>
  </Period>
</MPD>`;
    const fetchMock = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    await expect(
      parseDash("https://example.com/manifest.mpd", { fetch: fetchMock }),
    ).rejects.toBeInstanceOf(ManifestParseError);
  });
});

describe("HLS multi-codec extraction", () => {
  test("picks video codec ignoring audio entries", async () => {
    const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2,ec-3"
1080p.m3u8`;
    const fetchMock = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    const variants = await parseHls("https://example.com/master.m3u8", {
      fetch: fetchMock,
    });
    expect(variants[0].codec).toBe("avc1.640028");
    expect(variants[0].audioTracks?.[0].codec).toBe("mp4a.40.2");
  });
});

describe("sniff: true with failing HEAD", () => {
  test("falls through to file parser when HEAD throws", async () => {
    const fetchMock = mock((_url: string, opts?: RequestInit) => {
      if (opts && opts.method === "HEAD") {
        return Promise.reject(new Error("HEAD blocked"));
      }
      // GET reaches the file parser, which then issues a Range request;
      // we return a tiny non-video body so it surfaces as a parse error,
      // proving we got past the sniff step into the file path.
      return Promise.resolve(
        new Response(new Uint8Array(8), {
          status: 200,
        }),
      );
    });
    await expect(
      getVideoResolution("https://example.com/stream", {
        sniff: true,
        fetch: fetchMock,
      }),
    ).rejects.toThrow();
    // HEAD was attempted, but we still proceeded to the file parser.
    const calls = fetchMock.mock.calls;
    const hadHead = calls.some(
      ([, opts]) => (opts as RequestInit | undefined)?.method === "HEAD",
    );
    expect(hadHead).toBe(true);
  });
});
