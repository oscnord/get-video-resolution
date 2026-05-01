import { NetworkError } from "../errors";

export interface FetchOptions {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeout?: number;
}

// Hard cap on manifest body size to protect against pathological/hostile servers.
// 10 MB comfortably exceeds any real-world HLS or DASH manifest.
const MANIFEST_SIZE_CAP = 10 * 1024 * 1024;

export function buildSignal(options: FetchOptions): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
} {
  if (options.signal) return { signal: options.signal, cleanup: () => {} };
  if (!options.timeout) return { signal: undefined, cleanup: () => {} };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout);
  return { signal: controller.signal, cleanup: () => clearTimeout(timeoutId) };
}

export async function loadManifest(
  source: string,
  options: FetchOptions,
): Promise<string> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return fetchRemote(source, options);
  }
  const { readFile } = await import("node:fs/promises");
  return readFile(source, "utf-8");
}

async function fetchRemote(
  url: string,
  options: FetchOptions,
): Promise<string> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const { signal, cleanup } = buildSignal(options);

  try {
    const response = await fetchFn(url, { signal });

    if (!response.ok) {
      throw new NetworkError(`Failed to fetch ${url}: HTTP ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const declared = Number(contentLength);
      if (Number.isFinite(declared) && declared > MANIFEST_SIZE_CAP) {
        throw new NetworkError(
          `Manifest at ${url} exceeds ${MANIFEST_SIZE_CAP} bytes (got ${declared})`,
        );
      }
    }

    return await readBodyCapped(response, url);
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    throw new NetworkError(
      `Failed to fetch ${url}: ${(error as Error).message}`,
      {
        cause: error,
      },
    );
  } finally {
    cleanup();
  }
}

async function readBodyCapped(
  response: Response,
  url: string,
): Promise<string> {
  if (!response.body) return await response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MANIFEST_SIZE_CAP) {
        throw new NetworkError(
          `Manifest at ${url} exceeds ${MANIFEST_SIZE_CAP} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder("utf-8").decode(buf);
}
