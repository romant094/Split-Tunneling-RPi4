---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Quick task 260820-k3a complete — Routes page batch delete, Apply gating, Fill Descriptions dialog
last_updated: "2026-08-20T11:17:13.739Z"
progress:
  total_phases: 16
  completed_phases: 13
  total_plans: 42
  completed_plans: 34
  percent: 81
---

# State: RPi VPN Gateway

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-18)

**Core value:** Non-RU traffic exits through AmneziaWG VPN; RU traffic exits direct via ISP — transparent to LAN devices, survives reboots, fully reversible.
**Current focus:** Phase 16 — Web Admin UX Upgrade

## Current Phase

**Phase 13: Log Monitoring, Routing Refinement & Daemon — COMPLETE (4/4 plans)**

10-00 complete: all source dirs moved to src/.
10-01 complete: all internal /etc/ paths in 7 scripts/units migrated to /etc/splitgate/; vpn-rollback.sh D-18 teardown added.
10-02 complete: deploy.sh *_REMOTE vars updated to /etc/splitgate/; 3 new stages (5: mkdir /etc/splitgate/logs, 26: dispatcher, 27: logrotate); TOTAL_STAGES=27; Stage 21b header bug fixed.
10-03 complete: src/scripts/splitgate dispatcher created (exec-based, 5 subcommands); src/configs/logrotate-vpn-gateway created (targets /etc/splitgate/logs/vpn-gateway.log); README.md + docs/README.ru.md updated with splitgate CLI, filesystem layout, D-18 rollback docs.

## Phase Progress

