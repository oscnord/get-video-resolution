import { describe, expect, test } from "bun:test";
import { isHdrCodec } from "../../src/utils/hdr";

describe("isHdrCodec", () => {
  test("detects Dolby Vision (dvhe)", () => {
    expect(isHdrCodec("dvhe.05.04")).toBe(true);
  });

  test("detects Dolby Vision (dvh1)", () => {
    expect(isHdrCodec("dvh1.08.01")).toBe(true);
  });

  test("detects HEVC HDR10 (hvc1.2)", () => {
    expect(isHdrCodec("hvc1.2.4.L153.B0")).toBe(true);
  });

  test("detects HEV1 HDR10 (hev1.2)", () => {
    expect(isHdrCodec("hev1.2.4.L150")).toBe(true);
  });

  test("detects AV1 HDR (profile 1)", () => {
    expect(isHdrCodec("av01.1.04M.10")).toBe(true);
  });

  test("detects VP9 profile 2 (HDR)", () => {
    expect(isHdrCodec("vp09.02.10.10")).toBe(true);
  });

  test("returns false for SDR h264", () => {
    expect(isHdrCodec("avc1.640028")).toBe(false);
  });

  test("returns false for SDR HEVC (profile 1)", () => {
    expect(isHdrCodec("hvc1.1.6.L93.B0")).toBe(false);
  });

  test("returns false for undefined/empty", () => {
    expect(isHdrCodec(undefined)).toBe(false);
    expect(isHdrCodec("")).toBe(false);
  });
});
