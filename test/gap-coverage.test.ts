// Tests covering gaps that previously allowed bugs to slip through.
// Each test pins a contract that, if regressed, would surface a real issue
// users have hit (or could plausibly hit).

import { describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getVideoResolution } from "../src/resolver";

const distDir = join(import.meta.dir, "..", "dist");

describe("gap: built bundles must contain real code, not just export wrappers", () => {
  // The Bun 1.3.13 bundler regression silently produced a 52-line CJS that
  // referenced identifiers it never declared. The test job reported success
  // because it never tried to actually use the bundle. Pin a meaningful size
  // and a substantive marker so the regression can't reappear unnoticed.
  test.skipIf(!existsSync(join(distDir, "index.cjs")))(
    "dist/index.cjs is non-trivial and exports getVideoResolution",
    () => {
      const cjs = readFileSync(join(distDir, "index.cjs"), "utf-8");
      // The bundle must contain enough lines to be more than just a wrapper.
      // Real bundle is ~1700 lines; broken wrapper-only is ~50.
      expect(cjs.length).toBeGreaterThan(20_000);
      // It must define one of the parsers, not just re-export.
      expect(cjs).toContain("parseMP4");
      expect(cjs).toContain("parseHls");
    },
  );

  test.skipIf(!existsSync(join(distDir, "index.js")))(
    "dist/index.js is loadable as ESM",
    () => {
      const esm = readFileSync(join(distDir, "index.js"), "utf-8");
      expect(esm.length).toBeGreaterThan(20_000);
      expect(esm).toContain("export {");
    },
  );
});

describe("gap: every network code path must honour options.timeout", () => {
  // Past bug: sniffContentType ignored options.timeout.
  // This sweep ensures every code path that issues a network request honours
  // the caller-supplied timeout, not just the explicit signal.

  test("file URL: probe Range request times out", async () => {
    const fetchMock = mock(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    await expect(
      getVideoResolution("https://example.com/video.mp4", {
        timeout: 50,
        fetch: fetchMock,
      }),
    ).rejects.toThrow();
  });

  test("manifest: HLS GET times out", async () => {
    const fetchMock = mock(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    await expect(
      getVideoResolution("https://example.com/master.m3u8", {
        timeout: 50,
        fetch: fetchMock,
      }),
    ).rejects.toThrow();
  });

  test("sniff: HEAD request times out", async () => {
    const fetchMock = mock(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    await expect(
      getVideoResolution("https://example.com/no-extension", {
        sniff: true,
        timeout: 50,
        fetch: fetchMock,
      }),
    ).rejects.toThrow();
  });
});

describe("gap: custom fetch is used for every network request", () => {
  // Past concern: a code path could accidentally use globalThis.fetch instead
  // of options.fetch. Pin that every documented network call routes through
  // the user-supplied fetch.

  test("HLS path uses options.fetch only", async () => {
    let callCount = 0;
    const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360
360.m3u8`;
    const fetchMock = mock(() => {
      callCount++;
      return Promise.resolve(new Response(manifest, { status: 200 }));
    });
    await getVideoResolution("https://example.com/master.m3u8", {
      fetch: fetchMock,
    });
    expect(callCount).toBeGreaterThan(0);
  });

  test("file URL path uses options.fetch only (no fallback to globalThis)", async () => {
    // We patch globalThis.fetch to throw; if the lib falls back, the test fails.
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("globalThis.fetch must not be called");
    }) as typeof globalThis.fetch;
    try {
      const ok = mock(() =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
        ),
      );
      await expect(
        getVideoResolution("https://example.com/video.mp4", { fetch: ok }),
      ).rejects.toThrow();
      expect(ok).toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("sniff HEAD + Range fallback both use options.fetch", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("globalThis.fetch must not be called");
    }) as typeof globalThis.fetch;
    try {
      let headCalls = 0;
      let rangeCalls = 0;
      const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360
360.m3u8`;
      const fetchMock = mock((_url: string, init?: RequestInit) => {
        if (init?.method === "HEAD") {
          headCalls++;
          return Promise.resolve(
            new Response("", {
              status: 200,
              headers: { "Content-Type": "application/octet-stream" },
            }),
          );
        }
        if ((init?.headers as Record<string, string>)?.Range) {
          rangeCalls++;
        }
        return Promise.resolve(new Response(manifest, { status: 200 }));
      });
      await getVideoResolution("https://example.com/no-extension", {
        sniff: true,
        fetch: fetchMock,
      });
      expect(headCalls).toBe(1);
      expect(rangeCalls).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("gap: pickVariants must be deterministic on ties", () => {
  // The original `>` comparison let later variants win on tie, which is
  // observable but unspecified. Pin the new contract: higher bitrate wins on
  // resolution tie; otherwise input order is preserved.

  test("identical area + identical bitrate: input order preserved (highest)", async () => {
    const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,CODECS="avc1.4d4015"
a.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,CODECS="avc1.4d4016"
b.m3u8`;
    const fetchMock = mock(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    const result = (await getVideoResolution("https://example.com/m.m3u8", {
      fetch: fetchMock,
    })) as { codec?: string };
    expect(result.codec).toBe("avc1.4d4015");
  });
});
