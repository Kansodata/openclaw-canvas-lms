# openclaw-canvas-lms

Third-party Canvas LMS plugin for OpenClaw, maintained by Kansodata.

## Support and compatibility

- Maintainer: Kansodata.
- Distribution: npm package `@kansodata/openclaw-canvas-lms`.
- Expected runtime: Node 22+.
- OpenClaw compatibility target: `openclaw >= 2026.1.0` (see `peerDependencies`).

Architecture and security posture:

- Uses only public plugin APIs (`openclaw/plugin-sdk`), no internal `src/*` imports.
- Enforces HTTPS by default for Canvas endpoints and OAuth token exchange.
- Defaults to safer auth paths (OAuth or config/env token) and blocks inline token usage unless explicitly enabled.
- Applies bounded retries/timeouts and pagination limits to reduce abuse and runaway calls.
- Requires a configured Canvas base URL by default (per-call override is disabled unless explicitly enabled).

## Install

```bash
openclaw plugins install @kansodata/openclaw-canvas-lms --pin
```

## Enable

```bash
openclaw plugins enable canvas-lms
```

Package name: `@kansodata/openclaw-canvas-lms`  
Plugin id: `canvas-lms`

## Minimal config

```json
{
  "plugins": {
    "entries": {
      "canvas-lms": {
        "enabled": true,
        "config": {
          "baseUrl": "https://canvas.example.edu",
          "token": "<CANVAS_API_TOKEN>",
          "requestTimeoutMs": 20000,
          "maxRetries": 2
        }
      }
    }
  }
}
```

## Notes

- HTTPS is expected by default.
- Keep `allowInlineToken` disabled unless you explicitly need legacy behavior.
- Prefer OAuth with a Canvas Developer Key and minimum required scopes for multi-user deployments.
- Avoid reusing personal access tokens across multiple users or tenants.
- `sync_academic_digest` returns a digest payload; publication to Discord/Teams/WhatsApp/Telegram should be done by host automation/workflows.
- This plugin is designed to be maintained outside `openclaw/openclaw` and listed under community plugins.

## Teams Academic Chat (MVP)

- Guide: `docs/msteams-academic-chat-mvp.md`
- Config example: `examples/openclaw-config.canvas-msteams.jsonc`
- Intent examples: `examples/chat-intents.md`

Important: this plugin returns digest/data payloads (including `sync_academic_digest`) and does not publish directly to Teams. Delivery to Teams DM should be implemented in host-side automation/workflows.

## Risk controls

- Run `npm run verify` before each tag/release.
- Keep credentials out of source code and examples.
- Prefer OAuth2 for multi-user deployments.
- Use per-tenant/per-institution configuration boundaries.
- Review dependency updates and publish notes with each release.

## Architecture

```mermaid
flowchart LR
  User[Operator / Agent] -->|tool call| Gateway[OpenClaw Gateway]
  Gateway --> Plugin[canvas-lms plugin]
  Plugin -->|resolve auth| Auth[OAuth refresh or token]
  Auth --> Secrets[Secure config/env storage]
  Plugin -->|HTTPS requests| CanvasAPI[Canvas LMS REST API]
  CanvasAPI --> Plugin
  Plugin --> Gateway
  Gateway --> User
```

## Project positioning

### Community Edition

This repository is maintained by Kansodata as the Community Edition of the Canvas LMS integration for OpenClaw.
It provides the public open-source foundation of the integration.

### Commercial / Enterprise offering

Kansodata may offer separate commercial or institutional services around this integration, including:

- implementation services
- managed deployments
- enterprise hardening
- institutional integrations
- support and SLA-backed operations
- custom features
- hosted or private deployments

Public availability of this repository does not imply that all present or future Kansodata offerings are released under the same terms.

### Licensing clarification

This public repository remains licensed under MIT, as declared in this project.
That license applies to the code and materials published in this repository.

### Branding and trademarks

Kansodata and related branding are reserved by their respective owner.
The open-source license for this repository does not grant trademark rights.

## License

MIT
