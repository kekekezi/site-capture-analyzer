# Site Capture Analyzer / 网站记录器

网站记录器是一个 Chrome/Edge 浏览器扩展，用于记录一次网站分析过程。它可以采集页面状态、用户操作、地址变化、存储、Cookie、网络请求、页面可见的请求/响应体、截图，并导出为本地 ZIP 文件，方便后续分析和复盘。

Site Capture Analyzer is a Chrome/Edge extension for recording a website analysis session. It captures page state, user actions, navigation changes, storage, cookies, network metadata, page-visible request/response bodies, screenshots, and exports everything as a local ZIP package.

> 安全提示：导出文件可能包含 Cookie、Token、请求体、响应体、截图和用户输入内容。请只在可信环境中使用和分享。
>
> Security warning: exported files may contain cookies, tokens, request bodies, response bodies, screenshots, and typed input. Use and share exports only in trusted environments.

## 界面预览 / Screenshots

### 插件弹窗 / Extension Popup

![Extension popup preview](./docs/assets/popup-preview.png)

### 导出查看器 / Export Viewer

![Export viewer preview](./docs/assets/viewer-preview.png)

## 中文说明

### 功能

- 记录页面快照和 DOM 变化。
- 记录用户操作，包括点击、输入、滚动、聚焦、粘贴、提交和按键事件。
- 记录网络请求/响应元信息，以及页面 fetch/XHR 可读取的请求体和响应体。
- 记录 `localStorage`、`sessionStorage` 和 Cookie。
- 跟踪录制页面产生的地址变化和新标签页。
- 在关键时刻自动截图。
- 导出包含时间线、网络、DOM、存储、行为摘要、网站分析和截图的 ZIP 文件。
- 内置导出查看器。
- 支持完整保留和自动脱敏两种导出模式。
- 支持自动停止保护：最长录制时长、最大事件数、最大截图数、空闲停止时间。
- 录制中工具栏图标会切换到记录状态。

### 开发安装

```bash
pnpm install
pnpm build
```

然后打开 `chrome://extensions/`，启用“开发者模式”，点击“加载已解压的扩展程序”，选择 `dist` 目录。

源码修改后需要重新构建：

```bash
pnpm build
```

然后在 `chrome://extensions/` 中刷新扩展。

### 使用方式

1. 打开目标网站。
2. 点击扩展图标。
3. 点击 `开始` 开始录制。
4. 执行需要分析的操作。
5. 点击 `停止`，或等待自动停止保护触发。
6. 点击 `导出` 下载 ZIP 文件。
7. 点击 `打开查看器` 查看导出内容。

弹窗右上角齿轮按钮可配置：

- 导出模式：完整保留 / 自动脱敏。
- 最长录制时长。
- 最大事件数。
- 最大截图数。
- 空闲自动停止时间。

### 导出内容

典型导出包包含：

- `manifest.json`
- `timeline.jsonl`
- `network.jsonl`
- `dom-snapshots.jsonl`
- `user-actions.jsonl`
- `storage.json`
- `screenshots.jsonl`
- `screenshots/*.png`
- `ai-summary.md`
- `behavior-summary.md`
- `site-analysis.md`

### 安全与隐私

这个项目有较强的数据采集能力，可能采集敏感信息。使用或贡献前请阅读 [PRIVACY.md](./PRIVACY.md) 和 [SECURITY.md](./SECURITY.md)。

不要提交真实采集导出包、截图、Cookie、Token、请求体、响应体或存储数据。`.gitignore` 已排除常见导出路径，但发布前仍需要人工检查。

### 开发命令

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm test:e2e` 会启动 Chrome，并加载 `dist` 中构建好的扩展。

## English

### Features

- Record page snapshots and DOM mutations.
- Capture user actions such as clicks, input, scroll, focus, paste, submit, and key events.
- Capture network request/response metadata and page-visible fetch/XHR bodies.
- Capture `localStorage`, `sessionStorage`, and cookies.
- Track navigation and tabs opened from a recorded page.
- Capture screenshots during key moments.
- Export a ZIP package with timeline, network, DOM, storage, behavior summary, site analysis, and screenshots.
- Built-in viewer page for exported data.
- Configurable full/redacted export modes.
- Configurable auto-stop protection: maximum duration, event count, screenshot count, and idle timeout.
- Toolbar icon changes while recording.

### Development Install

```bash
pnpm install
pnpm build
```

Then open `chrome://extensions/`, enable Developer mode, choose "Load unpacked", and select the `dist` directory.

After source changes, rebuild:

```bash
pnpm build
```

Then refresh the extension in `chrome://extensions/`.

### Usage

1. Open the target website.
2. Click the extension icon.
3. Click `开始` to start recording.
4. Perform the actions you want to analyze.
5. Click `停止`, or let auto-stop protection stop recording.
6. Click `导出` to download the ZIP package.
7. Click `打开查看器` to inspect an export.

Use the gear icon in the popup to configure:

- Export mode: full or redacted.
- Maximum recording duration.
- Maximum event count.
- Maximum screenshot count.
- Idle auto-stop timeout.

### Export Contents

A typical export contains:

- `manifest.json`
- `timeline.jsonl`
- `network.jsonl`
- `dom-snapshots.jsonl`
- `user-actions.jsonl`
- `storage.json`
- `screenshots.jsonl`
- `screenshots/*.png`
- `ai-summary.md`
- `behavior-summary.md`
- `site-analysis.md`

### Security And Privacy

This project is intentionally powerful and can collect sensitive data. Read [PRIVACY.md](./PRIVACY.md) and [SECURITY.md](./SECURITY.md) before using or contributing.

Do not commit real capture exports, screenshots, cookies, tokens, request bodies, response bodies, or storage dumps. The `.gitignore` excludes common export paths, but you are still responsible for reviewing changes before publishing.

### Development

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm test:e2e` launches Chrome and loads the built extension from `dist`.

## License / 许可证

MIT. See [LICENSE](./LICENSE).
