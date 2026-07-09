# Security Policy

## Reporting Security Issues

If you find a vulnerability, please report it privately to the project maintainer instead of opening a public issue with exploit details.

If this repository does not list a private contact yet, open a minimal public issue asking for a security contact without including sensitive details.

## Sensitive Data Rules

Never commit or attach:

- Cookies.
- Tokens.
- API keys.
- Passwords.
- Real request or response bodies.
- Real exported ZIP files.
- Screenshots containing private data.
- Storage dumps from real websites.

## Threat Model

This extension intentionally has broad browser permissions so it can analyze websites. It can capture sensitive browser and website data during recording. Treat it as a local forensic/debugging tool, not as a privacy-preserving analytics product.

Important limitations:

- Automatic redaction is best-effort.
- Exported data can contain secrets.
- Browser extension APIs may expose data differently across Chrome/Edge versions.
- Some pages, frames, or browser-internal URLs may block capture.

## Development Guidance

- Keep capture behavior explicit and user-initiated.
- Avoid adding remote upload behavior.
- Keep sensitive warnings visible in the UI and documentation.
- Prefer local-only processing for exports and summaries.
- Review permission changes carefully.
- Add tests for redaction and export structure when capture behavior changes.
