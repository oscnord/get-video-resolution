import { describe, expect, test } from "bun:test";
import { parseFile } from "../src/parsers/file";
import { join } from "path";

const fixture = join(import.meta.dir, "fixtures", "test.mp4");

describe("File parser", () => {
  test("returns resolution from a local MP4 file", async () => {
    const result = await parseFile(fixture);
    expect(result).toEqual({ width: 320, height: 240 });
  });
});
