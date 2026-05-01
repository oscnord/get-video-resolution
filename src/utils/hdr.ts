// Codecs that unambiguously indicate HDR — the codec string itself carries
// the HDR signal. Used in both file and manifest paths.
const HDR_DEFINITE_PATTERNS = [
  /^dvhe\./i, // Dolby Vision
  /^dvh1\./i, // Dolby Vision
];

// 10/12-bit profiles often used for HDR but not exclusively. Used as a
// fallback signal in HLS/DASH manifests where colr metadata is unavailable.
// File parsers prefer the explicit `colr` box and only fall back to
// `isDefiniteHdrCodec` to avoid flagging Main 10 SDR sources as HDR.
const HDR_PROBABLE_PATTERNS = [
  /^hvc1\.2\./i, // HEVC Main 10
  /^hev1\.2\./i, // HEVC Main 10
  /^av01\.1\./i, // AV1 High profile
  /^vp09\.02\./i, // VP9 profile 2
];

export function isHdrCodec(codec: string | undefined): boolean {
  if (!codec) return false;
  return [...HDR_DEFINITE_PATTERNS, ...HDR_PROBABLE_PATTERNS].some((p) =>
    p.test(codec),
  );
}

export function isDefiniteHdrCodec(codec: string | undefined): boolean {
  if (!codec) return false;
  return HDR_DEFINITE_PATTERNS.some((p) => p.test(codec));
}
