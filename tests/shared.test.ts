import { describe, expect, it } from "vitest";
import { captureTextBody, MAX_BODY_CHARS } from "../src/shared/body";
import { createEvent, createSession, sortEvents } from "../src/shared/events";

describe("shared capture utilities", () => {
  it("sorts events by timestamp and id", () => {
    const session = createSession(1, "https://example.com");
    const late = createEvent(session, "session.stopped", {}, { timestampMs: 3000 });
    const early = createEvent(session, "session.started", {}, { timestampMs: 1000 });

    expect(sortEvents([late, early]).map((event) => event.type)).toEqual(["session.started", "session.stopped"]);
  });

  it("truncates large text bodies", () => {
    const body = captureTextBody("a".repeat(MAX_BODY_CHARS + 5), "text/plain");

    expect(body.truncated).toBe(true);
    expect(body.value).toHaveLength(MAX_BODY_CHARS);
    expect(body.originalLength).toBe(MAX_BODY_CHARS + 5);
  });
});
