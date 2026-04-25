import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { ManifestParseError } from "../src/errors";
import { parseHls } from "../src/parsers/hls";

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

  test("detects encryption", async () => {
    const manifest = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/playlist.m3u8`;
    const mockFetch = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    const results = await parseHls("https://example.com/master.m3u8", {
      fetch: mockFetch,
    });
    expect(results[0].encrypted).toBe(true);
  });

  test("does not set encrypted for METHOD=NONE", async () => {
    const manifest = `#EXTM3U
#EXT-X-KEY:METHOD=NONE
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028"
1080p/playlist.m3u8`;
    const mockFetch = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    const results = await parseHls("https://example.com/master.m3u8", {
      fetch: mockFetch,
    });
    expect(results[0].encrypted).toBeUndefined();
  });

  test("extracts audio tracks from EXT-X-MEDIA", async () => {
    const manifest = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English",CHANNELS="2"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="sv",NAME="Swedish",CHANNELS="2"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio"
1080p/playlist.m3u8`;
    const mockFetch = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    const results = await parseHls("https://example.com/master.m3u8", {
      fetch: mockFetch,
    });
    expect(results[0].audioTracks).toHaveLength(2);
    expect(results[0].audioTracks![0].language).toBe("en");
    expect(results[0].audioTracks![0].codec).toBe("mp4a.40.2");
    expect(results[0].audioTracks![0].channels).toBe(2);
    expect(results[0].audioTracks![1].language).toBe("sv");
  });

  test("infers audio from CODECS when no EXT-X-MEDIA", async () => {
    const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/playlist.m3u8`;
    const mockFetch = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    const results = await parseHls("https://example.com/master.m3u8", {
      fetch: mockFetch,
    });
    expect(results[0].audioTracks).toHaveLength(1);
    expect(results[0].audioTracks![0].codec).toBe("mp4a.40.2");
  });

  test("parses audio and subtitle tracks from full manifest", async () => {
    const results = await parseHls(join(fixturesDir, "master_full.m3u8"), {});
    expect(results).toHaveLength(3);

    const hd = results.find((r) => r.width === 1920)!;
    expect(hd.audioTracks).toHaveLength(2);
    expect(hd.audioTracks![0].language).toBe("en");
    expect(hd.audioTracks![0].codec).toBe("mp4a.40.2");
    expect(hd.audioTracks![0].channels).toBe(2);
    expect(hd.audioTracks![1].language).toBe("sv");

    expect(hd.subtitleTracks).toHaveLength(2);
    expect(hd.subtitleTracks![0].language).toBe("en");
    expect(hd.subtitleTracks![0].codec).toBe("wvtt");
    expect(hd.subtitleTracks![1].language).toBe("sv");
  });

  test("detects encryption from fixture", async () => {
    const results = await parseHls(
      join(fixturesDir, "master_encrypted.m3u8"),
      {},
    );
    expect(results[0].encrypted).toBe(true);
  });

  test("no encryption on unencrypted fixture", async () => {
    const results = await parseHls(join(fixturesDir, "master.m3u8"), {});
    expect(results[0].encrypted).toBeUndefined();
  });

  test("extracts subtitle tracks", async () => {
    const manifest = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="sv",NAME="Swedish"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028"
1080p/playlist.m3u8`;
    const mockFetch = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    const results = await parseHls("https://example.com/master.m3u8", {
      fetch: mockFetch,
    });
    expect(results[0].subtitleTracks).toHaveLength(2);
    expect(results[0].subtitleTracks![0].language).toBe("en");
    expect(results[0].subtitleTracks![0].codec).toBe("wvtt");
  });
});
