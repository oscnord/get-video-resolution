import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { MediaParseError } from "../src/errors";
import { parseAVI } from "../src/parsers/avi";
import { parseFile } from "../src/parsers/file";
import { parseMP4 } from "../src/parsers/mp4";
import { parseWebM } from "../src/parsers/webm";
import { getVideoResolution } from "../src/resolver";
import type { VideoInfo } from "../src/types";

const fixtures = (name: string) => join(import.meta.dir, "fixtures", name);

describe("feature: structured error context", () => {
  test("MediaParseError from MP4 carries format='mp4'", async () => {
    try {
      // 64 bytes of zeros — passes detectFormat MP4 path (since fourcc bytes 4-7
      // would need to match) but probably falls into 'unknown'. Instead, supply
      // bytes that look MP4-ish enough to enter parseMP4 then fail.
      const buf = new Uint8Array(128);
      // ftyp box header at start so format detector picks "mp4"
      buf[4] = 0x66;
      buf[5] = 0x74;
      buf[6] = 0x79;
      buf[7] = 0x70;
      // size = 16 (8-byte ftyp w/ 8 bytes of brand data), then nothing
      buf[3] = 16;
      await parseFile(buf, {});
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MediaParseError);
      expect((error as MediaParseError).context?.format).toBe("mp4");
    }
  });

  test("MediaParseError from unknown format has no format context", async () => {
    try {
      const buf = new Uint8Array(64); // zeros — unknown
      await parseFile(buf, {});
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MediaParseError);
      // detectFormat returns "unknown" → generic "Unrecognized file format"
      expect((error as MediaParseError).message).toContain(
        "Unrecognized file format",
      );
    }
  });
});

describe("feature: AVI audio extraction", () => {
  test("reports no audioTracks for a video-only AVI", async () => {
    const result = await parseFile(fixtures("avi_h264_480p.avi"), {});
    expect(result.audioTracks).toBeUndefined();
  });

  test("parseAVI extracts audio from a synthetic AVI with auds strl", () => {
    const data = buildAviWithAudio();
    const result = parseAVI(data);
    expect(result.audioTracks).toBeDefined();
    expect(result.audioTracks).toHaveLength(1);
    expect(result.audioTracks?.[0].codec).toBe("mp3");
    expect(result.audioTracks?.[0].channels).toBe(2);
  });
});

describe("feature: deterministic pickVariants tie-break", () => {
  test("on equal area, higher bitrate wins for 'highest'", async () => {
    const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080,CODECS="avc1.640028"
a.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028"
b.m3u8`;
    const fetchMock = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    const result = (await getVideoResolution("https://example.com/m.m3u8", {
      fetch: fetchMock,
    })) as VideoInfo;
    expect(result.bitrate).toBe(5_000_000);
  });

  test("on equal area, lower bitrate wins for 'lowest'", async () => {
    const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=640x360,CODECS="avc1"
a.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=640x360,CODECS="avc1"
b.m3u8`;
    const fetchMock = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    const result = (await getVideoResolution("https://example.com/m.m3u8", {
      fetch: fetchMock,
      pick: "lowest",
    })) as VideoInfo;
    expect(result.bitrate).toBe(2_000_000);
  });
});

describe("feature: magic-byte sniff fallback", () => {
  test("HLS detected via Range probe when HEAD returns octet-stream", async () => {
    const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360
360.m3u8`;
    const fetchMock = mock((_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" },
          }),
        );
      }
      // Match either Range probe or full GET
      return Promise.resolve(new Response(manifest, { status: 200 }));
    });
    const result = await getVideoResolution("https://example.com/abc/stream", {
      sniff: true,
      fetch: fetchMock,
    });
    expect(result.width).toBe(640);
  });

  test("DASH detected via Range probe when HEAD returns text/xml", async () => {
    const mpd = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period><AdaptationSet>
    <Representation width="1280" height="720" bandwidth="2000000" codecs="avc1"/>
  </AdaptationSet></Period>
</MPD>`;
    const fetchMock = mock((_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "Content-Type": "text/xml" },
          }),
        );
      }
      return Promise.resolve(new Response(mpd, { status: 200 }));
    });
    const result = await getVideoResolution(
      "https://example.com/abc/stream-xml",
      { sniff: true, fetch: fetchMock },
    );
    expect(result.width).toBe(1280);
  });
});

