import { describe, expect, test } from "bun:test";
import { parseHls } from "../src/parsers/hls";
import { join } from "path";

const fixture = join(import.meta.dir, "fixtures", "master.m3u8");

describe("HLS parser", () => {
  test("returns the highest resolution from a manifest", async () => {
    const result = await parseHls(fixture);
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  test("throws on empty manifest", async () => {
    const empty = join(import.meta.dir, "fixtures", "empty.m3u8");
    await Bun.write(empty, "#EXTM3U\n");
    try {
      await expect(parseHls(empty)).rejects.toThrow("No RESOLUTION found");
    } finally {
      const { unlinkSync } = await import("fs");
      unlinkSync(empty);
    }
  });
});
