import type { CaptureEvent, CaptureEventType, CaptureSession } from "./types";

export function createSession(tabId: number, startUrl?: string): CaptureSession {
  const now = Date.now();
  return {
    id: `session_${now}_${randomId()}`,
    tabId,
    startedAt: new Date(now).toISOString(),
    startedAtMs: now,
    startUrl,
    status: "recording"
  };
}

export function createEvent<TPayload>(
  session: CaptureSession,
  type: CaptureEventType,
  payload: TPayload,
  options: { tabId?: number; frameId?: number; url?: string; timestampMs?: number } = {}
): CaptureEvent<TPayload> {
  const timestampMs = options.timestampMs ?? Date.now();
  return {
    id: `evt_${timestampMs}_${randomId()}`,
    sessionId: session.id,
    tabId: options.tabId ?? session.tabId,
    frameId: options.frameId,
    timestamp: new Date(timestampMs).toISOString(),
    relativeMs: timestampMs - session.startedAtMs,
    type,
    url: options.url,
    payload
  };
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function sortEvents(events: CaptureEvent[]): CaptureEvent[] {
  return [...events].sort((a, b) => {
    const timeDelta = Date.parse(a.timestamp) - Date.parse(b.timestamp);
    return timeDelta === 0 ? a.id.localeCompare(b.id) : timeDelta;
  });
}
