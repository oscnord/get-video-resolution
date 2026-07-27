import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFile } from "../src/parsers/file";
import type { VideoInfo } from "../src/types";

const fixturesDir = join(import.meta.dir, "fixtures");

const FILE_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".avi"];

const fileFixtures = readdirSync(fixturesDir).filter((name) =>
  FILE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)),
);

describe("sanity sweep across all file fixtures", () => {
  for (const name of fileFixtures) {
    test(`${name} produces a sane VideoInfo`, async () => {
      const info = await parseFile(join(fixturesDir, name), {});
      assertSane(info);
    });
  }
});

function assertSane(info: VideoInfo): void {
  expect(info.width).toBeGreaterThan(0);
  expect(info.height).toBeGreaterThan(0);

  // Every supported container in test/fixtures yields these four. Asserting them
  // unconditionally means a parser that stops emitting one fails here instead of
  // quietly skipping the check.
  expect(info.aspectRatio).toMatch(/^\d+:\d+$/);

  expect(info.framerate).toBeGreaterThan(0);
  expect(info.framerate).toBeLessThan(1000);

  expect(info.duration).toBeGreaterThanOrEqual(0);
  expect(info.duration as number).toBeLessThan(86400); // < 24h, generous

  expect(info.codec?.length).toBeGreaterThan(0);

  if (info.bitDepth !== undefined) {
    expect([8, 10, 12]).toContain(info.bitDepth);
  }

  if (info.rotation !== undefined) {
    expect([0, 90, 180, 270]).toContain(info.rotation);
  }

  if (info.audioTracks) {
    for (const track of info.audioTracks) {
      if (track.channels !== undefined) {
        expect(track.channels).toBeGreaterThan(0);
      }
    }
  }
}
