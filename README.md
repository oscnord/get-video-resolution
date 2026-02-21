# Get video resolution

Get the dimensions (width and height) of a video. Supports local files (MP4, WebM, MKV, AVI), HLS streams, and DASH manifests.

No ffmpeg required.

## Install

```bash
npm install @oscnord/get-video-resolution
```

## Usage

```typescript
import { getVideoResolution } from "@oscnord/get-video-resolution";

// Local file
const res = await getVideoResolution("/path/to/video.mp4");
console.log(res); // { width: 1920, height: 1080 }

// HLS stream
const hls = await getVideoResolution("https://example.com/stream/master.m3u8");

// DASH manifest
const dash = await getVideoResolution("https://example.com/stream/manifest.mpd");
```

The input type is detected automatically by file extension:

| Extension | Parser |
| --------- | ------ |
| `.m3u8` | HLS — returns the highest resolution variant |
| `.mpd` | DASH — returns the highest resolution representation |
| Everything else | File parser via `@remotion/media-parser` |

## API

### `getVideoResolution(source: string): Promise<Resolution>`

Returns the resolution of a video from a local file path or URL.

```typescript
interface Resolution {
  width: number;
  height: number;
}
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
