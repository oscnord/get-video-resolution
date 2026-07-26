// Codecs that unambiguously indicate HDR — the codec string itself carries
// the HDR signal. 10/12-bit profiles (HEVC Main 10, AV1 High, VP9 profile 2)
// are deliberately absent: they are common in SDR content, so inferring HDR
// from them flags SDR sources. Every parser prefers an explicit transfer
// characteristic (MP4 `colr`, HLS VIDEO-RANGE, DASH CICP) and falls back here.
const HDR_DEFINITE_PATTERNS = [
  /^dvhe\./i, // Dolby Vision
  /^dvh1\./i, // Dolby Vision
];

export function isDefiniteHdrCodec(codec: string | undefined): boolean {
  if (!codec) return false;
  return HDR_DEFINITE_PATTERNS.some((p) => p.test(codec));
}

// ITU-T H.273 / ISO 23091-2 transfer characteristics: 16 = PQ (HDR10),
// 18 = HLG. Shared by the MP4 `colr` box and the DASH CICP descriptor.
export function isHdrTransfer(value: number): boolean {
  return value === 16 || value === 18;
}
