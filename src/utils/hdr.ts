const HDR_PATTERNS = [
  /^dvhe\./i, // Dolby Vision
  /^dvh1\./i, // Dolby Vision
  /^hvc1\.2\./i, // HEVC Main 10 (HDR10)
  /^hev1\.2\./i, // HEVC Main 10
  /^av01\.1\./i, // AV1 High profile
  /^vp09\.02\./i, // VP9 profile 2
];

export function isHdrCodec(codec: string | undefined): boolean {
  if (!codec) return false;
  return HDR_PATTERNS.some((pattern) => pattern.test(codec));
}