| Phase | Status | Plans | Progress |
|-------|--------|-------|----------|
| 1 — Foundation & Config | ✓ Complete | 2/2 done | 100% |
| 2 — Routing & NAT | ✓ Complete | 2/2 done | 100% |
| 3 — Autostart, Cron & Rollback | ✓ Complete | 3/3 done | 100% |
| 4 — Traffic Logging & Visibility | ✓ Complete | 3/3 done | 100% |
| 5 — Custom Route Exceptions | ✓ Complete | 2/2 done | 100% |
| 6 — Documentation | ◆ Planned | 0/2 | 0% |
| 7 — ASN Enrichment & Traffic Attribution | ✓ Complete | 3/3 done | 100% |
| 8 — RU IP List Exclusion Filter | ✓ Complete | 3/3 done | 100% |
| 9 — Operational Logging | ✓ Complete | 1/1 done | 100% |
| 10 — Splitgate Ergonomics & Organization | ✓ Complete | 4/4 done | 100% |
| 11 — README Documentation Overhaul | ✓ Complete | 1/1 done | 100% |
| 12 — Buffered ASN Output | ✓ Complete | 1/1 done | 100% |
| 13 — Log Monitoring, Routing Refinement & Daemon | ✓ Complete | 4/4 done | 100% |

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
- Phase 5 D-06/D-08: routing.sh renames SUBNET_FILE → WHITE_LIST_FILE (/etc/white-list.txt); Stage 5b added to load /etc/splitgate/isp-routes-custom.txt when present (silent skip when absent) [was white-list-extended.txt — renamed in quick task 2026-05-28]
- Phase 5 D-14: vpn-rollback.sh updated — /etc/splitgate/ tree includes isp-routes-custom.txt + vpn-routes-custom.txt; /etc/white-list.txt preserved during rollback [was white-list-extended.txt — renamed in quick task 2026-05-28]
- Quick 2026-05-28: white-list-extended.txt → isp-routes-custom.txt (rename); vpn-routes-custom.txt added (Stage 5c, VPN-force override — highest priority, deletes ISP route then adds via awg0)
- Phase 5 D-10/D-11: vpn-status.sh --via=vpn|isp filter applied at output time (not entry collection); strict string validation; composes with --filter/--device/--last
- Phase 5 deploy: deploy.sh TOTAL_STAGES=22; Stage 21 conditionally SCPs exception file (skip if absent); Stage 22 activation drops --no-update for first-deploy correctness
- Phase 7 D-06: ORG column placed after DOMAIN and before PATH; format "{org} (AS{asn})" or "-" for unknown
- Phase 7 D-07: --summary aggregate mode top-20 by TOTAL desc; composes with --filter/--device/--via
- Phase 7 test: Docker image python:3.11-slim-bookworm for macOS re-exec (debian:bookworm-slim lacks python3)
- Phase 7 D-08: watch-routes.py _asn_cache uses None sentinel (in-flight) / {} (completed-no-result) / dict (resolved) — three states prevent duplicate thread spawns
- Phase 7 D-09: enable_asn keyword-only param on format_line() — backward-compatible default True; --no-asn flag maps to enable_asn=False
- Phase 7 D-10: deploy.sh Stage 23 deploys asn-lookup.py; Stage 24 activates routing.sh — routing activation remains last runtime stage
- Phase 8 D-05/D-06: EFFECTIVE_URL initialized to RU_SUBNET_URL; /etc/ru-exclude.txt lines appended as &exclude[cidr4]=CIDR; absent/empty file → URL unchanged
- Phase 8 D-07/D-08: EXCLUDE_LIST_LOCAL=configs/ru-exclude.txt; Stage 21b conditional SCP to /etc/ru-exclude.txt (chmod 644, root:root); no TOTAL_STAGES bump (remains 24); configs/ru-exclude.txt gitignored
- Phase 10 D-10-00-01: cd dirname BASH_SOURCE[0] in src/deploy.sh — all *_LOCAL relative paths resolve to src/ subdirectories without modification
- Phase 10 D-10-00-02: .env/.env.secrets accessed via ../ prefix from src/; root .gitignore gains src/configs/ prefix on previously bare configs/ entries
- Phase 10 D-10-01 (D-18): vpn-rollback.sh Step 7b removes /usr/local/bin/splitgate then /etc/splitgate/ tree as final filesystem ops after route restoration (per Pitfall 5)
- Phase 10 D-10-01 (D-12): /etc/iptables/rules.v4 path in routing.sh left unchanged; iptables-persistent requires exact path
- Phase 10 D-10-02: deploy.sh Stage 5 (mkdir /etc/splitgate/logs) inserted after AmneziaWG install — before awg0.conf render — guaranteeing namespace exists before any file deploy (Pitfall 4); TOTAL_STAGES=27; Stage 21b bug corrected to [22b/...]; dispatcher Stage 26 + logrotate Stage 27 placed after routing.sh activation Stage 25
- Phase 10 D-10-03: splitgate dispatcher uses exec for all 5 subcommands (watch branch uses exec sudo python3); no set -euo pipefail; logrotate stanza targets /etc/splitgate/logs/vpn-gateway.log per D-19 (NOT /var/log/vpn-gateway.log)
- Phase 9 D-03/D-04: log() pattern: "[date +%F %T] [component] $*" >> LOG_FILE; err() tee -a to file and >&2
- Phase 9 D-05: all logger -t tag calls removed from routing.sh, update-vpn-routes, vpn-rollback.sh, vpn-status.sh
- Phase 9 D-08: vpn-status.sh is interactive — log() is plain echo, no file write
- Phase 9 D-11: vpn-rollback.sh Step 7b adds rm -f /etc/logrotate.d/vpn-gateway before rm -rf /etc/splitgate
- Phase 13 D-01/D-02: isp-routes-custom.txt gets 11 confirmed-RU /24 CIDRs (Selectel, MIRAN-AS, Keenetic captive, SonicDuo, MegaFon, Raiffeisenbank, VimpelCom, SOVAM); vpn-routes-custom.txt gets commented candidate block (Cherry Servers LT, Google PoPs, Cloudflare non-DNS, Amazon CF/EC2, Akamai, Azure EU)
- Phase 13 D-03/D-04: watch-routes.py STATUS_DELAY=3 + DEDUP_TTL=30; /proc/net/nf_conntrack for ✓/✗ status (plain file read, no subprocess); one complete line written after delay; status always on in daemon mode
- Phase 13 D-05/D-06: --daemon flag writes to /etc/splitgate/logs/watch-YYYY-MM-DD.log (dated, append); midnight date rotation; no --daemon = stdout (interactive unchanged)
- Phase 13 D-07: vpn-gateway.log → install.log across routing.sh, update-vpn-routes, vpn-rollback.sh, logrotate-vpn-gateway, deploy.sh; live migration SSH mv in Stage 22c
- Phase 13 D-08: ru-exclude.txt → ru-list-exclude.txt across routing.sh, update-vpn-routes, deploy.sh (EXCLUDE_LIST vars + Stage 22c + comment), ru-list-exclude.txt.example; live migration SSH mv in deploy.sh Stage 22c
- Phase 13 D-09: install log improvements — update-vpn-routes logs source domain, actual excluded CIDRs (not just count), route count after download; routing.sh logs excluded CIDRs explicitly + Stage 5b/5c entry counts
- Phase 13 D-10: splitgate-watch.service created (ExecStart=watch-routes.py --daemon, Restart=on-failure, StandardError→watch-error.log); TOTAL_STAGES=28; Stage 28 deploys + enables; vpn-rollback.sh Step 1a stops/disables service; logrotate postrotate cleans watch-*.log >14d
- Quick 260820-juc: route files are accepted in BOTH formats — leading-comment (repo `src/configs/*.txt`) and inline `cidr # desc` (written by the web admin). routing.sh `normalize_route_line()` is the single place that reconciles them; `add_route()` logs iproute2 rejections to install.log instead of swallowing them, with per-stage FAILED counters in the Stage 9 summary
- Quick 260820-juc: `/etc/splitgate/.last-apply` is stamped by routing.sh Stage 8b (not by the admin backend) so every apply path counts — /api/config/apply, update-vpn-routes from cron, and boot-time vpn-routing.service. `splitgate-admin.py _routes_dirty()` compares custom-route-file mtimes against it; missing stamp = dirty
- Quick 260820-juc: HISTORY_DAY_CAP=50000 per day for /api/logs/history; response carries `total`/`truncated`/`day_cap` so a capped tail is never presented as a complete day

