# Security Policy

## Supported versions

This plugin is community-maintained by Kansodata.
Only the latest published npm version is considered supported for security fixes.

## Reporting a vulnerability

Please report security issues privately:

- Email: security@kansodata.com
- GitHub Security Advisory (preferred): https://github.com/Kansodata/openclaw-canvas-lms/security/advisories/new

Please do not open public issues for suspected vulnerabilities.

## Security baseline for this plugin

- Canvas credentials/tokens must be provided via plugin config or environment variables.
- Do not place secrets in tool arguments unless explicitly enabled for legacy migration.
- HTTPS is required by default for Canvas base URL and OAuth token URL.
- OAuth2 with minimum scopes is recommended for multi-user/institutional environments.
- Logs and errors must not expose tokens or client secrets.
