import type { CaptureLimits, ExportMode, PopupState, RuntimeMessage } from "../shared/types";
import "./style.css";

const saveStatusEl = document.querySelector<HTMLElement>("#saveStatus")!;
const exportModeSelect = document.querySelector<HTMLSelectElement>("#exportMode")!;
const maxDurationInput = document.querySelector<HTMLInputElement>("#maxDurationMinutes")!;
const maxEventsInput = document.querySelector<HTMLInputElement>("#maxEvents")!;
const maxScreenshotsInput = document.querySelector<HTMLInputElement>("#maxScreenshots")!;
const idleTimeoutInput = document.querySelector<HTMLInputElement>("#idleTimeoutMinutes")!;
const limitInputs = [maxDurationInput, maxEventsInput, maxScreenshotsInput, idleTimeoutInput];

exportModeSelect.addEventListener("change", async () => {
  await send("set-export-mode", exportModeSelect.value as ExportMode);
  markSaved();
});

for (const input of limitInputs) {
  input.addEventListener("change", async () => {
    await send("set-limits", undefined, readLimits());
    markSaved();
  });
}

void refresh();

async function refresh(): Promise<void> {
  const state = await send("get-state");
  render(state);
}

async function send(command: RuntimeMessage["command"], exportMode?: ExportMode, limits?: CaptureLimits): Promise<PopupState> {
  return chrome.runtime.sendMessage({ source: "site-capture", command, exportMode, limits } satisfies RuntimeMessage);
}

function render(state: PopupState): void {
  exportModeSelect.value = state.exportMode ?? "full";
  if (state.limits) renderLimits(state.limits);
}

function readLimits(): CaptureLimits {
  return {
    maxDurationMinutes: Number(maxDurationInput.value),
    maxEvents: Number(maxEventsInput.value),
    maxScreenshots: Number(maxScreenshotsInput.value),
    idleTimeoutMinutes: Number(idleTimeoutInput.value)
  };
}

function renderLimits(limits: CaptureLimits): void {
  maxDurationInput.value = String(limits.maxDurationMinutes);
  maxEventsInput.value = String(limits.maxEvents);
  maxScreenshotsInput.value = String(limits.maxScreenshots);
  idleTimeoutInput.value = String(limits.idleTimeoutMinutes);
}

function markSaved(): void {
  saveStatusEl.textContent = "已保存";
  window.setTimeout(() => {
    saveStatusEl.textContent = "已同步";
  }, 1200);
}
