export function normalizeLanguage(
  lang: string | undefined,
): string | undefined {
  if (!lang) return undefined;
  const trimmed = lang.trim();
  if (!trimmed || trimmed === "und") return undefined;
  return trimmed;
}

export function pickCodec(
  codecs: string[],
  match: (c: string) => boolean,
): string | undefined {
  return codecs.find(match) ?? codecs[0];
}
