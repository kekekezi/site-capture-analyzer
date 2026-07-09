import type { CaptureEvent, CaptureSession, RuntimeMessage, UserActionPayload } from "../shared/types";

let activeSession: CaptureSession | undefined;
let mutationQueue: MutationRecord[] = [];
let mutationTimer: number | undefined;

declare global {
  interface Window {
    __siteCaptureContentLoaded?: boolean;
  }
}

if (!window.__siteCaptureContentLoaded) {
  window.__siteCaptureContentLoaded = true;
  boot();
}

function boot(): void {
injectMainWorldScript();

sendRuntimeMessage({ source: "site-capture", command: "content-ready" } satisfies RuntimeMessage);

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message.source !== "site-capture") return undefined;
  if (message.command === "start-recording") {
    if (message.session) {
      activeSession = message.session;
      startCapture();
      return undefined;
    }
    chrome.storage.session.get("activeSession").then(({ activeSession: session }) => {
      if (session) {
        activeSession = session as CaptureSession;
        startCapture();
      }
    }).catch(() => undefined);
  }
  if (message.command === "stop-recording") {
    flushMutations();
    if (activeSession) {
      sendEvent(
        createEvent(
          activeSession,
          "page.snapshot",
          {
            phase: "final",
            title: document.title,
            html: document.documentElement.outerHTML,
            text: document.body?.innerText ?? "",
            viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
            referrer: document.referrer,
            contentType: document.contentType
          },
          { url: location.href }
        )
      );
    }
    activeSession = undefined;
  }
  return undefined;
});

chrome.storage.session.get("activeSession").then(({ activeSession: session }) => {
  if (session) {
    activeSession = session as CaptureSession;
    startCapture();
  }
}).catch(() => undefined);

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "site-capture-injected" || !activeSession) return;

  const kind = event.data.kind as string;
  const timestampMs = Number(event.data.timestampMs) || Date.now();
  const payload = event.data.payload;
  const type =
    kind === "network"
      ? payload?.phase === "request"
        ? "network.request"
        : payload?.phase === "error"
          ? "network.error"
          : "network.response"
      : kind === "navigation"
        ? "navigation"
        : kind === "console"
          ? "runtime.console"
          : "runtime.error";

  sendEvent(createEvent(activeSession, type, payload, { url: location.href, timestampMs }));
});

function startCapture(): void {
  sendEvent(
    createEvent(activeSession!, "page.snapshot", {
      phase: "initial",
      title: document.title,
      html: document.documentElement.outerHTML,
      text: document.body?.innerText ?? "",
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      referrer: document.referrer,
      contentType: document.contentType
    }, { url: location.href })
  );
  sendStorageSnapshot();
  observeMutations();
}

function observeMutations(): void {
  const observer = new MutationObserver((records) => {
    mutationQueue.push(...records);
    if (!mutationTimer) {
      mutationTimer = window.setTimeout(flushMutations, 1000);
    }
  });
  observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true, characterData: true });
}

function flushMutations(): void {
  if (!activeSession || mutationQueue.length === 0) return;
  const records = mutationQueue.splice(0, mutationQueue.length);
  window.clearTimeout(mutationTimer);
  mutationTimer = undefined;
  sendEvent(
    createEvent(
      activeSession,
      "dom.mutation",
      {
        count: records.length,
        samples: records.slice(0, 50).map((record) => ({
          type: record.type,
          target: record.target instanceof Element ? selectorForElement(record.target) : record.target.nodeName,
          addedNodes: Array.from(record.addedNodes).slice(0, 10).map(nodeSummary),
          removedNodes: Array.from(record.removedNodes).slice(0, 10).map(nodeSummary),
          attributeName: record.attributeName,
          oldValue: record.oldValue
        }))
      },
      { url: location.href }
    )
  );
}

