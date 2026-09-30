interface InjectedEnvelope {
  source: "site-capture-injected";
  kind: "navigation" | "console" | "error";
  timestampMs: number;
  payload: unknown;
}

// 本文件必须保持零 import：content script 以经典 <script src> 注入本产物，
// 若打包为 ESM（含 import 语句）将直接语法报错导致采集全部失效。
const safeJson = (value: unknown): unknown => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
};

const disguiseAsNative = (target: object, name: string): void => {
  try {
    Object.defineProperty(target, "name", { value: name, configurable: true });
    Object.defineProperty(target, "toString", {
      value: function toString(): string {
        return `function ${name}() { [native code] }`;
      },
      configurable: true,
      writable: true
    });
  } catch {
    // 伪装失败不影响 hook 功能
  }
};

const post = (kind: InjectedEnvelope["kind"], payload: unknown) => {
  try {
    window.postMessage(
      {
        source: "site-capture-injected",
        kind,
        timestampMs: Date.now(),
        payload
      } satisfies InjectedEnvelope,
      "*"
    );
  } catch {
    // 采集上报失败绝不影响页面自身逻辑
  }
};

// 注意：这里刻意不 hook fetch/XMLHttpRequest。
// 网络请求由扩展后台通过 chrome.debugger（CDP）采集，页面环境保持原生，
// 避免触发站点风控（如网易易盾）对 hook 的环境检测。
const originalPushState = history.pushState.bind(history);
const capturedPushState = (data: unknown, unused: string, url?: string | URL | null) => {
  const result = originalPushState(data, unused, url);
  post("navigation", { api: "pushState", url: location.href, state: safeJson(data) });
  return result;
};
disguiseAsNative(capturedPushState, "pushState");
history.pushState = capturedPushState;

const originalReplaceState = history.replaceState.bind(history);
const capturedReplaceState = (data: unknown, unused: string, url?: string | URL | null) => {
  const result = originalReplaceState(data, unused, url);
  post("navigation", { api: "replaceState", url: location.href, state: safeJson(data) });
  return result;
};
disguiseAsNative(capturedReplaceState, "replaceState");
history.replaceState = capturedReplaceState;

window.addEventListener("hashchange", () => {
  try {
    post("navigation", { api: "hashchange", url: location.href });
  } catch {
    // 忽略
  }
});
window.addEventListener("popstate", (event) => {
  try {
    post("navigation", { api: "popstate", url: location.href, state: safeJson(event.state) });
  } catch {
    // 忽略
  }
});
window.addEventListener("error", (event) => {
  try {
    post("error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error instanceof Error ? { name: event.error.name, message: event.error.message, stack: event.error.stack } : String(event.error)
    });
  } catch {
    // 忽略
  }
});
window.addEventListener("unhandledrejection", (event) => {
  try {
    post("error", { reason: safeJson(event.reason) });
  } catch {
    // 忽略
  }
});

for (const level of ["debug", "info", "log", "warn", "error"] as const) {
  const original = console[level].bind(console);
  const captured = (...args: unknown[]) => {
    try {
      post("console", { level, args: args.map(safeJson) });
    } catch {
      // 采集失败忽略
    }
    original(...args);
  };
  disguiseAsNative(captured, level);
  console[level] = captured as (typeof console)[typeof level];
}
