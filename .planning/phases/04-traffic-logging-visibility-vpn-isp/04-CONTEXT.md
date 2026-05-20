# Phase 4: Traffic Logging & Visibility - Context

**Gathered:** 2026-05-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Add traffic logging and visibility to the RPi VPN gateway:

1. **iptables connection logging** — LOG new connections at the FORWARD chain with `[VPN]` / `[ISP]` prefix tags, so each LAN device connection records its routing decision to syslog
2. **dnsmasq DNS forwarder** — Install dnsmasq on RPi; LAN devices use 192.168.1.254 as DNS resolver; dnsmasq logs all queries (hostname + source device IP); upstream: Cloudflare 1.1.1.1
3. **vpn-status.sh** — Query script that correlates iptables LOG entries with dnsmasq query log to show last N connections with domain names, VPN/ISP decision, and source device; supports `--filter=<string>` and `--device=<IP>` flags
4. **Deploy integration** — new deploy.sh stages for dnsmasq config + LOG rules activation

Phase ends when: `vpn-status.sh` on the RPi shows recent LAN device connections with domain names and VPN/ISP routing decisions visible.

**Manual step (not automated):** Keenetic KN-3010 DHCP configuration — set DNS server to 192.168.1.254. Deploy docs must include step-by-step instructions for the KN-3010 web UI.

</domain>

<decisions>
## Implementation Decisions

