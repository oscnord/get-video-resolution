/**
 * Iterates lines starting with the given HLS tag prefix (e.g. "EXT-X-STREAM-INF").
 * Yields the attribute string that follows the colon.
 */
export function* iterateTagLines(
  content: string,
  tag: string,
): Generator<string> {
  const prefix = `#${tag}:`;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      yield line.slice(prefix.length);
    }
  }
}

/**
 * Parses an HLS attribute list per RFC 8216 §4.2. Handles quoted strings,
 * unquoted enumerated values, and integers. Whitespace around `=` is allowed.
 */
export function parseAttrs(line: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < line.length) {
    while (i < line.length && (line[i] === "," || line[i] === " ")) i++;
    const eq = line.indexOf("=", i);
    if (eq < 0) break;
    const key = line.slice(i, eq).trim();
    let j = eq + 1;
    let value: string;
    if (line[j] === '"') {
      const end = line.indexOf('"', j + 1);
      if (end < 0) {
        value = line.slice(j + 1);
        j = line.length;
      } else {
        value = line.slice(j + 1, end);
        j = end + 1;
      }
    } else {
      const end = line.indexOf(",", j);
      if (end < 0) {
        value = line.slice(j).trim();
        j = line.length;
      } else {
        value = line.slice(j, end).trim();
        j = end;
      }
    }
    if (key) out.set(key, value);
    i = j;
  }
  return out;
}

export function splitCodecs(codecs: string | undefined): string[] {
  if (!codecs) return [];
  return codecs
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const AUDIO_PREFIXES = ["mp4a", "ac-3", "ec-3", "opus", "flac", "vorbis"];
const TEXT_PREFIXES = ["stpp", "wvtt"];

export function isAudioCodec(codec: string): boolean {
  const lower = codec.toLowerCase();
  return AUDIO_PREFIXES.some((p) => lower.startsWith(p));
}

export function isTextCodec(codec: string): boolean {
  const lower = codec.toLowerCase();
  return TEXT_PREFIXES.some((p) => lower.startsWith(p));
}

export function parseResolution(
  value: string | undefined,
): { width: number; height: number } | null {
  if (!value) return null;
  const m = /^(\d+)x(\d+)$/i.exec(value);
  if (!m) return null;
  const width = parseInt(m[1], 10);
  const height = parseInt(m[2], 10);
  if (!(width > 0 && height > 0)) return null;
  return { width, height };
}
