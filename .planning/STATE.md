---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-05-19T07:45:00Z"
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 2
  completed_plans: 2
  percent: 100
---

# State: RPi VPN Gateway

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-18)

**Core value:** Non-RU traffic exits through AmneziaWG VPN; RU traffic exits direct via ISP — transparent to LAN devices, survives reboots, fully reversible.
**Current focus:** Phase 1 — Foundation & Config (complete; awaiting human-verify checkpoint)

## Current Phase

**Phase 1: Foundation & Config**

Goal: AmneziaWG installed, config deployed, IP forwarding on, tunnel operational

Status: Both plans complete — awaiting end-of-phase human-verify checkpoint

## Phase Progress

| Phase | Status | Plans | Progress |
|-------|--------|-------|----------|
| 1 — Foundation & Config | ✓ Plans done | 2/2 done | 100% |
| 2 — Routing & NAT | ○ Pending | — | 0% |
| 3 — Autostart, Cron & Rollback | ○ Pending | — | 0% |

## Requirements

- v1 total: 20
- Completed: 4 (INST-01, INST-02 — by install-awg.sh; CONF-01, CONF-02 — by deploy.sh)
- In progress: 0

## Decisions

- D-01: bivlked/RomikB AmneziaWG installer used as primary install path for RPi arm64 (auto-detects +rpt kernel suffix)
- D-02: AWG_DEB_URL env var fallback documented inline in install-awg.sh for manual deb install
- D-03: Script assumes RPi OS already running — no OS install step
- Tunnel bring-up excluded from installer and deploy.sh (not idempotent; left as manual post-deploy step — Pitfall 5)
- D-04: SSH_HOST="pi4" via system ~/.ssh/config — no hardcoded IP in deploy.sh
- D-05/D-06: SSH user ar + BatchMode=yes enforces key auth; password fallback blocked
- D-07/D-08: .env.secrets gitignored; AWG_PRIVATE_KEY/PUBLIC/PRESHARED_KEY variable names canonical
- D-09: sed pipeline substitution of {{PrivateKey}}/{{PublicKey}}/{{PresharedKey}} in amnezia.key.claude.txt
- D-10: validate_key() with ^[A-Za-z0-9+/]{43}=$ regex guards all key use before any SSH operation
- chmod 600 on mktemp BEFORE writing key material (T-01-SEC); trap EXIT for cleanup

## Last Session

**Stopped at:** Completed 01-02-PLAN.md (deploy.sh + .env.secrets.example + .gitignore)
**Timestamp:** 2026-05-19T07:45:00Z
**Resume:** End-of-phase human-verify checkpoint for Phase 1 (run deploy.sh against real pi4)

---
*Initialized: 2026-05-18*
*Updated: 2026-05-19 — Plan 01-02 complete; Phase 1 all plans done*
