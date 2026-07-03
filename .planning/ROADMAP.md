# Roadmap: RPi VPN Gateway

**Created:** 2026-05-18
**Phases:** 15
**Requirements mapped:** 20/20 ✓

---

## Overview

| # | Phase | Goal | Status |
|---|-------|------|--------|
| 1 | Foundation & Config | AmneziaWG running, config deployed | ✓ Complete |
| 2 | Routing & NAT | Split-tunnel routing active, LAN devices NATed through RPi | ✓ Complete |
| 3 | Autostart, Cron & Rollback | Survives reboots, daily refresh, one-command rollback | ✓ Complete |
| 4 | Traffic Logging & Visibility | Per-connection VPN/ISP routing decisions logged and queryable | ✓ Complete |
| 5 | Custom Route Exceptions | Per-CIDR ISP-bypass exceptions on top of auto-downloaded RU list | ✓ Complete |
| 6 | Documentation | Ops runbook: deploy, verify, rollback, add exceptions | ◆ Planned |
| 7 | ASN Enrichment & Traffic Attribution | Enrich vpn-status.sh and watch-routes.py with ISP/org via Team Cymru | ✓ Complete |
| 8 | RU IP List Exclusion Filter | Exclude specific CIDRs from downloaded RU list so they route via VPN | ✓ Complete |
| 9 | Operational Logging | Centralized logs for diagnosing system failures; 14-day rotation | ○ Pending |
| 10 | Splitgate Ergonomics & Organization | Consolidate RPi files under /etc/splitgate/, splitgate dispatcher CLI, log rotation | ✓ Complete |
| 11 | README Documentation Overhaul | Trim README to 3 quick-start sections; all technical detail in docs/REFERENCE.md | ✓ Complete |
| 12 | Buffered ASN Output | Hold watch-routes.py lines until ASN lookup completes; flush after BUFFER_TIMEOUT | ✓ Complete |
| 13 | Log Monitoring, Routing Refinement & Daemon | Daemon mode for watch-routes.py (✓/✗ status), install.log + ru-list-exclude.txt renames, isp-routes-custom.txt RU CIDRs | ✓ Complete |

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

- [x] 06-01-PLAN.md — README.md: English ops runbook (12 sections, CLI reference for 6 scripts, 7 troubleshooting gotchas, phase links table) ✓ 2026-05-23

**Wave 2** *(blocked on Wave 1 completion)*:

- [x] 06-02-PLAN.md — docs/README.ru.md: full Russian translation of README.md ✓ 2026-05-23

**Phase 6 complete ✓**

### Phase 7: ASN Enrichment & Traffic Attribution

**Goal:** Enrich existing traffic visibility tools (vpn-status.sh, watch-routes.py) with ISP/org attribution by mapping destination IPs to ASN + org name via Team Cymru bulk whois; ship a shared stdlib-only Python helper (asn-lookup.py) with a file-backed cache and graceful network-failure degradation; vpn-status.sh gains an ORG column + --summary aggregate view; watch-routes.py appends `| {org}` per line via a non-blocking background thread; deploy.sh extended with a new Stage 23 for the helper script
**Requirements**: None mapped (v1 requirements complete; this is a visibility/UX enhancement phase).
**Depends on:** Phase 6
**Plans:** 3/3 plans complete

Plans:

**Wave 1:**

- [x] 07-01-PLAN.md — scripts/asn-lookup.py: shared stdlib Cymru bulk-whois client + atomic /tmp/vpn-asn-cache.json file cache; CLI contract is stdin one-IP-per-line → stdout single-line JSON dict {ip:{asn,org}}; graceful degradation on network failure (D-01, D-02, D-04, D-09) ✓ 2026-05-23

**Wave 2:**

- [x] 07-02-PLAN.md — scripts/vpn-status.sh: ORG column after DOMAIN (format `{org} (AS{asn})`), --summary flag (ORG | VPN_COUNT | ISP_COUNT | TOTAL, top 20, TOTAL desc); declare -A org_map; all existing flags preserved (D-03, D-06, D-07) ✓ 2026-05-23
- [x] 07-03-PLAN.md — scripts/watch-routes.py: ` | {org}` per line via background-thread subprocess + threading.Lock-guarded _asn_cache + --no-asn flag; deploy.sh: ASN_LOOKUP_* vars, preflight check, TOTAL_STAGES=24, Stage 23 deploy + Stage 24 routing activation (D-03, D-05, D-08) ✓ 2026-05-23

**Phase 7 complete ✓** — hardware-verified 2026-05-23

### Phase 8: RU IP List Exclusion Filter

