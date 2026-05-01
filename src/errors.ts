/**
 * Base class for every error this library throws. Catch this to handle any
 * failure from `getVideoResolution`, or use one of the subclasses for finer
 * categorization.
 */
export class VideoResolutionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VideoResolutionError";
  }
}

/**
 * Thrown when an HTTP request fails — non-2xx response, timeout, abort, or a
 * cap exceeded (e.g. manifest body larger than the size limit).
 */
export class NetworkError extends VideoResolutionError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkError";
  }
}

/**
 * Thrown when an HLS or DASH manifest cannot be parsed or contains no usable
 * video resolution.
 */
export class ManifestParseError extends VideoResolutionError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ManifestParseError";
  }
}

/**
 * Thrown when the `source` argument is not a recognized path or URL.
 */
export class UnsupportedSourceError extends VideoResolutionError {
  constructor(message: string, options?: ErrorOptions) {
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
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaParseError";
  }
}
