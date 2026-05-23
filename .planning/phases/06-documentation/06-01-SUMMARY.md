---
phase: 06-documentation
plan: "01"
subsystem: docs
tags: [readme, ops-runbook, vpn, amneziawg, routing, split-tunnel]

requires:
  - phase: 05-custom-route-exceptions-ip
    provides: white-list-extended.txt deploy pattern, vpn-status.sh --via flag
  - phase: 04-traffic-logging-visibility-vpn-isp
    provides: vpn-status.sh, watch-routes.py, dnsmasq, iptables LOG rules
  - phase: 03-autostart-cron-rollback
    provides: vpn-rollback.sh, update-vpn-routes, systemd services, cron
  - phase: 02-routing-nat
    provides: routing.sh, split-tunnel logic, MASQUERADE rules
  - phase: 01-foundation-config
    provides: deploy.sh, awg0.conf, vpn-gateway.env, install-awg.sh

provides:
  - README.md at repo root — complete English-language ops runbook for the RPi VPN Gateway

affects:
  - 06-02-PLAN.md (Russian translation — README.md is the source)

tech-stack:
  added: []
  patterns:
    - "Docs-as-runbook: all operational workflows documented with exact commands + expected output"
    - "Symptom→Cause→Fix: each troubleshooting entry follows 3-line pattern"
    - "CLI reference inline: all script flags and examples in one place, not per-script files"

key-files:
  created:
    - README.md
  modified: []

key-decisions:
  - "CLI reference inline in README.md, not per-script files (D-04)"
  - "Stage groups documented at high level, not individual stage numbers (D-08)"
  - "install-awg.sh documented as internal only — no CLI reference (D-09)"
  - "NM carrier-change gotcha (260523-nmr) added as 8th troubleshooting entry"

patterns-established:
  - "Troubleshooting: Symptom → Cause → Fix (3-line pattern per entry)"
  - "Phase links table at bottom for dev history/traceability"
  - "Quick Tasks subsection for out-of-band work IDs"

requirements-completed: []

duration: 20min
completed: "2026-05-23"
---

# Phase 6 Plan 01: README.md — English Ops Runbook Summary

**Full-coverage ops runbook: README.md (751 lines, 10 sections, 6 script CLI references, 8 troubleshooting gotchas) for the RPi VPN Gateway.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-23T~05:00Z
- **Completed:** 2026-05-23T05:01:44Z
- **Tasks:** 1
- **Files created:** 1

## Accomplishments

- Created `README.md` (751 lines) covering all 12 plan-specified sections in correct order
- Full CLI reference for all 6 user-facing scripts: `deploy.sh`, `routing.sh`, `vpn-status.sh`, `vpn-rollback.sh`, `update-vpn-routes`, `watch-routes.py` — all flags and 2+ examples each
- 8 troubleshooting gotchas in symptom→cause→fix format including: FORWARD chain DROP, LOG-before-ACCEPT ordering, eth0 MASQUERADE LAN exclusion, dnsmasq install order, tunnel idempotency, empty vpn-status.sh output, raw IP domain column, and NM carrier-change route flush (260523-nmr)
- Custom exceptions discovery-to-deploy walkthrough (5 numbered steps from `--via=vpn` to verify)
- Rollback section with explicit "removes" vs "preserves" lists
- Phase links table for all 6 phases + Quick Tasks table with 260521-jex and 260523-nmr

## Task Commits

1. **Task 1: Write README.md — English ops runbook (all 12 sections)** - `856481a` (docs)

**Plan metadata:** (SUMMARY commit — committed next)

## Files Created/Modified

- `README.md` — Complete English-language ops runbook; 751 lines; 10 top-level sections; CLI reference for 6 scripts; 8 troubleshooting gotchas; phase links table

## Decisions Made

- Documented `install-awg.sh` as internal-only (no full CLI reference) per D-09
- Stage groups described at high level (install / config / routing / autostart / logging / exceptions / activation), not 23 individual stage numbers per D-08
- NM dispatcher section (`10-vpn-routes`, carrier-change gotcha) added as 8th troubleshooting entry — not in original plan D-14 list, but required by `must_haves.truths` item about 260523-nmr gotcha
- `vpn-rollback.sh` preserves list updated from actual script comments (dnsmasq.conf and vpn-status.sh remain on disk but service is stopped)

## Deviations from Plan

None — plan executed exactly as written. All 12 sections, 6 CLI references, 8+ troubleshooting gotchas, and all acceptance criteria satisfied.

## Issues Encountered

None.

## Known Stubs

None — README.md is documentation only; no data sources or UI components.

## Threat Flags

None — README.md contains no secrets. Variable names (`AWG_PRIVATE_KEY`, etc.) are documented by name only, not value. `.env.secrets` is explicitly documented as gitignored and never committed. This matches threat register T-06-01 (Information Disclosure: accept).

## Self-Check

- [x] `README.md` exists at repo root
- [x] Line count: 751 (>= 400 required)
- [x] Top-level sections: 10 (>= 10 required)
- [x] Russian link in first 5 lines: `[Документация на русском](docs/README.ru.md)`
- [x] Symptom: entries: 8 (>= 5 required)
- [x] `--no-run` documented
- [x] `--via=vpn` documented
- [x] `--no-update` documented
- [x] `--no-dns` documented
- [x] `white-list-extended.txt` present
- [x] `FORWARD chain` present
- [x] `.planning/phases/01-foundation-config/` present
- [x] `.planning/phases/06-documentation/` present
- [x] `260523-nmr` present
- [x] `10-vpn-routes` and `dispatcher` present
- [x] Commit `856481a` exists

## Self-Check: PASSED

## Next Phase Readiness

- Plan 06-02 (Russian translation `docs/README.ru.md`) uses this README.md as the source
- All content is in English; Russian plan translates the complete document

---
*Phase: 06-documentation*
*Completed: 2026-05-23*
