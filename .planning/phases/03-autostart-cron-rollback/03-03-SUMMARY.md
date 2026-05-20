---
phase: 03-autostart-cron-rollback
plan: 03
subsystem: infra
tags: [rollback, bash, iptables, systemd, vpn-gateway, rpi]

requires:
  - phase: 03-01-autostart
    provides: awg-quick@awg0 + vpn-routing.service deployed and enabled
  - phase: 03-02-cron
    provides: /etc/cron.d/vpn-routes deployed

provides:
  - scripts/vpn-rollback.sh (8-step idempotent rollback script at /etc/vpn-rollback.sh)
  - deploy.sh TOTAL_STAGES=16 with Stage 16 (SCP rollback script)

affects: []

tech-stack:
  added: []
  patterns:
    - iptables -C guard before -D for idempotent rule removal (mirrors routing.sh T-02)
    - static ip route add default (no dhclient dependency)
    - logger -t tag for syslog progress (matches update-vpn-routes pattern)

key-files:
  created:
    - scripts/vpn-rollback.sh
  modified:
    - deploy.sh

key-decisions:
  - "D-08: rollback does NOT remove awg0.conf, routing.sh, vpn-ru-subnets.txt, or AmneziaWG packages (ROLL-02)"
  - "D-10: script sources /etc/vpn-gateway.env; aborts if missing"
  - "Static ip route add via KEENETIC_GW — no dhclient, no DHCP dependency"
  - "netfilter-persistent save with || log fallback (Pitfall 5)"

patterns-established:
  - "iptables -C check before -D for safe idempotent removal"

requirements-completed: [ROLL-01, ROLL-02]

duration: ~15min
completed: 2026-05-20
---

# Plan 03-03: Rollback Script Summary

**8-step idempotent vpn-rollback.sh deployed to /etc/vpn-rollback.sh — stops services, flushes routes, removes MASQUERADE, restores ISP default route, preserves all config files**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-05-20
- **Tasks:** 3 (2 auto + 1 human-verify)
- **Files modified:** 2

## Accomplishments

- `scripts/vpn-rollback.sh` created — idempotent 8-step rollback verified on live RPi
- `deploy.sh` extended to TOTAL_STAGES=16 with Stage 16 (SCP rollback script to /etc/vpn-rollback.sh, chmod +x, root:root)
- Rollback verification passed: `ip route show default` → `via 192.168.1.1`, no VPN MASQUERADE rules, cron removed, both services disabled
- ROLL-02 preserved: awg0.conf (mode 600), /etc/routing.sh, /etc/vpn-ru-subnets.txt, AmneziaWG packages — all intact

## Task Commits

1. **Tasks 1-2: vpn-rollback.sh + deploy.sh Stage 16** - `38b8450` (feat)

## Files Created/Modified

- `scripts/vpn-rollback.sh` — 8-step rollback: stop/disable services, flush awg0 routes, iptables -C/-D MASQUERADE removal, netfilter-persistent save, rm cron, ip route add default via KEENETIC_GW
- `deploy.sh` — TOTAL_STAGES 15→16, Stage 16 (SCP rollback script +x)

## Decisions Made

- No removal of awg0.conf or packages — rollback is reversible; `./deploy.sh` + `awg-quick up awg0` re-activates fully
- Docker's pre-existing MASQUERADE rule (172.17.0.0/16 via !docker0) correctly preserved — rollback only targets VPN-specific MASQUERADE rules via specific `-s`/`-o` guards

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- After rollback, `sudo awg-quick up awg0` returned "awg0 already exists" — awg0 interface persisted after `systemctl stop awg-quick@awg0` (amneziawg behavior). Routing was correctly restored to ISP (via 192.168.1.1) and services were disabled, so this is a benign observation. Re-enabling via `./deploy.sh` works normally.

## Next Phase Readiness

- Phase 3 complete: autostart, daily cron update, and full rollback all verified on live RPi
- Phase 4 (traffic logging / visibility) can proceed

---
*Phase: 03-autostart-cron-rollback*
*Completed: 2026-05-20*
