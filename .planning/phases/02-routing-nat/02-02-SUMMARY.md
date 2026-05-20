---
phase: 02-routing-nat
plan: "02"
subsystem: infra
tags: [bash, ssh, scp, routing, iptables, split-tunnel, deploy]

# Dependency graph
requires:
  - phase: 02-01
    provides: scripts/routing.sh (split-tunnel routing + NAT script deployed to /etc/routing.sh)
  - phase: 01-02
    provides: deploy.sh Phase 1 deploy orchestrator (Stages 1-9, SSH patterns, SCP /tmp staging)
provides:
  - deploy.sh extended to cover Phase 1 + 2 in a single ./deploy.sh invocation
  - Stage 10: SCP scripts/routing.sh to RPi /etc/routing.sh with chmod +x
  - Stage 11: activate routing.sh automatically (or skip with --no-run flag)
  - --no-run flag for debugging first activation manually
affects:
  - 03-autostart (Phase 3 uses deploy.sh as the deployment vehicle)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SCP to /tmp then sudo mv + chmod — same /tmp staging pattern as Phase 1 config files"
    - "--no-run flag for optional activation step in deploy script"
    - "TOTAL_STAGES counter extended as new stages are added per phase"

key-files:
  created: []
  modified:
    - deploy.sh

key-decisions:
  - "D-11 honored: routing.sh deployed via SCP /tmp staging then sudo mv + chmod +x, matching Phase 1 pattern"
  - "D-12 honored: --no-run flag parsed at script start; without it, routing.sh runs automatically after deploy"
  - "TOTAL_STAGES incremented from 9 to 11 for the two new Phase 2 stages"
  - "Stage 9 changed from final summary to Phase 1 checkpoint message — pipeline continues to Phase 2"

patterns-established:
  - "Pattern: Phase N stages extend TOTAL_STAGES counter; each new phase block appended after prior phase stages"
  - "Pattern: --no-run flag for conditional activation allows safe first-deploy inspection"

requirements-completed: []

# Metrics
duration: 15min
completed: 2026-05-20
---

# Phase 02 Plan 02: Deploy.sh Phase 2 Extension Summary

**deploy.sh extended to deliver scripts/routing.sh to /etc/routing.sh on RPi and optionally activate the split-tunnel in one command, with --no-run flag for manual debugging**

## Performance

- **Duration:** 15 min
- **Started:** 2026-05-20T12:09:00Z
- **Completed:** 2026-05-20T12:24:11Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added Stage 10 to deploy.sh: SCP scripts/routing.sh to /tmp/routing.sh on RPi, then sudo mv to /etc/routing.sh with chmod +x
- Added Stage 11 to deploy.sh: ssh sudo /etc/routing.sh by default; skipped if --no-run passed
- Added --no-run argument parsing (D-12) at the top of the script
- Added ROUTING_SH_LOCAL/REMOTE/TMP constants for consistent path references
- Added scripts/routing.sh preflight check to Stage 1 alongside existing file checks
- Updated TOTAL_STAGES from 9 to 11
- Updated final summary to say "Phase 1 + 2 deploy successful" with Phase 2 verification commands

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend deploy.sh with Phase 2 routing.sh deploy + activate stages** - `e8515f7` (feat)

**Plan metadata:** (to be committed with docs commit)

## Files Created/Modified
- `deploy.sh` - Extended from 227 to 276 lines; Phase 1 + 2 deploy orchestrator with Stage 10 (SCP routing.sh) and Stage 11 (activate or --no-run skip)

## Decisions Made
- D-11 honored: /tmp staging pattern for routing.sh matches existing Phase 1 pattern for awg0.conf and vpn-gateway.env
- D-12 honored: --no-run flag parses via a simple for loop over "$@" at script startup, before any SSH operations
- Stage 9 repurposed as "Phase 1 complete" checkpoint message rather than final summary — pipeline continues
- Phase 2 verification commands added to summary block (ip route get, iptables -t nat -L)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- deploy.sh now covers both Phase 1 and Phase 2 in a single invocation
- `./deploy.sh` deploys AmneziaWG, config, routing.sh, and activates split-tunnel
- `./deploy.sh --no-run` deploys everything but leaves routing.sh unexecuted for manual inspection
- Phase 3 (autostart, cron, rollback) can extend deploy.sh with further stages following the same pattern

## Self-Check: PASSED
- deploy.sh exists and is 276 lines (> 230 required)
- e8515f7 commit exists in git log
- All 10 acceptance criteria greps passed

---
*Phase: 02-routing-nat*
*Completed: 2026-05-20*
