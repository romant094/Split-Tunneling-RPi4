# Roadmap: RPi VPN Gateway

**Created:** 2026-05-18
**Phases:** 6
**Requirements mapped:** 20/20 ✓

---

## Overview

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 1 | Foundation & Config | AmneziaWG running, config deployed | INST-01, INST-02, CONF-01, CONF-02 | 4 |
| 2 | Routing & NAT | Split-tunnel routing active, LAN devices NATed through RPi | ROUT-01–04, NAT-01–03 | 6 |
| 3 | Autostart, Cron & Rollback | Survives reboots, daily refresh, one-command rollback | AUTO-01–03, ROLL-01–02, VRFY-01–04 | 4 |
| 4 | Traffic Logging & Visibility | 3/3 | Complete   | 2026-05-21 |
| 5 | Custom Route Exceptions | 2/2 | Complete   | 2026-05-21 |
| 6 | Documentation | Ops runbook: deploy, verify, rollback, add exceptions — one source of truth | TBD | TBD |

---

### Phase 1: Foundation & Config

**Goal:** AmneziaWG installed, config deployed, IP forwarding on, tunnel operational
**Mode:** mvp

**Requirements:**

- INST-01: AmneziaWG installed; `awg` binary available
- INST-02: IP forwarding enabled persistently (sysctl)
- CONF-01: awg0.conf deployed to /etc/amnezia/amneziawg/
- CONF-02: /etc/vpn-gateway.env deployed on RPi

**Deliverables:**

- `deploy.sh` — deploys configs to RPi via SSH/SCP
- awg0.conf on RPi (from amnezia.key.claude.txt template + user keys)
- /etc/vpn-gateway.env on RPi

**Success Criteria:**

1. `which awg` returns a path on RPi
2. `sysctl net.ipv4.ip_forward` returns 1 and persists after reboot
3. awg0.conf present at /etc/amnezia/amneziawg/awg0.conf on RPi
4. `sudo awg-quick up awg0` succeeds; `sudo awg show` shows peer handshake

**Plans:** 2 plans

- [x] 01-01-PLAN.md — RPi-side AmneziaWG installer + persistent IP forwarding (INST-01, INST-02) ✓ 2026-05-19
- [x] 01-02-PLAN.md — deploy.sh orchestrator + secrets hygiene + awg0.conf and vpn-gateway.env deployment (CONF-01, CONF-02; wires INST-01, INST-02 via Plan 01) ✓ 2026-05-19

**Phase 1 complete ✓**

---

### Phase 2: Routing & NAT

**Goal:** Split-tunnel routing active, LAN devices NATed through RPi, rules survive reboot
**Mode:** mvp

**Requirements:**

- ROUT-01: /etc/routing.sh downloads RU subnets and applies split routes
- ROUT-02: routing.sh is idempotent (safe to re-run)
- ROUT-03: routing.sh adds host route for VPN server via ISP (prevents loop)
- ROUT-04: routing.sh sets default route via awg0
- NAT-01: iptables masquerade on awg0
- NAT-02: iptables masquerade on eth0
- NAT-03: iptables rules survive reboot (iptables-persistent)

**Deliverables:**

- `scripts/routing.sh` (deployed to /etc/routing.sh)
- `deploy.sh` extended with Stage 10 (SCP routing.sh) and Stage 11 (activate or --no-run)

**Plans:** 2 plans

- [x] 02-01-PLAN.md — scripts/routing.sh split-tunnel routing + NAT script (ROUT-01–04, NAT-01–03) ✓ 2026-05-20
- [x] 02-02-PLAN.md — deploy.sh extended with Phase 2 stages (D-11 SCP routing.sh, D-12 --no-run flag) ✓ 2026-05-20

**Phase 2 complete ✓**

**Success Criteria:**

1. `ip route show default` shows dev awg0
2. `ip route get YOUR_VPN_SERVER_IP` → via 192.168.1.1 (not awg0)
3. `ip route get 77.88.8.8` → via 192.168.1.1 (RU → ISP)
4. `ip route get 8.8.8.8` → dev awg0 (foreign → VPN)
5. LAN device reaches internet through RPi (both VPN and direct paths)
6. iptables MASQUERADE rules present after reboot

---

### Phase 3: Autostart, Cron & Rollback

**Goal:** Fully operational after reboot; RU subnet list refreshed daily; system can be fully rolled back
**Mode:** mvp

**Requirements:**

