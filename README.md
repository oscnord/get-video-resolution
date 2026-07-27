# Get video resolution

[![CI](https://github.com/oscnord/get-video-resolution/actions/workflows/ci.yml/badge.svg)](https://github.com/oscnord/get-video-resolution/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@oscnord/get-video-resolution)](https://www.npmjs.com/package/@oscnord/get-video-resolution)

Get resolution, codec, audio tracks, subtitles, bit depth, rotation, and more from any video source. Supports local files (MP4, MOV, WebM, MKV, AVI), HLS streams, DASH manifests, and binary input (Buffer/Blob).

Zero dependencies. No ffmpeg required. Browser-compatible for URL/Blob sources (see [Where it runs](#where-it-runs)).

Reads only the header regions it needs, never the whole file: about 1 MB from the start, plus a small tail read when an MP4 stores its `moov` at the end. That holds identically for a URL, a local path, a `Buffer`, a `Blob`/`File` and a `ReadableStream`, so a 1.5 GB source costs the same as a 4 MB one.

Two bounded exceptions: a server that ignores `Range` has its body streamed through once, so memory stays bounded but the bandwidth cannot be reclaimed; and a container whose format cannot be identified from the first 1 MB is read in full, up to a 64 MB ceiling, before giving up.

**[Try it in your browser →](https://www.oscarnord.com/get-video-resolution/)** Drop a video file or paste a stream URL and read the parsed `VideoInfo`, no install required.

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

Every call returns a `VideoInfo` object:

```typescript
const info = await getVideoResolution("/path/to/video.mp4");
// {
//   width: 1920,
//   height: 1080,
//   duration: 120.5,
//   codec: "avc1.640028",
//   framerate: 29.97,
//   bitrate: undefined,       // available for HLS/DASH variants
//   aspectRatio: "16:9",
//   hdr: false,
//   rotation: 0,              // degrees (0, 90, 180, 270)
//   bitDepth: 8,              // 8, 10, or 12
//   encrypted: undefined,     // true when DRM detected (HLS/DASH)
//   audioTracks: [
//     { codec: "mp4a.40.2", language: "en", channels: 2 }
//   ],
//   subtitleTracks: undefined  // populated when present (MP4/WebM/MKV/HLS/DASH)
// }
```

### HLS/DASH variant metadata

For streaming sources, each variant includes manifest-level metadata:

```typescript
const variants = await getVideoResolution(
  "https://example.com/stream/master.m3u8",
  { pick: "all" },
);

// Each variant includes:
// - audioTracks: available audio languages and codecs
// - subtitleTracks: available subtitle languages
// - encrypted: true if DRM detected
console.log(variants[0].audioTracks);
// [{ codec: "mp4a.40.2", language: "en", channels: 2 },
//  { codec: "mp4a.40.2", language: "sv", channels: 2 }]
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

### Buffer / Blob / ReadableStream input

Pass binary data directly:

```typescript
import { readFile } from "node:fs/promises";

// Buffer
const buffer = await readFile("/path/to/video.mp4");
const info = await getVideoResolution(buffer);

// Blob (browser, or Node's File API)
const blob = new Blob([buffer], { type: "video/mp4" });
const fromBlob = await getVideoResolution(blob);

// ReadableStream — e.g. from a fetch response or Node fs stream.
// The library reads only the head/tail it needs (capped at 2 MB) and
// cancels the rest, so streaming a multi-GB file is safe.
const res = await fetch("https://example.com/big-video.mp4");
const fromStream = await getVideoResolution(res.body!);
```

## Where it runs

Anywhere with `fetch` — Node 18+, modern browsers, edge runtimes (Vercel Edge, Cloudflare Workers), Bun, Deno.

| Source | Node | Browser | Edge |
| --- | --- | --- | --- |
| Local path (`/path/to/video.mp4`) | ✅ | ❌ | ❌ |
| `http(s)://` URL | ✅ | ✅ | ✅ |
| `Buffer` / `Blob` / `ReadableStream` | ✅ | ✅ | ✅ |

In Next.js App Router, call it from a server component so the fetch happens server-side:

```tsx
// app/video/[id]/page.tsx
import { getVideoResolution } from "@oscnord/get-video-resolution";

export default async function Page({ params }: { params: { id: string } }) {
  const info = await getVideoResolution(`https://cdn.example.com/${params.id}.mp4`);
  return <p>{info.width}×{info.height}</p>;
}
```

## Recipes

### Display dimensions for rotated mobile video

The library reports the *coded* `width`/`height` plus a separate `rotation`. A portrait iPhone clip stores `1920×1080` with `rotation: 90`. To get the dimensions you'll actually render:

```typescript
const info = await getVideoResolution(source);
const isSideways = info.rotation === 90 || info.rotation === 270;
const displayWidth = isSideways ? info.height : info.width;
const displayHeight = isSideways ? info.width : info.height;
```

### Detecting DRM-protected streams before playback

HLS/DASH variants populate `encrypted: true` when the manifest carries `#EXT-X-KEY` or `<ContentProtection>`. The library can read the manifest but can't decrypt segments — branch early:

```typescript
const info = await getVideoResolution("https://example.com/master.m3u8");
if (info.encrypted) {
  // Hand off to a DRM-aware player (Shaka, hls.js with EME). Don't try
  // to download or transcode the segments yourself.
}
```

### Sources where `duration` is missing

Some MP4s (fragmented, malformed, mid-write) and live HLS/DASH playlists return a `VideoInfo` without `duration`. Treat it as unknown rather than zero:

```typescript
const info = await getVideoResolution(source);
const knownDuration = info.duration ?? null;
if (knownDuration === null) {
  // For HLS this often means a live playlist; for MP4, the moov box
  // didn't carry an mvhd duration. Decide whether to reject the upload,
  // probe with a player, or accept without a duration display.
}
```

## API

### `getVideoResolution(source, options?)`

```typescript
function getVideoResolution(
  source: string | Buffer | Blob | ReadableStream,
  options: GetVideoResolutionOptions & { pick: "all" },
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
  aspectRatio?: string;   // display AR, e.g. "16:9", "4:3"
  hdr?: boolean;          // HLG, HDR10, or Dolby Vision (needs an explicit signal)
  rotation?: number;      // degrees (0, 90, 180, 270)
  bitDepth?: number;      // 8, 10, or 12
  encrypted?: boolean;    // DRM detected (HLS/DASH only)
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
}

interface AudioTrack {
  codec?: string;      // e.g. "mp4a.40.2", "opus", "ac-3"
  language?: string;   // e.g. "en", "sv"
  channels?: number;   // e.g. 2, 6
}

interface SubtitleTrack {
  language?: string;   // e.g. "en", "sv"
  codec?: string;      // e.g. "wvtt", "stpp"
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
| `.m3u8` | HLS manifest parser |
| `.mpd` | DASH manifest parser |
| Everything else | Built-in file parser (MP4, MOV, WebM, MKV, AVI) |

When `sniff: true` and the URL has no recognized extension, a HEAD request inspects the `Content-Type`:

- `application/vnd.apple.mpegurl` / `audio/mpegurl` → HLS
- `application/dash+xml` → DASH
- A generic type (`application/octet-stream`, `text/plain`, `text/xml`, or empty) triggers a small `Range: bytes=0-2047` GET that inspects the first bytes for `#EXTM3U`, `<MPD`, or `<?xml` before falling back to the file parser.

## Limitations

Deliberate scope boundaries, not bugs:

- **`width` / `height` are coded dimensions.** `aspectRatio` is the *display* aspect ratio: MP4 `pasp`, Matroska `DisplayWidth`/`DisplayHeight`, and DASH `sar`/`par` are all applied, so 1440×1080 anamorphic reports `1440`, `1080`, and `"16:9"`. It is not adjusted for `rotation` — see [Display dimensions for rotated mobile video](#display-dimensions-for-rotated-mobile-video).
- **`hdr` requires an explicit signal.** MP4 `colr`, HLS `VIDEO-RANGE`, and the DASH CICP `TransferCharacteristics` descriptor are trusted; Dolby Vision codec strings (`dvhe.`/`dvh1.`) count on their own. A 10-bit profile alone (HEVC Main 10, AV1 High, VP9 profile 2) is **not** treated as HDR, because plenty of SDR content ships that way. An unsignalled HDR stream therefore reports `hdr: false`.
- **`framerate` is an average, not an instantaneous rate.** For MP4 it is the mean over every `stts` entry (total samples ÷ total duration), which is exact for CFR and an average for VFR. WebM/MKV uses `DefaultDuration`; AVI uses `dwRate`/`dwScale`. All are rounded to 3 decimals.
- **Only the first sample entry in an `stsd` box is read.** Tracks that change codec or dimensions mid-stream (multi-entry `stsd`) report the first entry only. This is rare outside of legacy QuickTime edits.
- **The first video track wins.** Files with multiple video tracks (e.g. a thumbnail track) report the first one tagged with the `vide` handler.
- **Only the first DASH `<Period>` is read.** Multi-period manifests (ad insertion, spliced content) report the first period's representations.
- **HLS audio renditions are deduplicated by language and channel count.** A language offered at several bitrates collapses to one entry; a 5.1 mix stays separate from the stereo one.
- **Only headers are read.** Metadata comes from the container. Bitstream-level details (SPS/VUI, per-frame HDR metadata) are never parsed, so a 1 MB probe is all that is fetched.

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
  type AudioTrack,
  type SubtitleTrack,
  type VideoInfo,
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
| `NetworkError` | HTTP request failed, timed out, or was aborted. Covers a non-2xx response for any source, a file URL as much as a manifest |
| `ManifestParseError` | HLS/DASH manifest could not be parsed or has no resolution |
| `UnsupportedSourceError` | Source string is not a valid path or URL |
| `MediaParseError` | File could not be parsed or has no video track |

#### Structured error context

Every error carries an optional `context` object so you can branch without parsing message strings:

```typescript
try {
  await getVideoResolution(source);
} catch (error) {
  if (error instanceof MediaParseError && error.context?.format === "mp4") {
    // we know the file detected as MP4 but parsing failed
  }
  if (error instanceof NetworkError && error.context?.status === 404) {
    // ...
  }
}
```

```typescript
interface VideoResolutionErrorContext {
  source?: string;       // URL or path being processed
  format?: string;       // "mp4" | "webm" | "avi" | "hls" | "dash"
  byteOffset?: number;   // file offset, for parser errors
  status?: number;       // HTTP status, for network errors
  reason?:               // machine-readable cause, so you never match on message text
    | "no-moov"
    | "no-video-track"
    | "no-sample-description"
    | "no-dimensions"
    | "unrecognized-format";
}
```

`reason` is the field to branch on. `"no-moov"` in particular means the header lives elsewhere in the file rather than being unusable, which is how the library itself decides whether re-reading could help:

```typescript
try {
  await getVideoResolution(source);
} catch (error) {
  if (error instanceof MediaParseError && error.context?.reason === "no-video-track") {
    // A valid container that carries only audio.
  }
}
```

Errors thrown from the file parser also preserve the underlying cause via `error.cause` when wrapping a non-`VideoResolutionError`.

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
