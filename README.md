# Get video resolution

[![CI](https://github.com/oscnord/get-video-resolution/actions/workflows/ci.yml/badge.svg)](https://github.com/oscnord/get-video-resolution/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@oscnord/get-video-resolution)](https://www.npmjs.com/package/@oscnord/get-video-resolution)

Get the resolution and metadata of a video. Supports local files (MP4, WebM, MKV, AVI), HLS streams, DASH manifests, and binary input (Buffer/Blob).

No ffmpeg required.

## Install

```bash
npm install @oscnord/get-video-resolution
```

## Usage

### Basic usage

```typescript
import { getVideoResolution } from "@oscnord/get-video-resolution";

// Local file
const info = await getVideoResolution("/path/to/video.mp4");
console.log(info.width, info.height); // 1920 1080

// HLS stream
const hls = await getVideoResolution("https://example.com/stream/master.m3u8");

// DASH manifest
const dash = await getVideoResolution("https://example.com/stream/manifest.mpd");
```

### VideoInfo return type

Every call returns a `VideoInfo` object with richer metadata beyond just width and height:

```typescript
const info = await getVideoResolution("/path/to/video.mp4");
// {
//   width: 1920,
//   height: 1080,
//   duration: 120.5,
//   codec: "avc1",
//   framerate: 29.97,
//   bitrate: undefined,       // available for HLS/DASH variants
//   aspectRatio: "16:9",
//   hdr: false,
//   colorSpace: undefined
// }
```

### Get all variants

For HLS/DASH sources, use `pick: "all"` to get every variant instead of just the highest:

```typescript
const variants = await getVideoResolution(
  "https://example.com/stream/master.m3u8",
  { pick: "all" },
);
// VideoInfo[] - sorted as they appear in the manifest
```

### Get lowest resolution

```typescript
const lowest = await getVideoResolution(
  "https://example.com/stream/master.m3u8",
  { pick: "lowest" },
);
```

### URL content-type sniffing

When a URL has no recognizable extension, enable `sniff` to send a HEAD request and detect the content type:

```typescript
const info = await getVideoResolution("https://cdn.example.com/video/12345", {
  sniff: true,
});
```

### Custom fetch with auth headers

Pass a custom `fetch` function for authenticated or proxied requests:

```typescript
const info = await getVideoResolution(
  "https://api.example.com/stream/master.m3u8",
  {
    fetch: (url, init) =>
      globalThis.fetch(url, {
        ...init,
        headers: { Authorization: "Bearer token" },
      }),
  },
);
```

### Timeout and AbortSignal

```typescript
// Timeout in milliseconds
const info = await getVideoResolution("https://example.com/video.mp4", {
  timeout: 5000,
});

// Or use an AbortSignal for manual cancellation
const controller = new AbortController();
const info = await getVideoResolution("https://example.com/video.mp4", {
  signal: controller.signal,
});
```

### Buffer input

Pass a `Buffer`, `Blob`, or `ReadableStream` directly:

```typescript
import { readFile } from "fs/promises";

const buffer = await readFile("/path/to/video.mp4");
const info = await getVideoResolution(buffer);
```

## API

### `getVideoResolution(source, options?)`

```typescript
function getVideoResolution(
  source: string | Buffer | Blob | ReadableStream,
  options?: GetVideoResolutionOptions & { pick: "all" },
): Promise<VideoInfo[]>;

function getVideoResolution(
  source: string | Buffer | Blob | ReadableStream,
  options?: GetVideoResolutionOptions,
): Promise<VideoInfo>;
```

When `pick` is `"all"`, returns `VideoInfo[]`. Otherwise returns a single `VideoInfo`.

### `VideoInfo`

```typescript
interface VideoInfo {
  width: number;
  height: number;
  duration?: number;      // seconds
  codec?: string;         // e.g. "avc1.640028", "hev1.1.6.L150"
  framerate?: number;     // frames per second
  bitrate?: number;       // bits per second (HLS/DASH only)
  aspectRatio?: string;   // e.g. "16:9", "4:3"
  hdr?: boolean;          // true for HDR codecs (HLG, HDR10, Dolby Vision)
  colorSpace?: string;
}
```

### `GetVideoResolutionOptions`

```typescript
interface GetVideoResolutionOptions {
  timeout?: number;                  // milliseconds
  signal?: AbortSignal;              // manual abort
  fetch?: typeof globalThis.fetch;   // custom fetch implementation
  pick?: "highest" | "lowest" | "all"; // variant selection (default: "highest")
  sniff?: boolean;                   // HEAD-request content-type detection
}
```

### Auto-detection

The input type is detected automatically by file extension:

| Extension | Parser |
| --------- | ------ |
| `.m3u8` | HLS -- returns the highest resolution variant |
| `.mpd` | DASH -- returns the highest resolution representation |
| Everything else | File parser via `@remotion/media-parser` |

When `sniff: true` and the URL has no recognized extension, a HEAD request detects the content type.

## Error handling

All errors extend `VideoResolutionError`, so you can catch them with `instanceof`:

```typescript
import {
  getVideoResolution,
  VideoResolutionError,
  NetworkError,
  ManifestParseError,
  UnsupportedSourceError,
  MediaParseError,
} from "@oscnord/get-video-resolution";

try {
  const info = await getVideoResolution(source);
} catch (error) {
  if (error instanceof NetworkError) {
    // fetch failed, timeout, etc.
  } else if (error instanceof ManifestParseError) {
    // invalid HLS/DASH manifest
  } else if (error instanceof UnsupportedSourceError) {
    // invalid source path or URL
  } else if (error instanceof MediaParseError) {
    // file parsing failed
  } else if (error instanceof VideoResolutionError) {
    // catch-all for any library error
  }
}
```

| Error class | When |
| --- | --- |
| `NetworkError` | HTTP request failed, timed out, or was aborted |
| `ManifestParseError` | HLS/DASH manifest could not be parsed or has no resolution |
| `UnsupportedSourceError` | Source string is not a valid path or URL |
| `MediaParseError` | File could not be parsed or has no video track |

## CommonJS

```javascript
const { getVideoResolution } = require("@oscnord/get-video-resolution");

const info = await getVideoResolution("/path/to/video.mp4");
```

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun test
bun run build
```

## License

MIT