- AUTO-01: awg-quick@awg0 systemd service enabled
- AUTO-02: vpn-routing.service enabled, starts after awg-quick@awg0
- AUTO-03: /etc/cron.d/vpn-routes runs /etc/update-vpn-routes daily at CRON_UPDATE_HOUR
- ROLL-01: /etc/vpn-rollback.sh stops services, flushes routes, removes NAT/cron
- ROLL-02: Rollback preserves awg0.conf, installed packages, routing.sh
- VRFY-01: ip route get 8.8.8.8 → awg0
- VRFY-02: ip route get 77.88.8.8 → 192.168.1.1
- VRFY-03: ip route get YOUR_VPN_SERVER_IP → 192.168.1.1
- VRFY-04: curl --interface awg0 https://ifconfig.me returns VPN IP

**Deliverables:**

- `systemd/vpn-routing.service` (deployed to /etc/systemd/system/)
- `scripts/update-vpn-routes` (deployed to /etc/update-vpn-routes; cron entry at /etc/cron.d/vpn-routes)
- `scripts/vpn-rollback.sh` (deployed to /etc/vpn-rollback.sh)
- `deploy.sh` extended to 16 stages covering all Phase 3 artifacts

**Success Criteria:**

1. After simulated reboot: `systemctl is-active awg-quick@awg0` and `vpn-routing` both `active`
2. `/etc/cron.d/vpn-routes` is mode 644 root:root and runs `/etc/update-vpn-routes` daily at 5:00
3. `sudo /etc/vpn-rollback.sh` restores plain-host routing; `ip route show default` → via 192.168.1.1
4. All VRFY checks pass before rollback

**Plans:** 3 plans

- [x] 03-01-PLAN.md — vpn-routing.service unit file + deploy.sh Stages 12–13 (daemon-reload + systemctl enable AUTO-01, AUTO-02, VRFY-01..04) ✓ 2026-05-20
- [x] 03-02-PLAN.md — scripts/update-vpn-routes (sha256 checksum cron script) + .env CRON_UPDATE_HOUR=5 + deploy.sh Stages 14–15 (AUTO-03) ✓ 2026-05-20
- [x] 03-03-PLAN.md — scripts/vpn-rollback.sh + deploy.sh Stage 16 (ROLL-01, ROLL-02) ✓ 2026-05-20

**Phase 3 complete ✓**

---

## Requirement Coverage

| Requirement | Phase |
|-------------|-------|
| INST-01 | Phase 1 |
| INST-02 | Phase 1 |
| CONF-01 | Phase 1 |
| CONF-02 | Phase 1 |
| ROUT-01 | Phase 2 |
| ROUT-02 | Phase 2 |
| ROUT-03 | Phase 2 |
| ROUT-04 | Phase 2 |
| NAT-01 | Phase 2 |
| NAT-02 | Phase 2 |
| NAT-03 | Phase 2 |
| AUTO-01 | Phase 3 |
| AUTO-02 | Phase 3 |
| AUTO-03 | Phase 3 |
| ROLL-01 | Phase 3 |
| ROLL-02 | Phase 3 |
| VRFY-01 | Phase 3 |
| VRFY-02 | Phase 3 |
| VRFY-03 | Phase 3 |
| VRFY-04 | Phase 3 |

**20/20 requirements mapped. 0 unmapped. ✓**

### Phase 4: Traffic Logging & Visibility

**Goal:** Log per-connection routing decisions (VPN vs ISP), visible subnets, and resolved domain names
**Requirements**: TBD
**Depends on:** Phase 3
**Plans:** 3/3 plans complete

**Wave 1:**

- [x] 04-01-PLAN.md — iptables LOG rules in scripts/routing.sh ([VPN]/[ISP] on FORWARD chain, --state NEW, rate limited)
- [x] 04-02-PLAN.md — configs/dnsmasq.conf + scripts/vpn-status.sh (connection visibility query tool)

**Wave 2** *(blocked on Wave 1 completion)*:

- [x] 04-03-PLAN.md — deploy.sh Stages 17–20 + vpn-rollback.sh Phase 4 teardown (completed 2026-05-21)

**Cross-cutting constraints:**

- iptables LOG rule flag sets must be identical in routing.sh (add) and vpn-rollback.sh (remove)

### Phase 5: Custom Route Exceptions

