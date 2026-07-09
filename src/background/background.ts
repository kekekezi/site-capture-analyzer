import JSZip from "jszip";
import { createEvent, createSession, sortEvents } from "../shared/events";
import { redactSensitive } from "../shared/redact";
import type { CaptureEvent, CaptureLimits, CaptureSession, ExportMode, NetworkPayload, PopupState, RuntimeMessage, StopReason, UserActionPayload } from "../shared/types";

let session: CaptureSession | undefined;
let events: CaptureEvent[] = [];
let trackedTabIds = new Set<number>();
let exportMode: ExportMode = "full";
let limits: CaptureLimits = {
  maxDurationMinutes: 30,
  maxEvents: 5000,
  maxScreenshots: 100,
  idleTimeoutMinutes: 5
};
let limitTimer: ReturnType<typeof setInterval> | undefined;
let lastActivityMs = Date.now();
const tabUrls = new Map<number, string>();
const screenshots: ScreenshotRecord[] = [];
const lastScreenshotByTab = new Map<number, { timestampMs: number; url?: string }>();
const requestStarts = new Map<string, number>();
const requestRows = new Map<string, Partial<NetworkPayload>>();

interface ScreenshotRecord {
  id: string;
  tabId: number;
  url?: string;
  timestamp: string;
  relativeMs: number;
  reason: string;
  filename: string;
  dataUrl: string;
}

interface WebRequestBody {
  formData?: Record<string, unknown[]>;
  raw?: Array<{ bytes?: ArrayBuffer; file?: string }>;
}

declare global {
  interface Window {
    __siteCaptureContentLoaded?: boolean;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.remove("activeSession").catch(() => undefined);
  void updateActionIndicator("idle");
});

chrome.runtime.onStartup.addListener(() => {
  void updateActionIndicator("idle");
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.source !== "site-capture") return false;
  void handleMessage(message, sender).then(sendResponse);
  return true;
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isRecordingTab(details.tabId)) return undefined;
    requestStarts.set(details.requestId, details.timeStamp);
    requestRows.set(details.requestId, {
      requestId: details.requestId,
      method: details.method,
      url: details.url,
      type: details.type,
      requestBody: summarizeRequestBody(details.requestBody),
      bodyCaptureStatus: "blocked_by_browser"
    });
    addEvent("network.request", requestRows.get(details.requestId), { tabId: details.tabId, frameId: details.frameId, url: details.url, timestampMs: details.timeStamp });
    return undefined;
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!isRecordingTab(details.tabId)) return undefined;
    const row = requestRows.get(details.requestId) ?? { requestId: details.requestId, url: details.url };
    row.requestHeaders = headersToRecord(details.requestHeaders);
    requestRows.set(details.requestId, row);
    return undefined;
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!isRecordingTab(details.tabId)) return undefined;
    const row = requestRows.get(details.requestId) ?? { requestId: details.requestId, url: details.url };
    row.statusCode = details.statusCode;
    row.statusLine = details.statusLine;
    row.responseHeaders = headersToRecord(details.responseHeaders);
    requestRows.set(details.requestId, row);
    return undefined;
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"]
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!isRecordingTab(details.tabId)) return;
    const row = requestRows.get(details.requestId) ?? { requestId: details.requestId, url: details.url };
    row.statusCode = details.statusCode;
    row.durationMs = Math.round(details.timeStamp - (requestStarts.get(details.requestId) ?? details.timeStamp));
    addEvent("network.response", row, { tabId: details.tabId, frameId: details.frameId, url: details.url, timestampMs: details.timeStamp });
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (!isRecordingTab(details.tabId)) return;
    const row = requestRows.get(details.requestId) ?? { requestId: details.requestId, url: details.url };
    addEvent("network.error", { ...row, error: details.error }, { tabId: details.tabId, frameId: details.frameId, url: details.url, timestampMs: details.timeStamp });
  },
  { urls: ["<all_urls>"] }
);

