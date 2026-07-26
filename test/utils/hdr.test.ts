import { describe, expect, test } from "bun:test";
import { isDefiniteHdrCodec, isHdrTransfer } from "../../src/utils/hdr";

describe("isDefiniteHdrCodec", () => {
  test("detects Dolby Vision (dvhe)", () => {
    expect(isDefiniteHdrCodec("dvhe.05.04")).toBe(true);
  });

  test("detects Dolby Vision (dvh1)", () => {
    expect(isDefiniteHdrCodec("dvh1.08.01")).toBe(true);
  });

  test("returns false for SDR h264", () => {
    expect(isDefiniteHdrCodec("avc1.640028")).toBe(false);
  });

  test("returns false for SDR HEVC (profile 1)", () => {
    expect(isDefiniteHdrCodec("hvc1.1.6.L93.B0")).toBe(false);
  });

  test.each([
    "hvc1.2.4.L153.B0",
    "hev1.2.4.L150",
    "av01.1.04M.10",
    "vp09.02.10.10",
  ])("does not infer HDR from the 10-bit profile in %s", (codec) => {
    // These profiles carry no HDR guarantee — plenty of SDR content ships as
    // Main 10. HDR must come from colr / VIDEO-RANGE / CICP instead.
    expect(isDefiniteHdrCodec(codec)).toBe(false);
  });

  test("returns false for undefined/empty", () => {
    expect(isDefiniteHdrCodec(undefined)).toBe(false);
    expect(isDefiniteHdrCodec("")).toBe(false);
  });
});

describe("isHdrTransfer", () => {
  test("16 is PQ and 18 is HLG", () => {
    expect(isHdrTransfer(16)).toBe(true);
    expect(isHdrTransfer(18)).toBe(true);
  });

  test("SDR transfer characteristics are rejected", () => {
    expect(isHdrTransfer(1)).toBe(false); // BT.709
    expect(isHdrTransfer(13)).toBe(false); // sRGB
    expect(isHdrTransfer(0)).toBe(false);
  });
});
