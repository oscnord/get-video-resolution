# Changelog

## 2.2.2

### Features

- **Subtitle extraction for MP4 / WebM / MKV.** Previously HLS/DASH-only;
  callers now get `subtitleTracks` populated for file inputs as well.
- **Audio track extraction for AVI.** Reads each `auds` strl LIST and decodes
  the WAVEFORMATEX `formatTag` to a codec name plus channel count.
- **Magic-byte fallback for `sniff: true`.** When HEAD returns a generic
  `Content-Type` (octet-stream / text/plain / text/xml / empty), the library
  issues a `Range: bytes=0-2047` GET and inspects the first bytes for
  `#EXTM3U`, `<MPD`, or `<?xml` to detect HLS/DASH.
- **HEVC `bitDepth` now read from `hvcC`.** Previously a heuristic from
  `profileIdc`. Now reads `bit_depth_luma_minus8` per ISO/IEC 14496-15, with
  the heuristic kept as a fallback only when the box is truncated.
- **Structured error context.** `MediaParseError`, `ManifestParseError`, and
  `NetworkError` now carry an optional `context` property
  (`{ format?, source?, byteOffset?, status? }`) so callers can branch on the
  failing component without parsing message strings.

### Robustness

- **`pickVariants` is deterministic.** On equal area, the variant with higher
  bitrate wins (`pick: "highest"`) or lower bitrate wins (`pick: "lowest"`).
  Previously a strict `>` comparison let later variants win on tie.
- **README docs `subtitleTracks` for file inputs** and includes an explicit
  `ReadableStream` usage example.

### Tests

- 20 new tests across feature coverage (subtitle/audio extraction, HEVC bit
  depth, magic-byte sniff, deterministic tie-break) and gap coverage —
  pinning that every network code path honours `options.timeout`, that custom
  `fetch` is used for every request (HLS GET, file Range, sniff HEAD, magic
  Range probe), that built `dist/` bundles contain real code (a regression
  test against last release's silent Bun-bundler issue).

## 2.2.1

### Robustness

- Guard against integer overflow in MP4 64-bit box size / duration reads. Values
  past `Number.MAX_SAFE_INTEGER` now clamp instead of silently truncating.
- Reject WebM/Matroska EBML uint elements claiming more than 6 bytes (would
  overflow JS safe-integer range and yield garbage dimensions or durations).
- DASH `frameRate="N/0"` no longer produces `Infinity`. Returns `undefined` on
  any non-finite or non-positive denominator.
- `getAspectRatio` returns `undefined` for zero, negative, or non-finite
  dimensions instead of `"0:1"`.
- `parseColr` and `parseCodecInfo` validate that the visual sample entry is at
  least 86 bytes before reading children, preventing OOB reads on malformed MP4.
- File-format detection no longer caps its MP4 box scan at 64 bytes; iterates up
  to 16 boxes for early-stream metadata layouts.
- `ReadableStream` input is capped at 2 MB to prevent unbounded memory use; only
  the head and tail of large streams are needed for parsing.
- HLS/DASH manifest fetching enforces a 10 MB cap on response body size and
  honours `Content-Length` upfront, throwing `NetworkError` on oversize.
- Sniff (`sniff: true`) HEAD request now honours `options.timeout`. Previously
  the timeout was bypassed for the content-type probe.

### DX

- `Resolution`, `VideoInfo`, `AudioTrack`, `SubtitleTrack`,
  `GetVideoResolutionOptions`, and every error class now carry JSDoc that
  surfaces in IDE hover tooltips.
- `VideoInfo extends Resolution` so the previously-unused `Resolution` export
  is now part of the type chain.

### Refactor

- Extracted shared binary readers to `src/utils/binary.ts` (`readU16BE`,
  `readU32BE`, `readI32BE`, `readU64BE`, `readU32LE`, `readFourCC`).
- Replaced ad-hoc HLS attribute regex parsing with `src/parsers/hls-helpers.ts`
  (`iterateTagLines`, `parseAttrs`, `splitCodecs`, `parseResolution`,
  `parsePositiveInt`, `parsePositiveFloat`, `isAudioCodec`).
- Replaced DASH XML parsing with `src/parsers/dash-helpers.ts`
  (`iterateOpenTags`, `parseXmlAttrs`, `parseDashFrameRate`,
  `parseIso8601Duration`).
- Centralized language and codec selection in `src/utils/manifest.ts`.

### Tests

- Added 75 new tests covering helper units, regression scenarios, public API
  surface, multi-Period DASH, multi-codec HLS, sniff failure paths, error cause
  chains, and a property-style sanity sweep across all fixtures.

### Tooling

- Added `engines.node: ">=18"` to `package.json`.
- Build now emits source maps for both ESM and CJS bundles.
- TypeScript target lowered from `ESNext` to `ES2022` for wider downstream
  compatibility.
- New `typecheck` npm script.
- CI matrix added for Node 18 / 20 / 22 plus a smoke import of the built
  artifact.