chrome.webNavigation.onCommitted.addListener((details) => {
  if (!isRecordingTab(details.tabId)) return;
  tabUrls.set(details.tabId, details.url);
  addEvent("navigation", { transitionType: details.transitionType, transitionQualifiers: details.transitionQualifiers, url: details.url }, { tabId: details.tabId, frameId: details.frameId, url: details.url, timestampMs: details.timeStamp });
  void captureScreenshotForTab(details.tabId, "navigation", details.url);
});

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  if (!isRecordingTab(details.sourceTabId)) return;
  void trackTab(details.tabId, details.url);
  addEvent("navigation", { api: "createdNavigationTarget", sourceTabId: details.sourceTabId, url: details.url }, { tabId: details.tabId, url: details.url, timestampMs: details.timeStamp });
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id && tab.openerTabId && isRecordingTab(tab.openerTabId)) {
    void trackTab(tab.id, tab.url);
  }
});

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (message.command === "get-state") return getState();
  if (message.command === "start-recording") return startRecording();
  if (message.command === "stop-recording") return stopRecording();
  if (message.command === "export-recording") return exportRecording();
  if (message.command === "clear-recording") return clearRecording();
  if (message.command === "open-viewer") return openViewer();
  if (message.command === "open-settings") return openSettings();
  if (message.command === "set-export-mode") {
    exportMode = message.exportMode ?? "full";
    await chrome.storage.local.set({ exportMode });
    return getState();
  }
  if (message.command === "set-limits") {
    limits = normalizeLimits(message.limits);
    await chrome.storage.local.set({ limits });
    checkLimits();
    return getState();
  }

  if (message.command === "content-ready" && session?.status === "recording" && sender.tab?.id && isRecordingTab(sender.tab.id)) {
    await chrome.tabs.sendMessage(sender.tab.id, { source: "site-capture", command: "start-recording", session } satisfies RuntimeMessage).catch(() => undefined);
  }

  if (message.command === "content-event" && message.event && isRecordingTab(message.event.tabId)) {
    events.push(message.event);
    if (message.event.url) tabUrls.set(message.event.tabId, message.event.url);
    if (message.event.type === "user.action" || message.event.type === "navigation") {
      lastActivityMs = Date.now();
    }

    if (message.event.type === "user.action" && (message.event.payload as UserActionPayload).action === "click") {
      await captureScreenshotForTab(message.event.tabId, "click", message.event.url);
    }
    if (message.event.type === "navigation") {
      await captureScreenshotForTab(message.event.tabId, "navigation", message.event.url);
    }
    checkLimits();
  }

  return getState();
}

async function startRecording(): Promise<PopupState> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");

  session = createSession(tab.id, tab.url);
  session.tabIds = [tab.id];
  events = [createEvent(session, "session.started", { startUrl: tab.url, title: tab.title }, { url: tab.url })];
  trackedTabIds = new Set([tab.id]);
  const stored = await chrome.storage.local.get(["exportMode", "limits"]);
  exportMode = (stored.exportMode as ExportMode | undefined) ?? exportMode;
  limits = normalizeLimits(stored.limits);
  tabUrls.clear();
  tabUrls.set(tab.id, tab.url ?? "");
  screenshots.splice(0, screenshots.length);
  lastScreenshotByTab.clear();
  requestStarts.clear();
  requestRows.clear();
  lastActivityMs = Date.now();

  await chrome.storage.session.set({ activeSession: session });
  startLimitTimer();
  void updateActionIndicator("recording");
  await ensureContentScript(tab.id);
  await chrome.tabs.sendMessage(tab.id, { source: "site-capture", command: "start-recording", session } satisfies RuntimeMessage).catch(() => undefined);
  await captureScreenshotForTab(tab.id, "session.started", tab.url);
  return getState();
}

async function stopRecording(): Promise<PopupState> {
  return stopRecordingWithReason("manual");
}

