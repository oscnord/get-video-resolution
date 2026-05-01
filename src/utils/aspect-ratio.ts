function gcd(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function getAspectRatio(
  width: number,
  height: number,
): string | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}
