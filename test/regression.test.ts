import { describe, expect, mock, test } from "bun:test";
import { MediaParseError, NetworkError } from "../src/errors";
import { parseDash } from "../src/parsers/dash";
import { parseFile } from "../src/parsers/file";
import { parseMP4 } from "../src/parsers/mp4";
import { parseWebM } from "../src/parsers/webm";
import { getAspectRatio } from "../src/utils/aspect-ratio";
import { loadManifest } from "../src/utils/fetch";

describe("regression: aspect ratio with invalid dimensions", () => {
  test("returns undefined for zero width", () => {
    expect(getAspectRatio(0, 1080)).toBeUndefined();
  });

  test("returns undefined for zero height", () => {
    expect(getAspectRatio(1920, 0)).toBeUndefined();
  });

  test("returns undefined for negative", () => {
    expect(getAspectRatio(-1, 100)).toBeUndefined();
  });

  test("returns undefined for non-finite", () => {
    expect(getAspectRatio(Number.NaN, 1080)).toBeUndefined();
    expect(getAspectRatio(Number.POSITIVE_INFINITY, 1080)).toBeUndefined();
  });

  test("still returns a string for valid dims", () => {
    expect(getAspectRatio(1920, 1080)).toBe("16:9");
  });
});

describe("regression: WebM EBML overflow", () => {
  test("rejects EBML uint claim larger than 6 bytes", () => {
    // Build a minimal-ish WebM with a Tracks element whose VINT size claims 8 bytes,
    // exceeding our MAX_VINT_SIZE for readUint. The parser should throw.
    const data = buildOverflowingWebm();
    expect(() => parseWebM(data)).toThrow();
  });
});

describe("regression: DASH frameRate divide by zero", () => {
  test('frameRate="30/0" yields undefined, not Infinity', async () => {
    const manifest = `<?xml version="1.0"?>
<MPD>
  <Period>
    <AdaptationSet>
      <Representation id="v" width="1920" height="1080" bandwidth="5000000" frameRate="30/0" codecs="avc1.640028"/>
    </AdaptationSet>
  </Period>
</MPD>`;
    const fetchMock = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    const variants = await parseDash("https://example.com/manifest.mpd", {
      fetch: fetchMock,
    });
    expect(variants[0].framerate).toBeUndefined();
  });

  test('frameRate="0/0" yields undefined', async () => {
    const manifest = `<?xml version="1.0"?>
<MPD>
  <Period>
    <AdaptationSet>
      <Representation id="v" width="1920" height="1080" bandwidth="5000000" frameRate="0/0" codecs="avc1.640028"/>
    </AdaptationSet>
  </Period>
</MPD>`;
    const fetchMock = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    const variants = await parseDash("https://example.com/manifest.mpd", {
      fetch: fetchMock,
    });
    expect(variants[0].framerate).toBeUndefined();
  });
});

describe("regression: ReadableStream input is capped", () => {
  test("stops reading after STREAM_CAP and surfaces a parse error rather than OOM", async () => {
    // Yield 3 MB of garbage. Cap is 2 MB. Parser will fail format detection, but
    // the test passes if we don't hang or run out of memory.
    let yielded = 0;
    const total = 3 * 1024 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (yielded >= total) {
          controller.close();
          return;
        }
        const chunk = new Uint8Array(64 * 1024);
        controller.enqueue(chunk);
        yielded += chunk.length;
      },
    });
    await expect(parseFile(stream, {})).rejects.toBeInstanceOf(MediaParseError);
  });
});

describe("regression: sniff HEAD honors options.timeout", () => {
  test("HEAD request aborts when timeout fires", async () => {
    const { getVideoResolution } = await import("../src/resolver");
    let aborted = false;
    const fetchMock = mock((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
        // never resolve naturally
      });
    });
    await expect(
      getVideoResolution("https://example.com/stream-no-ext", {
        sniff: true,
        timeout: 50,
        fetch: fetchMock,
      }),
    ).rejects.toThrow();
    expect(aborted).toBe(true);
  });
});

