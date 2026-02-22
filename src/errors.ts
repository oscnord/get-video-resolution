export class VideoResolutionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VideoResolutionError";
  }
}

export class NetworkError extends VideoResolutionError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkError";
  }
}

export class ManifestParseError extends VideoResolutionError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ManifestParseError";
  }
}

export class UnsupportedSourceError extends VideoResolutionError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UnsupportedSourceError";
  }
}

export class MediaParseError extends VideoResolutionError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaParseError";
  }
}
