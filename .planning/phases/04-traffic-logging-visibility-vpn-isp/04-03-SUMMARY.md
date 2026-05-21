---
phase: 04-traffic-logging-visibility-vpn-isp
plan: "03"
subsystem: infra
tags: [deploy, dnsmasq, vpn-status, iptables, logging, bash, rollback]

# Dependency graph
requires:
  - phase: 04-traffic-logging-visibility-vpn-isp
    provides: "configs/dnsmasq.conf forwarding resolver config (Plan 04-02)"
  - phase: 04-traffic-logging-visibility-vpn-isp
    provides: "scripts/vpn-status.sh connection visibility tool (Plan 04-02)"
  - phase: 04-traffic-logging-visibility-vpn-isp
    provides: "iptables LOG rules in scripts/routing.sh Stage 7b (Plan 04-01)"
provides:
  - "deploy.sh extended to 20 stages with full Phase 4 artifact deployment pipeline"
  - "scripts/vpn-rollback.sh extended with dnsmasq teardown (Step 1b) and LOG rule removal (Step 4b)"
affects: []

# Tech tracking
tech-stack:
  added: [dnsmasq (installed on RPi via deploy Stage 18)]
  patterns:
    - "SCP-to-tmp then sudo mv pattern extended to dnsmasq.conf (mode 644) and vpn-status.sh (chmod +x)"
    - "Stage 20 re-runs routing.sh --no-update to activate LOG rules idempotently after config deploy"
    - "vpn-rollback.sh Step 4b mirrors Step 4 -C before -D iptables safe-removal pattern for LOG rules"
    - "Service teardown group: vpn-routing.service + dnsmasq both stopped in Steps 1/1b before route restoration"

key-files:
  created: []
  modified:
    - deploy.sh
    - scripts/vpn-rollback.sh

key-decisions:
  - "Stage 20 uses routing.sh --no-update flag — skips IP list re-fetch, only rebuilds iptables rules including Stage 7b LOG rules"
  - "Step 1b placed immediately after Step 1 (vpn-routing.service) — keeps all service teardown grouped before route/iptables changes"
  - "LOG rule -C checks in Step 4b use no -t flag (filter table default) — identical to routing.sh Stage 7b; -t nat would fail silently"
  - "dnsmasq.conf deployed with mode 644 root:root (no secrets); vpn-status.sh with chmod +x (executable operator tool)"
  - "Note: /etc/dnsmasq.conf and /etc/vpn-status.sh are not removed on rollback — only the dnsmasq service is stopped"

patterns-established:
  - "Phase 4 deploy pattern: deploy config file → install/enable service → deploy script → re-run activation script"
  - "Rollback pattern: stop service (Step 1b) → remove iptables rules (Step 4b) with -C guard → save iptables state (Step 5)"

requirements-completed: []

# Metrics
duration: 5min
completed: 2026-05-21
---

# Phase 04 Plan 03: Extend deploy.sh and vpn-rollback.sh with Phase 4 Pipeline Summary

**deploy.sh extended from 16 to 20 stages deploying dnsmasq.conf, vpn-status.sh, and activating LOG rules; vpn-rollback.sh extended with dnsmasq stop/disable (Step 1b) and iptables LOG rule removal (Step 4b)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-21T07:39:00Z
- **Completed:** 2026-05-21T07:44:06Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended deploy.sh with 6 new variables (DNSMASQ_CONF_*, VPN_STATUS_*), 2 preflight checks, 4 new stages (17-20), and updated final summary with Phase 4 items + vpn-status.sh usage hints
- Extended vpn-rollback.sh with Step 1b (dnsmasq stop+disable), Step 4b (iptables -C before -D for [VPN] and [ISP] LOG rules), and updated final summary echo block
- Both scripts pass bash -n; all acceptance criteria met

## Task Commits

Each task was committed atomically:

1. **Tasks 1+2: deploy.sh and vpn-rollback.sh** - `a1c1734` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `deploy.sh` — Extended from 16 to 20 stages; DNSMASQ_CONF_* and VPN_STATUS_* path variables; Stage 17 (dnsmasq.conf SCP+mv), Stage 18 (dnsmasq install+enable), Stage 19 (vpn-status.sh SCP+chmod+x), Stage 20 (routing.sh --no-update); updated final summary
- `scripts/vpn-rollback.sh` — Step 1b (systemctl stop+disable dnsmasq after vpn-routing.service); Step 4b (iptables -C/-D for [VPN]/[ISP] FORWARD LOG rules, no -t nat); final summary extended with Phase 4 teardown items

## Decisions Made
- Used `${ROUTING_SH_REMOTE} --no-update` (variable reference, not literal path) in Stage 20 — consistent with all other stages referencing remote paths via variables
- Step 1b placed immediately after Step 1 — service teardown grouped together before iptables/route changes; consistent with existing pattern
- LOG rule iptables calls in Step 4b use no `-t` flag (filter table default) — must match routing.sh Stage 7b exactly; any flag difference causes -C to fail and rule would not be removed
- /etc/dnsmasq.conf and /etc/vpn-status.sh intentionally NOT removed on rollback — only the service is stopped; files remain harmless on disk

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. After running `./deploy.sh`, manually verify:
- `ssh pi4 "sudo systemctl is-active dnsmasq"` — expect: active
- `ssh pi4 "sudo iptables -L FORWARD -n -v | grep LOG"` — expect: two LOG rules

## Next Phase Readiness
- Phase 4 deploy pipeline is complete: all four artifacts (routing.sh with LOG rules, dnsmasq.conf, vpn-status.sh, dnsmasq service) are deployed in a single `./deploy.sh` run
- Rollback is fully reversible: vpn-rollback.sh handles dnsmasq teardown and LOG rule removal in addition to all prior phases
- Run `ssh pi4 "sudo /etc/vpn-status.sh"` after deploy to verify connection visibility is operational

---
*Phase: 04-traffic-logging-visibility-vpn-isp*
*Completed: 2026-05-21*
