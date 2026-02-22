import { describe, expect, test } from "bun:test";
import { getAspectRatio } from "../../src/utils/aspect-ratio";

describe("getAspectRatio", () => {
  test("1920x1080 -> 16:9", () => {
    expect(getAspectRatio(1920, 1080)).toBe("16:9");
  });

  test("1280x720 -> 16:9", () => {
    expect(getAspectRatio(1280, 720)).toBe("16:9");
  });

  test("640x480 -> 4:3", () => {
    expect(getAspectRatio(640, 480)).toBe("4:3");
  });

  test("1080x1920 -> 9:16 (portrait)", () => {
    expect(getAspectRatio(1080, 1920)).toBe("9:16");
  });

  test("1920x1920 -> 1:1", () => {
    expect(getAspectRatio(1920, 1920)).toBe("1:1");
  });

  test("320x240 -> 4:3", () => {
    expect(getAspectRatio(320, 240)).toBe("4:3");
  });

  test("2560x1080 -> 64:27 (ultrawide)", () => {
    expect(getAspectRatio(2560, 1080)).toBe("64:27");
  });
});