async function stopRecordingWithReason(reason: StopReason): Promise<PopupState> {
  if (!session) return getState();
  stopLimitTimer();
  const tabIds = Array.from(trackedTabIds);
  for (const tabId of tabIds) {
    await captureScreenshotForTab(tabId, "session.stopped", tabUrls.get(tabId));
    await chrome.tabs.sendMessage(tabId, { source: "site-capture", command: "stop-recording" } satisfies RuntimeMessage).catch(() => undefined);
  }
  await captureCookies();
  session = { ...session, status: "stopped", stoppedAt: new Date().toISOString(), stopReason: reason, tabIds };
  events.push(createEvent(session, "session.stopped", { stoppedAt: session.stoppedAt, stopReason: reason }, { url: session.startUrl }));
  await chrome.storage.session.remove("activeSession");
  void updateActionIndicator("stopped");
  return getState();
}

async function exportRecording(): Promise<PopupState> {
  if (!session) throw new Error("No recording to export.");
  if (session.status === "recording") await stopRecordingWithReason("manual");

  const sorted = sortEvents(events);
  const exportEvents = exportMode === "redacted" ? (redactSensitive(sorted) as CaptureEvent[]) : sorted;
  const exportScreenshots = screenshots;
  const zip = new JSZip();
  const manifest = {
    name: "\u7f51\u7ad9\u8bb0\u5f55\u5668\u5bfc\u51fa",
    version: 2,
    sensitive: true,
    exportMode,
    warning: "\u6b64\u5bfc\u51fa\u6587\u4ef6\u4f1a\u5b8c\u6574\u4fdd\u7559 Cookie\u3001Token\u3001\u8bf7\u6c42\u4f53\u3001\u54cd\u5e94\u4f53\u548c\u7528\u6237\u8f93\u5165\u5185\u5bb9\uff0c\u8bf7\u53ea\u5728\u53ef\u4fe1\u73af\u5883\u4e2d\u4fdd\u5b58\u548c\u5206\u4eab\u3002",
    session,
    limits,
    trackedTabIds: Array.from(trackedTabIds),
    generatedAt: new Date().toISOString(),
    eventCount: exportEvents.length,
    screenshotCount: exportScreenshots.length
  };

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("timeline.jsonl", exportEvents.map((event) => JSON.stringify(event)).join("\n"));
  zip.file("network.jsonl", exportEvents.filter((event) => event.type.startsWith("network.")).map((event) => JSON.stringify(event)).join("\n"));
  zip.file("dom-snapshots.jsonl", exportEvents.filter((event) => event.type === "page.snapshot" || event.type === "dom.mutation").map((event) => JSON.stringify(event)).join("\n"));
  zip.file("user-actions.jsonl", exportEvents.filter((event) => event.type === "user.action").map((event) => JSON.stringify(event)).join("\n"));
  zip.file("screenshots.jsonl", exportScreenshots.map(({ dataUrl, ...record }) => JSON.stringify(record)).join("\n"));
  zip.file("storage.json", JSON.stringify(exportEvents.filter((event) => event.type === "storage.snapshot" || event.type === "session.stopped"), null, 2));
  zip.file("ai-summary.md", createAiSummary(manifest, exportEvents));
  zip.file("behavior-summary.md", createBehaviorSummary(exportEvents));
  zip.file("site-analysis.md", createSiteAnalysis(exportEvents, manifest));
  for (const screenshot of exportScreenshots) {
    zip.file(screenshot.filename, screenshot.dataUrl.split(",", 2)[1], { base64: true });
  }

  const base64 = await zip.generateAsync({ type: "base64", compression: "DEFLATE" });
  const url = `data:application/zip;base64,${base64}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await chrome.downloads.download({ url, filename: `site-capture-sensitive-${stamp}.zip`, saveAs: false });
  return getState();
}

async function clearRecording(): Promise<PopupState> {
  const tabIds = Array.from(trackedTabIds);
  stopLimitTimer();
  session = undefined;
  events = [];
  trackedTabIds.clear();
  tabUrls.clear();
  screenshots.splice(0, screenshots.length);
  lastScreenshotByTab.clear();
  requestStarts.clear();
  requestRows.clear();
  await chrome.storage.session.remove("activeSession");
  void updateActionIndicator("idle");
  for (const tabId of tabIds) {
    await chrome.tabs.sendMessage(tabId, { source: "site-capture", command: "stop-recording" } satisfies RuntimeMessage).catch(() => undefined);
  }
  return getState();
}

async function updateActionIndicator(status: PopupState["status"]): Promise<void> {
  try {
    const recording = status === "recording";
    const iconPrefix = recording ? "icons/icon-recording" : "icons/icon-idle";
    await chrome.action.setIcon({
      path: {
        16: `${iconPrefix}-16.png`,
        32: `${iconPrefix}-32.png`,
        48: `${iconPrefix}-48.png`,
        128: `${iconPrefix}-128.png`
      }
    });
    await chrome.action.setBadgeText({ text: recording ? "REC" : "" });
    await chrome.action.setBadgeBackgroundColor({ color: recording ? "#ff3348" : "#1ff0e1" });
    await chrome.action.setTitle({ title: recording ? "\u7f51\u7ad9\u8bb0\u5f55\u5668\uff1a\u8bb0\u5f55\u4e2d" : "\u7f51\u7ad9\u8bb0\u5f55\u5668" });
  } catch {
    // Toolbar indicators are visual-only; recording must not fail if Chrome rejects an action update.
  }
}

function getState(): PopupState {
  const elapsedMs = session ? Math.max(0, Date.now() - session.startedAtMs) : 0;
  const maxDurationMs = limits.maxDurationMinutes > 0 ? limits.maxDurationMinutes * 60_000 : 0;
  return {
    status: session?.status ?? "idle",
    session,
    eventCount: events.length,
    requestCount: events.filter((event) => event.type.startsWith("network.")).length,
    tabCount: trackedTabIds.size,
    screenshotCount: screenshots.length,
    errorCount: events.filter((event) => event.type === "network.error" || event.type === "runtime.error").length,
    startedAt: session?.startedAt,
    elapsedMs,
    remainingMs: session && maxDurationMs > 0 ? Math.max(0, maxDurationMs - elapsedMs) : undefined,
    stopReason: session?.stopReason,
    exportMode,
    limits
  };
}

function startLimitTimer(): void {
  stopLimitTimer();
  limitTimer = setInterval(checkLimits, 5000);
}

function stopLimitTimer(): void {
  if (limitTimer) clearInterval(limitTimer);
  limitTimer = undefined;
}

function checkLimits(): void {
  if (!session || session.status !== "recording") return;
  const now = Date.now();
  if (limits.maxDurationMinutes > 0 && now - session.startedAtMs >= limits.maxDurationMinutes * 60_000) {
    void stopRecordingWithReason("timeout");
    return;
  }
  if (limits.maxEvents > 0 && events.length >= limits.maxEvents) {
    void stopRecordingWithReason("event_limit");
    return;
  }
  if (limits.maxScreenshots > 0 && screenshots.length >= limits.maxScreenshots) {
    void stopRecordingWithReason("screenshot_limit");
    return;
  }
  if (limits.idleTimeoutMinutes > 0 && now - lastActivityMs >= limits.idleTimeoutMinutes * 60_000) {
    void stopRecordingWithReason("idle_timeout");
  }
}

function normalizeLimits(value: unknown): CaptureLimits {
  const input = (value ?? {}) as Partial<CaptureLimits>;
  return {
    maxDurationMinutes: normalizeLimit(input.maxDurationMinutes, 30, 1, 1440),
    maxEvents: normalizeLimit(input.maxEvents, 5000, 100, 100000),
    maxScreenshots: normalizeLimit(input.maxScreenshots, 100, 1, 2000),
    idleTimeoutMinutes: normalizeLimit(input.idleTimeoutMinutes, 5, 1, 1440)
  };
}

function normalizeLimit(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric <= 0) return 0;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

async function openViewer(): Promise<PopupState> {
  await chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
  return getState();
}

async function openSettings(): Promise<PopupState> {
  await chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
  return getState();
}

function addEvent(type: CaptureEvent["type"], payload: unknown, options: { tabId: number; frameId?: number; url?: string; timestampMs?: number }): void {
  if (!session || session.status !== "recording") return;
  events.push(createEvent(session, type, payload, options));
  if (type === "navigation" || type === "user.action") {
    lastActivityMs = Date.now();
  }
  checkLimits();
}

function isRecordingTab(tabId: number): boolean {
  return Boolean(session && session.status === "recording" && trackedTabIds.has(tabId));
}

async function trackTab(tabId: number, url?: string): Promise<void> {
  if (!session || trackedTabIds.has(tabId)) return;
  trackedTabIds.add(tabId);
  session.tabIds = Array.from(trackedTabIds);
  if (url) tabUrls.set(tabId, url);
  await ensureContentScript(tabId);
  await chrome.tabs.sendMessage(tabId, { source: "site-capture", command: "start-recording", session } satisfies RuntimeMessage).catch(() => undefined);
  await captureScreenshotForTab(tabId, "tab.tracked", url);
}

function headersToRecord(headers?: chrome.webRequest.HttpHeader[]): Record<string, string> {
  return Object.fromEntries((headers ?? []).map((header) => [header.name, header.value ?? String(header.binaryValue ?? "")]));
}

function summarizeRequestBody(body?: WebRequestBody): unknown {
  if (!body) return undefined;
  if (body.formData) return body.formData;
  if (body.raw) {
    return body.raw.map((part) => ({
      bytes: part.bytes?.byteLength,
      file: part.file,
      note: "Chrome webRequest exposes raw body bytes but MV3 service worker export stores byte lengths only here; injected fetch/XHR captures readable page bodies."
    }));
  }
  return undefined;
}

async function captureCookies(): Promise<void> {
  if (!session) return;
  const domains = new Set<string>();
  for (const url of [session.startUrl, ...tabUrls.values()]) {
    try {
      if (url) domains.add(new URL(url).hostname);
    } catch {
      // Ignore invalid or browser-internal URLs.
    }
  }
  const cookies = [];
  for (const domain of domains) {
    cookies.push(...(await chrome.cookies.getAll({ domain }).catch(() => [])));
  }
  events.push(createEvent(session, "storage.snapshot", { cookies }, { url: session.startUrl }));
}

async function captureScreenshotForTab(tabId: number, reason: string, url?: string): Promise<void> {
  if (!session || session.status !== "recording") return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active || tab.windowId === undefined) return;
    const targetUrl = url ?? tab.url;
    const timestampMs = Date.now();
    const last = lastScreenshotByTab.get(tabId);
    if (last && timestampMs - last.timestampMs < 800 && normalizeUrl(last.url) === normalizeUrl(targetUrl)) {
      return;
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const id = `shot_${timestampMs}_${Math.random().toString(36).slice(2, 10)}`;
    const filename = `screenshots/${id}.png`;
    lastScreenshotByTab.set(tabId, { timestampMs, url: targetUrl });
    screenshots.push({
      id,
      tabId,
      url: targetUrl,
      timestamp: new Date(timestampMs).toISOString(),
      relativeMs: timestampMs - session.startedAtMs,
      reason,
      filename,
      dataUrl
    });
    addEvent("screenshot", { id, reason, filename }, { tabId, url: targetUrl, timestampMs });
  } catch (error) {
    // Screenshot capture is best-effort; Chrome rejects inactive, hidden, or restricted tabs.
  }
}

function normalizeUrl(url?: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function createAiSummary(manifest: unknown, sorted: CaptureEvent[]): string {
  const counts = sorted.reduce<Record<string, number>>((acc, event) => {
    acc[event.type] = (acc[event.type] ?? 0) + 1;
    return acc;
  }, {});
  return [
    "# \u7f51\u7ad9\u8bb0\u5f55\u5668\u5bfc\u51fa",
    "",
    "\u6b64\u5bfc\u51fa\u6587\u4ef6\u5305\u542b\u654f\u611f\u4fe1\u606f\uff0c\u53ef\u80fd\u5305\u62ec Cookie\u3001Token\u3001\u8bf7\u6c42\u4f53\u3001\u54cd\u5e94\u4f53\u548c\u7528\u6237\u8f93\u5165\u5185\u5bb9\u3002",
    "",
    "## \u5206\u6790\u65b9\u5f0f",
    "- \u5148\u770b `manifest.json`\uff0c\u4e86\u89e3\u672c\u6b21\u5f55\u5236\u7684\u4f1a\u8bdd\u4fe1\u606f\u3002",
    "- \u4ee5 `timeline.jsonl` \u4f5c\u4e3a\u5b8c\u6574\u65f6\u95f4\u7ebf\u3002",
    "- \u7528 `behavior-summary.md` \u5feb\u901f\u7406\u89e3\u7528\u6237\u64cd\u4f5c\u3002",
    "- \u6309\u9700\u67e5\u770b `network.jsonl`\u3001`dom-snapshots.jsonl`\u3001`user-actions.jsonl`\u3001`screenshots.jsonl` \u548c `storage.json`\u3002",
    "",
    "## \u4e8b\u4ef6\u6570\u91cf",
    "```json",
    JSON.stringify(counts, null, 2),
    "```",
    "",
    "## \u5bfc\u51fa\u5143\u4fe1\u606f",
    "```json",
    JSON.stringify(manifest, null, 2),
    "```"
  ].join("\n");
}