function sendStorageSnapshot(): void {
  if (!activeSession) return;
  sendEvent(
    createEvent(
      activeSession,
      "storage.snapshot",
      {
        localStorage: storageToRecord(localStorage),
        sessionStorage: storageToRecord(sessionStorage),
        cookiesVisibleToPage: document.cookie
      },
      { url: location.href }
    )
  );
}

for (const eventName of ["click", "input", "change", "submit", "keydown", "focus", "paste"] as const) {
  document.addEventListener(
    eventName,
    (event) => {
      if (!activeSession) return;
      const target = event.target instanceof Element ? event.target : undefined;
      const payload: UserActionPayload = {
        action: eventName,
        selector: target ? selectorForElement(target) : undefined,
        tagName: target?.tagName,
        text: target?.textContent?.trim().slice(0, 500),
        role: target?.getAttribute("role") ?? null,
        ariaLabel: target?.getAttribute("aria-label") ?? null,
        name: target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ? target.name || null : null,
        contextText: target ? contextTextForElement(target) : undefined
      };
      const link = target?.closest("a");
      if (link instanceof HTMLAnchorElement) {
        payload.href = link.href;
        payload.target = link.target || null;
      }

      if (event instanceof MouseEvent) {
        payload.x = event.clientX;
        payload.y = event.clientY;
      }
      if (event instanceof KeyboardEvent) {
        payload.key = event.key;
      }
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        payload.value = target.value;
      }
      sendEvent(createEvent(activeSession, "user.action", payload, { url: location.href }));
    },
    true
  );
}

let lastScroll = 0;
window.addEventListener(
  "scroll",
  () => {
    if (!activeSession || Date.now() - lastScroll < 500) return;
    lastScroll = Date.now();
    sendEvent(createEvent(activeSession, "user.action", { action: "scroll", scrollX: window.scrollX, scrollY: window.scrollY }, { url: location.href }));
  },
  true
);
}

function sendEvent(event: CaptureEvent): void {
  sendRuntimeMessage({ source: "site-capture", command: "content-event", event } satisfies RuntimeMessage);
}

function sendRuntimeMessage(message: RuntimeMessage): void {
  try {
    const result = chrome.runtime.sendMessage(message) as Promise<unknown> | undefined;
    if (result && typeof result.catch === "function") {
      result.catch(() => undefined);
    }
  } catch {
    // Ignore send failures; capture should not break the inspected page.
  }
}

function storageToRecord(storage: Storage): Record<string, string> {
  return Object.fromEntries(Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index) ?? "";
    return [key, storage.getItem(key) ?? ""];
  }));
}

function nodeSummary(node: Node): Record<string, unknown> {
  if (node instanceof Element) {
    return {
      nodeType: "element",
      selector: selectorForElement(node),
      html: node.outerHTML.slice(0, 2000)
    };
  }
  return { nodeType: node.nodeName, text: node.textContent?.slice(0, 1000) };
}

function contextTextForElement(element: Element): string {
  const nearest = element.closest("a, button, label, li, form, section, article, div") ?? element;
  return (nearest.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
}

function injectMainWorldScript(): void {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("assets/injected.js");
  script.onload = () => script.remove();
  (document.documentElement || document.head).appendChild(script);
}

function createEvent<TPayload>(
  session: CaptureSession,
  type: CaptureEvent["type"],
  payload: TPayload,
  options: { tabId?: number; frameId?: number; url?: string; timestampMs?: number } = {}
): CaptureEvent<TPayload> {
  const timestampMs = options.timestampMs ?? Date.now();
  return {
    id: `evt_${timestampMs}_${Math.random().toString(36).slice(2, 10)}`,
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

function selectorForElement(element: Element): string {
  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    const classes = Array.from(current.classList).slice(0, 2).map((name) => `.${cssEscape(name)}`).join("");
    const parent: Element | null = current.parentElement;
    const children: Element[] = parent ? Array.from(parent.children) : [];
    const siblings = children.filter((child: Element) => child.tagName === current?.tagName);
    const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
    parts.unshift(`${tag}${classes}${nth}`);
    current = parent;
  }

  return parts.join(" > ");
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