describe("feature: HEVC bitDepth from hvcC", () => {
  test("Main10 hvcC byte 17 = 0x02 yields bitDepth 10", () => {
    const data = buildMinimalHevcMp4(0x02);
    const info = parseMP4(data);
    expect(info.bitDepth).toBe(10);
  });

  test("Main hvcC byte 17 = 0x00 yields bitDepth 8", () => {
    const data = buildMinimalHevcMp4(0x00);
    const info = parseMP4(data);
    expect(info.bitDepth).toBe(8);
  });
});

describe("feature: fragmented MP4 (moov followed by moof)", () => {
  test("parseMP4 ignores moof boxes that follow moov", () => {
    const moov = buildMinimalHevcMp4(0x00); // 8-bit Main HEVC
    // Append a synthetic moof box: 16 bytes, type "moof", arbitrary payload.
    const moof = new Uint8Array([
      0,
      0,
      0,
      16,
      0x6d,
      0x6f,
      0x6f,
      0x66, // "moof"
      0,
      0,
      0,
      8,
      0x6d,
      0x66,
      0x68,
      0x64, // "mfhd" sub-box
    ]);
    const fragmented = new Uint8Array(moov.length + moof.length);
    fragmented.set(moov, 0);
    fragmented.set(moof, moov.length);
    const info = parseMP4(fragmented);
    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
  });
});

describe("feature: WebM subtitle extraction", () => {
  test("Matroska subtitle track (TrackType 0x11) with S_TEXT/UTF8 maps to 'srt'", () => {
    const data = buildWebmWithSubtitle();
    const info = parseWebM(data);
    expect(info.subtitleTracks).toBeDefined();
    expect(info.subtitleTracks?.[0].codec).toBe("srt");
    expect(info.subtitleTracks?.[0].language).toBe("eng");
  });
});

// ---------- helpers ----------

