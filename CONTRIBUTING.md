# Contributing

Thanks for helping improve Site Capture Analyzer.

## Setup

```bash
pnpm install
pnpm build
```

Load the generated `dist` directory as an unpacked extension from `chrome://extensions/`.

## Checks

Run these before opening a pull request:

```bash
pnpm typecheck
pnpm test
pnpm build
```

For browser flow validation:

```bash
pnpm test:e2e
```

## Contribution Rules

- Do not commit real capture exports.
- Do not commit screenshots containing private data.
- Do not commit cookies, tokens, API keys, headers, request bodies, response bodies, or storage dumps from real websites.
- Keep UI copy clear about sensitive data risks.
- Keep extension permission changes narrow and explain why they are needed.
- Prefer focused pull requests over broad unrelated refactors.

## Code Style

- TypeScript is used for extension logic.
- Keep behavior close to existing modules:
  - `src/background/` for session, network, export, and browser APIs.
  - `src/content/` for page DOM and user action capture.
  - `src/injected/` for page-context hooks.
  - `src/popup/`, `src/settings/`, and `src/viewer/` for UI.
  - `src/shared/` for shared types and helpers.

## Testing Capture Changes

When changing capture or export behavior, verify:

- Recording starts and stops.
- Clear resets state.
- Export ZIP contains required files.
- Redacted mode still works.
- Sensitive data warnings remain accurate.
