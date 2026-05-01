/**
 * Width/height pair. Re-exported for callers that want to type a resolution
 * tuple without pulling the full `VideoInfo`.
 */
export interface Resolution {
  width: number;
  height: number;
}

/**
 * Metadata returned by `getVideoResolution`. All fields except `width` and
 * `height` are optional — they're populated when the source carries the
 * relevant information.
 */
export interface VideoInfo extends Resolution {
  /** Duration in seconds. */
  duration?: number;
  /** RFC 6381 codec string, e.g. `"avc1.640028"`, `"hvc1.1.6.L150.B0"`. */
  codec?: string;
  /** Frames per second. */
  framerate?: number;
  /** Bits per second. Populated for HLS/DASH variants only. */
  bitrate?: number;
  /** Reduced aspect ratio string, e.g. `"16:9"`. */
  aspectRatio?: string;
  /** True for HDR codecs (HLG, HDR10, Dolby Vision). */
  hdr?: boolean;
  /** Display rotation in degrees: 0, 90, 180, 270. */
  rotation?: number;
  /** Color depth: 8, 10, or 12. Best-effort for HEVC. */
  bitDepth?: number;
  /** True when DRM/encryption is detected (HLS/DASH only). */
  encrypted?: boolean;
  /** Audio tracks discovered in the source. */
  audioTracks?: AudioTrack[];
  /** Subtitle tracks discovered in the source. */
  subtitleTracks?: SubtitleTrack[];
}

/** Internal shape returned by file parsers, used to compose `VideoInfo`. */
export interface ParsedMetadata {
  width: number;
  height: number;
  duration?: number;
  codec?: string;
  framerate?: number;
  hdr: boolean;
  rotation?: number;
  bitDepth?: number;
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
}

/** A single audio track. */
export interface AudioTrack {
  /** Codec string, e.g. `"mp4a.40.2"`, `"opus"`, `"ac-3"`. */
  codec?: string;
  /** ISO 639 language code, e.g. `"en"`, `"sv"`. `"und"` is normalized away. */
  language?: string;
  /** Channel count, e.g. 2 (stereo), 6 (5.1). */
  channels?: number;
}

/** A single subtitle track (HLS/DASH manifests only). */
export interface SubtitleTrack {
  /** ISO 639 language code. */
  language?: string;
  /** Codec string, e.g. `"wvtt"` (WebVTT), `"stpp"` (TTML/IMSC). */
  codec?: string;
}

/** Options accepted by `getVideoResolution`. */
export interface GetVideoResolutionOptions {
  /**
   * Abort all network requests after this many milliseconds. Ignored when
   * `signal` is provided (the caller's signal takes precedence).
   */
  timeout?: number;
  /**
   * AbortSignal for manual cancellation. Aborts every network request issued
   * during this call (probe, tail Range, sniff HEAD, manifest GET).
   */
  signal?: AbortSignal;
  /**
   * Replacement `fetch` implementation, e.g. for adding auth headers or
   * routing through a proxy. Used for every network request the library makes.
   */
  fetch?: typeof globalThis.fetch;
  /**
   * For HLS/DASH manifests with multiple variants:
   * - `"highest"` (default) returns the highest-resolution variant.
   * - `"lowest"` returns the lowest-resolution variant.
   * - `"all"` returns every variant as `VideoInfo[]`.
   */
  pick?: "highest" | "lowest" | "all";
  /**
   * When the URL has no recognizable extension, send a HEAD request and use
   * `Content-Type` to detect HLS/DASH/file. Off by default.
   */
  sniff?: boolean;
}
