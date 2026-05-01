import { describe, expect, test } from "bun:test";
import {
  readFourCC,
  readI32BE,
  readU16BE,
  readU32BE,
  readU32LE,
  readU64BE,
} from "../src/utils/binary";

describe("binary helpers", () => {
  test("readU16BE reads two bytes big-endian", () => {
    const data = new Uint8Array([0x12, 0x34, 0xff, 0xff]);
    expect(readU16BE(data, 0)).toBe(0x1234);
    expect(readU16BE(data, 2)).toBe(0xffff);
  });

  test("readU32BE reads four bytes big-endian unsigned", () => {
    const data = new Uint8Array([
      0xff, 0xff, 0xff, 0xff, 0x12, 0x34, 0x56, 0x78,
    ]);
    expect(readU32BE(data, 0)).toBe(0xffffffff);
    expect(readU32BE(data, 4)).toBe(0x12345678);
  });

  test("readI32BE preserves sign", () => {
    const data = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    expect(readI32BE(data, 0)).toBe(-1);
  });

  test("readU64BE returns exact value below 2^53", () => {
    // 0x0000_0001_0000_0001 = 4294967297
    const data = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1]);
    expect(readU64BE(data, 0)).toBe(0x100000001);
  });

  test("readU64BE clamps to MAX_SAFE_INTEGER above 2^53", () => {
    // high = 0x00800000 → high * 2^32 = 2^55, well above safe integer
    const data = new Uint8Array([0x00, 0x80, 0x00, 0x00, 0, 0, 0, 0]);
    expect(readU64BE(data, 0)).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("readU32LE reads four bytes little-endian", () => {
    const data = new Uint8Array([0x78, 0x56, 0x34, 0x12]);
    expect(readU32LE(data, 0)).toBe(0x12345678);
  });

  test("readFourCC returns ASCII string", () => {
    const data = new Uint8Array([0x66, 0x74, 0x79, 0x70]); // "ftyp"
    expect(readFourCC(data, 0)).toBe("ftyp");
  });
});
