import type { BodyCapture } from "./types";

export const MAX_BODY_CHARS = 1_000_000;

export function captureTextBody(value: string, contentType?: string | null): BodyCapture {
  const truncated = value.length > MAX_BODY_CHARS;
  return {
    contentType,
    encoding: "text",
    value: truncated ? value.slice(0, MAX_BODY_CHARS) : value,
    truncated,
    originalLength: value.length
  };
}

export function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
