import { createServer } from "node:http";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import JSZip from "jszip";
import puppeteer from "puppeteer-core";

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const extensionPath = resolve("dist");

if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}. Set CHROME_PATH to override.`);
if (!existsSync(join(extensionPath, "manifest.json"))) throw new Error("dist/manifest.json not found. Run pnpm build first.");

const workDir = await mkdtemp(join(tmpdir(), "site-capture-e2e-"));
const userDataDir = join(workDir, "profile");
const downloadDir = join(workDir, "downloads");
let browser;

const server = createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/next") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html>
      <html>
        <head><title>Capture Fixture</title></head>
        <body>
          <input id="secret" value="">
          <button id="run">Run</button>
          <script>
            localStorage.setItem("local-token", "local-secret-token");
            sessionStorage.setItem("session-token", "session-secret-token");
            document.cookie = "fixture_cookie=cookie-secret; path=/";
            document.querySelector("#run").addEventListener("click", async () => {
              const input = document.querySelector("#secret");
              input.value = "typed-secret";
              input.dispatchEvent(new Event("input", { bubbles: true }));
              await fetch("/api/data", {
                method: "POST",
                headers: { "content-type": "application/json", "authorization": "Bearer fetch-secret" },
                body: JSON.stringify({ token: "fetch-body-secret" })
              });
              await new Promise((resolve) => {
                const xhr = new XMLHttpRequest();
                xhr.onloadend = resolve;
                xhr.open("POST", "/api/xhr");
                xhr.setRequestHeader("x-fixture-token", "xhr-secret");
                xhr.send("xhr-body-secret");
              });
              history.pushState({ routeSecret: "route-secret" }, "", "/next");
              console.log("console-secret");
              document.body.insertAdjacentHTML("beforeend", "<section id='added'>added-dom</section>");
            });
          </script>
        </body>
      </html>`);
    return;
  }
  if (req.url === "/api/data" || req.url === "/api/xhr") {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.writeHead(200, { "content-type": "application/json", "x-fixture-response": "response-secret" });
    res.end(JSON.stringify({ ok: true, echo: body, responseToken: "response-secret" }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

try {
  const baseUrl = await listen(server);
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: process.env.HEADLESS === "true" ? "new" : false,
    enableExtensions: [extensionPath],
    userDataDir,
    args: [
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check"
    ],
    timeout: 15_000,
    protocolTimeout: 15_000
  });

  console.log("browser launched");
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  const pageCdp = await page.createCDPSession();
  await pageCdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, eventsEnabled: true });
  console.log("opening fixture");
  await page.goto(baseUrl, { waitUntil: "load" });
  console.log("fixture loaded");

  console.log("waiting for extension service worker");
  const serviceTarget = await browser.waitForTarget(
    (target) => target.type() === "service_worker" && target.url().includes("assets/background.js"),
    { timeout: 10_000 }
  ).catch(() => {
    const targets = browser.targets().map((target) => ({ type: target.type(), url: target.url() }));
    throw new Error(`Extension service worker target was not found. Targets: ${JSON.stringify(targets, null, 2)}`);
  });
  const worker = await serviceTarget.worker();
  if (!worker) throw new Error("Extension service worker was not available.");
  const extensionId = new URL(serviceTarget.url()).hostname;
  const controller = await browser.newPage();
  await controller.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
  console.log(`extension loaded: ${extensionId}`);

  console.log("starting recording");
  await controller.evaluate(async (targetUrl) => {
    const [tab] = await chrome.tabs.query({ url: `${targetUrl}*` });
    if (!tab?.id) throw new Error("Fixture tab not found.");
    await chrome.tabs.update(tab.id, { active: true });
    return chrome.runtime.sendMessage({ source: "site-capture", command: "start-recording" });
  }, baseUrl);
  console.log("recording started");
  const clearedState = await controller.evaluate(() => chrome.runtime.sendMessage({ source: "site-capture", command: "clear-recording" }));
  if (clearedState.status !== "idle" || clearedState.eventCount !== 0 || clearedState.requestCount !== 0) {
    throw new Error(`Clear did not reset state: ${JSON.stringify(clearedState)}`);
  }
  console.log("clear verified");
  await controller.evaluate(async (targetUrl) => {
    const [tab] = await chrome.tabs.query({ url: `${targetUrl}*` });
    if (!tab?.id) throw new Error("Fixture tab not found.");
    await chrome.tabs.update(tab.id, { active: true });
    return chrome.runtime.sendMessage({ source: "site-capture", command: "start-recording" });
  }, baseUrl);
  console.log("recording restarted");
  await page.waitForFunction(() => document.readyState === "complete");
  console.log("running fixture actions");
  await page.click("#run");
  await page.waitForFunction(() => location.pathname === "/next" && Boolean(document.querySelector("#added")));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  console.log("stopping recording");
  await controller.evaluate(() => chrome.runtime.sendMessage({ source: "site-capture", command: "stop-recording" }));
  console.log("exporting recording");
  await controller.evaluate(() => chrome.runtime.sendMessage({ source: "site-capture", command: "export-recording" }));

  console.log("waiting for zip");
  const zipPath = await waitForDownload(downloadDir);
  console.log(`zip downloaded: ${zipPath}`);
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  const required = ["manifest.json", "timeline.jsonl", "network.jsonl", "dom-snapshots.jsonl", "user-actions.jsonl", "storage.json", "ai-summary.md", "behavior-summary.md", "site-analysis.md", "screenshots.jsonl"];
  for (const name of required) {
    if (!zip.file(name)) throw new Error(`Missing export file: ${name}`);
  }

  const timeline = await zip.file("timeline.jsonl").async("string");
  const network = await zip.file("network.jsonl").async("string");
  const storage = await zip.file("storage.json").async("string");
  const actions = await zip.file("user-actions.jsonl").async("string");
  const dom = await zip.file("dom-snapshots.jsonl").async("string");
  const behavior = await zip.file("behavior-summary.md").async("string");
  const analysis = await zip.file("site-analysis.md").async("string");
  const screenshots = await zip.file("screenshots.jsonl").async("string");
  const eventTypes = timeline
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).type)
    .reduce((acc, type) => {
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {});
  console.log(`event types: ${JSON.stringify(eventTypes)}`);

  assertIncludes(timeline, "session.started");
  assertIncludes(timeline, "session.stopped");
  assertIncludes(timeline, "navigation");
  assertIncludes(network, "fetch-body-secret");
  assertIncludes(network, "response-secret");
  assertIncludes(storage, "local-secret-token");
  assertIncludes(storage, "fixture_cookie");
  assertIncludes(actions, "typed-secret");
  assertIncludes(dom, "added-dom");
  assertIncludes(actions, "contextText");
  assertIncludes(behavior, "typed-secret");
  assertIncludes(analysis, "fetch-body-secret");
  assertIncludes(screenshots, "screenshots/");
  if (!Object.keys(zip.files).some((name) => name.startsWith("screenshots/") && name.endsWith(".png"))) {
    throw new Error("Expected at least one screenshot PNG in export.");
  }

  console.log(JSON.stringify({ ok: true, zipPath, requiredFiles: required }, null, 2));
} finally {
  server.close();
  if (browser) await Promise.race([
    browser.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
  await rm(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(() => undefined);
}

function listen(httpServer) {
  return new Promise((resolveListen) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      resolveListen(`http://127.0.0.1:${address.port}/`);
    });
  });
}

async function waitForDownload(downloadPath) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const files = await readdir(downloadPath).catch(() => []);
    const zip = files.find((file) => file.endsWith(".zip"));
    if (zip) return join(downloadPath, zip);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Export zip was not downloaded.");
}

function assertIncludes(value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Expected export to include ${expected}`);
  }
}
