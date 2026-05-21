---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 4 planned — ready to execute
last_updated: "2026-05-21T07:36:48.009Z"
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 10
  completed_plans: 9
  percent: 50
---

# State: RPi VPN Gateway

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-18)

**Core value:** Non-RU traffic exits through AmneziaWG VPN; RU traffic exits direct via ISP — transparent to LAN devices, survives reboots, fully reversible.
**Current focus:** Phase 04 — traffic-logging-visibility-vpn-isp

## Current Phase

**Phase 4: Traffic Logging & Visibility**

Goal: Log per-connection routing decisions (VPN vs ISP), visible subnets, and resolved domain names

Status: Ready to execute (3 plans in 2 waves)

## Phase Progress

| Phase | Status | Plans | Progress |
|-------|--------|-------|----------|
| 1 — Foundation & Config | ✓ Plans done | 2/2 done | 100% |
| 2 — Routing & NAT | ✓ Plans done | 2/2 done | 100% |
| 3 — Autostart, Cron & Rollback | ✓ Plans done | 3/3 done | 100% |
| 4 — Traffic Logging & Visibility | ○ Ready to execute | 0/3 done | 0% |

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

## Hardware Verified

- install-awg.sh: ✓ verified on RPi 4 (kernel 6.12.25+rpt-rpi-v8) — 2026-05-19
  - INST-01: awg + awg-quick at /usr/bin ✓
  - INST-02: ip_forward=1 persisted via /etc/sysctl.d/99-vpn-gateway.conf ✓
  - amneziawg kernel module loaded ✓

## Last Session

**Stopped at:** Phase 4 planned — ready to execute
**Timestamp:** 2026-05-21T00:00:00Z
**Resume:** Run /gsd:execute-phase 4 — 3 plans ready (04-01 iptables LOG, 04-02 dnsmasq+vpn-status.sh, 04-03 deploy+rollback)

---
*Initialized: 2026-05-18*
*Updated: 2026-05-20 — Phase 3 complete; deploy.sh at TOTAL_STAGES=16; vpn-routing.service, update-vpn-routes, vpn-rollback.sh all deployed and verified on live RPi*

## Accumulated Context

### Roadmap Evolution

- Phase 4 added: Traffic Logging & Visibility — per-connection route logging (VPN/ISP), subnets, domain names
- Phase 5 added: Custom Route Exceptions — per-IP/domain overrides forcing traffic through ISP
- Phase 6 added: Documentation — ops runbook (deploy, verify, rollback, add exceptions)