## Hardware Verified

- install-awg.sh: ✓ verified on RPi 4 (kernel 6.12.25+rpt-rpi-v8) — 2026-05-19
  - INST-01: awg + awg-quick at /usr/bin ✓
  - INST-02: ip_forward=1 persisted via /etc/sysctl.d/99-vpn-gateway.conf ✓
  - amneziawg kernel module loaded ✓

## Last Session

**Stopped at:** Quick task 260603-f8c complete — deploy-routes.sh added; docs updated
**Timestamp:** 2026-06-03T00:00:00Z
**Resume:** Deploy to RPi: `cd src && ./deploy.sh`

---
*Initialized: 2026-05-18*
*Updated: 2026-05-27 — Phase 8 complete; EFFECTIVE_URL exclusion filter in update-vpn-routes; Stage 21b + EXCLUDE_LIST vars in deploy.sh (TOTAL_STAGES=24); configs/ru-exclude.txt.example added*

## Phase 15: Web Admin Interface

**Status:** Executing Phase 16

### Decisions

- D-01: React + Vite SPA (not vanilla JS, not embedded HTML in Python)
- D-02: Built dist committed to repo — no Node.js on RPi, no build step at deploy time
- D-03: src/admin/ — React project source; src/admin/dist/ — committed build output
- D-04: Flask serves src/admin/dist/ as static files; SPA routing via React Router (hash mode)
- D-05: deploy.sh checks for src/admin/dist/ before deploying admin UI; if absent: skip with log message
- D-06: New conditional Stage 29 in deploy.sh for admin (after existing Stage 28 splitgate-watch)
- D-07: Admin files deploy to /etc/splitgate/admin/ on RPi; Flask backend at /usr/local/bin/splitgate-admin
- D-08: Python Flask (src/scripts/splitgate-admin.py) — single file, no external Python deps beyond Flask
- D-09: Auth: HTTP Basic Auth, password stored at /etc/splitgate/admin.secret (plain text, mode 600)
- D-10: Port: ADMIN_PORT=8080 in .env; accessible at http://192.168.1.254:8080 from LAN
- D-11: Flask runs as root (systemd User=root) — required for systemctl and /etc/splitgate/ writes
- D-12: Services page button state: Start disabled when active; Stop and Restart disabled when inactive
- D-13: Logs page: 4 tabs — Watch Live (SSE), Install Log, Watch Errors, System Journal; [VPN]=cyan [ISP]=yellow
- D-14: Settings page: edits vpn-gateway.env and awg0.conf; mask secret values; modal for Rollback

### File Layout (RPi)

- /usr/local/bin/splitgate-admin — Flask backend
- /etc/splitgate/admin/ — React SPA dist (served as static)
- /etc/splitgate/admin.secret — admin password (mode 600, root:root)
- /etc/systemd/system/splitgate-admin.service — systemd unit
- /etc/splitgate/logs/admin-error.log — Flask stderr

### Key Packages

