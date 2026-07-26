export function normalizeLanguage(
  lang: string | undefined,
): string | undefined {
  if (!lang) return undefined;
  const trimmed = lang.trim();
  if (!trimmed || trimmed === "und") return undefined;
  return trimmed;
}

export function parsePositiveInt(
  value: string | undefined,
): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parsePositiveFloat(
  value: string | undefined,
): number | undefined {
  if (!value) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
