const SENSITIVE_KEY = /(token|cookie|session|secret|key|jwt|auth|code|state)/i;

export function redactSensitiveUrl(rawValue: string): string {
  try {
    const parsed = new URL(rawValue);
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) {
        parsed.searchParams.set(key, "REDACTED");
      }
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawValue;
  }
}

export function redactSensitiveText(rawValue: string): string {
  return rawValue.replace(
    /([?&](?:token|cookie|session|secret|key|jwt|auth|code|state)=)[^&\s]+/gi,
    "$1REDACTED",
  );
}
