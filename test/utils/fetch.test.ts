import { describe, expect, test, mock } from "bun:test";
import { loadManifest } from "../../src/utils/fetch";
import { join } from "path";
import { NetworkError } from "../../src/errors";

const fixturesDir = join(import.meta.dir, "..", "fixtures");

describe("loadManifest", () => {
  test("reads a local file", async () => {
    const content = await loadManifest(join(fixturesDir, "master.m3u8"), {});
    expect(content).toContain("#EXTM3U");
  });

  test("fetches a remote URL", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response("remote content", { status: 200 })),
    );
    const content = await loadManifest("https://example.com/test.m3u8", {
      fetch: mockFetch,
    });
    expect(content).toBe("remote content");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("throws NetworkError on non-ok response", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response("", { status: 404 })),
    );
    await expect(
      loadManifest("https://example.com/test.m3u8", { fetch: mockFetch }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  test("throws NetworkError on fetch rejection", async () => {
    const mockFetch = mock(() => Promise.reject(new Error("network down")));
    await expect(
      loadManifest("https://example.com/test.m3u8", { fetch: mockFetch }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  test("passes signal to fetch", async () => {
    const controller = new AbortController();
    const mockFetch = mock(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );
    await loadManifest("https://example.com/test.m3u8", {
      fetch: mockFetch,
      signal: controller.signal,
    });
    expect(mockFetch).toHaveBeenCalledWith("https://example.com/test.m3u8", {
      signal: controller.signal,
    });
  });

  test("creates timeout signal when timeout is set", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );
    await loadManifest("https://example.com/test.m3u8", {
      fetch: mockFetch,
      timeout: 5000,
    });
    const call = mockFetch.mock.calls[0];
    expect(call[1]).toHaveProperty("signal");
  });
});
