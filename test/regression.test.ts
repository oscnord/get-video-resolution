import { describe, expect, mock, test } from "bun:test";
import { MediaParseError, NetworkError } from "../src/errors";
import { parseDash } from "../src/parsers/dash";
import { parseFile } from "../src/parsers/file";
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