- python3-flask (apt) — Flask on RPi
- vite + react + react-dom + react-router-dom (npm, dev only — dist committed to repo)

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260521-jex | Add scripts/watch-routes.py — real-time iptables log viewer with reverse DNS caching | 2026-05-21 | cf6bafa | [260521-jex-add-scripts-watch-routes-py-real-time-ip](./quick/260521-jex-add-scripts-watch-routes-py-real-time-ip/) |
| 260603-f8c | Add deploy-routes.sh — fast custom-routes deploy (SCP + routing.sh --no-update) | 2026-06-03 | 0d0bec6 | [260603-f8c-add-deploy-routes-npm-script-create-src-](./quick/260603-f8c-add-deploy-routes-npm-script-create-src-/) |
| 260810-ixy | Add dynamic per-page document.title in the admin SPA | 2026-08-10 | 60ac5dd | [260810-ixy-add-dynamic-per-page-document-title-in-t](./quick/260810-ixy-add-dynamic-per-page-document-title-in-t/) |
| 260810-iym | Fix Logs page timestamps timezone — normalize watch-routes.py to UTC Z | 2026-08-10 | f759d53 | [260810-iym-fix-logs-page-timestamps-to-display-in-t](./quick/260810-iym-fix-logs-page-timestamps-to-display-in-t/) |
| 260810-j0k | Bulk-fill route descriptions via whois lookup on Routes page | 2026-08-10 | 0dee1b9 | [260810-j0k-bulk-fill-route-descriptions-via-whois-l](./quick/260810-j0k-bulk-fill-route-descriptions-via-whois-l/) |
| 260810-izt | Add Select All control to Logs page multi-select mode | 2026-08-10 | 4625532 | [260810-izt-add-select-all-control-to-logs-page-mult](./quick/260810-izt-add-select-all-control-to-logs-page-mult/) |
| 260820-juc | Fix routing.sh silently dropping web-admin routes with inline descriptions; add routes_dirty tracking; make logs history cap honest | 2026-08-20 | 2a2c4dd | [260820-juc-fix-routing-sh-silently-dropping-web-adm](./quick/260820-juc-fix-routing-sh-silently-dropping-web-adm/) |
| 260820-k3a | Routes page: checkbox batch delete, gate Apply Changes on routes_dirty, Fill Descriptions scope dialog | 2026-08-20 | e8720c9 | [260820-k3a-routes-page-checkbox-batch-delete-gate-a](./quick/260820-k3a-routes-page-checkbox-batch-delete-gate-a/) |

## Accumulated Context

### Roadmap Evolution

- Phase 4 added: Traffic Logging & Visibility — per-connection route logging (VPN/ISP), subnets, domain names
- Phase 5 added: Custom Route Exceptions — per-IP/domain overrides forcing traffic through ISP
- Phase 6 added: Documentation — ops runbook (deploy, verify, rollback, add exceptions)
- Phase 7 added: ASN Enrichment & Traffic Attribution
- Phase 9 added: Operational Logging — centralized logs for diagnosing system failures; 14-day rotation
- Phase 10 added: Splitgate Ergonomics & Organization — consolidate RPi files under /etc/splitgate/, add splitgate dispatcher CLI, move repo source into src/ subdirectory; 4 plans across 3 waves (Wave 0: src/ restructure; Wave 1: path migration + deploy.sh parallel; Wave 2: dispatcher + docs)
- Phase 14 added: domain-based routing via dnsmasq ipset — allow domain suffixes (e.g. amazonaws.com, cloudfront.net) in isp-routes-custom.txt and vpn-routes-custom.txt alongside CIDRs; real-time DNS-triggered routing via kernel ipsets + iptables mangle marks + policy routing tables
- Phase 16 added: Backups — automated backup of config (/etc/splitgate/), keys-excluded state, and route lists; restorable without full redeploy
- Phase 16 edited: redefined from Backups to Web Admin UX Upgrade (7 requirements: UI-LOGS/AUTH/RESOURCES/DIAG/ADDROUTE/BACKUP/DEPLOY)

### Phase 4 Post-execution Fixes (applied after plans, discovered during live testing)

- routing.sh: FORWARD chain policy is DROP (Docker). Added ACCEPT rules (-i eth0, RELATED,ESTABLISHED) — without them LAN forwarding silently dropped
- routing.sh: LOG rules must be BEFORE ACCEPT — LOG is non-terminating, ACCEPT terminates; wrong order = no journald entries
- routing.sh: eth0 MASQUERADE must exclude LAN subnet (`! -d LAN_SUBNET`) — full MASQUERADE caused Keenetic web/app admin to block requests appearing from 192.168.1.254
- deploy.sh: Stage 17/18 order swapped — dnsmasq must be installed before config deployed to avoid dpkg interactive prompt
- SSH_HOST moved from deploy.sh hardcode to .env
