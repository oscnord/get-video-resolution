import { NetworkError } from "../errors";
import type { FetchOptions } from "./fetch";
import { buildSignal } from "./fetch";

/** Bytes taken from the start of a source to identify and parse its header. */
export const PROBE_SIZE = 1024 * 1024;

/**
 * Retained when a source cannot seek — a caller-supplied stream, or a server
 * that answers 200 to a ranged request. Enough for a header at the start plus a
 * tail scan, and far less than buffering an arbitrary source.
 */
const WINDOW_CAP = PROBE_SIZE * 2;

/**
 * Random-access view over a byte source, so the container-probing algorithm is
 * written once rather than once per source type.
 */
export interface RangeReader {
  /**
   * Total byte length, or undefined when unknown. Only meaningful after the
   * first `read()`: the HTTP backend learns the length from the probe response
   * instead of spending a round trip on HEAD.
   */
  size(): Promise<number | undefined>;
  /** Bytes `[start, start + length)`, truncated at EOF. */
  read(start: number, length: number): Promise<Uint8Array>;
  /** Releases any held handle. Only the disk backend needs one. */
  close?(): Promise<void>;
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= total) break;
    out.set(chunk.subarray(0, total - offset), offset);
    offset += chunk.length;
  }
  return out;
}

export function bufferReader(data: Uint8Array): RangeReader {
  return {
    size: async () => data.length,
    read: async (start, length) => data.subarray(start, start + length),
  };
}

export function blobReader(blob: Blob): RangeReader {
  return {
    size: async () => blob.size,
    // slice() is a lazy view: nothing is materialised until arrayBuffer().
    read: async (start, length) =>
      new Uint8Array(await blob.slice(start, start + length).arrayBuffer()),
  };
}

export async function diskReader(path: string): Promise<RangeReader> {
  const { open, stat } = await import("node:fs/promises");
  const [stats, handle] = await Promise.all([stat(path), open(path, "r")]);
  const total = stats.size;
  return {
    size: async () => total,
    read: async (start, length) => {
      const capped = Math.max(0, Math.min(length, total - start));
      const buffer = new Uint8Array(capped);
      const { bytesRead } = await handle.read(buffer, 0, capped, start);
      return buffer.subarray(0, bytesRead);
    },
    close: () => handle.close(),
  };
}

/**
 * Drains a body in one pass, keeping only the first `WINDOW_CAP` bytes and the
 * last `PROBE_SIZE`, and measuring the total length on the way through. The
 * middle is discarded, so memory stays bounded while a header at either end
 * remains reachable without a second request.
 */
async function windowedReaderFromStream(
  body: ReadableStream<Uint8Array>,
): Promise<RangeReader> {
  const stream = body.getReader();
  const headBuffer = new Uint8Array(WINDOW_CAP);
  let headFilled = 0;
  const tailChunks: Uint8Array[] = [];
  let tailBytes = 0;
  let total = 0;

  try {
    while (true) {
      const { done, value } = await stream.read();
      if (done) break;

      total += value.length;
      if (headFilled < WINDOW_CAP) {
        const take = Math.min(WINDOW_CAP - headFilled, value.length);
        headBuffer.set(value.subarray(0, take), headFilled);
        headFilled += take;
      }

      tailChunks.push(value);
      tailBytes += value.length;
      while (
        tailChunks.length > 1 &&
        tailBytes - tailChunks[0].length >= PROBE_SIZE
      ) {
        tailBytes -= tailChunks[0].length;
        tailChunks.shift();
      }
    }
  } finally {
    await stream.cancel().catch(() => undefined);
  }

  // slice(), not subarray(): a view would pin the whole WINDOW_CAP allocation
  // for the reader's lifetime even when the body was a few kilobytes.
  const head = headBuffer.slice(0, headFilled);
  const tail = concat(tailChunks, tailBytes);
  const tailStart = total - tailBytes;

  return {
    size: async () => total,
    read: async (start, length) => {
      if (start + length <= head.length) {
        return head.subarray(start, start + length);
      }
      if (start >= tailStart) {
        const from = start - tailStart;
        return tail.subarray(from, Math.min(tail.length, from + length));
      }
      // Spans the discarded middle; serve whatever the head still covers.
      return start < head.length ? head.subarray(start) : new Uint8Array(0);
    },
  };
}

export function httpReader(url: string, options: FetchOptions): RangeReader {
  const fetchFn = options.fetch ?? globalThis.fetch;
  let total: number | undefined;
  // Set once a server answers 200 to a ranged request, proving it will not seek.
  let unranged: RangeReader | undefined;

  return {
    size: async () => total,
    read: async (start, length) => {
      if (unranged) return await unranged.read(start, length);

      const { signal } = buildSignal(options);
      const response = await fetchFn(url, {
        signal,
        headers: { Range: `bytes=${start}-${start + length - 1}` },
      });
      if (!response.ok) {
        // NetworkError, matching what the manifest paths throw for a non-2xx, so
        // the error class does not depend on the source's file extension.
        throw new NetworkError(`Failed to fetch ${url}: ${response.status}`, {
          context: { source: url, status: response.status },
        });
      }

      if (response.status === 206) {
        const declared = response.headers
          .get("content-range")
          ?.match(/\/(\d+)\s*$/);
        if (declared) total = Number(declared[1]);
        return new Uint8Array(await response.arrayBuffer());
      }

      // 200 to a ranged request: the body is the whole file from offset 0.
      unranged = response.body
        ? await windowedReaderFromStream(response.body)
        : bufferReader(new Uint8Array(await response.arrayBuffer()));
      total = await unranged.size();
      return await unranged.read(start, length);
    },
  };
}

/**
 * A caller-supplied stream cannot seek, so it is drained once up to the window
 * cap and then cancelled, and the collected prefix is served as random access.
 */
export async function streamReader(
  stream: ReadableStream,
): Promise<RangeReader> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < WINDOW_CAP) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return bufferReader(concat(chunks, total));
}
