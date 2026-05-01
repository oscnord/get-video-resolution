import {
  ManifestParseError,
  MediaParseError,
  NetworkError,
  UnsupportedSourceError,
  VideoResolutionError,
} from "./errors";
import { getVideoResolution } from "./resolver";

export type {
  AudioTrack,
  GetVideoResolutionOptions,
  Resolution,
  SubtitleTrack,
  VideoInfo,
} from "./types";
export {
  getVideoResolution,
  ManifestParseError,
  MediaParseError,
  NetworkError,
  UnsupportedSourceError,
  VideoResolutionError,
};
