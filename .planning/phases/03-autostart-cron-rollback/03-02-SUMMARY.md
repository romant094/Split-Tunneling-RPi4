---
phase: 03-autostart-cron-rollback
plan: 02
subsystem: infra
tags: [cron, bash, sha256, vpn-gateway, rpi, systemd]

requires:
  - phase: 03-01-autostart
    provides: deploy.sh TOTAL_STAGES=13; /etc/routing.sh on RPi accepting --no-update flag

provides:
  - scripts/update-vpn-routes (sha256-diff cron script, sources /etc/vpn-gateway.env)
  - /etc/cron.d/vpn-routes (daily at 5:00, 6-field format, trailing newline, 644 root:root)
  - deploy.sh TOTAL_STAGES=15 with Stage 14 (SCP script) + Stage 15 (cron.d write)

affects:
  - 03-03-rollback

tech-stack:
  added: []
  patterns:
    - sha256-based idempotent update (download → diff → apply only on change)
    - logger -t tag for syslog tagging without cron email noise
    - printf '%s\n' to guarantee trailing newline in cron.d files

key-files:
  created:
    - scripts/update-vpn-routes
  modified:
    - deploy.sh
    - .env

key-decisions:
  - "D-05: CRON_UPDATE_HOUR=5 in .env (safe to commit, no secrets)"
  - "D-06: sha256 diff gate — only rebuild routes when subnet list actually changed"
  - "Exit 0 on download failure — no cron failure emails (Pattern 3)"
  - "Trailing newline enforced via printf '%s\\n' (Pitfall 2)"

patterns-established:
  - "sha256sum diff before mutating shared state (routes)"
  - "logger -t <tag> for structured syslog without cron noise"

requirements-completed: [AUTO-03]

duration: ~20min
completed: 2026-05-20
---

# Plan 03-02: Cron Update Script Summary

**sha256-diff daily cron script (/etc/update-vpn-routes) deployed via cron.d with trailing-newline guarantee and idempotent hash gate**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-05-20
- **Tasks:** 4 (3 auto + 1 human-verify)
- **Files modified:** 3

## Accomplishments

- `scripts/update-vpn-routes` created — downloads RU subnet list, compares sha256 against existing, rebuilds routes only on change, exits 0 on download failure
- `.env` updated with `CRON_UPDATE_HOUR=5`
- `deploy.sh` extended to TOTAL_STAGES=15: Stage 14 SCPs script to /etc/update-vpn-routes (chmod +x, root:root); Stage 15 writes /etc/cron.d/vpn-routes with trailing newline
- Live verification on RPi: two consecutive manual runs both exit 0, syslog shows `Subnet list unchanged (hash: 978bbb58e8fb...)`, routing intact (8.8.8.8 → awg0, 77.88.8.8 → ISP)

## Task Commits

1. **Tasks 1-3: update-vpn-routes + .env + deploy.sh** - `26fa766` (feat)

## Files Created/Modified

- `scripts/update-vpn-routes` — sha256-diff cron script, syslog via logger, 0-exit on failure
- `.env` — added CRON_UPDATE_HOUR=5
- `deploy.sh` — TOTAL_STAGES 13→15, Stage 14 (SCP script +x), Stage 15 (cron.d with trailing newline)

## Decisions Made

- Exit 0 on download failure with syslog warn — avoids cron failure email noise while still logging
- Hash comparison before any route rebuild — prevents unnecessary routing.sh runs when list unchanged

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Cron daily update verified operational on live RPi
- Plan 03-03 (rollback script) can proceed immediately

---
*Phase: 03-autostart-cron-rollback*
*Completed: 2026-05-20*
