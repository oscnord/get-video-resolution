import { describe, expect, test } from "bun:test";
import {
  VideoResolutionError,
  NetworkError,
  ManifestParseError,
  UnsupportedSourceError,
  MediaParseError,
} from "../src/errors";

describe("Error classes", () => {
  test("VideoResolutionError extends Error", () => {
    const err = new VideoResolutionError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(VideoResolutionError);
    expect(err.message).toBe("test");
    expect(err.name).toBe("VideoResolutionError");
  });

  test("NetworkError extends VideoResolutionError", () => {
    const err = new NetworkError("fetch failed");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(VideoResolutionError);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.name).toBe("NetworkError");
  });

  test("ManifestParseError extends VideoResolutionError", () => {
    const err = new ManifestParseError("no resolution");
    expect(err).toBeInstanceOf(VideoResolutionError);
    expect(err.name).toBe("ManifestParseError");
  });

  test("UnsupportedSourceError extends VideoResolutionError", () => {
    const err = new UnsupportedSourceError("bad input");
    expect(err).toBeInstanceOf(VideoResolutionError);
    expect(err.name).toBe("UnsupportedSourceError");
  });

  test("MediaParseError extends VideoResolutionError and preserves cause", () => {
    const cause = new Error("original");
    const err = new MediaParseError("parse failed", { cause });
    expect(err).toBeInstanceOf(VideoResolutionError);
    expect(err.name).toBe("MediaParseError");
    expect(err.cause).toBe(cause);
  });
});
