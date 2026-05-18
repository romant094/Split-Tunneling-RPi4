# Phase 1: Foundation & Config - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 01-foundation-config
**Areas discussed:** AmneziaWG install method, deploy.sh authentication, Key injection into awg0.conf

---

## AmneziaWG Install Method

| Option | Description | Selected |
|--------|-------------|----------|
| Official installer script | curl \| bash from amnezia.org — simplest, may lag behind latest | ✓ |
| Build from source | Clone amneziawg-go + tools, compile on RPi — most control, slow build | |
| Pre-built deb/binary | Download specific release deb from GitHub releases — fast, version-pinned | |

**User's choice:** Official installer script
**Notes:** Fallback if installer fails: pre-built GitHub release deb (not source build). RPi OS already installed and running — no OS setup step needed.

---

## deploy.sh Authentication

| Option | Description | Selected |
|--------|-------------|----------|
| SSH key | ssh-copy-id pre-done; deploy.sh uses key auth — no prompts | ✓ |
| SSH password | sshpass required; password in env var | |
| Manual — no deploy script | deploy.sh prints commands, user runs manually | |

**User's choice:** SSH key via system SSH config
**Notes:** 
- SSH host alias in system config: `pi4`
- RPi SSH user: `ar` (not default `pi`)
- User `ar` has passwordless sudo

---

## Key Injection into awg0.conf

| Option | Description | Selected |
|--------|-------------|----------|
| deploy.sh prompts interactively | Script asks for each key, substitutes via sed — keys never touch disk | |
| User edits template locally | User fills keys into local .gitignored copy, deploy.sh SCPs that file | |
| Keys stored in .env.secrets | Local .gitignored file; deploy.sh reads + substitutes via sed | ✓ |

**User's choice:** `.env.secrets` file with variables `AWG_PRIVATE_KEY`, `AWG_PUBLIC_KEY`, `AWG_PRESHARED_KEY`
**Notes:** deploy.sh validates keys before deploying (non-empty + basic base64 format check). Fails fast with clear error if invalid.

---

## Claude's Discretion

- Exact sed substitution implementation (inline pipeline vs temp file)
- Whether deploy.sh verifies SSH connectivity before starting
- Error message wording for validation failures

## Deferred Ideas

None — discussion stayed within phase scope.
