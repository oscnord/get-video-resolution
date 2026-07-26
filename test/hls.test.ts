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

const fromM3u8 = (m3u8: string) =>
  parseHls("https://example.com/master.m3u8", {
    fetch: mock(() => Promise.resolve(new Response(m3u8, { status: 200 }))),
  });

describe("HLS: VIDEO-RANGE drives hdr", () => {
  const variant = (attrs: string) =>
    `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,${attrs}\na.m3u8\n`;

  test("PQ is HDR", async () => {
    const r = await fromM3u8(
      variant('CODECS="hvc1.2.4.L153.B0",VIDEO-RANGE=PQ'),
    );
    expect(r[0].hdr).toBe(true);
  });

  test("HLG is HDR", async () => {
    const r = await fromM3u8(
      variant('CODECS="hvc1.2.4.L153.B0",VIDEO-RANGE=HLG'),
    );
    expect(r[0].hdr).toBe(true);
  });

  test("an explicit SDR overrides the Main 10 codec guess", async () => {
    const r = await fromM3u8(
      variant('CODECS="hvc1.2.4.L153.B0",VIDEO-RANGE=SDR'),
    );
    expect(r[0].hdr).toBe(false);
  });

  test("Main 10 without VIDEO-RANGE is not assumed to be HDR", async () => {
    const r = await fromM3u8(variant('CODECS="hvc1.2.4.L153.B0"'));
    expect(r[0].hdr).toBe(false);
  });

  test("Dolby Vision is HDR without VIDEO-RANGE", async () => {
    const r = await fromM3u8(variant('CODECS="dvh1.05.06"'));
    expect(r[0].hdr).toBe(true);
  });

  test("an unrecognized VIDEO-RANGE falls through to the codec", async () => {
    const r = await fromM3u8(variant('CODECS="dvh1.05.06",VIDEO-RANGE=FUTURE'));
    expect(r[0].hdr).toBe(true);
  });
});

describe("HLS: audio rendition deduplication", () => {
  test("the same language at different channel counts stays separate", async () => {
    // Renditions repeat per bitrate group; only the 2ch duplicate collapses.
    const r = await fromM3u8(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac-64k",LANGUAGE="en",NAME="English",CHANNELS="2"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac-128k",LANGUAGE="en",NAME="English",CHANNELS="2"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="ec3",LANGUAGE="en",NAME="English 5.1",CHANNELS="6"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028"
a.m3u8
`);
    expect(r[0].audioTracks).toHaveLength(2);
    expect(r[0].audioTracks![0].channels).toBe(2);
    expect(r[0].audioTracks![1].channels).toBe(6);
    expect(r[0].audioTracks!.every((t) => t.language === "en")).toBe(true);
  });

  test("distinct languages are still kept", async () => {
    const r = await fromM3u8(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="en",CHANNELS="2"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="sv",CHANNELS="2"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028"
a.m3u8
`);
    expect(r[0].audioTracks).toHaveLength(2);
  });
});

describe("HLS: subtitle codec comes from the variant CODECS", () => {
  test("IMSC/TTML is reported as stpp, not wvtt", async () => {
    const r = await fromM3u8(`#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2,stpp.ttml.im1t",SUBTITLES="subs"
a.m3u8
`);
    expect(r[0].subtitleTracks![0].codec).toBe("stpp");
  });

  test("defaults to wvtt when nothing is declared", async () => {
    const r = await fromM3u8(`#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028",SUBTITLES="subs"
a.m3u8
`);
    expect(r[0].subtitleTracks![0].codec).toBe("wvtt");
  });

  test("a text codec in CODECS is not mistaken for the video codec", async () => {
    const r = await fromM3u8(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="stpp.ttml.im1t,mp4a.40.2,avc1.640028"
a.m3u8
`);
    expect(r[0].codec).toBe("avc1.640028");
  });
});