function createBehaviorSummary(sorted: CaptureEvent[]): string {
  const lines = ["# \u7528\u6237\u884c\u4e3a\u6458\u8981", ""];
  const actions = sorted.filter((event) => event.type === "user.action") as Array<CaptureEvent<UserActionPayload>>;
  const inputRuns = new Map<string, CaptureEvent<UserActionPayload>>();

  for (const event of actions) {
    const action = event.payload.action;
    const selector = event.payload.selector ?? "(unknown)";
    if (action === "input" && event.payload.value !== undefined) {
      inputRuns.set(`${event.tabId}:${selector}`, event);
      continue;
    }

    if (action === "keydown" && shouldSuppressKeydown(event.payload, inputRuns.has(`${event.tabId}:${selector}`))) {
      continue;
    }

    flushInputs(lines, inputRuns);
    if (action === "click") {
      const target = event.payload.text || event.payload.ariaLabel || event.payload.contextText || selector;
      const href = event.payload.href ? ` -> ${event.payload.href}` : "";
      lines.push(`- ${formatMs(event.relativeMs)} \u70b9\u51fb ${target}${href}`);
    } else if (action === "keydown") {
      lines.push(`- ${formatMs(event.relativeMs)} \u6309\u4e0b ${event.payload.key ?? ""} \u4e8e ${selector}`);
    } else if (action === "change") {
      lines.push(`- ${formatMs(event.relativeMs)} \u66f4\u6539 ${selector}\uff0c\u5f53\u524d\u503c: ${event.payload.value ?? ""}`);
    } else if (action === "focus") {
      lines.push(`- ${formatMs(event.relativeMs)} \u805a\u7126 ${selector}`);
    } else if (action === "paste") {
      lines.push(`- ${formatMs(event.relativeMs)} \u7c98\u8d34\u5230 ${selector}`);
    } else if (action === "scroll") {
      lines.push(`- ${formatMs(event.relativeMs)} \u6eda\u52a8\u5230 x=${event.payload.scrollX ?? 0}, y=${event.payload.scrollY ?? 0}`);
    } else if (action === "submit") {
      lines.push(`- ${formatMs(event.relativeMs)} \u63d0\u4ea4 ${selector}`);
    }
  }
  flushInputs(lines, inputRuns);

  const navigations = sorted.filter((event) => event.type === "navigation");
  if (navigations.length > 0) {
    lines.push("", "## \u5730\u5740\u53d8\u5316");
    for (const event of navigations) {
      lines.push(`- ${formatMs(event.relativeMs)} ${event.url ?? JSON.stringify(event.payload)}`);
    }
  }

  return lines.join("\n");
}