describe("regression: loadManifest size cap", () => {
  test("rejects when content-length declares > 10 MB", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response("payload", {
          status: 200,
          headers: { "content-length": String(20 * 1024 * 1024) },
        }),
      ),
    );
    await expect(
      loadManifest("https://example.com/manifest.mpd", { fetch: fetchMock }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  test("rejects when streamed body exceeds cap without content-length", async () => {
    const chunk = new Uint8Array(1024 * 1024); // 1 MB
    chunk.fill(0x20);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Continuously push chunks; Response.body will deliver them to readBodyCapped
        controller.enqueue(chunk);
      },
    });
    const fetchMock = mock(() =>
      Promise.resolve(new Response(stream, { status: 200 })),
    );
    await expect(
      loadManifest("https://example.com/manifest.mpd", { fetch: fetchMock }),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("regression: HEVC Main 10 SDR is not flagged as HDR (real-world bug)", () => {
  test("Main 10 codec with bt709 colr returns hdr=false", () => {
    // Real failure mode: a 10-bit hvc1.2.* SDR file (color_transfer=bt709) was
    // being reported as hdr:true because the heuristic conflated 10-bit with
    // HDR. Now we trust the colr box: bt709 transfer (=1) means SDR.
    const data = buildHevcMp4WithColr(1);
    const info = parseMP4(data);
    expect(info.codec).toContain("hvc1.2.");
    expect(info.hdr).toBe(false);
  });

  test("Main 10 codec with PQ colr (transfer=16) returns hdr=true", () => {
    const data = buildHevcMp4WithColr(16);
    const info = parseMP4(data);
    expect(info.hdr).toBe(true);
  });

  test("Main 10 codec with no colr box returns hdr=false (conservative)", () => {
    // Without an explicit HDR signal, fall back to false rather than guessing
    // from the codec string. Matches the real-world test movie that ffprobe
    // confirms is SDR despite Main 10 encoding.
    const data = buildHevcMp4WithColr(null);
    const info = parseMP4(data);
    expect(info.hdr).toBe(false);
  });
});

describe("regression: QuickTime v2 audio sample description channels (real-world bug)", () => {
  test("version=2 mp4a entry reads channels from body+40 not body+16", () => {
    // Real failure mode: BBB's QT v2 mp4a entry reports 6 channels but the
    // v0/v1 channelcount slot at body+16 holds the constant "3" sentinel.
    // The actual 32-bit channel count is at body+40.
    const data = buildMp4WithQtV2Audio(6);
    const info = parseMP4(data);
    expect(info.audioTracks?.[0].channels).toBe(6);
  });

  test("version=0 mp4a entry still reads from body+16 (legacy path)", () => {
    const data = buildMp4WithQtV0Audio(2);
    const info = parseMP4(data);
    expect(info.audioTracks?.[0].channels).toBe(2);
  });
});

function buildOverflowingWebm(): Uint8Array {
  // Hand-rolled EBML containing a Channels element whose declared size (7
  // bytes) exceeds MAX_VINT_SIZE (6). readUint must throw rather than overflow.
  const out: number[] = [];
  out.push(0x1a, 0x45, 0xdf, 0xa3, 0x80); // EBML header, empty body
  out.push(0x18, 0x53, 0x80, 0x67, 0x40, 100); // Segment, size 100
  out.push(0x16, 0x54, 0xae, 0x6b, 0x40, 95); // Tracks, size 95
  out.push(0xae, 0x40, 92); // TrackEntry, size 92
  out.push(0x83, 0x81, 0x02); // TrackType = 2 (audio)
  out.push(0xe1, 0x40, 12); // Audio, size 12
  out.push(0x9f, 0x47); // Channels with declared size 7 (overflow trigger)
  out.push(0, 0, 0, 0, 0, 0, 0);
  return new Uint8Array(out);
}

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

function videoMdia(handler: string, children: number[]): number[] {
  const mdhd = box("mdhd", [
    0,
    0,
    0,
    0, // version + flags
    ...u32(0),
    ...u32(0), // creation, modification
    ...u32(1000), // timescale
    ...u32(0), // duration
    ...u16(0x55c4), // packed lang "und"
    ...u16(0),
  ]);
  const hdlr = box("hdlr", [
    ...u32(0),
    ...u32(0),
    ...enc(handler),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    0,
  ]);
  const minf = box("minf", box("stbl", [...children]));
  return box("mdia", [...mdhd, ...hdlr, ...minf]);
}

function buildHevcMp4WithColr(transfer: number | null): Uint8Array {
  // hvcC: 23 bytes, profileIdc=2 (Main10), bit_depth_luma_minus8=2 -> 10-bit
  const hvcC = box(
    "hvcC",
    [
      1, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 120, 0, 0, 0, 0, 0x02, 0, 0, 0, 0,
      0,
    ],
  );
  // Optional colr nclx box
  const colr =
    transfer === null
      ? []
      : box("colr", [
          ...enc("nclx"),
          ...u16(1),
          ...u16(transfer),
          ...u16(1),
          0,
        ]);
  const hvc1 = box("hvc1", [
    ...u32(0),
    ...u16(0),
    ...u16(1), // 6 reserved + data_ref_index
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u32(0), // 16 reserved
    ...u16(1920),
    ...u16(1080),
    ...u32(0x00480000),
    ...u32(0x00480000),
    ...u32(0),
    ...u16(1),
    ...new Array(32).fill(0),
    ...u16(24),
    ...u16(0xffff),
    ...hvcC,
    ...colr,
  ]);
  const stsd = box("stsd", [...u32(0), ...u32(1), ...hvc1]);
  const trak = box("trak", videoMdia("vide", stsd));
  return new Uint8Array(box("moov", trak));
}

function audioStsd(audioEntry: number[]): number[] {
  return box("stsd", [...u32(0), ...u32(1), ...audioEntry]);
}

function videoTrak1080p(): number[] {
  // Minimal video trak so parseMP4 doesn't reject the file.
  const hvcC = box(
    "hvcC",
    [1, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 120, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  );
  const hvc1 = box("hvc1", [
    ...u32(0),
    ...u16(0),
    ...u16(1),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u16(1920),
    ...u16(1080),
    ...u32(0x00480000),
    ...u32(0x00480000),
    ...u32(0),
    ...u16(1),
    ...new Array(32).fill(0),
    ...u16(24),
    ...u16(0xffff),
    ...hvcC,
  ]);
  const stsd = box("stsd", [...u32(0), ...u32(1), ...hvc1]);
  return box("trak", videoMdia("vide", stsd));
}

function audioTrak(stsdBoxBytes: number[]): number[] {
  return box("trak", videoMdia("soun", stsdBoxBytes));
}

function buildMp4WithQtV2Audio(numChannels: number): Uint8Array {
  // QuickTime v2 sound sample description: version=2 at body+8, real channel
  // count as 32-bit at body+40. Sentinel "3" lives at body+16 (the v0/v1
  // channelcount slot) and must NOT be read as the actual count.
  const mp4a = box("mp4a", [
    ...u32(0),
    ...u16(0), // 6 reserved
    ...u16(1), // data_reference_index
    ...u16(2), // version = 2  (body+8..9)
    ...u16(0), // revision
    ...u32(0), // vendor
    ...u16(3), // sentinel channelcount  (body+16..17)
    ...u16(16), // sentinel sampleSize
    ...u16(0xfffe), // sentinel compression_id
    ...u16(0), // sentinel packet_size
    ...u32(0x00010000), // sentinel sample_rate hi (body+24..27)
    ...u32(72), // sizeOfStructOnly  (body+28..31)
    ...u32(0x40e77000),
    ...u32(0), // audio_sample_rate (double 48000.0)  (body+32..39)
    ...u32(numChannels), // num_audio_channels  (body+40..43)
    ...u32(0x7f000000), // always 0x7f000000  (body+44..47)
    ...u32(0), // const_bits_per_channel
    ...u32(0), // format_specific_flags
    ...u32(0), // const_bytes_per_audio_packet
    ...u32(0), // const_lpcm_frames_per_audio_packet
  ]);
  return new Uint8Array(
    box("moov", [...videoTrak1080p(), ...audioTrak(audioStsd(mp4a))]),
  );
}

function buildMp4WithQtV0Audio(numChannels: number): Uint8Array {
  // QuickTime v0/ISO BMFF audio sample entry: channelcount at body+16..17.
  const mp4a = box("mp4a", [
    ...u32(0),
    ...u16(0),
    ...u16(1), // data_reference_index
    ...u32(0),
    ...u32(0), // 8 reserved (incl. version=0 at body+8..9)
    ...u16(numChannels), // channelcount  (body+16..17)
    ...u16(16), // samplesize
    ...u16(0), // pre_defined
    ...u16(0), // reserved
    ...u32(0x00010000), // samplerate hi
  ]);
  return new Uint8Array(
    box("moov", [...videoTrak1080p(), ...audioTrak(audioStsd(mp4a))]),
  );
}
