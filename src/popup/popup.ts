import type { PopupState, RuntimeMessage, StopReason } from "../shared/types";
import "./style.css";

const statusEl = document.querySelector<HTMLSpanElement>("#status")!;
const eventCountEl = document.querySelector<HTMLElement>("#eventCount")!;
const requestCountEl = document.querySelector<HTMLElement>("#requestCount")!;
const tabCountEl = document.querySelector<HTMLElement>("#tabCount")!;
const screenshotCountEl = document.querySelector<HTMLElement>("#screenshotCount")!;
const messageEl = document.querySelector<HTMLElement>("#message")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const stopButton = document.querySelector<HTMLButtonElement>("#stop")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export")!;
const clearButton = document.querySelector<HTMLButtonElement>("#clear")!;
const viewerButton = document.querySelector<HTMLButtonElement>("#viewer")!;
const settingsButton = document.querySelector<HTMLButtonElement>("#settings")!;
const statsEl = document.querySelector<HTMLElement>(".stats")!;
const statValueEls = [eventCountEl, requestCountEl, tabCountEl, screenshotCountEl];
let statsResetAnimating = false;
let statsAnimationFrame: number | undefined;
const previousStats = new WeakMap<HTMLElement, string>();
const suppressNextStatTick = new WeakSet<HTMLElement>();

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  size: number;
  color: string;
}

startButton.addEventListener("click", () => run("start-recording", "\u5df2\u5f00\u59cb\u5f55\u5236"));
stopButton.addEventListener("click", () => run("stop-recording", "\u5df2\u505c\u6b62\u5f55\u5236"));
exportButton.addEventListener("click", () => run("export-recording", "\u6b63\u5728\u751f\u6210\u5bfc\u51fa\u6587\u4ef6"));
clearButton.addEventListener("click", () => {
  playStatsReset();
  void run("clear-recording", "\u5df2\u6e05\u9664\u5f53\u524d\u8bb0\u5f55");
});
viewerButton.addEventListener("click", () => run("open-viewer", "\u5df2\u6253\u5f00\u67e5\u770b\u5668"));
settingsButton.addEventListener("click", () => run("open-settings", "\u5df2\u6253\u5f00\u8bbe\u7f6e"));

void refresh();
setInterval(refresh, 1000);

async function run(command: RuntimeMessage["command"], success: string): Promise<void> {
  try {
    messageEl.textContent = "";
    setCommandBusy(command, true);
    const state = await send(command);
    render(state);
    messageEl.textContent = success;
  } catch (error) {
    messageEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setCommandBusy(command, false);
  }
}

async function refresh(): Promise<void> {
  try {
    render(await send("get-state"));
  } catch {
    render({ status: "idle", eventCount: 0, requestCount: 0 });
  }
}

async function send(command: RuntimeMessage["command"]): Promise<PopupState> {
  return chrome.runtime.sendMessage({ source: "site-capture", command } satisfies RuntimeMessage);
}

function render(state: PopupState): void {
  statusEl.textContent = statusText(state.status);
  statusEl.dataset.status = state.status;
  if (!statsResetAnimating) {
    setStatValue(eventCountEl, String(state.eventCount));
    setStatValue(requestCountEl, String(state.requestCount));
    setStatValue(tabCountEl, String(state.tabCount ?? 0));
    setStatValue(screenshotCountEl, String(state.screenshotCount ?? 0));
  }
  if (state.status === "recording" && state.remainingMs !== undefined) {
    messageEl.textContent = `\u5df2\u5f55\u5236 ${formatDuration(state.elapsedMs ?? 0)} / \u5269\u4f59 ${formatDuration(state.remainingMs)}`;
  } else if (state.status === "stopped" && state.stopReason && state.stopReason !== "manual") {
    messageEl.textContent = `\u5df2\u81ea\u52a8\u505c\u6b62\uff1a${stopReasonText(state.stopReason)}`;
  }
  startButton.disabled = state.status === "recording";
  stopButton.disabled = state.status !== "recording";
  exportButton.disabled = state.status === "idle" || state.eventCount === 0;
  clearButton.disabled = state.status === "idle" || state.eventCount === 0;
}

function setStatValue(element: HTMLElement, value: string): void {
  const previous = previousStats.get(element);
  const suppressTick = suppressNextStatTick.has(element);
  if (suppressTick) suppressNextStatTick.delete(element);
  if (!suppressTick && previous !== undefined && previous !== value) {
    element.classList.remove("is-stat-updated");
    void element.offsetWidth;
    element.classList.add("is-stat-updated");
  }
  previousStats.set(element, value);
  element.textContent = value;
}