function shouldSuppressKeydown(payload: UserActionPayload, hasPendingInput: boolean): boolean {
  const key = payload.key ?? "";
  if (hasPendingInput) return key !== "Enter";
  return key.length === 1 || key === "Process" || key === "Shift" || key === "Backspace";
}

function createSiteAnalysis(sorted: CaptureEvent[], manifest: unknown): string {
  const network = sorted.filter((event) => event.type.startsWith("network."));
  const errors = sorted.filter((event) => event.type === "network.error" || event.type === "runtime.error");
  const actions = sorted.filter((event) => event.type === "user.action") as Array<CaptureEvent<UserActionPayload>>;
  const pageUrls = Array.from(
    new Set(
      sorted
        .filter((event) => event.type === "navigation" || event.type === "page.snapshot" || event.type === "session.started")
        .map((event) => event.url)
        .filter(Boolean)
    )
  ) as string[];
  const classified = classifyNetworkEvents(network);

  const lines = [
    "# \u7f51\u7ad9\u5206\u6790\u62a5\u544a",
    "",
    "## \u6982\u89c8",
    `- \u603b\u4e8b\u4ef6\u6570: ${sorted.length}`,
    `- \u7f51\u7edc\u4e8b\u4ef6\u6570: ${network.length}`,
    `- \u7528\u6237\u64cd\u4f5c\u6570: ${actions.length}`,
    `- \u5f02\u5e38\u6570: ${errors.length}`,
    "",
    "## \u8bbf\u95ee\u8def\u5f84",
    ...pageUrls.slice(0, 50).map((url) => `- ${url}`),
    "",
    "## \u5173\u952e\u7528\u6237\u64cd\u4f5c",
    ...createActionSummaryLines(actions).slice(0, 80),
    "",
    "## \u7591\u4f3c\u6838\u5fc3\u63a5\u53e3",
    ...classified.api.slice(0, 30).map(formatNetworkForReport),
    "",
    "## \u57cb\u70b9\u8bf7\u6c42",
    ...classified.tracking.slice(0, 30).map(formatNetworkForReport),
    "",
    "## \u9759\u6001\u8d44\u6e90",
    ...classified.static.slice(0, 30).map(formatNetworkForReport),
    "",
    "## \u5f02\u5e38",
    ...errors.slice(0, 50).map((event) => `- ${formatMs(event.relativeMs)} ${event.type} ${event.url ?? ""} ${JSON.stringify(event.payload).slice(0, 500)}`),
    "",
    "## \u5bfc\u51fa\u5143\u4fe1\u606f",
    "```json",
    JSON.stringify(manifest, null, 2),
    "```"
  ];

  return lines.join("\n");
}

