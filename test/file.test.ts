import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { MediaParseError } from "../src/errors";
import { parseAVI } from "../src/parsers/avi";
import { parseFile } from "../src/parsers/file";
import { parseMP4 } from "../src/parsers/mp4";
import { parseWebM } from "../src/parsers/webm";

const fixtures = (name: string) => join(import.meta.dir, "fixtures", name);

describe("File parser", () => {
  test("returns resolution from a local MP4 file", async () => {
    const result = await parseFile(fixtures("test.mp4"), {});
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
  });

  test("returns aspectRatio", async () => {
    const result = await parseFile(fixtures("test.mp4"), {});
    expect(result.aspectRatio).toBe("4:3");
  });

  test("returns codec as a string if available", async () => {
    const result = await parseFile(fixtures("test.mp4"), {});
    expect(typeof result.codec).toBe("string");
  });

  test("returns hdr as boolean", async () => {
    const result = await parseFile(fixtures("test.mp4"), {});
    expect(result.hdr).toBe(false);
  });

  test("returns duration", async () => {
    const result = await parseFile(fixtures("test.mp4"), {});
    expect(result.duration).toBeCloseTo(0.04, 2);
  });
});

describe("H.264 1080p", () => {
  test("parses dimensions", async () => {
    const result = await parseFile(fixtures("h264_1080p.mp4"), {});
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  test("parses codec string", async () => {
    const result = await parseFile(fixtures("h264_1080p.mp4"), {});
    expect(result.codec).toBe("avc1.640028");
  });

  test("parses framerate", async () => {
    const result = await parseFile(fixtures("h264_1080p.mp4"), {});
    expect(result.framerate).toBe(30);
  });

  test("parses duration", async () => {
    const result = await parseFile(fixtures("h264_1080p.mp4"), {});
    expect(result.duration).toBeCloseTo(0.5, 1);
  });

  test("parses aspect ratio", async () => {
    const result = await parseFile(fixtures("h264_1080p.mp4"), {});
    expect(result.aspectRatio).toBe("16:9");
  });

  test("detects SDR", async () => {
    const result = await parseFile(fixtures("h264_1080p.mp4"), {});
    expect(result.hdr).toBe(false);
  });
});

describe("HEVC 4K", () => {
  test("parses dimensions", async () => {
    const result = await parseFile(fixtures("hevc_4k.mp4"), {});
    expect(result.width).toBe(3840);
    expect(result.height).toBe(2160);
  });

  test("parses codec string starting with hvc1", async () => {
    const result = await parseFile(fixtures("hevc_4k.mp4"), {});
    expect(result.codec).toStartWith("hvc1.");
  });

  test("parses framerate", async () => {
    const result = await parseFile(fixtures("hevc_4k.mp4"), {});
    expect(result.framerate).toBe(24);
  });

  test("parses duration", async () => {
    const result = await parseFile(fixtures("hevc_4k.mp4"), {});
    expect(result.duration).toBeCloseTo(0.5, 1);
  });
});

describe("H.264 720p 60fps", () => {
  test("parses dimensions", async () => {
    const result = await parseFile(fixtures("h264_720p_60fps.mp4"), {});
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  test("parses codec string", async () => {
    const result = await parseFile(fixtures("h264_720p_60fps.mp4"), {});
    expect(result.codec).toBe("avc1.4d4020");
  });

  test("parses 60fps framerate", async () => {
    const result = await parseFile(fixtures("h264_720p_60fps.mp4"), {});
    expect(result.framerate).toBe(60);
  });

  test("parses 1 second duration", async () => {
    const result = await parseFile(fixtures("h264_720p_60fps.mp4"), {});
    expect(result.duration).toBeCloseTo(1.0, 1);
  });
});

describe("MOV container", () => {
  test("parses MOV file", async () => {
    const result = await parseFile(fixtures("h264_480p.mov"), {});
    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
  });

  test("parses codec from MOV", async () => {
    const result = await parseFile(fixtures("h264_480p.mov"), {});
    expect(result.codec).toBe("avc1.64001e");
  });
});

describe("Buffer input", () => {
  test("parses from Buffer", async () => {
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(fixtures("h264_1080p.mp4"));
    const result = await parseFile(buffer, {});
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  test("parses from Blob", async () => {
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(fixtures("h264_1080p.mp4"));
    const blob = new Blob([buffer]);
    const result = await parseFile(blob, {});
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });
});

describe("WebM VP9 720p", () => {
  test("parses dimensions", async () => {
    const result = await parseFile(fixtures("webm_vp9_720p.webm"), {});
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  test("parses codec", async () => {
    const result = await parseFile(fixtures("webm_vp9_720p.webm"), {});
    expect(result.codec).toBe("vp09");
  });

  test("parses framerate", async () => {
    const result = await parseFile(fixtures("webm_vp9_720p.webm"), {});
    expect(result.framerate).toBe(30);
  });

  test("parses duration", async () => {
    const result = await parseFile(fixtures("webm_vp9_720p.webm"), {});
    expect(result.duration).toBeCloseTo(0.5, 1);
  });

  test("parses aspect ratio", async () => {
    const result = await parseFile(fixtures("webm_vp9_720p.webm"), {});
    expect(result.aspectRatio).toBe("16:9");
  });

  test("detects SDR", async () => {
    const result = await parseFile(fixtures("webm_vp9_720p.webm"), {});
    expect(result.hdr).toBe(false);
  });
});

describe("MP4 with audio", () => {
  test("extracts audio tracks", async () => {
    const result = await parseFile(fixtures("h264_1080p_audio.mp4"), {});
    expect(result.audioTracks).toHaveLength(1);
    expect(result.audioTracks![0].codec).toBe("mp4a");
    expect(result.audioTracks![0].language).toBe("eng");
    expect(result.audioTracks![0].channels).toBe(2);
  });
});

describe("WebM metadata", () => {
  test("returns bitDepth for VP9", async () => {
    const result = await parseFile(fixtures("webm_vp9_720p.webm"), {});
    expect(
      result.bitDepth === undefined || typeof result.bitDepth === "number",
    ).toBe(true);
  });
});

describe("WebM with audio", () => {
  test("extracts audio tracks", async () => {
    const result = await parseFile(fixtures("webm_vp9_720p_audio.webm"), {});
    expect(result.audioTracks).toHaveLength(1);
    expect(result.audioTracks![0].codec).toBe("opus");
    expect(result.audioTracks![0].language).toBe("eng");
    expect(result.audioTracks![0].channels).toBe(2);
  });
});

describe("MKV H.264 1080p", () => {
  test("parses dimensions", async () => {
    const result = await parseFile(fixtures("mkv_h264_1080p.mkv"), {});
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  test("parses codec", async () => {
    const result = await parseFile(fixtures("mkv_h264_1080p.mkv"), {});
    expect(result.codec).toBe("avc1");
  });

  test("parses framerate", async () => {
    const result = await parseFile(fixtures("mkv_h264_1080p.mkv"), {});
    expect(result.framerate).toBe(25);
  });

  test("parses duration", async () => {
    const result = await parseFile(fixtures("mkv_h264_1080p.mkv"), {});
    expect(result.duration).toBeCloseTo(0.5, 1);
  });

  test("parses aspect ratio", async () => {
    const result = await parseFile(fixtures("mkv_h264_1080p.mkv"), {});
    expect(result.aspectRatio).toBe("16:9");
  });
});

describe("AVI H.264 480p", () => {
  test("parses dimensions", async () => {
    const result = await parseFile(fixtures("avi_h264_480p.avi"), {});
    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
  });

  test("parses codec", async () => {
    const result = await parseFile(fixtures("avi_h264_480p.avi"), {});
    expect(result.codec).toBe("avc1");
  });

  test("parses framerate", async () => {
    const result = await parseFile(fixtures("avi_h264_480p.avi"), {});
    expect(result.framerate).toBe(25);
  });

  test("parses duration", async () => {
    const result = await parseFile(fixtures("avi_h264_480p.avi"), {});
    expect(result.duration).toBeCloseTo(0.48, 1);
  });

  test("parses aspect ratio", async () => {
    const result = await parseFile(fixtures("avi_h264_480p.avi"), {});
    expect(result.aspectRatio).toBe("4:3");
  });

  test("detects SDR", async () => {
    const result = await parseFile(fixtures("avi_h264_480p.avi"), {});
    expect(result.hdr).toBe(false);
  });
});

describe("ReadableStream input", () => {
  test("parses from ReadableStream", async () => {
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(fixtures("h264_1080p.mp4"));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(buffer));
        controller.close();
      },
    });
    const result = await parseFile(stream, {});
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });
});

describe("Format detection edge cases", () => {
  test("throws for unrecognized data", async () => {
    const garbage = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    await expect(parseFile(garbage as Buffer, {})).rejects.toThrow(
      MediaParseError,
    );
  });

  test("throws for empty data", async () => {
    const empty = new Uint8Array(0);
    await expect(parseFile(empty as Buffer, {})).rejects.toThrow(
      MediaParseError,
    );
  });

  test("throws for tiny data (< 4 bytes)", async () => {
    const tiny = new Uint8Array([0x01, 0x02]);
    await expect(parseFile(tiny as Buffer, {})).rejects.toThrow(
      MediaParseError,
    );
  });

  test("detects RIFF that is not AVI as unknown", async () => {
    // RIFF header but with "WAVE" instead of "AVI "
    const wave = new Uint8Array(12);
    wave.set([0x52, 0x49, 0x46, 0x46]); // RIFF
    wave.set([0x00, 0x00, 0x00, 0x00], 4); // size
    wave.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
    await expect(parseFile(wave as Buffer, {})).rejects.toThrow(
      MediaParseError,
    );
  });
});

describe("MP4 parser error handling", () => {
  test("throws MediaParseError when moov box is missing", () => {
    const ftyp = new Uint8Array(16);
    ftyp.set([0x00, 0x00, 0x00, 0x10]); // size = 16
    ftyp.set([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
    expect(() => parseMP4(ftyp)).toThrow(MediaParseError);
    expect(() => parseMP4(ftyp)).toThrow("No moov box found");
  });

  test("throws MediaParseError when no video track exists", () => {
    // Minimal moov with an audio-only trak (hdlr type = "soun")
    const data = new Uint8Array(80);
    let pos = 0;

    // moov box header
    data.set([0x00, 0x00, 0x00, 0x50], pos); // size = 80
    data.set([0x6d, 0x6f, 0x6f, 0x76], pos + 4); // "moov"
    pos += 8;

    // trak box header
    data.set([0x00, 0x00, 0x00, 0x48], pos); // size = 72
    data.set([0x74, 0x72, 0x61, 0x6b], pos + 4); // "trak"
    pos += 8;

    // mdia box header
    data.set([0x00, 0x00, 0x00, 0x40], pos); // size = 64
    data.set([0x6d, 0x64, 0x69, 0x61], pos + 4); // "mdia"
    pos += 8;

    // hdlr box header
    data.set([0x00, 0x00, 0x00, 0x21], pos); // size = 33
    data.set([0x68, 0x64, 0x6c, 0x72], pos + 4); // "hdlr"
    pos += 8;
    // version/flags (4) + pre_defined (4) + handler_type
    data.set([0x00, 0x00, 0x00, 0x00], pos); // version/flags
    data.set([0x00, 0x00, 0x00, 0x00], pos + 4); // pre_defined
    data.set([0x73, 0x6f, 0x75, 0x6e], pos + 8); // "soun" (audio)

    expect(() => parseMP4(data)).toThrow(MediaParseError);
    expect(() => parseMP4(data)).toThrow("No video track found");
  });
});

describe("WebM parser error handling", () => {
  test("throws MediaParseError for invalid EBML data", () => {
    // EBML magic but corrupt after that
    const data = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00]);
    expect(() => parseWebM(data)).toThrow(MediaParseError);
  });

  test("throws MediaParseError when no video track exists", () => {
    // Valid EBML header + Segment but no Tracks
    const data = new Uint8Array(20);
    // EBML header: ID = 1A 45 DF A3, size = 0x83 (3 bytes of data)
    data.set([0x1a, 0x45, 0xdf, 0xa3, 0x83, 0x00, 0x00, 0x00]);
    // Segment: ID = 18 53 80 67, size = 0x88 (8 bytes)
    data.set(
      [0x18, 0x53, 0x80, 0x67, 0x88, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      8,
    );
    expect(() => parseWebM(data)).toThrow(MediaParseError);
    expect(() => parseWebM(data)).toThrow("No video track found");
  });
});

describe("AVI parser error handling", () => {
  test("throws MediaParseError for data too small", () => {
    const tiny = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    expect(() => parseAVI(tiny)).toThrow(MediaParseError);
    expect(() => parseAVI(tiny)).toThrow("File too small");
  });

  test("throws MediaParseError for invalid RIFF header", () => {
    const data = new Uint8Array(12);
    data.set([0x00, 0x00, 0x00, 0x00]); // not RIFF
    expect(() => parseAVI(data)).toThrow(MediaParseError);
    expect(() => parseAVI(data)).toThrow("Not a valid AVI file");
  });

  test("throws MediaParseError when hdrl list is missing", () => {
    const data = new Uint8Array(20);
    data.set([0x52, 0x49, 0x46, 0x46]); // RIFF
    data.set([0x0c, 0x00, 0x00, 0x00], 4); // size = 12
    data.set([0x41, 0x56, 0x49, 0x20], 8); // AVI
    expect(() => parseAVI(data)).toThrow(MediaParseError);
    expect(() => parseAVI(data)).toThrow("No hdrl list found");
  });
});

describe("Range requests for URLs", () => {
  test("sends Range header for URL sources", async () => {
    const { readFile } = await import("node:fs/promises");
    const mp4Data = await readFile(fixtures("h264_1080p.mp4"));
    const mockFetch = mock((_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.Range) {
        return Promise.resolve(
          new Response(mp4Data, {
            status: 206,
            headers: {
              "Content-Range": `bytes 0-${mp4Data.length - 1}/${mp4Data.length}`,
            },
          }),
        );
      }
      return Promise.resolve(new Response(mp4Data, { status: 200 }));
    });
    const result = await parseFile("https://example.com/video.mp4", {
      fetch: mockFetch,
    });
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("falls back to full download when Range not supported", async () => {
    const { readFile } = await import("node:fs/promises");
    const mp4Data = await readFile(fixtures("h264_1080p.mp4"));
    const mockFetch = mock(() =>
      Promise.resolve(new Response(mp4Data, { status: 200 })),
    );
    const result = await parseFile("https://example.com/video.mp4", {
      fetch: mockFetch,
    });
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  test("fetches tail for MP4 with moov at end", async () => {
    const { readFile } = await import("node:fs/promises");
    const mp4Data = await readFile(fixtures("h264_1080p.mp4"));
    let callCount = 0;
    const mockFetch = mock((_url: string, init?: RequestInit) => {
      callCount++;
      const headers = init?.headers as Record<string, string> | undefined;
      if (callCount === 1 && headers?.Range) {
        // First request: return ftyp-only data (no moov) to simulate moov-at-end
        const ftyp = new Uint8Array(16);
        ftyp.set([0x00, 0x00, 0x00, 0x10]); // size = 16
        ftyp.set([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
        return Promise.resolve(
          new Response(ftyp, {
            status: 206,
            headers: {
              "Content-Range": `bytes 0-15/${mp4Data.length + 16}`,
            },
          }),
        );
      }
      // Second request (tail): return full MP4 data
      return Promise.resolve(new Response(mp4Data, { status: 206 }));
    });
    const result = await parseFile("https://example.com/video.mp4", {
      fetch: mockFetch,
    });
    expect(result.width).toBe(1920);
    expect(callCount).toBe(2);
  });
});

describe("Rotation", () => {
  test("returns 0 rotation for non-rotated MP4", async () => {
    const result = await parseFile(fixtures("h264_1080p.mp4"), {});
    expect(result.rotation).toBe(0);
  });

  test.each([
    { degrees: 90, a: 0, b: 0x00010000 },
    { degrees: 180, a: -0x00010000, b: 0 },
    { degrees: 270, a: 0, b: -0x00010000 },
  ])("detects $degrees-degree rotation from tkhd", ({ degrees, a, b }) => {
    const mp4 = buildMP4WithRotation(a, b);
    const result = parseMP4(mp4);
    expect(result.rotation).toBe(degrees);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });
});

function buildMP4WithRotation(a: number, b: number): Uint8Array {
  const data = new Uint8Array(512);
  let pos = 0;

  const moovStart = pos;
  writeU32(data, pos, 0);
  writeFourCC(data, pos + 4, "moov");
  pos += 8;

  const trakStart = pos;
  writeU32(data, pos, 0);
  writeFourCC(data, pos + 4, "trak");
  pos += 8;

  const tkhdStart = pos;
  writeU32(data, pos, 96);
  writeFourCC(data, pos + 4, "tkhd");
  pos += 8;
  data[pos] = 0;
  pos += 40;
  writeI32(data, pos, a);
  writeI32(data, pos + 4, b);
  pos = tkhdStart + 96;

  const mdiaStart = pos;
  writeU32(data, pos, 0);
  writeFourCC(data, pos + 4, "mdia");
  pos += 8;

  writeU32(data, pos, 21);
  writeFourCC(data, pos + 4, "hdlr");
  pos += 12;
  pos += 4;
  writeFourCC(data, pos, "vide");
  pos = mdiaStart + 8 + 21;

  const minfStart = pos;
  writeU32(data, pos, 0);
  writeFourCC(data, pos + 4, "minf");
  pos += 8;

  const stblStart = pos;
  writeU32(data, pos, 0);
  writeFourCC(data, pos + 4, "stbl");
  pos += 8;

  const stsdStart = pos;
  writeU32(data, pos, 8 + 8 + 86);
  writeFourCC(data, pos + 4, "stsd");
  pos += 8;
  writeU32(data, pos + 4, 1);
  pos += 8;
  const entryStart = pos;
  writeU32(data, pos, 86);
  writeFourCC(data, pos + 4, "avc1");
  writeU32(data, entryStart + 32, 0x07800438);
  pos = stsdStart + 8 + 8 + 86;

  writeU32(data, stblStart, pos - stblStart);
  writeU32(data, minfStart, pos - minfStart);
  writeU32(data, mdiaStart, pos - mdiaStart);
  writeU32(data, trakStart, pos - trakStart);
  writeU32(data, moovStart, pos - moovStart);

  return data.subarray(0, pos);
}

function writeU32(data: Uint8Array, offset: number, value: number) {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}

function writeI32(data: Uint8Array, offset: number, value: number) {
  const v = value | 0;
  data[offset] = (v >>> 24) & 0xff;
  data[offset + 1] = (v >>> 16) & 0xff;
  data[offset + 2] = (v >>> 8) & 0xff;
  data[offset + 3] = v & 0xff;
}

function writeFourCC(data: Uint8Array, offset: number, str: string) {
  for (let i = 0; i < 4; i++) data[offset + i] = str.charCodeAt(i);
}

describe("MP4 metadata", () => {
  test("returns bitDepth for H.264", async () => {
    const result = await parseFile(fixtures("h264_1080p.mp4"), {});
    expect(result.bitDepth).toBe(8);
  });

  test("returns bitDepth for HEVC", async () => {
    const result = await parseFile(fixtures("hevc_4k.mp4"), {});
    expect(typeof result.bitDepth).toBe("number");
  });

  test("returns audioTracks if audio exists", async () => {
    const result = await parseFile(fixtures("h264_1080p.mp4"), {});
    if (result.audioTracks) {
      expect(Array.isArray(result.audioTracks)).toBe(true);
      for (const track of result.audioTracks) {
        if (track.codec) expect(typeof track.codec).toBe("string");
        if (track.channels) expect(typeof track.channels).toBe("number");
      }
    }
  });
});

describe("Timeout handling", () => {
  test("respects timeout for URL fetches", async () => {
    const slowFetch = mock(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(
            () => resolve(new Response(new ArrayBuffer(0))),
            5000,
          );
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        }),
    );
    await expect(
      parseFile("https://example.com/slow.mp4", {
        fetch: slowFetch,
        timeout: 50,
      }),
    ).rejects.toThrow();
  });
});
