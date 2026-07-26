import { describe, expect, mock, test } from "bun:test";
import { MediaParseError, NetworkError } from "../src/errors";
import { parseAVI } from "../src/parsers/avi";
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

describe("WebM DisplayWidth/DisplayHeight", () => {
  test("width/height stay the coded pixel dimensions", () => {
    const info = parseWebM(buildWebm(1440, 1080, [1920, 1080]));
    expect(info.width).toBe(1440);
    expect(info.height).toBe(1080);
    expect(info.aspectRatio).toBe("16:9");
  });

  test("a bare display ratio is not mistaken for pixel dimensions", () => {
    // Under DisplayUnit 3 the display elements hold the ratio itself. Treating
    // them as pixel dimensions would report a 16x9 video.
    const info = parseWebM(buildWebm(1440, 1080, [16, 9]));
    expect(info.width).toBe(1440);
    expect(info.aspectRatio).toBe("16:9");
  });

  test("absent display elements leave aspectRatio to the caller", () => {
    const info = parseWebM(buildWebm(1280, 720));
    expect(info.width).toBe(1280);
    expect(info.aspectRatio).toBeUndefined();
  });

  test("parseData derives the ratio from pixel dimensions as a fallback", async () => {
    const info = await parseFile(Buffer.from(buildWebm(1280, 720)), {});
    expect(info.aspectRatio).toBe("16:9");
  });
});

describe("pasp: anamorphic display aspect ratio", () => {
  test("1440x1080 with 4:3 pasp reports 16:9, not 4:3", () => {
    const info = parseMP4(buildMp4(1440, 1080, { pasp: [4, 3] }));
    expect(info.width).toBe(1440);
    expect(info.height).toBe(1080);
    expect(info.aspectRatio).toBe("16:9");
  });

  test("square pasp leaves the ratio unchanged", () => {
    expect(parseMP4(buildMp4(1920, 1080, { pasp: [1, 1] })).aspectRatio).toBe(
      "16:9",
    );
  });

  test("zero spacing is ignored rather than dividing by zero", () => {
    expect(
      parseMP4(buildMp4(1920, 1080, { pasp: [0, 1] })).aspectRatio,
    ).toBeUndefined();
  });

  test("no pasp box leaves aspectRatio for the caller to derive", () => {
    expect(parseMP4(buildMp4(1920, 1080)).aspectRatio).toBeUndefined();
  });

  test("parseData falls back to pixel dimensions when pasp is absent", async () => {
    const info = await parseFile(Buffer.from(buildMp4(1920, 1080)), {});
    expect(info.aspectRatio).toBe("16:9");
  });

  test("parseData prefers the parser's display ratio over pixel dimensions", async () => {
    const info = await parseFile(
      Buffer.from(buildMp4(1440, 1080, { pasp: [4, 3] })),
      {},
    );
    expect(info.aspectRatio).toBe("16:9");
  });
});

describe("stts: framerate averages every entry", () => {
  test("single-entry (CFR) rate is unchanged", () => {
    // timescale 1000, 300 samples of 40 ticks => 25 fps
    const info = parseMP4(buildMp4(1920, 1080, { stts: [[300, 40]] }));
    expect(info.framerate).toBe(25);
  });

  test("29.97 drop-frame timing still rounds correctly", () => {
    const info = parseMP4(
      buildMp4(1920, 1080, { timescale: 30000, stts: [[300, 1001]] }),
    );
    expect(info.framerate).toBe(29.97);
  });

  test("VFR averages across entries instead of taking the first", () => {
    // 100 samples @ 25fps + 100 @ 50fps => 200 samples over 6s => 33.333 fps.
    // Reading only the first entry would report 25.
    const info = parseMP4(
      buildMp4(1920, 1080, {
        stts: [
          [100, 40],
          [100, 20],
        ],
      }),
    );
    expect(info.framerate).toBe(33.333);
  });

  test("a trailing odd-delta sample barely moves the average", () => {
    const info = parseMP4(
      buildMp4(1920, 1080, {
        stts: [
          [299, 40],
          [1, 1],
        ],
      }),
    );
    expect(info.framerate).toBeCloseTo(25.08, 2);
  });

  test("entry_count of zero yields no framerate", () => {
    expect(
      parseMP4(buildMp4(1920, 1080, { stts: [] })).framerate,
    ).toBeUndefined();
  });

  test("entries truncated by a short buffer use what is readable", () => {
    const full = buildMp4(1920, 1080, {
      stts: [
        [100, 40],
        [100, 20],
      ],
    });
    // Drop the second stts entry; the declared entry_count still says 2.
    const info = parseMP4(full.subarray(0, full.length - 8));
    expect(info.framerate).toBe(25);
  });
});