### iptables Connection Logging
- **D-01:** LOG target fires on FORWARD chain only (LAN device traffic passing through RPi). OUTPUT chain (RPi's own traffic) excluded — reduces noise.
- **D-02:** Two LOG rules, both with `--state NEW` to log only connection initiations (not every packet):
  - `iptables -A FORWARD -o awg0 -m state --state NEW -j LOG --log-prefix "[VPN] " --log-level 6`
  - `iptables -A FORWARD -o eth0 -m state --state NEW -j LOG --log-prefix "[ISP] " --log-level 6`
- **D-03:** Rate limiting: `--limit 10/min --limit-burst 20` on both LOG rules to prevent log floods from streaming/gaming devices.
- **D-04:** LOG rules added inside `scripts/routing.sh`, following the existing iptables idempotency pattern (`iptables -C` check before `iptables -A`). Same flush-and-rebuild approach: LOG rules removed during flush and re-added on rebuild.
- **D-05:** Log level 6 (info) → goes to syslog → journald automatically.

### dnsmasq DNS Forwarder
- **D-06:** Install `dnsmasq` on RPi. Configure as forwarding-only resolver (no local authority).
- **D-07:** Upstream DNS: `1.1.1.1` (Cloudflare). Queries go through awg0 (default VPN route) — DNS tunneled through VPN for non-RU traffic.
- **D-08:** dnsmasq query logging enabled: `log-queries` option in `/etc/dnsmasq.conf`. Logs to syslog → journald. No separate log file.
- **D-09:** Listen interface: `interface=eth0` (LAN interface on RPi). Do not listen on awg0 or lo for DNS.
- **D-10:** Retention: journald default (`SystemMaxUse=100M`) handles both iptables LOG and dnsmasq query logs. No logrotate config needed.

### vpn-status.sh Query Script
- **D-11:** Deployed to `/etc/vpn-status.sh` (chmod +x). Run as: `sudo vpn-status.sh` or `sudo vpn-status.sh --filter=steam --device=192.168.1.50 --last=100`.
- **D-12:** Default output: last 50 connections from journald. Columns: timestamp, source device IP, destination IP, destination domain, VPN/ISP decision.
- **D-13:** Domain resolution for each destination IP — two-step:
  1. Check dnsmasq query log in journald for matching DNS query (same source IP, within ~60s of connection). Use that domain name if found.
  2. If no dnsmasq match: run `host <dest-ip>` (rDNS). Use result or show raw IP if rDNS fails.
- **D-14:** `--filter=<string>` — partial, case-insensitive grep on the resolved domain name (or rDNS result). Example: `--filter=steam` matches `store.steampowered.com`, `api.steampowered.com`.
- **D-15:** `--device=<IP>` — filter by source LAN device IP. Can combine with `--filter`.
- **D-16:** `--last=<N>` — override default 50 entries. Example: `--last=200`.
- **D-17:** Script follows established patterns: `set -euo pipefail`, `source /etc/vpn-gateway.env`, `logger` for its own errors.

### Deploy Integration
- **D-18:** Extend `deploy.sh` with Phase 4 stages: deploy `/etc/dnsmasq.conf` (SCP-to-tmp → sudo mv), `systemctl enable --now dnsmasq`, run `routing.sh` to add LOG rules (or just restart routing.sh).
- **D-19:** `scripts/vpn-status.sh` in repo; deployed to `/etc/vpn-status.sh` via SCP-to-tmp → sudo mv + chmod +x.
- **D-20:** No new env vars needed — dnsmasq config is static (1.1.1.1 upstream, log-queries on).

### Rollback Integration
- **D-21:** `vpn-rollback.sh` extended: stop + disable dnsmasq, remove LOG rules from iptables. Rollback is complete without these additions (LAN loses DNS forwarder + logging), restoring plain-host state.

### Claude's Discretion
- Exact `dnsmasq.conf` options beyond interface + upstream + log-queries
- Whether to use `listen-address=192.168.1.254` or `interface=eth0` (use `interface=eth0` — more portable)
- vpn-status.sh: exact journalctl query flags for extracting [VPN]/[ISP] lines and dnsmasq queries
- Whether rDNS uses `host`, `dig -x`, or `getent hosts` (use `host` — simpler, always available)
- iptables LOG rule position within FORWARD chain (after ESTABLISHED,RELATED rule to avoid re-logging)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Scripts to Extend
- `scripts/routing.sh` — iptables authority; Phase 4 LOG rules added here; read the existing iptables -C idempotency pattern and flush-and-rebuild logic before adding D-01–D-05
- `scripts/vpn-rollback.sh` — extend with dnsmasq stop + iptables LOG rule removal (D-21)
- `deploy.sh` — extend with Phase 4 stages; read existing stage pattern before adding new stages

### Configuration
- `.env` — canonical env var source; confirm no new vars needed for Phase 4 (D-20)
- `.planning/REQUIREMENTS.md` — no Phase 4 REQ-IDs defined yet (Requirements: TBD in ROADMAP)

### Phase Context (prior decisions)
- `.planning/phases/03-autostart-cron-rollback/03-CONTEXT.md` — D-08 (rollback pattern), D-11 (deploy stage pattern), D-09 (logger/syslog convention)
- `.planning/phases/02-routing-nat/02-CONTEXT.md` — D-07 (iptables idempotency), D-11 (deploy SCP-to-tmp pattern)

### No External Specs
No ADRs or external specs — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/routing.sh` flush-and-rebuild iptables block — copy the `iptables -C` guard pattern for LOG rules
- `scripts/vpn-rollback.sh` iptables rule removal block — extend for LOG rule removal
- `deploy.sh` stage template (`[N/$TOTAL_STAGES]` logging + SCP-to-tmp) — copy for new Phase 4 stages
- `scripts/update-vpn-routes` `log()` function (`logger -t "vpn-routes"`) — same pattern for vpn-status.sh errors

### Established Patterns
- `set -euo pipefail` + staged logging `[N/TOTAL]` — all new scripts must follow
- `source /etc/vpn-gateway.env` — all RPi-side scripts source for config vars
- `iptables -C` before `iptables -A` — mandatory idempotency guard
- SCP to `/tmp/filename.tmp` → `sudo mv` + `sudo chmod` — deploy pattern for all remote files
- `logger -t "<tag>"` for syslog output from RPi scripts

### Integration Points
- `awg0` and `eth0` interfaces already up and in main routing table — LOG rules reference these
- `iptables-persistent` already installed (routing.sh Stage 8) — LOG rules survive reboot after `iptables-save`
- Existing MASQUERADE rules in FORWARD chain — LOG rules must be ordered before or after correctly (log first, then masquerade is fine; or use separate LOG jump before POSTROUTING)
- journald on RPi — receives syslog from both iptables LOG (kernel) and dnsmasq; vpn-status.sh queries this

</code_context>

<specifics>
## Specific Ideas

- `--filter=steam` → partial case-insensitive match on domain; user's primary use case is identifying gaming/app traffic routing
- Keenetic KN-3010 DHCP DNS instruction: navigate to 192.168.1.1 → Home network → Segments → DNS server → set to 192.168.1.254. Include in deploy docs as a manual prerequisite step.
- vpn-status.sh output must be readable on a terminal (not a daemon/service — a query tool run manually)
- Rate limiting protects against streaming or gaming devices generating thousands of connections per minute

</specifics>

<deferred>
## Deferred Ideas

- **Domain-based routing (Phase 5)** — routing specific domains/apps via ISP instead of VPN (e.g., forcing a game to bypass VPN). This is Phase 5: Custom Route Exceptions territory.
- **Tunnel health summary in vpn-status.sh** — user declined; `awg show` and `ip route` remain the tools for tunnel health

</deferred>

---

*Phase: 4-traffic-logging-visibility-vpn-isp*
*Context gathered: 2026-05-20*
