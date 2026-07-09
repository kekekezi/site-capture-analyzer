import JSZip from "jszip";
import "./viewer.css";

const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const summaryEl = document.querySelector<HTMLElement>("#summary")!;
const behaviorEl = document.querySelector<HTMLElement>("#behavior")!;
const analysisEl = document.querySelector<HTMLElement>("#analysis")!;
const shotsEl = document.querySelector<HTMLElement>("#screenshots")!;

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifest = await readJson(zip, "manifest.json");
  const timeline = await readJsonl(zip, "timeline.jsonl");
  const screenshots = await readJsonl(zip, "screenshots.jsonl");
  behaviorEl.textContent = await readText(zip, "behavior-summary.md");
  analysisEl.textContent = await readText(zip, "site-analysis.md");
  summaryEl.innerHTML = [
    item("\u4e8b\u4ef6", String(timeline.length)),
    item("\u8bf7\u6c42", String(timeline.filter((event) => String(event.type).startsWith("network.")).length)),
    item("Tab", String(manifest.trackedTabIds?.length ?? manifest.session?.tabIds?.length ?? 0)),
    item("\u622a\u56fe", String(screenshots.length)),
    item("\u6a21\u5f0f", manifest.exportMode ?? "full")
  ].join("");

  shotsEl.innerHTML = "";
  for (const shot of screenshots.slice(0, 50)) {
    const fileEntry = zip.file(shot.filename);
    if (!fileEntry) continue;
    const blob = await fileEntry.async("blob");
    const figure = document.createElement("figure");
    const img = document.createElement("img");
    img.src = URL.createObjectURL(blob);
    const caption = document.createElement("figcaption");
    caption.textContent = `${shot.reason} ${shot.url ?? ""}`;
    figure.append(img, caption);
    shotsEl.append(figure);
  }
});

async function readText(zip: JSZip, name: string): Promise<string> {
  return (await zip.file(name)?.async("string")) ?? "";
}

async function readJson(zip: JSZip, name: string): Promise<Record<string, any>> {
  const text = await readText(zip, name);
  return text ? JSON.parse(text) : {};
}

async function readJsonl(zip: JSZip, name: string): Promise<Array<Record<string, any>>> {
  const text = await readText(zip, name);
  return text.trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function item(label: string, value: string): string {
  return `<div><span>${label}</span><strong>${value}</strong></div>`;
}