function setCommandBusy(command: RuntimeMessage["command"], busy: boolean): void {
  const button = command === "export-recording" ? exportButton : command === "start-recording" ? startButton : command === "stop-recording" ? stopButton : undefined;
  if (!button) return;
  button.classList.toggle("is-busy", busy);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function stopReasonText(reason: StopReason): string {
  if (reason === "timeout") return "\u8fbe\u5230\u6700\u957f\u5f55\u5236\u65f6\u957f";
  if (reason === "event_limit") return "\u8fbe\u5230\u6700\u5927\u4e8b\u4ef6\u6570";
  if (reason === "screenshot_limit") return "\u8fbe\u5230\u6700\u5927\u622a\u56fe\u6570";
  if (reason === "idle_timeout") return "\u957f\u65f6\u95f4\u65e0\u7528\u6237\u64cd\u4f5c";
  return "\u624b\u52a8\u505c\u6b62";
}

function statusText(status: PopupState["status"]): string {
  if (status === "recording") return "\u5f55\u5236\u4e2d";
  if (status === "stopped") return "\u5df2\u505c\u6b62";
  return "\u7a7a\u95f2";
}

function playStatsReset(): void {
  if (clearButton.disabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (statsAnimationFrame !== undefined) cancelAnimationFrame(statsAnimationFrame);
  statsResetAnimating = true;
  const particles = createStatParticles();
  if (particles.length === 0) {
    statsResetAnimating = false;
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.className = "stats-particle-canvas";
  const rect = statsEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.ceil(rect.width * dpr);
  canvas.height = Math.ceil(rect.height * dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  statsEl.append(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    statsResetAnimating = false;
    return;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  statValueEls.forEach((element) => element.classList.add("is-particle-hidden"));

  const startedAt = performance.now();
  const explodeMs = 360;
  const settleMs = 980;
  let revealedZero = false;
  const animate = (now: number) => {
    const elapsed = now - startedAt;
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "rgba(2, 8, 18, 0.18)";
    ctx.fillRect(0, 0, rect.width, rect.height);

    for (const particle of particles) {
      if (elapsed < explodeMs) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= 0.9;
        particle.vy *= 0.9;
      } else {
        const pull = Math.min(0.16, 0.06 + (elapsed - explodeMs) / settleMs * 0.08);
        particle.x += (particle.tx - particle.x) * pull;
        particle.y += (particle.ty - particle.y) * pull;
      }

      ctx.globalAlpha = elapsed > settleMs ? Math.max(0, 1 - (elapsed - settleMs) / 180) : 1;
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 8;
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    if (!revealedZero && elapsed >= settleMs - 120) {
      revealedZero = true;
      statValueEls.forEach((element) => {
        element.textContent = "0";
        previousStats.set(element, "0");
        suppressNextStatTick.add(element);
        element.classList.remove("is-particle-hidden", "is-reassembling", "is-stat-updated");
      });
    }

    if (elapsed < settleMs + 180) {
      statsAnimationFrame = requestAnimationFrame(animate);
      return;
    }

    canvas.remove();
    statsAnimationFrame = undefined;
  };

  statsAnimationFrame = requestAnimationFrame(animate);
  window.setTimeout(() => {
    statValueEls.forEach((element) => {
      element.classList.remove("is-particle-hidden", "is-reassembling");
      previousStats.set(element, "0");
      suppressNextStatTick.add(element);
    });
    statsResetAnimating = false;
  }, 1280);
}

function createStatParticles(): Particle[] {
  const statsRect = statsEl.getBoundingClientRect();
  const particles: Particle[] = [];
  for (const element of statValueEls) {
    const value = element.textContent?.trim() || "0";
    const color = getComputedStyle(element).getPropertyValue("--stat-color").trim() || getComputedStyle(element).color;
    const from = sampleTextPoints(value, element, statsRect);
    const to = sampleTextPoints("0", element, statsRect);
    if (from.length === 0 || to.length === 0) continue;
    from.forEach((point, index) => {
      const target = to[index % to.length];
      particles.push({
        x: point.x,
        y: point.y,
        vx: (Math.random() - 0.5) * 11,
        vy: (Math.random() - 0.5) * 11,
        tx: target.x,
        ty: target.y,
        size: Math.random() * 2 + 1.5,
        color
      });
    });
  }
  return particles;
}

function sampleTextPoints(text: string, element: HTMLElement, origin: DOMRect): Array<{ x: number; y: number }> {
  const rect = element.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.ceil(origin.width);
  const height = Math.ceil(origin.height);
  const canvas = document.createElement("canvas");
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const style = getComputedStyle(element);
  ctx.clearRect(0, 0, width, height);
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, rect.left - origin.left + rect.width / 2, rect.top - origin.top + rect.height / 2);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const points: Array<{ x: number; y: number }> = [];
  const step = Math.max(3, Math.round(4 * dpr));
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const index = (y * canvas.width + x) * 4;
      if (image.data[index + 3] > 80) {
        points.push({ x: x / dpr, y: y / dpr });
      }
    }
  }
  return points;
}
