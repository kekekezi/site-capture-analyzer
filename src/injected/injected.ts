import { captureTextBody, safeJson } from "../shared/body";

interface InjectedEnvelope {
  source: "site-capture-injected";
  kind: "network" | "navigation" | "console" | "error";
  timestampMs: number;
  payload: unknown;
}

const post = (kind: InjectedEnvelope["kind"], payload: unknown) => {
  window.postMessage(
    {
      source: "site-capture-injected",
      kind,
      timestampMs: Date.now(),
      payload
    } satisfies InjectedEnvelope,
    "*"
  );
};

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const startedAt = Date.now();
  const request = input instanceof Request ? input : undefined;
  const url = request?.url ?? String(input);
  const method = init?.method ?? request?.method ?? "GET";
  const requestHeaders = headersToRecord(init?.headers ?? request?.headers);
  const requestBody = await serializeRequestBody(init?.body);

  post("network", {
    phase: "request",
    transport: "fetch",
    method,
    url,
    requestHeaders,
    requestBody
  });

  try {
    const response = await originalFetch(input, init);
    const clone = response.clone();
    let responseBody;
    let bodyCaptureStatus = "not_applicable";

    try {
      const text = await clone.text();
      responseBody = captureTextBody(text, response.headers.get("content-type"));
      bodyCaptureStatus = responseBody.truncated ? "truncated" : "captured";
    } catch (error) {
      bodyCaptureStatus = "blocked_by_browser";
    }

    post("network", {
      phase: "response",
      transport: "fetch",
      method,
      url: response.url || url,
      statusCode: response.status,
      statusLine: `${response.status} ${response.statusText}`,
      responseHeaders: headersToRecord(response.headers),
      responseBody,
      bodyCaptureStatus,
      durationMs: Date.now() - startedAt
    });

    return response;
  } catch (error) {
    post("network", {
      phase: "error",
      transport: "fetch",
      method,
      url,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error)
    });
    throw error;
  }
};

const OriginalXHR = window.XMLHttpRequest;
window.XMLHttpRequest = class CapturedXMLHttpRequest extends OriginalXHR {
  private captureMethod = "GET";
  private captureUrl = "";
  private captureStartedAt = 0;
  private captureRequestHeaders: Record<string, string> = {};
  private captureRequestBody: unknown;

  override open(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null): void {
    this.captureMethod = method;
    this.captureUrl = String(url);
    super.open(method, url, async ?? true, username ?? undefined, password ?? undefined);
  }

  override setRequestHeader(name: string, value: string): void {
    this.captureRequestHeaders[name] = value;
    super.setRequestHeader(name, value);
  }

  override send(body?: Document | XMLHttpRequestBodyInit | null): void {
    this.captureStartedAt = Date.now();
    this.captureRequestBody = serializeSyncBody(body);
    post("network", {
      phase: "request",
      transport: "xhr",
      method: this.captureMethod,
      url: this.captureUrl,
      requestHeaders: this.captureRequestHeaders,
      requestBody: this.captureRequestBody
    });

    this.addEventListener("loadend", () => {
      let responseBody;
      let bodyCaptureStatus = "not_applicable";
      try {
        if (typeof this.responseText === "string") {
          responseBody = captureTextBody(this.responseText, this.getResponseHeader("content-type"));
          bodyCaptureStatus = responseBody.truncated ? "truncated" : "captured";
        }
      } catch {
        bodyCaptureStatus = "blocked_by_browser";
      }

      post("network", {
        phase: this.status ? "response" : "error",
        transport: "xhr",
        method: this.captureMethod,
        url: this.responseURL || this.captureUrl,
        statusCode: this.status,
        statusLine: String(this.status),
        responseHeaders: parseRawHeaders(this.getAllResponseHeaders()),
        responseBody,
        bodyCaptureStatus,
        durationMs: Date.now() - this.captureStartedAt
      });
    });

    super.send(body);
  }
};

const originalPushState = history.pushState.bind(history);
history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
  const result = originalPushState(data, unused, url);
  post("navigation", { api: "pushState", url: location.href, state: safeJson(data) });
  return result;
};

const originalReplaceState = history.replaceState.bind(history);
history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
  const result = originalReplaceState(data, unused, url);
  post("navigation", { api: "replaceState", url: location.href, state: safeJson(data) });
  return result;
};

window.addEventListener("hashchange", () => post("navigation", { api: "hashchange", url: location.href }));
window.addEventListener("popstate", (event) => post("navigation", { api: "popstate", url: location.href, state: safeJson(event.state) }));
window.addEventListener("error", (event) =>
  post("error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error instanceof Error ? { name: event.error.name, message: event.error.message, stack: event.error.stack } : String(event.error)
  })
);
window.addEventListener("unhandledrejection", (event) => post("error", { reason: safeJson(event.reason) }));

for (const level of ["debug", "info", "log", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    post("console", { level, args: args.map(safeJson) });
    original(...args);
  };
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

async function serializeRequestBody(body: BodyInit | null | undefined): Promise<unknown> {
  if (!body) return undefined;
  if (typeof body === "string") return captureTextBody(body);
  if (body instanceof URLSearchParams) return captureTextBody(body.toString(), "application/x-www-form-urlencoded");
  if (body instanceof FormData) return Object.fromEntries(Array.from(body.entries()).map(([key, value]) => [key, value instanceof File ? fileInfo(value) : value]));
  if (body instanceof Blob) return { blob: fileInfo(body) };
  if (body instanceof ArrayBuffer) return { arrayBufferBytes: body.byteLength };
  return { type: Object.prototype.toString.call(body) };
}

function serializeSyncBody(body: Document | XMLHttpRequestBodyInit | null | undefined): unknown {
  if (!body) return undefined;
  if (typeof body === "string") return captureTextBody(body);
  if (body instanceof URLSearchParams) return captureTextBody(body.toString(), "application/x-www-form-urlencoded");
  if (body instanceof FormData) return Object.fromEntries(Array.from(body.entries()).map(([key, value]) => [key, value instanceof File ? fileInfo(value) : value]));
  if (body instanceof Blob) return { blob: fileInfo(body) };
  if (body instanceof ArrayBuffer) return { arrayBufferBytes: body.byteLength };
  if (body instanceof Document) return captureTextBody(new XMLSerializer().serializeToString(body), "application/xml");
  return { type: Object.prototype.toString.call(body) };
}

function fileInfo(blob: Blob): Record<string, unknown> {
  const file = blob instanceof File ? blob : undefined;
  return {
    name: file?.name,
    type: blob.type,
    size: blob.size,
    lastModified: file?.lastModified
  };
}

function parseRawHeaders(raw: string): Record<string, string> {
  return Object.fromEntries(
    raw
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf(":");
        return index === -1 ? [line, ""] : [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}
