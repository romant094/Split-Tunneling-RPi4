---
phase: 03-autostart-cron-rollback
plan: 01
subsystem: infra
tags: [systemd, autostart, amneziawg, vpn-gateway, rpi, bash]

requires:
  - phase: 02-routing-nat
    provides: routing.sh deployed to /etc/routing.sh; vpn-gateway.env on RPi

provides:
  - systemd/vpn-routing.service (Type=oneshot, After=awg-quick@awg0.service)
  - deploy.sh TOTAL_STAGES=13 with Stage 12 (SCP unit file) + Stage 13 (daemon-reload + enable)
  - awg-quick@awg0 and vpn-routing.service enabled for autostart

affects:
  - 03-02-cron
  - 03-03-rollback

tech-stack:
  added: []
  patterns:
    - systemd oneshot service with RemainAfterExit=yes for post-exit active state
    - SCP-to-tmp then sudo mv pattern for safe remote file deploy (D-11)

key-files:
  created:
    - systemd/vpn-routing.service
  modified:
    - deploy.sh

key-decisions:
  - "D-01: vpn-routing.service ExecStart=/etc/routing.sh with NO --no-update — boot uses freshest subnets"
  - "D-02: After=awg-quick@awg0.service network-online.target + Requires=awg-quick@awg0.service"
  - "No Restart= directive — storm risk, operator investigates per Pitfall 1"

patterns-established:
  - "Stage N: scp file to /tmp.tmp → ssh sudo mv + chmod + chown (D-11)"
  - "daemon-reload && enable (single SSH compound, Pitfall 3 ordering)"

requirements-completed: [AUTO-01, AUTO-02, VRFY-01, VRFY-02, VRFY-03, VRFY-04]

duration: ~30min
completed: 2026-05-20
---

# Plan 03-01: Autostart Summary

**systemd vpn-routing.service (Type=oneshot) + deploy.sh stages 12-13 enabling awg-quick@awg0 and vpn-routing.service at boot**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-05-20
- **Tasks:** 3 (2 auto + 1 human-verify)
- **Files modified:** 2

## Accomplishments

- `systemd/vpn-routing.service` created — Type=oneshot, RemainAfterExit=yes, After=awg-quick@awg0.service network-online.target, Requires=awg-quick@awg0.service, ExecStart=/etc/routing.sh
- `deploy.sh` extended to TOTAL_STAGES=13: Stage 12 deploys unit file via /tmp staging; Stage 13 runs daemon-reload then enables both services
- RPi reboot verified: awg-quick@awg0 + vpn-routing.service both active after reboot
- VRFY-01..04 all pass: foreign traffic → awg0, RU traffic → ISP, VPN server → ISP, egress IP = VPN provider IP

## Task Commits

1. **Task 1+2: systemd unit file + deploy.sh extension** - `28e63fe` (feat)

## Files Created/Modified

- `systemd/vpn-routing.service` — Type=oneshot systemd unit wrapping /etc/routing.sh with awg tunnel dependency
- `deploy.sh` — TOTAL_STAGES 11→13, added VPN_ROUTING_SERVICE_* constants, preflight check, Stage 12 (SCP unit), Stage 13 (daemon-reload + enable)

## Decisions Made

- No `Restart=` on vpn-routing.service — routing.sh failure at boot should be investigated, not retried (storm risk per Anti-Pattern)
- Handshake delay (Pitfall 1) accepted — brief packet loss at boot is tolerable for a gateway

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Autostart slice complete; RPi is now fully autonomous across reboots
- Plan 03-02 (cron daily route update) can proceed immediately
- Plan 03-03 (rollback script) can proceed after 03-02

---
*Phase: 03-autostart-cron-rollback*
*Completed: 2026-05-20*
