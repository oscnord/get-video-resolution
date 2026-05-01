/**
 * Yields each opening (or self-closing) tag of the given name, with its
 * attribute string and inner body (null when the tag is self-closing).
 */
export function* iterateOpenTags(
  xml: string,
  tag: string,
): Generator<{ attrs: string; body: string | null }> {
  const openRe = new RegExp(`<${tag}\\b([^>]*?)(/?)>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(xml)) !== null) {
    const attrs = match[1];
    const selfClosing = match[2] === "/";
    if (selfClosing) {
      yield { attrs, body: null };
      continue;
    }
    const closeIdx = findMatchingClose(xml, tag, openRe.lastIndex);
    if (closeIdx < 0) {
      yield { attrs, body: xml.slice(openRe.lastIndex) };
      break;
    }
    yield { attrs, body: xml.slice(openRe.lastIndex, closeIdx) };
    openRe.lastIndex = closeIdx;
  }
}

function findMatchingClose(xml: string, tag: string, from: number): number {
  const openRe = new RegExp(`<${tag}\\b[^>]*?(/?)>`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
  openRe.lastIndex = from;
  closeRe.lastIndex = from;
  let depth = 1;
  while (depth > 0) {
    const open = openRe.exec(xml);
    const close = closeRe.exec(xml);
    if (!close) return -1;
    if (open && open.index < close.index) {
      if (open[1] !== "/") depth++;
      closeRe.lastIndex = open.index + open[0].length;
      continue;
    }
    depth--;
    if (depth === 0) return close.index;
    openRe.lastIndex = close.index + close[0].length;
  }
  return -1;
}

/**
 * Parses XML-style `attr="value"` or `attr='value'` pairs into a Map.
 */
export function parseXmlAttrs(attrs: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrs)) !== null) {
    const key = match[1];
    const value = match[3] ?? match[4] ?? "";
    out.set(key, value);
  }
  return out;
}

/**
 * Parses a DASH frameRate value: "30", "30.0", "30000/1001". Returns undefined
 * for missing/invalid input or a zero/negative denominator.
 */
export function parseDashFrameRate(
  value: string | undefined,
): number | undefined {
  if (!value) return undefined;
  if (value.includes("/")) {
    const [num, den] = value.split("/").map(Number);
    if (
      !Number.isFinite(num) ||
      !Number.isFinite(den) ||
      den <= 0 ||
      num <= 0
    ) {
      return undefined;
    }
    return num / den;
  }
  const fr = parseFloat(value);
  return Number.isFinite(fr) && fr > 0 ? fr : undefined;
}

/**
 * Parses an ISO-8601 PT-style duration ("PT1H30M5.5S") to seconds.
 * Returns undefined for empty or unparseable input.
 */
export function parseIso8601Duration(
  duration: string | undefined,
): number | undefined {
  if (!duration) return undefined;
  let seconds = 0;
  let matched = false;
  const hours = /(\d+(?:\.\d+)?)H/.exec(duration);
  const minutes = /(\d+(?:\.\d+)?)M/.exec(duration);
  const secs = /(\d+(?:\.\d+)?)S/.exec(duration);
  if (hours) {
    seconds += parseFloat(hours[1]) * 3600;
    matched = true;
  }
  if (minutes) {
    seconds += parseFloat(minutes[1]) * 60;
    matched = true;
  }
  if (secs) {
    seconds += parseFloat(secs[1]);
    matched = true;
  }
  return matched ? seconds : undefined;
}
