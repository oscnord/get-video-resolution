import { describe, expect, test, mock } from "bun:test";
import { getVideoResolution } from "../src/resolver";

describe("Content-type sniffing", () => {
  test("sniff: true detects HLS from Content-Type", async () => {
    const hlsManifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/playlist.m3u8`;

    const mockFetch = mock((url: string, opts?: RequestInit) => {
      if (opts && opts.method === "HEAD") {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "Content-Type": "application/vnd.apple.mpegurl" },
          }),
        );
      }
      return Promise.resolve(new Response(hlsManifest, { status: 200 }));
    });

    const result = await getVideoResolution(
      "https://example.com/stream?token=abc",
      { sniff: true, fetch: mockFetch },
    );
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  test("sniff: true detects DASH from Content-Type", async () => {
    const mpd = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT30S">
  <Period><AdaptationSet mimeType="video/mp4">
    <Representation width="1280" height="720" bandwidth="2800000" codecs="avc1.4d4020"/>
  </AdaptationSet></Period>
</MPD>`;

    const mockFetch = mock((url: string, opts?: RequestInit) => {
      if (opts && opts.method === "HEAD") {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "Content-Type": "application/dash+xml" },
          }),
        );
      }
      return Promise.resolve(new Response(mpd, { status: 200 }));
    });

    const result = await getVideoResolution(
      "https://example.com/stream?format=dash",
      { sniff: true, fetch: mockFetch },
    );
    expect(result.width).toBe(1280);
  });

  test("sniff: false (default) does not send HEAD request", async () => {
    const mockFetch = mock(() => {
      throw new Error("fetch should not be called");
    });

    // Without sniff, a URL without extension goes to file parser,
    // which will fail -- but fetch should NOT be called for a HEAD request.
    await expect(
      getVideoResolution("https://example.com/stream?token=abc", {
        fetch: mockFetch,
      }),
    ).rejects.toThrow();
  });
});
