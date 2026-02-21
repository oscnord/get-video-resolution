import { describe, expect, test } from "bun:test";
import { parseDash } from "../src/parsers/dash";
import { join } from "path";

const fixturesDir = join(import.meta.dir, "fixtures");

describe("DASH parser", () => {
  test("returns the highest resolution from an MPD manifest", async () => {
    const result = await parseDash(join(fixturesDir, "manifest.mpd"));
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  test("throws on manifest with no representations", async () => {
    await expect(
      parseDash(join(fixturesDir, "empty.mpd")),
    ).rejects.toThrow("No resolution found in DASH manifest");
  });
});
