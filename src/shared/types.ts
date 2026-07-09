export type CaptureStatus = "idle" | "recording" | "stopped";
export type StopReason = "manual" | "timeout" | "event_limit" | "screenshot_limit" | "idle_timeout";

export interface CaptureLimits {
  maxDurationMinutes: number;
  maxEvents: number;
  maxScreenshots: number;
  idleTimeoutMinutes: number;
}

export type CaptureEventType =
  | "session.started"
  | "session.stopped"
  | "page.snapshot"
  | "dom.mutation"
  | "screenshot"
  | "behavior.summary"
  | "storage.snapshot"
  | "user.action"
  | "navigation"
  | "network.request"
  | "network.response"
  | "network.error"
  | "runtime.console"
  | "runtime.error";

export interface CaptureEvent<TPayload = unknown> {
  id: string;
  sessionId: string;
  tabId: number;
  frameId?: number;
  timestamp: string;
  relativeMs: number;
  type: CaptureEventType;
  url?: string;
  payload: TPayload;
}

export interface CaptureSession {
  id: string;
  tabId: number;
  tabIds?: number[];
  startedAt: string;
  startedAtMs: number;
  startUrl?: string;
  status: CaptureStatus;
  stoppedAt?: string;
  stopReason?: StopReason;
}

export interface PopupState {
  status: CaptureStatus;
  session?: CaptureSession;
  eventCount: number;
  requestCount: number;
  tabCount?: number;
  screenshotCount?: number;
  errorCount?: number;
  startedAt?: string;
  elapsedMs?: number;
  remainingMs?: number;
  stopReason?: StopReason;
  exportMode?: ExportMode;
  limits?: CaptureLimits;
}

export type ExportMode = "full" | "redacted";

export interface RuntimeMessage {
  source: "site-capture";
  command:
    | "start-recording"
    | "stop-recording"
    | "export-recording"
    | "clear-recording"
    | "open-viewer"
    | "open-settings"
    | "set-export-mode"
    | "set-limits"
    | "get-state"
    | "content-event"
    | "injected-event"
    | "content-ready";
  event?: CaptureEvent;
  session?: CaptureSession;
  exportMode?: ExportMode;
  limits?: CaptureLimits;
}

export interface UserActionPayload {
  action: "click" | "input" | "change" | "scroll" | "keydown" | "submit" | "focus" | "paste";
  selector?: string;
  tagName?: string;
  text?: string;
  value?: string;
  href?: string;
  target?: string | null;
  role?: string | null;
  ariaLabel?: string | null;
  name?: string | null;
  contextText?: string;
  key?: string;
  x?: number;
  y?: number;
  scrollX?: number;
  scrollY?: number;
}

export interface NetworkPayload {
  requestId?: string;
  method?: string;
  url: string;
  type?: string;
  statusCode?: number;
  statusLine?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseBody?: BodyCapture;
  durationMs?: number;
  bodyCaptureStatus?: "captured" | "truncated" | "blocked_by_browser" | "not_applicable";
}

export interface BodyCapture {
  contentType?: string | null;
  encoding: "text" | "base64";
  value: string;
  truncated: boolean;
  originalLength: number;
}
