import { describe, expect, test } from "bun:test";
import { getVideoResolution } from "../src/resolver";
import { UnsupportedSourceError } from "../src/errors";

describe("Input validation", () => {
  test("throws UnsupportedSourceError for invalid string input", async () => {
    await expect(getVideoResolution("not-a-path")).rejects.toBeInstanceOf(
      UnsupportedSourceError,
    );
  });

  test("throws UnsupportedSourceError for empty string", async () => {
    await expect(getVideoResolution("")).rejects.toBeInstanceOf(
      UnsupportedSourceError,
    );
  });

  test("accepts absolute paths", async () => {
    await expect(
      getVideoResolution("/nonexistent/video.mp4"),
    ).rejects.not.toBeInstanceOf(UnsupportedSourceError);
  });

  test("accepts relative paths starting with ./", async () => {
    await expect(
      getVideoResolution("./nonexistent/video.mp4"),
    ).rejects.not.toBeInstanceOf(UnsupportedSourceError);
  });

  test("accepts http URLs", async () => {
    await expect(
      getVideoResolution("http://example.com/video.mp4"),
    ).rejects.not.toBeInstanceOf(UnsupportedSourceError);
  });

  test("accepts https URLs", async () => {
    await expect(
      getVideoResolution("https://example.com/video.mp4"),
    ).rejects.not.toBeInstanceOf(UnsupportedSourceError);
  });

  test("accepts Buffer input", async () => {
    const buf = Buffer.from("not a video");
    await expect(getVideoResolution(buf as any)).rejects.not.toBeInstanceOf(
      UnsupportedSourceError,
    );
  });
});