function buildAviWithAudio(): Uint8Array {
  // Minimal RIFF/AVI with a valid avih, a video strl and an audio strl whose
  // strf is a 14-byte WAVEFORMATEX claiming MP3 (formatTag 0x0055), 2 channels.
  // We write fields little-endian.
  const out: number[] = [];
  const w = (n: number) => out.push(n & 0xff);
  const w16 = (n: number) => {
    w(n);
    w(n >> 8);
  };
  const w32 = (n: number) => {
    w(n);
    w(n >> 8);
    w(n >> 16);
    w(n >> 24);
  };
  const wStr = (s: string) => {
    for (const c of s) w(c.charCodeAt(0));
  };

  // Build hdrl content first to compute its size
  const hdrl: number[] = [];
  const wh = (n: number) => hdrl.push(n & 0xff);
  const wh16 = (n: number) => {
    wh(n);
    wh(n >> 8);
  };
  const wh32 = (n: number) => {
    wh(n);
    wh(n >> 8);
    wh(n >> 16);
    wh(n >> 24);
  };
  const whStr = (s: string) => {
    for (const c of s) wh(c.charCodeAt(0));
  };

  // hdrl LIST id (already wrapped outside via 'LIST' + size + 'hdrl')
  // children: avih chunk (56 bytes payload) + strl LIST (video) + strl LIST (audio)

  // avih
  whStr("avih");
  wh32(56);
  wh32(33333); // microSecPerFrame (~30fps)
  wh32(0); // dwMaxBytesPerSec
  wh32(0); // padding
  wh32(0); // flags
  wh32(0); // totalFrames
  wh32(0); // initialFrames
  wh32(2); // streams
  wh32(0); // suggestedBufferSize
  wh32(640); // width
  wh32(480); // height
  wh32(0);
  wh32(0);
  wh32(0);
  wh32(0);

  // video strl LIST
  const strlVideo: number[] = [];
  const wv = (n: number) => strlVideo.push(n & 0xff);
  const wv16 = (n: number) => {
    wv(n);
    wv(n >> 8);
  };
  const wv32 = (n: number) => {
    wv(n);
    wv(n >> 8);
    wv(n >> 16);
    wv(n >> 24);
  };
  const wvStr = (s: string) => {
    for (const c of s) wv(c.charCodeAt(0));
  };

  wvStr("strl"); // list type id
  // strh
  wvStr("strh");
  wv32(56);
  wvStr("vids");
  wvStr("H264");
  wv32(0); // flags
  wv32(0); // priority+language
  wv32(0); // initialFrames
  wv32(1); // dwScale
  wv32(30); // dwRate
  wv32(0); // dwStart
  wv32(0); // dwLength
  wv32(0); // suggestedBufferSize
  wv32(0); // quality
  wv32(0); // sampleSize
  wv32(0);
  wv32(0); // rcFrame

  // strf (BITMAPINFOHEADER, 40 bytes)
  wvStr("strf");
  wv32(40);
  wv32(40); // biSize
  wv32(640); // biWidth
  wv32(480); // biHeight
  wv16(1); // biPlanes
  wv16(24); // biBitCount
  wvStr("H264"); // biCompression
  wv32(0); // biSizeImage
  wv32(0); // biXPelsPerMeter
  wv32(0); // biYPelsPerMeter
  wv32(0); // biClrUsed
  wv32(0); // biClrImportant

  // wrap as LIST
  whStr("LIST");
  wh32(strlVideo.length);
  for (const b of strlVideo) hdrl.push(b);

  // audio strl LIST
  const strlAudio: number[] = [];
  const wa = (n: number) => strlAudio.push(n & 0xff);
  const wa16 = (n: number) => {
    wa(n);
    wa(n >> 8);
  };
  const wa32 = (n: number) => {
    wa(n);
    wa(n >> 8);
    wa(n >> 16);
    wa(n >> 24);
  };
  const waStr = (s: string) => {
    for (const c of s) wa(c.charCodeAt(0));
  };
  waStr("strl");
  // strh
  waStr("strh");
  wa32(56);
  waStr("auds");
  wa32(0); // fccHandler
  wa32(0); // flags
  wa32(0);
  wa32(0);
  wa32(1); // dwScale
  wa32(48000); // dwRate
  wa32(0);
  wa32(0);
  wa32(0);
  wa32(0);
  wa32(0);
  wa32(0);
  wa32(0);
  // strf — WAVEFORMATEX 16 bytes (formatTag, channels, sampleRate, avgBytes, blockAlign, bitsPerSample, cbSize)
  waStr("strf");
  wa32(16);
  wa16(0x0055); // formatTag MP3
  wa16(2); // channels
  wa32(48000); // sampleRate
  wa32(192000); // avgBytesPerSec
  wa16(1); // blockAlign
  wa16(16); // bitsPerSample
  wa16(0); // cbSize

  whStr("LIST");
  wh32(strlAudio.length);
  for (const b of strlAudio) hdrl.push(b);

  // top-level: RIFF + size + AVI  + LIST + size + hdrl + ...hdrl content
  const body: number[] = [];
  const wb = (n: number) => body.push(n & 0xff);
  const wb32 = (n: number) => {
    wb(n);
    wb(n >> 8);
    wb(n >> 16);
    wb(n >> 24);
  };
  const wbStr = (s: string) => {
    for (const c of s) wb(c.charCodeAt(0));
  };
  wbStr("AVI ");
  wbStr("LIST");
  wb32(4 + hdrl.length); // 4 for "hdrl" + payload
  wbStr("hdrl");
  for (const b of hdrl) body.push(b);

  wStr("RIFF");
  w32(body.length);
  for (const b of body) out.push(b);

  return new Uint8Array(out);
}

