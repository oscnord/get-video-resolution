import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { MediaParseError } from "../src/errors";
import { parseFile } from "../src/parsers/file";

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

  test("returns duration if available", async () => {
    const result = await parseFile(fixtures("test.mp4"), {});
    if (result.duration !== undefined) {
      expect(typeof result.duration).toBe("number");
    }
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
    if (result.duration !== undefined) {
      expect(result.duration).toBeCloseTo(0.48, 1);
    }
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

describe("Unsupported formats", () => {
  test("throws for unrecognized data", async () => {
    const garbage = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    await expect(parseFile(garbage as Buffer, {})).rejects.toThrow(
      MediaParseError,
    );
  });
});