**Goal:** Allow operators to define CIDR ranges that must be excluded from the downloaded RU IP list; when `scripts/update-vpn-routes` fetches the list, it appends `exclude[cidr4]=...` query parameters to the URL for each CIDR in a local exclusion file, so those ranges are never added to `/etc/white-list.txt` and are routed through the VPN instead of the ISP
**Requirements**: None mapped (UX enhancement — extends existing download workflow)
**Depends on:** Phase 3 (update-vpn-routes), Phase 5 (white-list.txt)
**Plans:** 3/3 plans complete

Plans:

**Wave 1 (parallel):**

- [x] 08-01-PLAN.md — scripts/update-vpn-routes: EFFECTIVE_URL construction block; curl uses EFFECTIVE_URL
- [x] 08-02-PLAN.md — deploy.sh: EXCLUDE_LIST_* vars, Stage 21b conditional SCP, PHASE 8 Final Summary line

**Wave 2 (after Wave 1):**

- [x] 08-03-PLAN.md — configs/ru-exclude.txt.example, .gitignore entry, README.md + docs/README.ru.md documentation

### Phase 9: Operational Logging

**Goal:** Centralized, human-readable logs for diagnosing system failures and routing issues; 14-day rotation
**Requirements**: TBD
**Depends on:** Phase 8
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 9 to break down)

### Phase 10: Splitgate Ergonomics & Organization

**Goal:** Consolidate all RPi app files under `/etc/splitgate/` (branded namespace); move Phase 9 logs to `/etc/splitgate/logs/`; add `/usr/local/bin/splitgate` dispatcher with subcommands: `status`, `watch`, `rollback`, `routing`, `update`
**Requirements**: None mapped (UX/ergonomics phase — pure path consolidation + dispatcher CLI; no new v1 requirements)
**Depends on:** Phase 9 (logrotate stanza targets the Phase 9 log path under the new namespace)
**Plans:** 4/4 plans complete

Plans:

**Wave 0 (prerequisite):**

- [x] 10-00-PLAN.md — Move all source files into `src/` subdirectory via `git mv`; update `src/deploy.sh` to auto-cd to its own directory + update `.env`/TEMPLATE paths; update `.gitignore` for `src/configs/` prefix

**Wave 1 (parallel — disjoint file sets, after Wave 0):**

- [x] 10-01-PLAN.md — Rewrite internal `/etc/` path references in src/scripts/routing.sh, vpn-status.sh, vpn-rollback.sh (+ D-18 splitgate teardown), update-vpn-routes, watch-routes.py, 10-vpn-routes, src/systemd/vpn-routing.service to the `/etc/splitgate/` namespace ✓ 2026-05-27
- [x] 10-02-PLAN.md — Update src/deploy.sh `*_REMOTE` variables to `/etc/splitgate/...`; add SPLITGATE_/LOGROTATE_ variables + preflight checks; insert Stages 5 (mkdir splitgate), 26 (dispatcher deploy), 27 (logrotate deploy); bump TOTAL_STAGES=27; refresh final summary

**Wave 2 (after Wave 1):**

- [x] 10-03-PLAN.md — Create src/scripts/splitgate dispatcher (D-13..D-17) + src/configs/logrotate-vpn-gateway (D-02, D-19); update README.md and docs/README.ru.md with the splitgate CLI, new filesystem layout, and D-18 rollback behavior ✓ 2026-05-27

**Phase 10 complete ✓**

---

### Phase 11: README Documentation Overhaul

**Goal:** Trim README.md to ~150 lines (3 sections: purpose, deploy, commands); extract all technical detail into `docs/REFERENCE.md`; sync `docs/README.ru.md`
**Requirements**: None mapped (docs-only phase)
**Depends on:** Phase 10 (final filesystem layout + splitgate CLI)
**Plans:** 1 plan

Plans:

- [x] 11-01-PLAN.md — Rewrite README.md (3 sections), create docs/REFERENCE.md, sync docs/README.ru.md ✓ 2026-05-28

---

### Phase 12: Buffered ASN Output

**Goal:** Buffer `watch-routes.py` log lines until their ASN/org lookup completes so every printed line carries full enrichment data; fall back to immediate print after `BUFFER_TIMEOUT` (6.0 s) if lookup stalls
**Requirements**: None mapped (UX enhancement — extends Phase 7 async enrichment)
**Depends on:** Phase 7 (asn-lookup.py, _asn_cache), Phase 10 (/etc/splitgate/ namespace)
**Plans:** 1 plan

Plans:

- [x] 12-01-PLAN.md — src/scripts/watch-routes.py: pending buffer + watchdog thread; src/tests/test_watch_routes_asn.py updated ✓ 2026-05-28