function createActionSummaryLines(actions: Array<CaptureEvent<UserActionPayload>>): string[] {
  const lines: string[] = [];
  const inputRuns = new Map<string, CaptureEvent<UserActionPayload>>();
  for (const event of actions) {
    const payload = event.payload;
    const selector = payload.selector ?? "(unknown)";
    if (payload.action === "input" && payload.value !== undefined) {
      inputRuns.set(`${event.tabId}:${selector}`, event);
      continue;
    }
    if (payload.action === "keydown" && shouldSuppressKeydown(payload, inputRuns.has(`${event.tabId}:${selector}`))) {
      continue;
    }
    flushInputs(lines, inputRuns);
    if (payload.action === "click") {
      lines.push(`- ${formatMs(event.relativeMs)} \u70b9\u51fb ${payload.text || payload.ariaLabel || payload.contextText || payload.selector || ""}${payload.href ? ` -> ${payload.href}` : ""}`);
    } else if (payload.action === "scroll") {
      lines.push(`- ${formatMs(event.relativeMs)} \u6eda\u52a8\u5230 y=${payload.scrollY ?? 0}`);
    } else if (payload.action === "change") {
      lines.push(`- ${formatMs(event.relativeMs)} \u66f4\u6539 ${selector}: ${payload.value ?? ""}`);
    } else if (payload.action === "focus") {
      lines.push(`- ${formatMs(event.relativeMs)} \u805a\u7126 ${selector}`);
    } else if (payload.action === "paste") {
      lines.push(`- ${formatMs(event.relativeMs)} \u7c98\u8d34\u5230 ${selector}`);
    } else if (payload.action === "submit") {
      lines.push(`- ${formatMs(event.relativeMs)} \u63d0\u4ea4 ${selector}`);
    } else if (payload.action === "keydown") {
      lines.push(`- ${formatMs(event.relativeMs)} \u6309\u4e0b ${payload.key ?? ""} \u4e8e ${selector}`);
    }
  }
  flushInputs(lines, inputRuns);
  return lines;
}

