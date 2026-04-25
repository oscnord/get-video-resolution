import { readFile } from "node:fs/promises";
import { NetworkError } from "../errors";

export interface FetchOptions {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeout?: number;
}

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

    return await response.text();
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
