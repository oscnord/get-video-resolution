import { describe, expect, test } from "bun:test";
import { parseHls } from "../src/parsers/hls";
import { join } from "path";

const fixturesDir = join(import.meta.dir, "fixtures");

describe("HLS parser", () => {
  test("returns the highest resolution from a manifest", async () => {
    const result = await parseHls(join(fixturesDir, "master.m3u8"));
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  test("throws on empty manifest", async () => {
    await expect(parseHls(join(fixturesDir, "empty.m3u8"))).rejects.toThrow(
      "No RESOLUTION found",
    );
  });
});
