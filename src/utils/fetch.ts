import { readFile } from "fs/promises";
import { NetworkError } from "../errors";

export interface FetchOptions {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeout?: number;
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

  let signal = options.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (!signal && options.timeout) {
    const controller = new AbortController();
    signal = controller.signal;
    timeoutId = setTimeout(() => controller.abort(), options.timeout);
  }

  try {
    const response = await fetchFn(url, { signal });

    if (!response.ok) {
      throw new NetworkError(
        `Failed to fetch ${url}: HTTP ${response.status}`,
      );
    }

    return await response.text();
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    throw new NetworkError(`Failed to fetch ${url}: ${(error as Error).message}`, {
      cause: error,
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
