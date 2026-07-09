const SENSITIVE_KEY_RE = /cookie|token|authorization|password|passwd|secret|session|credential|set-cookie/i;

export function redactSensitive(value: unknown, key = ""): unknown {
  if (value == null) return value;
  if (SENSITIVE_KEY_RE.test(key)) return redactScalar(value);
  if (typeof value === "string") return looksSensitive(value) ? redactString(value) : value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, key));

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    output[childKey] = redactSensitive(childValue, childKey);
  }
  return output;
}

function redactScalar(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `[REDACTED length=${text?.length ?? 0}]`;
}

function redactString(value: string): string {
  return value.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]").replace(/([?&](?:token|sid|session|auth|password)=)[^&]+/gi, "$1[REDACTED]");
}

function looksSensitive(value: string): boolean {
  return /Bearer\s+[A-Za-z0-9._~+/=-]+/i.test(value) || /[?&](token|sid|session|auth|password)=/i.test(value);
}