**Goal:** Add user-defined per-CIDR ISP-bypass exceptions on top of the auto-downloaded RU CIDR list; rename /etc/vpn-ru-subnets.txt → /etc/white-list.txt for naming parity; extend vpn-status.sh with --via=vpn|isp filter for the discover→exception workflow
**Requirements**: TBD
**Depends on:** Phase 4
**Plans:** 2/2 plans complete

Plans:
**Wave 1**

- [x] 05-01-PLAN.md — Wave 1: routing.sh rename SUBNET_FILE → WHITE_LIST_FILE + Stage 5b loader for /etc/white-list-extended.txt; update-vpn-routes path rename; vpn-rollback.sh rm white-list-extended + summary rename (D-06, D-07, D-08, D-09, D-14) ✓ 2026-05-21

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02-PLAN.md — Wave 2: vpn-status.sh --via=vpn|isp filter (D-10, D-11); deploy.sh Stage 21 conditional exception file deploy (D-12, D-13); configs/white-list-extended.txt.example committed; .gitignore the user file; --no-update dropped from Stage 22 activation (Pitfall 2 fix) ✓ 2026-05-21

### Phase 6: Documentation

**Goal:** Ops runbook covering all phases — how to deploy, verify routing, rollback, add custom exceptions, and interpret traffic logs; each major script and workflow documented with examples
**Requirements**: Every subsequent phase (7+) that adds scripts, flags, or workflows must update README.md and docs/README.ru.md accordingly before the phase is considered complete.
**Depends on:** Phase 5
**Plans:** 2 plans

Plans:

**Wave 1:**

- [ ] 06-01-PLAN.md — README.md: English ops runbook (12 sections, CLI reference for 6 scripts, 7 troubleshooting gotchas, phase links table)

**Wave 2** *(blocked on Wave 1 completion)*:

- [ ] 06-02-PLAN.md — docs/README.ru.md: full Russian translation of README.md

### Phase 7: ASN Enrichment & Traffic Attribution

**Goal:** Enrich existing traffic visibility tools (vpn-status.sh, watch-routes.py) with ISP/org attribution by mapping destination IPs to ASN + org name via Team Cymru bulk whois; ship a shared stdlib-only Python helper (asn-lookup.py) with a file-backed cache and graceful network-failure degradation; vpn-status.sh gains an ORG column + --summary aggregate view; watch-routes.py appends `| {org}` per line via a non-blocking background thread; deploy.sh extended with a new Stage 23 for the helper script
**Requirements**: None mapped (v1 requirements complete; this is a visibility/UX enhancement phase). Per Phase 6 cross-cutting note, README.md and docs/README.ru.md must be updated to document the new ORG column, --summary flag, and --no-asn flag before Phase 7 is considered complete.
**Depends on:** Phase 6
**Plans:** 3 plans

Plans:

**Wave 1:**

- [ ] 07-01-PLAN.md — scripts/asn-lookup.py: shared stdlib Cymru bulk-whois client + atomic /tmp/vpn-asn-cache.json file cache; CLI contract is stdin one-IP-per-line → stdout single-line JSON dict {ip:{asn,org}}; graceful degradation on network failure (D-01, D-02, D-04, D-09)

**Wave 2** *(blocked on Wave 1 completion)*:

- [ ] 07-02-PLAN.md — scripts/vpn-status.sh: add ORG column after DOMAIN (format `{org} (AS{asn})`) and --summary flag (ORG | VPN_COUNT | ISP_COUNT | TOTAL, top 20, ranked by TOTAL desc); seed asn-lookup.py with full pre-filter unique DST IP set (Pitfall 6); declare -A org_map (Pitfall 5); preserve all existing flags (D-03, D-06, D-07)
- [ ] 07-03-PLAN.md — scripts/watch-routes.py: append ` | {org}` per line via background-thread subprocess call to /etc/asn-lookup.py (Pattern 3, threading.Lock-guarded _asn_cache, daemon thread, 5s timeout); add --no-asn opt-out flag; deploy.sh: add ASN_LOOKUP_* variables, preflight check, bump TOTAL_STAGES 23→24 (Pitfall 7), insert new Stage 23 deploy + renumber routing-activation to Stage 24, add PHASE 7 line to final summary (D-03, D-05, D-08)

---
*Created: 2026-05-18*
*Updated: 2026-05-23 — Phase 7 plans created (07-01 asn-lookup.py helper, 07-02 vpn-status.sh ORG+summary, 07-03 watch-routes.py threading + deploy Stage 23)*
