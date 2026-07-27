import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaParseError, NetworkError } from "../src/errors";
import { parseFile } from "../src/parsers/file";
import { PROBE_SIZE } from "../src/utils/range-reader";

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
    0,
    ...u32(0),
    ...u32(0),
    ...u32(1000),
    ...u32(0),
    ...u16(0x55c4),
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
  const minf = box("minf", box("stbl", children));
  return box("mdia", [...mdhd, ...hdlr, ...minf]);
}

function videoTrak(): number[] {
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
  return box(
    "trak",
    videoMdia("vide", box("stsd", [...u32(0), ...u32(1), ...hvc1])),
  );
}

const FTYP = box("ftyp", [
  ...enc("isom"),
  ...u32(0),
  ...enc("isom"),
  ...enc("mp41"),
]);

/** moov at the front, but padded so the real trak sits beyond a 1 MB probe. */
function mp4WithOversizedLeadingMoov(): Uint8Array {
  const moov = box("moov", [
    ...box("free", new Array(1_200_000).fill(0)),
    ...videoTrak(),
  ]);
  return new Uint8Array([
    ...FTYP,
    ...moov,
    ...box("mdat", new Array(1024).fill(0)),
  ]);
}

/** moov after a multi-megabyte mdat, the classic non-faststart layout. */
function mp4WithTrailingMoov(mdatBytes = 3 * PROBE_SIZE): Uint8Array {
  return new Uint8Array([
    ...FTYP,
    ...box("mdat", new Array(mdatBytes).fill(0)),
    ...box("moov", videoTrak()),
  ]);
}

/** A Blob that reports how many bytes were actually materialised, slices included. */
class TrackedBlob extends Blob {
  readonly bytes: Uint8Array;
  readonly counter: { read: number };

  constructor(bytes: Uint8Array, counter: { read: number }) {
    super([bytes]);
    this.bytes = bytes;
    this.counter = counter;
  }

  slice(start = 0, end = this.bytes.length): Blob {
    return new TrackedBlob(this.bytes.subarray(start, end), this.counter);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    this.counter.read += this.bytes.length;
    return super.arrayBuffer();
  }
}

/** Serves `bytes` over HTTP, honouring a single `bytes=a-b` range. */
function rangeServer(bytes: Uint8Array) {
  return mock(async (_url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const match = headers.Range?.match(/bytes=(\d+)-(\d+)/);
    if (!match) {
      return new Response(bytes, { status: 200 });
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), bytes.length - 1);
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { "content-range": `bytes ${start}-${end}/${bytes.length}` },
    });
  });
}

