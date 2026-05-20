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
| 4 | Traffic Logging & Visibility | Per-connection route logging (VPN/ISP), subnets, domain names | TBD | TBD |
| 5 | Custom Route Exceptions | Per-IP/domain overrides forcing traffic through ISP | TBD | TBD |
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
2. `ip route get 84.32.100.60` → via 192.168.1.1 (not awg0)
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
- VRFY-03: ip route get 84.32.100.60 → 192.168.1.1
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
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 4 to break down)

### Phase 5: Custom Route Exceptions

**Goal:** Define per-IP and per-domain overrides that force traffic through ISP, bypassing the default VPN route
**Requirements**: TBD
**Depends on:** Phase 4
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 5 to break down)

### Phase 6: Documentation

**Goal:** Ops runbook covering all phases — how to deploy, verify routing, rollback, add custom exceptions, and interpret traffic logs; each major script and workflow documented with examples
**Requirements**: TBD
**Depends on:** Phase 5
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 6 to break down)

---
*Created: 2026-05-18*
*Updated: 2026-05-20 — Phase 3 plans created (03-01 autostart, 03-02 cron, 03-03 rollback)*