function classifyNetworkEvents(network: CaptureEvent[]): { api: CaptureEvent[]; tracking: CaptureEvent[]; static: CaptureEvent[] } {
  const buckets = { api: [] as CaptureEvent[], tracking: [] as CaptureEvent[], static: [] as CaptureEvent[] };
  const seen = new Set<string>();
  for (const event of network) {
    const payload = event.payload as Partial<NetworkPayload>;
    const url = payload.url ?? event.url ?? "";
    const key = `${payload.method ?? ""} ${url} ${payload.statusCode ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isStaticResource(url, payload.type)) buckets.static.push(event);
    else if (isTrackingRequest(url)) buckets.tracking.push(event);
    else if (isApiRequest(url, payload)) buckets.api.push(event);
  }
  return buckets;
}

function formatNetworkForReport(event: CaptureEvent): string {
  const payload = event.payload as Partial<NetworkPayload>;
  const body = summarizeBodyForReport(payload);
  return `- ${payload.method ?? ""} ${payload.url ?? event.url ?? ""} ${payload.statusCode ? `(${payload.statusCode})` : ""}${body ? `\n  - ${body}` : ""}`;
}

function isStaticResource(url: string, type?: string): boolean {
  return /^(image|stylesheet|script|font|media)$/.test(type ?? "") || /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ttf|ico)([?#]|$)/i.test(url);
}

function isTrackingRequest(url: string): boolean {
  return /\/(log|trace|track|collect|beacon|v\.gif|hm\.gif|wb\.gif|ztbox)|[?&](log|trace|track|beacon|tj)=/i.test(url);
}

function isApiRequest(url: string, payload: Partial<NetworkPayload>): boolean {
  return payload.responseBody !== undefined || /api|json|xhr|fetch|graphql|rest|ajax|search|sug|mcp/i.test(url);
}

function summarizeBodyForReport(payload: Partial<NetworkPayload>): string {
  const parts: string[] = [];
  if (payload.requestBody !== undefined) {
    parts.push(`requestBody: ${stringifyForReport(payload.requestBody)}`);
  }
  if (payload.responseBody !== undefined) {
    parts.push(`responseBody: ${stringifyForReport(payload.responseBody)}`);
  }
  return parts.join(" | ");
}

function stringifyForReport(value: unknown): string {
  if (typeof value === "object" && value && "value" in value) {
    return String((value as { value?: unknown }).value).slice(0, 500);
  }
  return JSON.stringify(value).slice(0, 500);
}

function flushInputs(lines: string[], inputRuns: Map<string, CaptureEvent<UserActionPayload>>): void {
  for (const event of inputRuns.values()) {
    lines.push(`- ${formatMs(event.relativeMs)} \u5728 ${event.payload.selector ?? "(unknown)"} \u8f93\u5165 "${event.payload.value ?? ""}"`);
  }
  inputRuns.clear();
}

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    const checks = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => Boolean(window.__siteCaptureContentLoaded)
    });
    const unloadedFrameIds = checks.filter((result) => !result.result && typeof result.frameId === "number").map((result) => result.frameId);
    if (unloadedFrameIds.length > 0) {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: unloadedFrameIds },
        files: ["assets/content.js"]
      });
    }
  } catch (error) {
    addEvent("runtime.error", { stage: "ensureContentScript", message: error instanceof Error ? error.message : String(error) }, { tabId });
  }
}
