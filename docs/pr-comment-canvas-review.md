Canvas LMS review: security, architecture and compliance hardening

## Summary
- Added base URL override guard to avoid per-call host overrides unless explicitly enabled.
- Added response-body redaction for OAuth/API error paths.
- Documented security expectations and residual risks.

## Risks found
- Base URL override via tool args allowed untrusted host targeting (SSRF risk in untrusted contexts).
- OAuth/token error bodies were returned verbatim in error messages.

## Changes applied
- `src/canvas-lms-tool.ts`: guard baseUrl override; redact sensitive fields in error bodies.
- `openclaw.plugin.json`: expose `allowBaseUrlOverride`.
- `README.md`: security guidance for OAuth and multi-user tokens.
- `docs/canvas-security-review.md`: scope, findings, and residual risks.

## Validations and tests
- No automated tests run (no test runner configured in this repo).

## Residual risks / external dependencies
- OAuth client configuration, scopes, and token storage are managed outside the repo.
- Multi-tenant isolation depends on host configuration and per-tenant token management.

## Final recommendation
- Safe to merge; follow-up work should add a minimal test harness and validate OAuth against a real Canvas tenant.
