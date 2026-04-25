import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { ManifestParseError } from "../src/errors";
import { parseDash } from "../src/parsers/dash";

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

  test("parses Representation with height before width", async () => {
    const mpd = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT10S">
  <Period><AdaptationSet mimeType="video/mp4">
    <Representation height="720" width="1280" bandwidth="2800000" codecs="avc1.4d4020" frameRate="30"/>
  </AdaptationSet></Period>
</MPD>`;
    const mockFetch = mock(() =>
      Promise.resolve(new Response(mpd, { status: 200 })),
    );
    const results = await parseDash("https://example.com/test.mpd", {
      fetch: mockFetch,
    });
    expect(results).toHaveLength(1);
    expect(results[0].width).toBe(1280);
    expect(results[0].height).toBe(720);
    expect(results[0].codec).toBe("avc1.4d4020");
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

  test("scopes to first period in multi-period manifest", async () => {
    const mpd = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT60S">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation width="1920" height="1080" bandwidth="5000000" codecs="avc1.640028"/>
    </AdaptationSet>
  </Period>
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation width="640" height="360" bandwidth="800000" codecs="avc1.4d401e"/>
    </AdaptationSet>
  </Period>
</MPD>`;
    const mockFetch = mock(() =>
      Promise.resolve(new Response(mpd, { status: 200 })),
    );
    const results = await parseDash("https://example.com/manifest.mpd", {
      fetch: mockFetch,
    });
    expect(results).toHaveLength(1);
    expect(results[0].width).toBe(1920);
  });

  test("detects ContentProtection as encrypted", async () => {
    const mpd = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT10S">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>
      <Representation width="1920" height="1080" bandwidth="5000000" codecs="avc1.640028"/>
    </AdaptationSet>
  </Period>
</MPD>`;
    const mockFetch = mock(() =>
      Promise.resolve(new Response(mpd, { status: 200 })),
    );
    const results = await parseDash("https://example.com/manifest.mpd", {
      fetch: mockFetch,
    });
    expect(results[0].encrypted).toBe(true);
  });

  test("extracts audio tracks from audio AdaptationSet", async () => {
    const mpd = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT10S">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation width="1920" height="1080" bandwidth="5000000" codecs="avc1.640028"/>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" lang="en">
      <Representation bandwidth="128000" codecs="mp4a.40.2"/>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" lang="sv">
      <Representation bandwidth="128000" codecs="mp4a.40.2"/>
    </AdaptationSet>
  </Period>
</MPD>`;
    const mockFetch = mock(() =>
      Promise.resolve(new Response(mpd, { status: 200 })),
    );
    const results = await parseDash("https://example.com/manifest.mpd", {
      fetch: mockFetch,
    });
    expect(results[0].audioTracks).toHaveLength(2);
    expect(results[0].audioTracks![0].language).toBe("en");
    expect(results[0].audioTracks![0].codec).toBe("mp4a.40.2");
    expect(results[0].audioTracks![1].language).toBe("sv");
  });

  test("parses audio and subtitle tracks from full manifest", async () => {
    const results = await parseDash(join(fixturesDir, "manifest_full.mpd"), {});
    expect(results).toHaveLength(3);

    const hd = results.find((r) => r.width === 1920)!;
    expect(hd.audioTracks).toHaveLength(2);
    expect(hd.audioTracks![0].language).toBe("en");
    expect(hd.audioTracks![0].codec).toBe("mp4a.40.2");
    expect(hd.audioTracks![1].language).toBe("sv");

    expect(hd.subtitleTracks).toHaveLength(2);
    expect(hd.subtitleTracks![0].language).toBe("en");
    expect(hd.subtitleTracks![0].codec).toBe("stpp");
    expect(hd.subtitleTracks![1].language).toBe("sv");
  });

  test("detects encryption from fixture", async () => {
    const results = await parseDash(
      join(fixturesDir, "manifest_encrypted.mpd"),
      {},
    );
    expect(results[0].encrypted).toBe(true);
  });

  test("no encryption on unencrypted fixture", async () => {
    const results = await parseDash(join(fixturesDir, "manifest.mpd"), {});
    expect(results[0].encrypted).toBeUndefined();
  });

  test("scopes to first period from fixture", async () => {
    const results = await parseDash(
      join(fixturesDir, "manifest_multiperiod.mpd"),
      {},
    );
    expect(results).toHaveLength(2);
    expect(results[0].width).toBe(1920);
    expect(results[1].width).toBe(1280);
  });

  test("extracts subtitle tracks", async () => {
    const mpd = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT10S">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation width="1920" height="1080" bandwidth="5000000" codecs="avc1.640028"/>
    </AdaptationSet>
    <AdaptationSet mimeType="application/ttml+xml" lang="en" contentType="text"/>
  </Period>
</MPD>`;
    const mockFetch = mock(() =>
      Promise.resolve(new Response(mpd, { status: 200 })),
    );
    const results = await parseDash("https://example.com/manifest.mpd", {
      fetch: mockFetch,
    });
    expect(results[0].subtitleTracks).toHaveLength(1);
    expect(results[0].subtitleTracks![0].language).toBe("en");
    expect(results[0].subtitleTracks![0].codec).toBe("stpp");
  });
});
