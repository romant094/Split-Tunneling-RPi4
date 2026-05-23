---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Phase 6 complete
stopped_at: Phase 6 planned — 2 plans in 2 waves
last_updated: "2026-05-23T05:13:44.897Z"
progress:
  total_phases: 7
  completed_phases: 6
  total_plans: 14
  completed_plans: 14
  percent: 86
---

# State: RPi VPN Gateway

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-18)

**Core value:** Non-RU traffic exits through AmneziaWG VPN; RU traffic exits direct via ISP — transparent to LAN devices, survives reboots, fully reversible.
**Current focus:** Phase 6 — documentation

## Current Phase

**Phase 5: Custom Route Exceptions — COMPLETE ✓**

All deploy tooling (vpn-status.sh --via, deploy.sh Stage 21, example template) wired 2026-05-21.

## Phase Progress

| Phase | Status | Plans | Progress |
|-------|--------|-------|----------|
| 1 — Foundation & Config | ✓ Complete | 2/2 done | 100% |
| 2 — Routing & NAT | ✓ Complete | 2/2 done | 100% |
| 3 — Autostart, Cron & Rollback | ✓ Complete | 3/3 done | 100% |
| 4 — Traffic Logging & Visibility | ✓ Complete | 3/3 done | 100% |
| 5 — Custom Route Exceptions | ✓ Complete | 2/2 done | 100% |
| 6 — Documentation | ◆ Planned | 0/2 | 0% |

## Requirements

- v1 total: 20
- Completed: 20 (INST-01, INST-02 — by install-awg.sh; CONF-01, CONF-02 — by deploy.sh; ROUT-01–04, NAT-01–03 — by scripts/routing.sh; AUTO-01–03, ROLL-01–02, VRFY-01–04 — by Phase 3)
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
- D-11: install-awg.sh Stage 6 uses /sys/module/amneziawg check instead of lsmod grep — /sys/module is set synchronously on load; lsmod can lag on kernel 6.12.25+rpt-rpi-v8
- routing.sh D-06: Flush-and-rebuild (ip route flush dev awg0) for idempotent routing — clean slate on every run
- routing.sh D-07: iptables idempotency via iptables -C check before every -A — no duplicate MASQUERADE rules
- deploy.sh D-11: routing.sh deployed via SCP /tmp staging then sudo mv + chmod +x (matches Phase 1 pattern)
- deploy.sh D-12: --no-run flag skips routing.sh activation; without it, routing.sh runs automatically after deploy
- Phase 5 D-06/D-08: routing.sh renames SUBNET_FILE → WHITE_LIST_FILE (/etc/white-list.txt); Stage 5b added to load /etc/white-list-extended.txt when present (silent skip when absent)
- Phase 5 D-14: vpn-rollback.sh Step 4c added — rm -f /etc/white-list-extended.txt; /etc/white-list.txt preserved (not removed) during rollback
- Phase 5 D-10/D-11: vpn-status.sh --via=vpn|isp filter applied at output time (not entry collection); strict string validation; composes with --filter/--device/--last
- Phase 5 deploy: deploy.sh TOTAL_STAGES=22; Stage 21 conditionally SCPs exception file (skip if absent); Stage 22 activation drops --no-update for first-deploy correctness

## Hardware Verified

- install-awg.sh: ✓ verified on RPi 4 (kernel 6.12.25+rpt-rpi-v8) — 2026-05-19
  - INST-01: awg + awg-quick at /usr/bin ✓
  - INST-02: ip_forward=1 persisted via /etc/sysctl.d/99-vpn-gateway.conf ✓
  - amneziawg kernel module loaded ✓

## Last Session

**Stopped at:** Phase 6 planned — 2 plans in 2 waves
**Timestamp:** 2026-05-21T17:00:00Z
**Resume:** Run /gsd:execute-phase 06 — Documentation (ops runbook)

---
*Initialized: 2026-05-18*
*Updated: 2026-05-21 — Phase 5 complete; deploy.sh at TOTAL_STAGES=22; --via flag in vpn-status.sh; exception file deploy staged*

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260521-jex | Add scripts/watch-routes.py — real-time iptables log viewer with reverse DNS caching | 2026-05-21 | cf6bafa | [260521-jex-add-scripts-watch-routes-py-real-time-ip](./quick/260521-jex-add-scripts-watch-routes-py-real-time-ip/) |

## Accumulated Context

### Roadmap Evolution

- Phase 4 added: Traffic Logging & Visibility — per-connection route logging (VPN/ISP), subnets, domain names
- Phase 5 added: Custom Route Exceptions — per-IP/domain overrides forcing traffic through ISP
- Phase 6 added: Documentation — ops runbook (deploy, verify, rollback, add exceptions)
- Phase 7 added: ASN Enrichment & Traffic Attribution

### Phase 4 Post-execution Fixes (applied after plans, discovered during live testing)

- routing.sh: FORWARD chain policy is DROP (Docker). Added ACCEPT rules (-i eth0, RELATED,ESTABLISHED) — without them LAN forwarding silently dropped
- routing.sh: LOG rules must be BEFORE ACCEPT — LOG is non-terminating, ACCEPT terminates; wrong order = no journald entries
- routing.sh: eth0 MASQUERADE must exclude LAN subnet (`! -d LAN_SUBNET`) — full MASQUERADE caused Keenetic web/app admin to block requests appearing from 192.168.1.254
- deploy.sh: Stage 17/18 order swapped — dnsmasq must be installed before config deployed to avoid dpkg interactive prompt
- SSH_HOST moved from deploy.sh hardcode to .env
