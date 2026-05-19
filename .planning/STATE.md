---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-05-19T07:25:19Z"
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 2
  completed_plans: 1
  percent: 50
---

# State: RPi VPN Gateway

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-18)

**Core value:** Non-RU traffic exits through AmneziaWG VPN; RU traffic exits direct via ISP — transparent to LAN devices, survives reboots, fully reversible.
**Current focus:** Phase 1 — Foundation & Config

## Current Phase

**Phase 1: Foundation & Config**

Goal: AmneziaWG installed, config deployed, IP forwarding on, tunnel operational

Status: In progress (Plan 01 complete, Plan 02 pending)

## Phase Progress

| Phase | Status | Plans | Progress |
|-------|--------|-------|----------|
| 1 — Foundation & Config | ◑ In Progress | 1/2 done | 50% |
| 2 — Routing & NAT | ○ Pending | — | 0% |
| 3 — Autostart, Cron & Rollback | ○ Pending | — | 0% |

## Requirements

- v1 total: 20
- Completed: 2 (INST-01, INST-02 — by install-awg.sh)
- In progress: 0

## Decisions

- D-01: bivlked/RomikB AmneziaWG installer used as primary install path for RPi arm64 (auto-detects +rpt kernel suffix)
- D-02: AWG_DEB_URL env var fallback documented inline in install-awg.sh for manual deb install
- D-03: Script assumes RPi OS already running — no OS install step
- Tunnel bring-up excluded from installer (not idempotent; left as manual post-deploy step)

## Last Session

**Stopped at:** Completed 01-01-PLAN.md (scripts/install-awg.sh)
**Timestamp:** 2026-05-19T07:25:19Z
**Resume:** Execute 01-02-PLAN.md (deploy.sh)

---
*Initialized: 2026-05-18*
*Updated: 2026-05-19 — Plan 01-01 complete*
