import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import * as pkg from "../src/index";
import {
  getVideoResolution,
  ManifestParseError,
  MediaParseError,
  NetworkError,
  UnsupportedSourceError,
  VideoResolutionError,
} from "../src/index";

const fixturesDir = join(import.meta.dir, "fixtures");

describe("public re-export surface", () => {
  test("exports getVideoResolution", () => {
    expect(typeof pkg.getVideoResolution).toBe("function");
  });

  test("exports all error classes", () => {
    expect(VideoResolutionError.prototype).toBeInstanceOf(Error);
    expect(NetworkError.prototype).toBeInstanceOf(VideoResolutionError);
    expect(ManifestParseError.prototype).toBeInstanceOf(VideoResolutionError);
    expect(UnsupportedSourceError.prototype).toBeInstanceOf(
      VideoResolutionError,
    );
    expect(MediaParseError.prototype).toBeInstanceOf(VideoResolutionError);
  });

  test("error classes preserve their name property", () => {
    expect(new NetworkError("x").name).toBe("NetworkError");
    expect(new ManifestParseError("x").name).toBe("ManifestParseError");
    expect(new UnsupportedSourceError("x").name).toBe("UnsupportedSourceError");
    expect(new MediaParseError("x").name).toBe("MediaParseError");
    expect(new VideoResolutionError("x").name).toBe("VideoResolutionError");
  });
});

describe("pick: 'highest' (default)", () => {
  test("returns the highest-area variant explicitly", async () => {
    const result = await getVideoResolution(join(fixturesDir, "master.m3u8"), {
      pick: "highest",
    });
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  test("default behaviour matches pick: 'highest'", async () => {
    const a = await getVideoResolution(join(fixturesDir, "master.m3u8"));
    const b = await getVideoResolution(join(fixturesDir, "master.m3u8"), {
      pick: "highest",
    });
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
  });
});

describe("signal precedence over timeout", () => {
  test("caller signal aborts even when timeout is set", async () => {
    const controller = new AbortController();
    const fetchMock = mock((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    controller.abort();
    await expect(
      getVideoResolution("https://example.com/master.m3u8", {
        fetch: fetchMock,
        signal: controller.signal,
        timeout: 60_000,
      }),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("custom fetch routing", () => {
  test("not invoked for local file paths", async () => {
    const fetchMock = mock(() => {
      throw new Error("should not be called for local paths");
    });
    const result = await getVideoResolution(join(fixturesDir, "test.mp4"), {
      fetch: fetchMock,
    });
    expect(result.width).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("invoked for remote manifest URLs", async () => {
    const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360,CODECS="avc1.42c01e"
360p.m3u8`;
    const fetchMock = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    await getVideoResolution("https://example.com/master.m3u8", {
      fetch: fetchMock,
    });
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("error cause chain", () => {
  test("MediaParseError preserves cause when wrapping unrelated error", async () => {
    try {
      await getVideoResolution(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("source-stream-failure"));
          },
        }),
      );
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MediaParseError);
      const cause = (error as Error).cause;
      expect(cause).toBeInstanceOf(Error);
      expect((cause as Error).message).toBe("source-stream-failure");
    }
  });
});