function buildMinimalHevcMp4(byte17: number): Uint8Array {
  // Build moov > trak > mdia > (mdhd, hdlr=vide, minf > stbl > stsd > hvc1 > hvcC)
  const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

  const u32 = (n: number): number[] => [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ];
  const u16 = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff];

  const box = (type: string, body: number[]): number[] => [
    ...u32(8 + body.length),
    ...enc(type),
    ...body,
  ];

  // hvcC body — 23 bytes minimum to reach byte 17
  const hvcC = box("hvcC", [
    1, // configurationVersion
    0x02, // profileSpace=0, tierFlag=0, profileIdc=2 (Main10)
    0,
    0,
    0,
    0, // profile_compatibility_flags
    0,
    0,
    0,
    0,
    0,
    0, // constraint indicators (6 bytes)
    120, // level_idc
    0,
    0, // reserved + min_spatial_seg
    0, // reserved + parallelismType
    0, // reserved + chromaFormat
    byte17, // reserved + bit_depth_luma_minus8 (3 LSB)
    0, // reserved + bit_depth_chroma_minus8
    0,
    0, // avgFrameRate
    0, // constantFrameRate / lengths
    0, // numOfArrays
  ]);

  // hvc1 sample entry: 8 reserved + 2 data_ref_index + 16 reserved + 2 width
  // + 2 height + 4 horizres + 4 vertres + 4 reserved + 2 frame_count + 32
  // compressorname + 2 depth + 2 pre_defined = 78 bytes header before child boxes
  const hvc1Body = [
    ...u32(0),
    ...u16(0), // 6 reserved
    ...u16(1), // data_reference_index
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u32(0), // 16 reserved
    ...u16(1920), // width
    ...u16(1080), // height
    ...u32(0x00480000),
    ...u32(0x00480000), // hres, vres
    ...u32(0), // reserved
    ...u16(1), // frame_count
    ...new Array(32).fill(0), // compressorname
    ...u16(24), // depth
    ...u16(0xffff), // pre_defined
    ...hvcC,
  ];
  const hvc1 = box("hvc1", hvc1Body);

  const stsd = box("stsd", [
    ...u32(0), // version+flags
    ...u32(1), // entry_count
    ...hvc1,
  ]);

  const stbl = box("stbl", stsd);
  const minf = box("minf", stbl);

  const hdlr = box("hdlr", [
    ...u32(0),
    ...u32(0), // pre_defined
    ...enc("vide"), // handler_type
    ...u32(0),
    ...u32(0),
    ...u32(0), // reserved
    0, // null-terminated name
  ]);
  const mdhd = box("mdhd", [
    0, // version 0
    0,
    0,
    0, // flags
    ...u32(0),
    ...u32(0), // creation, modification
    ...u32(1000), // timescale
    ...u32(0), // duration
    ...u16(0x55c4), // packed lang "und"
    ...u16(0), // pre_defined
  ]);

  const mdia = box("mdia", [...mdhd, ...hdlr, ...minf]);
  const trak = box("trak", mdia);
  const moov = box("moov", trak);

  return new Uint8Array(moov);
}

function buildWebmWithSubtitle(): Uint8Array {
  // Reuse parseWebM expectations: EBML header + Segment with one video track,
  // plus a subtitle TrackEntry (TrackType=0x11) with codec S_TEXT/UTF8 and lang "eng".
  // Build with explicit byte arrays.
  const out: number[] = [];
  const push = (...bs: number[]) => out.push(...bs);
  const str = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

  // EBML header: id 1A 45 DF A3, size 0x80 (empty body)
  push(0x1a, 0x45, 0xdf, 0xa3, 0x80);

  // We'll build the full Segment payload then prefix with id + VINT size.
  const segment: number[] = [];
  const segPush = (...bs: number[]) => segment.push(...bs);

  // Tracks (id 1654ae6b)
  const tracks: number[] = [];

  // Helper: build a TrackEntry (id 0xAE)
  function trackEntry(
    trackType: number,
    codecId: string,
    extras: number[] = [],
  ): number[] {
    const body: number[] = [];
    // TrackType (0x83)
    body.push(0x83, 0x81, trackType);
    // CodecID (0x86)
    const cid = str(codecId);
    body.push(0x86, 0x40, cid.length, ...cid);
    body.push(...extras);
    return [0xae, 0x40, body.length, ...body];
  }

  // Video track: type=1, codec=V_VP9
  // Need PixelWidth (0xB0) and PixelHeight (0xBA) inside Video element (0xE0)
  const video: number[] = [];
  // PixelWidth = 1280
  video.push(0xb0, 0x82, (1280 >> 8) & 0xff, 1280 & 0xff);
  // PixelHeight = 720
  video.push(0xba, 0x82, (720 >> 8) & 0xff, 720 & 0xff);
  const videoElement = [0xe0, 0x40, video.length, ...video];

  tracks.push(...trackEntry(1, "V_VP9", videoElement));

  // Subtitle track: type=0x11, codec=S_TEXT/UTF8, language=eng
  const langExtra: number[] = [];
  const lang = str("eng");
  // Language id 22 b5 9c
  langExtra.push(0x22, 0xb5, 0x9c, 0x40, lang.length, ...lang);
  tracks.push(...trackEntry(0x11, "S_TEXT/UTF8", langExtra));

  // Encode `value` as a length-2 VINT: marker 0x40 in the high 6 bits + 8 LSB.
  // Caller must ensure value fits in 14 bits.
  const vint2 = (value: number) => [0x40 | ((value >> 8) & 0x3f), value & 0xff];

  // Wrap tracks: id 16 54 ae 6b + 2-byte VINT size + body
  segPush(0x16, 0x54, 0xae, 0x6b, ...vint2(tracks.length), ...tracks);

  // Segment id 18 53 80 67 + 2-byte VINT size + body
  push(0x18, 0x53, 0x80, 0x67, ...vint2(segment.length), ...segment);

  return new Uint8Array(out);
}
