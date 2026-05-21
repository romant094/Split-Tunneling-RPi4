---
phase: 04-traffic-logging-visibility-vpn-isp
plan: "02"
subsystem: infra
tags: [dnsmasq, dns, vpn, iptables, journald, bash, syslog]

# Dependency graph
requires:
  - phase: 04-traffic-logging-visibility-vpn-isp
    provides: iptables LOG rules writing [VPN]/[ISP] entries to journald (Plan 04-01)

provides:
  - configs/dnsmasq.conf — forwarding resolver config for RPi (interface=eth0, 1.1.1.1, log-queries)
  - scripts/vpn-status.sh — operator-facing connection visibility tool with --filter/--device/--last flags

affects: [04-03-deploy, vpn-rollback.sh, deploy.sh]

# Tech tracking
tech-stack:
  added: [dnsmasq]
  patterns: [journalctl-query-pattern, dnsmasq-log-correlation, rdns-fallback]

key-files:
  created:
    - configs/dnsmasq.conf
    - scripts/vpn-status.sh
  modified: []

key-decisions:
  - "dnsmasq listens on interface=eth0 only — not awg0 or lo (D-09)"
  - "Upstream DNS is 1.1.1.1 hardcoded; queries tunnel through awg0 default route (D-07)"
  - "log-queries + log-facility=daemon routes dnsmasq logs to journald under dnsmasq.service (D-08)"
  - "No listen-address directive — interface= is sufficient and more portable (D-09)"
  - "vpn-status.sh domain resolution: dnsmasq reply correlation first, rDNS via host fallback (D-13)"
  - "--filter uses grep -qiF (fixed-string) — injection safe (T-04-07 mitigated)"
  - "LAST=50 default; script exits 0 on empty results, non-zero only on real errors"

patterns-established:
  - "Domain resolution pattern: journalctl dnsmasq reply grep → host rDNS → raw IP"
  - "Pre-fetch journald log once, grep in-memory — avoids N journalctl calls for N entries"
  - "Operator query tools use logger -t tag for own errors, exit 0 on no-results"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-05-21
---

# Phase 4 Plan 02: DNS Forwarder Config and Connection Visibility Script Summary

**dnsmasq forwarding resolver config (interface=eth0, 1.1.1.1, log-queries) and vpn-status.sh connection table tool with dnsmasq correlation + rDNS fallback domain resolution**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-21T07:34:02Z
- **Completed:** 2026-05-21T07:35:55Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `configs/dnsmasq.conf` with all required directives: interface=eth0, no-resolv, server=1.1.1.1, domain-needed, bogus-priv, log-queries, log-facility=daemon; includes manual Keenetic DHCP step comment (192.168.1.254)
- Created `scripts/vpn-status.sh` as executable bash script: set -euo pipefail, source /etc/vpn-gateway.env, --filter/--device/--last arg parsing, journalctl kernel query for [VPN]/[ISP] entries, dnsmasq log correlation, rDNS fallback via host, formatted TIMESTAMP/SRC-IP/DST-IP/DOMAIN/PATH table
- Security mitigations applied per threat model: --filter uses grep -F (fixed-string), --device uses string equality — no values passed to eval or shell execution

## Task Commits

Each task was committed atomically:

1. **Tasks 1+2: configs/dnsmasq.conf and scripts/vpn-status.sh** - `30daf00` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `configs/dnsmasq.conf` — dnsmasq forwarding resolver configuration for RPi; deployed to /etc/dnsmasq.conf by deploy.sh Phase 4 stage
- `scripts/vpn-status.sh` — operator query tool; reads journalctl for iptables [VPN]/[ISP] LOG entries; correlates with dnsmasq query log for domain names; supports --filter, --device, --last flags

## Decisions Made
- Used `interface=eth0` instead of `listen-address=192.168.1.254` — more portable per D-09 discretion
- Pre-fetched dnsmasq journald log once (`--since "10 minutes ago"`) and grep in-memory per entry — avoids one journalctl subprocess per connection line, more efficient
- Domain correlation searches for dnsmasq "reply <hostname> is <dst_ip>" lines — the most direct and reliable match available in dnsmasq's log format
- `--filter` uses `grep -qiF` (fixed-string, case-insensitive) — satisfies T-04-07 injection threat mitigation

## Deviations from Plan

None — plan executed exactly as written. Threat model T-04-07 mitigation (fixed-string grep for --filter) was specified in the plan and implemented as written.

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required. Manual Keenetic DHCP step (set DNS to 192.168.1.254) is documented in configs/dnsmasq.conf comment header and will be in deploy docs (Plan 04-03).

## Next Phase Readiness
- `configs/dnsmasq.conf` ready for deploy.sh Phase 4 stage (Plan 04-03)
- `scripts/vpn-status.sh` ready to be deployed to `/etc/vpn-status.sh` via SCP-to-tmp → sudo mv + chmod +x
- After deploy: `sudo vpn-status.sh` will show connection table once iptables LOG rules and dnsmasq are active

---
*Phase: 04-traffic-logging-visibility-vpn-isp*
*Completed: 2026-05-21*
