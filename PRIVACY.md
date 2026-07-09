# Privacy Notice

Site Capture Analyzer records website activity locally in your browser and exports the captured data to a local ZIP file.

## Data The Extension May Capture

Depending on the website and your actions, an export may contain:

- Page HTML and DOM mutations.
- User actions, including clicks, scrolls, focus events, form changes, pasted text, and typed input.
- URLs and navigation history during the recording session.
- Network request and response metadata.
- Request headers and response headers.
- Request bodies and response bodies visible to page-level fetch/XHR hooks.
- Cookies for recorded domains.
- `localStorage` and `sessionStorage`.
- Screenshots of the active tab.
- Console output and runtime errors.

## Where Data Goes

The extension is designed to store and export data locally. It does not intentionally upload captured data to a remote service.

Exported ZIP files are created on your machine through the browser downloads API.

## Sensitive Data Warning

Captured data may include:

- Cookies and session identifiers.
- Authentication tokens.
- Personal information.
- Business data.
- Password-like or secret values typed into forms.
- Private API request and response bodies.

Only record websites that you are authorized to analyze. Only share exports with trusted recipients.

## Redaction

The extension includes an automatic redacted export mode. Redaction is best-effort and should not be treated as a guarantee that all sensitive data has been removed.

Before publishing, sending, or attaching an export, manually inspect it.

## Data Retention

Recorded data is held in the extension background process while a session is active or stopped. Use `清除` to remove the current in-memory session. Exported ZIP files remain wherever your browser downloads them until you delete them.

## Open Source Contributions

Do not submit real capture exports, screenshots, cookies, tokens, headers, request bodies, response bodies, or private website data in issues, pull requests, tests, or examples.