async function tempFile(bytes: Uint8Array, name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gvr-"));
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

describe("oversized leading moov", () => {
  test("parses over HTTP when the moov exceeds the probe", async () => {
    const bytes = mp4WithOversizedLeadingMoov();
    const result = await parseFile("https://example.com/v.mp4", {
      fetch: rangeServer(bytes) as unknown as typeof globalThis.fetch,
    });
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  test("parses from a Blob when the moov exceeds the probe", async () => {
    const bytes = mp4WithOversizedLeadingMoov();
    const result = await parseFile(new Blob([bytes]), {});
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  test("parses from a local path when the moov exceeds the probe", async () => {
    const path = await tempFile(mp4WithOversizedLeadingMoov(), "big-moov.mp4");
    const result = await parseFile(path, {});
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });
});

describe("bounded reads", () => {
  test("a Blob is not buffered in full", async () => {
    const bytes = mp4WithTrailingMoov(8 * PROBE_SIZE);
    const counter = { read: 0 };
    const blob = new TrackedBlob(bytes, counter);

    const result = await parseFile(blob, {});

    expect(result.width).toBe(1920);
    // head + tail, with headroom; nowhere near the ~9 MB total
    expect(counter.read).toBeLessThan(3 * PROBE_SIZE);
    expect(counter.read).toBeLessThan(bytes.length / 2);
  });

  test("a Range-capable server transfers only the head and tail", async () => {
    const bytes = mp4WithTrailingMoov(8 * PROBE_SIZE);
    let transferred = 0;
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const match = headers.Range?.match(/bytes=(\d+)-(\d+)/);
      if (!match) return new Response(bytes, { status: 200 });
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), bytes.length - 1);
      const slice = bytes.slice(start, end + 1);
      transferred += slice.length;
      return new Response(slice, {
        status: 206,
        headers: { "content-range": `bytes ${start}-${end}/${bytes.length}` },
      });
    });

    const result = await parseFile("https://example.com/v.mp4", {
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    expect(result.width).toBe(1920);
    expect(transferred).toBeLessThan(3 * PROBE_SIZE);
    expect(transferred).toBeLessThan(bytes.length / 2);
  });
});

describe("server that ignores Range", () => {
  /** Body as a stream with no content-length, so the total length is unknowable. */
  const streamingServer = (bytes: Uint8Array) =>
    mock(async () => {
      let offset = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.length) {
            controller.close();
            return;
          }
          const chunk = bytes.subarray(offset, offset + 256 * 1024);
          offset += chunk.length;
          controller.enqueue(chunk);
        },
      });
      return new Response(body, { status: 200 });
    });

  test("still parses a trailing-moov MP4, in a single request", async () => {
    const bytes = mp4WithTrailingMoov(3 * PROBE_SIZE);
    const fetchMock = streamingServer(bytes);

    const result = await parseFile("https://example.com/v.mp4", {
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    // One pass: the body must be streamed through to reach the tail, but never
    // re-requested and never buffered whole.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("still parses a leading-moov MP4", async () => {
    const bytes = new Uint8Array([
      ...FTYP,
      ...box("moov", videoTrak()),
      ...box("mdat", new Array(2 * PROBE_SIZE).fill(0)),
    ]);
    const result = await parseFile("https://example.com/v.mp4", {
      fetch: streamingServer(bytes) as unknown as typeof globalThis.fetch,
    });
    expect(result.width).toBe(1920);
  });
});

describe("recovery is only attempted when the layout calls for it", () => {
  /** moov is complete and inside the probe, but carries no video track. */
  function audioOnlyMp4(): Uint8Array {
    const mp4a = box("mp4a", [
      ...u32(0),
      ...u16(0),
      ...u16(1),
      ...u32(0),
      ...u16(2),
      ...u16(16),
      ...u32(0),
      ...u32(48000 << 16),
    ]);
    const soun = box(
      "trak",
      videoMdia("soun", box("stsd", [...u32(0), ...u32(1), ...mp4a])),
    );
    // Larger than the probe, so a size-driven tail recovery is even eligible.
    return new Uint8Array([
      ...FTYP,
      ...box("moov", soun),
      ...box("mdat", new Array(2 * PROBE_SIZE).fill(0)),
    ]);
  }

  test("reports the real parse failure, not a moov error", async () => {
    await expect(parseFile(new Blob([audioOnlyMp4()]), {})).rejects.toThrow(
      /no video track/i,
    );
  });

  test("does not issue a second request for a complete moov", async () => {
    const bytes = audioOnlyMp4();
    const fetchMock = rangeServer(bytes);
    await expect(
      parseFile("https://example.com/v.mp4", {
        fetch: fetchMock as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow(/no video track/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("an unidentifiable source is not re-read", async () => {
    const bytes = new Uint8Array(4 * PROBE_SIZE).fill(0x7a);
    const fetchMock = rangeServer(bytes);
    await expect(
      parseFile("https://example.com/mystery.bin", {
        fetch: fetchMock as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow(/unrecognized file format/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("reads never exceed the source", () => {
  test("a moov claiming more than the file size is not requested", async () => {
    // 40 MB moov claim inside a ~2 MB file: plausible enough to pass a fixed
    // ceiling, but impossible given the real length.
    const claim = 40 * 1024 * 1024;
    const bogus = [...u32(claim), ...enc("moov"), ...new Array(64).fill(0)];
    const bytes = new Uint8Array([
      ...FTYP,
      ...bogus,
      ...box("free", new Array(2 * PROBE_SIZE).fill(0)),
    ]);

    const requested: number[] = [];
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const match = headers.Range?.match(/bytes=(\d+)-(\d+)/);
      if (!match) return new Response(bytes, { status: 200 });
      const start = Number(match[1]);
      const end = Number(match[2]);
      requested.push(end - start + 1);
      const slice = bytes.slice(start, Math.min(end + 1, bytes.length));
      return new Response(slice, {
        status: 206,
        headers: {
          "content-range": `bytes ${start}-${start + slice.length - 1}/${bytes.length}`,
        },
      });
    });

    await expect(
      parseFile("https://example.com/v.mp4", {
        fetch: fetchMock as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toBeInstanceOf(MediaParseError);

    expect(requested.length).toBeGreaterThan(0);
    for (const length of requested) {
      expect(length).toBeLessThanOrEqual(bytes.length);
    }
  });
});

describe("HTTP failures", () => {
  test("a non-2xx response is a NetworkError, matching the manifest paths", async () => {
    const fetchMock = mock(async () => new Response("nope", { status: 404 }));
    await expect(
      parseFile("https://example.com/missing.mp4", {
        fetch: fetchMock as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("corrupt box sizes", () => {
  test("an absurd moov size is not trusted for allocation", async () => {
    // moov declares ~3 GB while the file is tiny; the reader must refuse to
    // allocate it rather than attempting a 3 GB read.
    const trak = videoTrak();
    const bogus = [
      ...u32(0xbfffffff),
      ...enc("moov"),
      ...new Array(64).fill(0),
    ];
    const bytes = new Uint8Array([...FTYP, ...bogus, ...trak]);

    const counter = { read: 0 };
    const blob = new TrackedBlob(bytes, counter);

    await expect(parseFile(blob, {})).rejects.toBeInstanceOf(MediaParseError);
    expect(counter.read).toBeLessThan(4 * PROBE_SIZE);
  });
});

describe("trailing moov stays supported on every backend", () => {
  const expectHd = (r: { width: number; height: number }) => {
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1080);
  };

  test("Blob", async () => {
    expectHd(await parseFile(new Blob([mp4WithTrailingMoov()]), {}));
  });

  test("local path", async () => {
    const path = await tempFile(mp4WithTrailingMoov(), "tail-moov.mp4");
    expectHd(await parseFile(path, {}));
  });

  test("HTTP with Range", async () => {
    const bytes = mp4WithTrailingMoov();
    expectHd(
      await parseFile("https://example.com/v.mp4", {
        fetch: rangeServer(bytes) as unknown as typeof globalThis.fetch,
      }),
    );
  });

  test("Buffer", async () => {
    expectHd(await parseFile(Buffer.from(mp4WithTrailingMoov()), {}));
  });
});

describe("small sources", () => {
  test("a Blob smaller than the probe still parses", async () => {
    const bytes = new Uint8Array([...FTYP, ...box("moov", videoTrak())]);
    expect(bytes.length).toBeLessThan(PROBE_SIZE);
    const result = await parseFile(new Blob([bytes]), {});
    expect(result.width).toBe(1920);
  });

  test("an empty Blob reports a parse failure, not a crash", async () => {
    await expect(parseFile(new Blob([]), {})).rejects.toThrow();
  });
});
