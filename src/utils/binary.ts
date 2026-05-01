export function readU16BE(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

export function readU32BE(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  );
}

export function readI32BE(data: Uint8Array, offset: number): number {
  return (
    (data[offset] << 24) |
    (data[offset + 1] << 16) |
    (data[offset + 2] << 8) |
    data[offset + 3]
  );
}

export function readU64BE(data: Uint8Array, offset: number): number {
  const high = readU32BE(data, offset);
  const low = readU32BE(data, offset + 4);
  if (high > 0x1fffff) {
    return Number.MAX_SAFE_INTEGER;
  }
  return high * 0x100000000 + low;
}

export function readU32LE(data: Uint8Array, offset: number): number {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  );
}

export function readFourCC(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3],
  );
}
