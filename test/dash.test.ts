import { describe, expect, test } from "bun:test";
import { parseDash } from "../src/parsers/dash";
import { join } from "path";

const fixture = join(import.meta.dir, "fixtures", "manifest.mpd");

describe("DASH parser", () => {
  test("returns the highest resolution from an MPD manifest", async () => {
    const result = await parseDash(fixture);
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  test("throws on manifest with no representations", async () => {
    const empty = join(import.meta.dir, "fixtures", "empty.mpd");
    await Bun.write(
      empty,
      '<?xml version="1.0"?><MPD><Period><AdaptationSet/></Period></MPD>',
    );
    try {
      await expect(parseDash(empty)).rejects.toThrow(
        "No resolution found in DASH manifest",
      );
    } finally {
      const { unlinkSync } = await import("fs");
      unlinkSync(empty);
    }
  });
});
