/**
 * Optional context attached to library errors. Helps callers branch on the
 * failing component (HLS vs MP4 vs WebM) without parsing the message string.
 */
export interface VideoResolutionErrorContext {
  /** The source URL or path being processed when the error occurred. */
  source?: string;
  /** Detected/assumed format: "mp4", "webm", "avi", "hls", "dash". */
  format?: string;
  /** Byte offset into the source when a parser ran into trouble. */
  byteOffset?: number;
  /** HTTP status when the error came from a network request. */
  status?: number;
}

/**
 * Base class for every error this library throws. Catch this to handle any
 * failure from `getVideoResolution`, or use one of the subclasses for finer
 * categorization.
 */
export class VideoResolutionError extends Error {
  /** Structured context, when the throw site supplied any. */
  readonly context?: VideoResolutionErrorContext;

  constructor(
    message: string,
    options?: ErrorOptions & { context?: VideoResolutionErrorContext },
  ) {
    super(message, options);
    this.name = "VideoResolutionError";
    this.context = options?.context;
  }
}

/**
 * Thrown when an HTTP request fails — non-2xx response, timeout, abort, or a
 * cap exceeded (e.g. manifest body larger than the size limit).
 */
export class NetworkError extends VideoResolutionError {
  constructor(
    message: string,
    options?: ErrorOptions & { context?: VideoResolutionErrorContext },
  ) {
    super(message, options);
    this.name = "NetworkError";
  }
}

/**
 * Thrown when an HLS or DASH manifest cannot be parsed or contains no usable
 * video resolution.
 */
export class ManifestParseError extends VideoResolutionError {
  constructor(
    message: string,
    options?: ErrorOptions & { context?: VideoResolutionErrorContext },
  ) {
    super(message, options);
    this.name = "ManifestParseError";
  }
}

/**
 * Thrown when the `source` argument is not a recognized path or URL.
 */
export class UnsupportedSourceError extends VideoResolutionError {
  constructor(
    message: string,
    options?: ErrorOptions & { context?: VideoResolutionErrorContext },
  ) {
    super(message, options);
    this.name = "UnsupportedSourceError";
  }
}

/**
 * Thrown when a media file cannot be parsed — unrecognized format, truncated
 * data, or no video track present. The original cause (where applicable) is
 * available via `error.cause`.
 */
export class MediaParseError extends VideoResolutionError {
  constructor(
    message: string,
    options?: ErrorOptions & { context?: VideoResolutionErrorContext },
  ) {
    super(message, options);
    this.name = "MediaParseError";
  }
}
