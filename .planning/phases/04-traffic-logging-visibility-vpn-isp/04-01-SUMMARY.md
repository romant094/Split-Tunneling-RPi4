---
phase: 04-traffic-logging-visibility-vpn-isp
plan: "01"
subsystem: infra
tags: [iptables, logging, routing, split-tunnel, vpn, journald]

# Dependency graph
requires:
  - phase: 02-routing-script
    provides: "scripts/routing.sh with Stage 7 MASQUERADE pattern and iptables -C idempotency guards"
provides:
  - "iptables LOG rules on FORWARD chain tagging new connections as [VPN] or [ISP]"
  - "Stage 3 flush block removes LOG rules before routing rebuild"
  - "Stage 7b adds LOG rules idempotently after MASQUERADE"
affects:
  - 04-02-vpn-status-sh  # reads [VPN]/[ISP] entries from journald

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "iptables -C before -D in flush block — same safe-removal pattern as vpn-rollback.sh"
    - "iptables -C idempotency guard before -A — mirrors existing Stage 7 MASQUERADE pattern"
    - "Stage 7b: dedicated stage for LOG rules, ordered after MASQUERADE in FORWARD chain"

key-files:
  created: []
  modified:
    - scripts/routing.sh

key-decisions:
  - "Used ${VPN_IFACE} (not hardcoded awg0) for VPN LOG rule to match existing MASQUERADE pattern"
  - "--state NEW limits logging to connection initiations only, not per-packet (D-02)"
  - "--limit 10/min --limit-burst 20 rate cap prevents syslog flood from streaming/gaming (D-03)"
  - "--log-level 6 routes to journald via syslog info; no separate log file needed (D-05)"
  - "LOG rules go in FORWARD chain only — LAN-to-RPi traffic, not RPi's own OUTPUT (D-01)"

patterns-established:
  - "Stage 7b: LOG rules always ordered after Stage 7 MASQUERADE rules in FORWARD chain"
  - "Flush-and-rebuild lifecycle includes LOG rules: Stage 3 removes, Stage 7b re-adds"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-05-21
---

# Phase 04 Plan 01: Add iptables LOG Rules to routing.sh Summary

**Two iptables FORWARD LOG rules added to routing.sh with [VPN]/[ISP] prefixes, --state NEW per-connection logging, 10/min rate cap, and full flush-and-rebuild lifecycle integration**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-21T07:33:24Z
- **Completed:** 2026-05-21T07:35:42Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added Stage 7b to routing.sh with two idempotent iptables LOG rules on FORWARD chain
- Added LOG rule removal to Stage 3 flush block (iptables -C before -D pattern)
- Added iptables LOG status line to Stage 9 summary output
- Script passes bash -n with no syntax errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add iptables LOG rules to routing.sh** - `b287424` (feat)

**Plan metadata:** (pending docs commit)

## Files Created/Modified
- `scripts/routing.sh` - Extended with Stage 7b (LOG rules), Stage 3 LOG flush, Stage 9 LOG summary line

## Decisions Made
- Used `${VPN_IFACE}` instead of hardcoded `awg0` for the VPN LOG rule — consistent with existing MASQUERADE pattern
- Placed LOG rule removal at the START of Stage 3 before `ip route flush` — ensures clean iptables state before routing rebuild
- Stage 7b positioned immediately after Stage 7 closing `fi` — FORWARD chain ordering: MASQUERADE first, then LOG

## Deviations from Plan

None - plan executed exactly as written.

Note: The plan's acceptance criteria stated `grep -c 'LOG --log-prefix "\[VPN\]"' returns 3`. The actual count is 4 because the flush block contains both a `-C` check line AND a `-D` command line, each containing `--log-prefix "[VPN] "`. The implementation is functionally correct — the plan description of "flush -D check, -A check, -A add" under-counted by treating the `-C` and `-D` as a single occurrence. All 8 iptables LOG lines are correct and necessary.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. LOG rules will be active after next deploy + routing.sh run on RPi.

## Next Phase Readiness
- `scripts/routing.sh` now emits `[VPN]` and `[ISP]` kernel log entries via journald on every new LAN connection
- Plan 04-02 (vpn-status.sh) can query journald with `journalctl -k` and grep for `\[VPN\]`/`\[ISP\]` prefixes
- Plan 04-03 (deploy) will push the updated routing.sh to RPi and run it to activate the LOG rules

---
*Phase: 04-traffic-logging-visibility-vpn-isp*
*Completed: 2026-05-21*
