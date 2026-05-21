# Phase 5: Custom Route Exceptions - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21
**Phase:** 05-custom-route-exceptions-ip
**Areas discussed:** Domain exceptions scope, Where exceptions live, Management UX on RPi, Discovery flow (Phase 4 logging → exception), Exception format, Deploy integration

---

## Domain Exceptions Scope

| Option | Description | Selected |
|--------|-------------|----------|
| IP/CIDR only | Same mechanism as RU subnets — add specific host IPs or ranges to route via ISP. Use vpn-status.sh to find IPs. Domains resolved manually once before adding. | ✓ |
| Domains + IPs (full scope) | Support hostnames like 'steampowered.com' that auto-resolve. Requires ipset + dnsmasq --ipset. Robust but 2-3x more setup. | |

**User's choice:** IP/CIDR only
**Notes:** No domain-based routing at this stage. Domain routing deferred to future phase if needed.

---

## Where Exceptions Live

| Option | Description | Selected |
|--------|-------------|----------|
| File in repo + redeploy | exceptions.txt in repo (gitignored). Edit on workstation, deploy.sh pushes. Keeps config versioned. | ✓ |
| File on RPi only, no redeploy | /etc/vpn-exceptions.txt on RPi, edited via SSH. No repo change. | |
| Both (repo canonical + direct RPi edits) | Repo file authoritative; direct SSH edits work until next deploy. | |

**User's choice:** Discovery on RPi → form file locally → deploy (repo-managed)
**Notes:** "Detection will happen on the Raspberry itself, then I will form the file locally and do a deploy. There should be an example file. The file itself should be added to gitignore. The example file is not deployed." → Repo path: `config/white-list-extended.txt` (gitignored), example: `config/white-list-extended.txt.example` (committed, not deployed).

---

## Discovery Flow (Phase 4 Logging → Exception)

| Option | Description | Selected |
|--------|-------------|----------|
| vpn-status.sh extended | Add --via=vpn / --via=isp flags to filter by routing decision. | ✓ |
| No change — existing vpn-status.sh is enough | Filter output manually. | |
| New show-exceptions.sh | Separate helper showing active exceptions + candidates. | |

**User's choice:** Extend vpn-status.sh with `--via=vpn` / `--via=isp` flags (composable with existing --filter, --device, --last)
**Notes:** User clarified the primary use case: "I need to extract only those routes that go through VPN." The discovery flow is: run `sudo vpn-status.sh --via=vpn` on RPi → identify IPs → add to `config/white-list-extended.txt` locally → deploy.

---

## Exception File Format

| Option | Description | Selected |
|--------|-------------|----------|
| One CIDR/IP per line, # comments | Same format as vpn-ru-subnets.txt. | |
| IP with optional label (IP # description) | e.g. '1.2.3.4/32 # Steam CDN'. | |
| Same format as iplist output | Identical to downloaded white-list.txt — one CIDR per line, no comments/labels. | ✓ |

**User's choice:** "Same format as the list downloaded from iplist" — one CIDR per line, no labels.
**Notes:** File absent at routing.sh run time → skip silently, no error.

---

## File Rename

| Option | Description | Selected |
|--------|-------------|----------|
| /etc/vpn-exceptions.txt | Standard naming. | |
| Rename both files: white-list.txt + white-list-extended.txt | Rename /etc/vpn-ru-subnets.txt → /etc/white-list.txt; new exceptions = /etc/white-list-extended.txt. | ✓ |

**User's choice:** Rename both — `white-list.txt` (RU subnets from iplist) and `white-list-extended.txt` (user exceptions)
**Notes:** Makes both files semantically parallel — both are "whitelists" (ISP bypass); one auto-populated, one user-defined.

---

## Repo Location for Exceptions File

| Option | Description | Selected |
|--------|-------------|----------|
| Root (alongside .env) | Simple. | |
| config/white-list-extended.txt | In config/ subdirectory. | ✓ |

**User's choice:** `config/white-list-extended.txt`

---

## Claude's Discretion

- Exact routing.sh constant name for exceptions file path
- Whether to log count of loaded exception CIDRs (recommended: yes, consistent with RU subnet count log)
- deploy.sh stage number placement (before or after rollback script stage)

## Deferred Ideas

- **Domain-based exceptions** — considered but deferred; would require ipset + dnsmasq --ipset
- **Management helper script** (add-exception.sh) — user chose file-based approach; no RPi-side management script for Phase 5