describe("stsd: malformed sample entries are rejected, not misread", () => {
  test("entry_count of zero does not read the following sibling box", () => {
    // Without the guard the parser reads the stts box header as a sample
    // entry, yielding codec "stts" and garbage dimensions.
    expect(() => parseMP4(buildMp4(1920, 1080, { stsdEntryCount: 0 }))).toThrow(
      "Could not read video dimensions from stsd",
    );
  });

  test("a sample entry declaring a size past the stsd box is rejected", () => {
    expect(() => parseMP4(buildMp4(1920, 1080, { entrySizeDelta: 8 }))).toThrow(
      "Could not read video dimensions from stsd",
    );
  });

  test("an audio stsd with entry_count zero yields no codec or channels", () => {
    const mp4a = box("mp4a", [
      ...u32(0),
      ...u16(0),
      ...u16(1),
      ...u32(0),
      ...u32(0),
      ...u16(2),
      ...u16(16),
      ...u16(0),
      ...u16(0),
      ...u32(0x00010000),
    ]);
    const stsd = box("stsd", [...u32(0), ...u32(0), ...mp4a]);
    const data = new Uint8Array(
      box("moov", [...videoTrak1080p(), ...audioTrak(stsd)]),
    );
    const track = parseMP4(data).audioTracks?.[0];
    expect(track?.codec).toBeUndefined();
    expect(track?.channels).toBeUndefined();
  });
});

interface Mp4Opts {
  pasp?: [number, number];
  stts?: Array<[number, number]>;
  timescale?: number;
  stsdEntryCount?: number;
  entrySizeDelta?: number;
}

