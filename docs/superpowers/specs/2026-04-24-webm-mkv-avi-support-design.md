# Design: WebM, MKV, and AVI format support

## Context

v2.0.0 replaced `@remotion/media-parser` with a built-in MP4 parser, dropping WebM/MKV/AVI support. This design adds them back with two new built-in parsers, keeping the package at zero dependencies.

## Approach

Two new parser files following the same pattern as `src/parsers/mp4.ts`:

- `src/parsers/webm.ts` — EBML parser covering both WebM and MKV
- `src/parsers/avi.ts` — RIFF parser for AVI

Each exports a single function returning the same `{ width, height, duration?, codec?, framerate?, hdr }` shape. `file.ts` dispatches based on format detection.

## WebM/MKV Parser (`src/parsers/webm.ts`)

### EBML structure

Elements are `[variable-length ID][variable-length size][data]`. Variable-width integers (VINT): leading bits encode byte count (like UTF-8).

### Elements to parse

```
EBML (header — validate)
Segment
  ├─ Info
  │   ├─ TimestampScale (uint, default 1,000,000 ns)
  │   └─ Duration (float, in TimestampScale units)
  ├─ Tracks
  │   └─ TrackEntry (first with TrackType == 1)
  │       ├─ CodecID (string: "V_VP9", "V_AV1", "V_MPEG4/ISO/AVC", etc.)
  │       └─ Video
  │           ├─ PixelWidth (uint)
  │           ├─ PixelHeight (uint)
  │           └─ DefaultDuration (uint, nanoseconds per frame)
```

### Metadata extraction

| Field | Source | Calculation |
|-------|--------|-------------|
| Width/Height | `Video.PixelWidth`, `Video.PixelHeight` | Direct read |
| Duration | `Info.Duration` + `Info.TimestampScale` | `Duration * TimestampScale / 1e9` seconds |
| FPS | `Video.DefaultDuration` | `1e9 / DefaultDuration` |
| Codec | `TrackEntry.CodecID` | Map to standard strings (V_VP9 → vp09, V_AV1 → av01, V_MPEG4/ISO/AVC → avc1, V_MPEGH/ISO/HEVC → hvc1) |
| HDR | Codec string | `isHdrCodec()` on mapped codec |

### Implementation notes

- VINT reader: read leading byte, count leading 1-bits to get length, mask off length marker, read remaining bytes big-endian
- Element IDs are fixed constants from the Matroska spec
- Duration is IEEE 754 float (4 or 8 bytes) — use `DataView.getFloat32/getFloat64`
- Container elements (Segment, Info, Tracks, TrackEntry, Video) are recursed into; leaf elements are read directly
- Estimated ~200-250 lines

## AVI Parser (`src/parsers/avi.ts`)

### RIFF structure

Chunks are `[4-byte type ASCII][4-byte size LE][data]`. All integers are **little-endian**.

### Chunks to parse

```
RIFF (type = "AVI ")
  └─ hdrl
      ├─ avih (main header)
      │   ├─ dwMicroSecPerFrame (u32 LE, offset 0)
      │   ├─ dwWidth (u32 LE, offset 32)
      │   └─ dwHeight (u32 LE, offset 36)
      └─ strl (first video stream)
          ├─ strh (stream header)
          │   ├─ fccType ("vids" = video)
          │   ├─ fccHandler (codec fourcc)
          │   ├─ dwScale (u32 LE, offset 20)
          │   ├─ dwRate (u32 LE, offset 24)
          │   └─ dwLength (u32 LE, offset 28)
          └─ strf (BITMAPINFOHEADER)
              ├─ biWidth (u32 LE, offset 4)
              ├─ biHeight (u32 LE, offset 8)
              └─ biCompression (fourcc, offset 16)
```

### Metadata extraction

| Field | Source | Calculation |
|-------|--------|-------------|
| Width/Height | `strf.biWidth`, `strf.biHeight` (fallback: `avih`) | Direct read, `biHeight` may be negative (top-down), use absolute value |
| Duration | `strh.dwLength` + FPS | `dwLength / fps` seconds |
| FPS | `strh.dwRate / strh.dwScale` (fallback: `1e6 / avih.dwMicroSecPerFrame`) | Direct calculation |
| Codec | `strh.fccHandler` or `strf.biCompression` | Map common fourccs (H264→avc1, XVID→xvid, etc.), fall back to raw fourcc |
| HDR | N/A | Always `false` — AVI predates HDR |

### Implementation notes

- Little-endian reads throughout (opposite of MP4/EBML)
- RIFF lists (`hdrl`, `strl`, `movi`) have an extra 4-byte list type after the size
- Find the first `strl` where `strh.fccType == "vids"`
- Estimated ~150-200 lines

## Changes to `file.ts`

- Extend `detectFormat` return type: `"mp4" | "webm" | "avi" | "unknown"`
- AVI detection: bytes 0-3 = `RIFF` AND bytes 8-11 = `AVI `
- Dispatch to `parseWebM`/`parseAVI`/`parseMP4` based on format
- Update error messages

## Test fixtures

Generate with ffmpeg:
- `webm_vp9_720p.webm` — VP9 720p 30fps
- `mkv_h264_1080p.mkv` — H.264 in MKV container
- `avi_h264_480p.avi` — H.264 in AVI container

## README / package.json

- Update description to include WebM, MKV, AVI
- Update auto-detection table
- Remove "only MP4 and MOV" note
- Version bump: `2.1.0` (additive, non-breaking)

## Verification

```bash
bunx biome check --diagnostic-level=error .
bunx tsc --noEmit
bun test
bun run build
```
