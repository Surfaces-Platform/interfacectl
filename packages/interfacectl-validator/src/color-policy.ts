export function normalizeColorValue(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }

  const variableMatch = trimmed.match(/^var\(\s*(--[^)\s]+)\s*\)$/i);
  if (variableMatch) {
    return `var(${variableMatch[1]})`;
  }

  const lowered = trimmed.toLowerCase();

  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(lowered)) {
    return lowered;
  }

  if (/^(rgba?|hsla?)\s*\(/.test(lowered)) {
    return lowered
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .replace(/\s*,\s*/g, ", ");
  }

  if (/^[a-z]+$/.test(lowered)) {
    return lowered;
  }

  return trimmed;
}

export function normalizeColorValues(values: readonly string[]): string[] {
  const normalized = values
    .map((value) => normalizeColorValue(value))
    .filter((value) => value.length > 0);
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}