function buildMp4(
  width: number,
  height: number,
  opts: Mp4Opts = {},
): Uint8Array {
  const hvcC = box(
    "hvcC",
    [1, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 120, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  );
  const pasp = opts.pasp
    ? box("pasp", [...u32(opts.pasp[0]), ...u32(opts.pasp[1])])
    : [];
  const hvc1 = box("hvc1", [
    ...u32(0),
    ...u16(0),
    ...u16(1),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u16(width),
    ...u16(height),
    ...u32(0x00480000),
    ...u32(0x00480000),
    ...u32(0),
    ...u16(1),
    ...new Array(32).fill(0),
    ...u16(24),
    ...u16(0xffff),
    ...hvcC,
    ...pasp,
  ]);
  if (opts.entrySizeDelta) {
    hvc1.splice(0, 4, ...u32(hvc1.length + opts.entrySizeDelta));
  }

  const entries = opts.stts ?? [[300, 40]];
  const stts = box("stts", [
    ...u32(0),
    ...u32(entries.length),
    ...entries.flatMap(([count, delta]) => [...u32(count), ...u32(delta)]),
  ]);

  const stsd = box("stsd", [
    ...u32(0),
    ...u32(opts.stsdEntryCount ?? 1),
    ...hvc1,
  ]);
  const trak = box(
    "trak",
    videoMdia("vide", [...stsd, ...stts], opts.timescale),
  );
  return new Uint8Array(box("moov", trak));
}

const vint = (n: number): number[] =>
  n < 0x80 ? [0x80 | n] : [0x40 | (n >> 8), n & 0xff];
const ebml = (id: number[], payload: number[]): number[] => [
  ...id,
  ...vint(payload.length),
  ...payload,
];
const ebmlUint = (id: number[], value: number): number[] =>
  ebml(id, value <= 0xff ? [value] : [(value >> 8) & 0xff, value & 0xff]);

function buildWebm(
  pixelWidth: number,
  pixelHeight: number,
  display?: [number, number],
): Uint8Array {
  const video = ebml(
    [0xe0],
    [
      ...ebmlUint([0xb0], pixelWidth),
      ...ebmlUint([0xba], pixelHeight),
      ...(display
        ? [
            ...ebmlUint([0x54, 0xb0], display[0]),
            ...ebmlUint([0x54, 0xba], display[1]),
          ]
        : []),
    ],
  );
  const trackEntry = ebml([0xae], [...ebmlUint([0x83], 1), ...video]);
  const tracks = ebml([0x16, 0x54, 0xae, 0x6b], trackEntry);
  return new Uint8Array([
    0x1a,
    0x45,
    0xdf,
    0xa3,
    0x80, // EBML header, empty body
    ...ebml([0x18, 0x53, 0x80, 0x67], tracks),
  ]);
}

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

function videoMdia(
  handler: string,
  children: number[],
  timescale = 1000,
): number[] {
  const mdhd = box("mdhd", [
    0,
    0,
    0,
    0, // version + flags
    ...u32(0),
    ...u32(0), // creation, modification
    ...u32(timescale),
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

describe("AVI: chunk-bounded header reads", () => {
  test("a full strl parses dimensions, codec, and framerate", () => {
    const info = parseAVI(buildAvi({}));
    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
    expect(info.codec).toBe("avc1");
    expect(info.framerate).toBe(29.97);
  });

  test("a truncated strh is rejected instead of reading the next chunk", () => {
    // With strh cut to 16 bytes, an unbounded read would take dwScale/dwRate
    // from whatever follows. The avih fallback supplies the real values.
    const info = parseAVI(buildAvi({ strhSize: 16 }));
    expect(info.width).toBe(640);
    expect(info.height).toBe(480);
    expect(info.framerate).toBe(25);
    expect(info.codec).toBeUndefined();
  });

  test("a truncated strf falls back to the avih dimensions", () => {
    const info = parseAVI(buildAvi({ strfSize: 12 }));
    expect(info.width).toBe(640);
    expect(info.height).toBe(480);
    expect(info.codec).toBe("avc1");
  });

  test("a top-down (negative biHeight) bitmap reports a positive height", () => {
    const info = parseAVI(buildAvi({ biHeight: -1080 }));
    expect(info.height).toBe(1080);
  });

  test("duration uses the unrounded rate, not the rounded framerate", () => {
    // 107892 frames divided by the rounded 29.97 lands on exactly 3600s, which
    // is precisely the wrong answer: at the true 30000/1001 it is 3599.9964.
    const info = parseAVI(buildAvi({ dwLength: 107892 }));
    expect(info.framerate).toBe(29.97);
    expect(info.duration).toBeCloseTo(3599.9964, 4);
    expect(info.duration).not.toBe(3600);
  });
});

interface AviOpts {
  strhSize?: number;
  strfSize?: number;
  biWidth?: number;
  biHeight?: number;
  dwLength?: number;
}

const u32le = (n: number): number[] => [
  n & 0xff,
  (n >>> 8) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 24) & 0xff,
];
const chunk = (
  type: string,
  body: number[],
  declaredSize?: number,
): number[] => [...enc(type), ...u32le(declaredSize ?? body.length), ...body];

function buildAvi(opts: AviOpts): Uint8Array {
  // avih: fallback 25fps 640x480, deliberately different from the strl values
  // so it is obvious which path produced the result.
  const avih = chunk("avih", [
    ...u32le(40000), // dwMicroSecPerFrame -> 25 fps
    ...new Array(28).fill(0),
    ...u32le(640), // dwWidth  (+32)
    ...u32le(480), // dwHeight (+36)
    ...new Array(16).fill(0),
  ]);

  const strh = chunk(
    "strh",
    [
      ...enc("vids"),
      ...enc("H264"),
      ...new Array(12).fill(0),
      ...u32le(1001), // dwScale  (+20)
      ...u32le(30000), // dwRate   (+24)
      ...u32le(0), // dwStart  (+28)
      ...u32le(opts.dwLength ?? 300), // dwLength (+32)
      ...new Array(16).fill(0),
    ],
    opts.strhSize,
  );

  const strf = chunk(
    "strf",
    [
      ...u32le(40), // biSize
      ...u32le(opts.biWidth ?? 1920), // biWidth  (+4)
      ...u32le(opts.biHeight ?? 1080), // biHeight (+8)
      ...u32le(0), // planes + bitcount (+12)
      ...enc("H264"), // biCompression (+16)
      ...new Array(20).fill(0),
    ],
    opts.strfSize,
  );

  const strl = [...enc("LIST"), ...u32le(4 + strh.length + strf.length)];
  const hdrlBody = [
    ...enc("hdrl"),
    ...avih,
    ...strl,
    ...enc("strl"),
    ...strh,
    ...strf,
  ];
  const hdrl = [...enc("LIST"), ...u32le(hdrlBody.length), ...hdrlBody];
  const riffBody = [...enc("AVI "), ...hdrl];
  return new Uint8Array([
    ...enc("RIFF"),
    ...u32le(riffBody.length),
    ...riffBody,
  ]);
}

describe("AVI: malformed BITMAPINFOHEADER dimensions", () => {
  test("a negative biWidth falls back to avih instead of flipping sign", () => {
    // There is no top-down analog for width, so a negative biWidth is simply
    // malformed. Taking its absolute value would manufacture a plausible 1900
    // and suppress the fallback.
    const info = parseAVI(buildAvi({ biWidth: -1900 }));
    expect(info.width).toBe(640);
    expect(info.height).toBe(480);
  });

  test("a zero biHeight falls back to avih", () => {
    const info = parseAVI(buildAvi({ biHeight: 0 }));
    expect(info.width).toBe(640);
    expect(info.height).toBe(480);
  });
});
