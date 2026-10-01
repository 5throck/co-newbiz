# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | ✅        |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, **do not open a public GitHub issue**.

Instead, please report it privately via one of the following channels:

- **GitHub Security Advisory**: [Report a vulnerability](https://github.com/5throck/co-newbiz/security/advisories/new)
- **Email**: None — contact the repo owner [@5throck](https://github.com/5throck) directly via GitHub

### What to include

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Any suggested fixes or mitigations

### Response timeline

- **Acknowledgement**: within 48 hours
- **Initial assessment**: within 7 days
- **Patch release**: within 30 days for critical issues

We appreciate responsible disclosure and will credit reporters (unless anonymity is requested).

## Scope & Threat Model

> For the full security scope, threat model, and data-handling policy, see [docs/security.md](docs/security.md), [docs/security/security-model.md](docs/security/security-model.md), and [docs/security/security-baseline.md](docs/security/security-baseline.md).

## Secrets Management

- All `.env*` files (including `.env.prod`) are gitignored; only `.env.sample` placeholders are committed.
- Runtime secrets enter the container exclusively via `env_file` (`docker-compose.yml`), never baked into the image.
- Pre-commit and CI gitleaks scanning covers git-tracked content, including `memory/` session logs (allowlist restored to fleet baseline policy, 2026-10-01).