**Phase 12 complete ✓**

---

### Phase 13: Log Monitoring, Routing Refinement & Daemon

**Goal:** Convert watch-routes.py to a systemd daemon writing dated daily logs with connection status (✓/✗); refine RU routing (add missing RU CIDRs to isp-routes-custom.txt, add non-RU candidates to vpn-routes-custom.txt commented); rename vpn-gateway.log → install.log and ru-exclude.txt → ru-list-exclude.txt; improve install log verbosity (show URL, excluded CIDRs, route counts); update docs
**Requirements**: None mapped (operational UX + routing hygiene phase)
**Depends on:** Phase 12 (watch-routes.py), Phase 10 (/etc/splitgate/ namespace), Phase 8 (ru-exclude.txt), Phase 9 (logrotate)
**Plans:** 4 plans

Plans:

**Wave 1 (parallel):**

- [x] 13-01-PLAN.md — Routing config updates (isp-routes-custom.txt + vpn-routes-custom.txt) ✓ 2026-05-29
- [x] 13-02-PLAN.md — System cleanup: install.log + ru-list-exclude.txt renames, install log verbosity, logrotate postrotate ✓ 2026-05-29

**Wave 2 (after Wave 1):**

- [x] 13-03-PLAN.md — watch-routes.py daemon mode (--daemon, ✓/✗ status, dedup) + splitgate-watch.service + deploy.sh Stage 27 + vpn-rollback.sh ✓ 2026-05-29

**Wave 3 (after all):**

- [x] 13-04-PLAN.md — Documentation (README.md, docs/README.ru.md, docs/REFERENCE.md, STATE.md) ✓ 2026-05-29

**Phase 13 complete ✓**

### Phase 14: domain-based routing via dnsmasq ipset

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 13
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 14 to break down)

---

### Phase 15: Web Admin Interface

**Goal:** React SPA admin interface running on the RPi at http://192.168.1.254:8080 — lets any LAN device manage the gateway without SSH: service control, route exceptions, all system logs, config editing, and full rollback.
**Requirements**:
- WEB-01: Route management: add/remove CIDRs in vpn-routes-custom.txt and isp-routes-custom.txt, apply changes without full redeploy
- WEB-02: Live log view: stream splitgate-watch daemon output in browser (SSE)
- WEB-03: System status dashboard: AWG tunnel health, splitgate-watch daemon state, RU list last-updated, active route counts
- WEB-04: Config management: view/edit ru-list-exclude.txt, trigger manual RU list refresh
- WEB-05: Auth: simple password protection (single shared secret, no multi-user needed)
- WEB-06: Deploy: runs as systemd service on RPi; accessible at http://192.168.1.254:PORT from LAN
**Depends on:** Phase 13 (daemon + logs), Phase 14 (dnsmasq ipset, optional)
**Plans:** 4 plans

Plans:

**Wave 1:**

- [ ] 15-01-PLAN.md — Flask backend (src/scripts/splitgate-admin.py): HTTP Basic Auth, static file serving for React SPA dist/, all 17+ API endpoints (status, services, routes, logs SSE, config, settings, rollback); src/admin/.gitignore [WEB-01..WEB-06]

**Wave 2 (parallel after Wave 1):**

- [ ] 15-02-PLAN.md — React SPA (src/admin/): Vite+React scaffold, 6 pages (Dashboard/Services/Routes/Logs/Config/Settings), HashRouter, SSE EventSource on Logs page, service button state rules per D-12, Rollback modal per D-14; npm run build + dist/ committed [WEB-01..WEB-04]
- [ ] 15-03-PLAN.md — Systemd unit (src/systemd/splitgate-admin.service) + deploy.sh Stage 29 conditional deploy (TOTAL_STAGES=29) + vpn-rollback.sh admin teardown + ADMIN_PORT=8080 in .env [WEB-05, WEB-06]

**Wave 3 (after Wave 2):**

- [ ] 15-04-PLAN.md — splitgate admin subcommand (status/start/stop/restart) + README.md Web Admin section + docs/REFERENCE.md full API table + docs/README.ru.md Russian translation + .planning/STATE.md Phase 15 decisions [WEB-05, WEB-06]

### Phase 16: Backups

**Goal:** Automated backup of config (/etc/splitgate/), keys-excluded state, and route lists — restorable without full redeploy.
**Requirements**: TBD
**Depends on:** Phase 15
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 16 to break down)

---
*Created: 2026-05-18*
*Updated: 2026-06-30 — Phase 15 plans finalized: React SPA + Flask backend, 4 plans, 3 waves*
