# Phase 3: Autostart, Cron & Rollback - Context

**Gathered:** 2026-05-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Deploy and enable three components on the RPi that make the VPN gateway fully autonomous:

1. **Autostart** — `awg-quick@awg0` systemd service + `vpn-routing.service` bring up tunnel and routes on every boot without manual intervention
2. **Daily cron** — `/etc/cron.d/` job at 5:00am downloads fresh RU subnet list; only flushes and rebuilds routes if the list changed (checksum compare)
3. **Rollback** — `/etc/vpn-rollback.sh` fully undoes the VPN gateway in one command: stops services, flushes routes, removes NAT rules, removes cron job

All deployed via extended `deploy.sh` stages (12+) using the established SCP-to-tmp → sudo mv + chmod pattern.

Phase ends when: system survives a full reboot with both services active, cron job deployed and executable, and rollback script verified to restore plain-host routing.

</domain>

<decisions>
## Implementation Decisions

### Autostart — vpn-routing.service
- **D-01:** `vpn-routing.service` runs `/etc/routing.sh` (full run with download) on boot. If download fails, routing.sh falls back to existing `/etc/vpn-ru-subnets.txt` (D-04 behavior already in routing.sh). No `--no-update` at boot — start with freshest available subnets.
- **D-02:** Service ordering: `After=awg-quick@awg0.service network-online.target` — ensures VPN interface is up and network reachable before routing.sh runs.
- **D-03:** `awg-quick@awg0` uses the standard WireGuard systemd template unit (ships with awg-quick package). Enable via `systemctl enable awg-quick@awg0` — no custom unit file needed.

### Daily Cron
- **D-04:** Schedule: 5:00am daily via `/etc/cron.d/vpn-routes` (not `/etc/cron.daily/` — RPi is always-on, predictable time preferred).
- **D-05:** Schedule stored in `.env` as `CRON_UPDATE_HOUR=5`. `deploy.sh` reads this variable and writes it into the cron config at deploy time.
- **D-06:** Checksum-based rebuild: cron script downloads fresh RU list to temp file → computes SHA256 → compares with current `/etc/vpn-ru-subnets.txt` → if different: mv temp file into place and run `routing.sh --no-update` to flush+rebuild routes; if same: discard temp file, skip rebuild. Zero disruption on days with no list changes (~most days).
- **D-07:** Cron script deployed as `/etc/cron.d/update-vpn-routes` (AUTO-03). The script itself is `scripts/update-vpn-routes` in the repo.

### Rollback
- **D-08:** `vpn-rollback.sh` (ROLL-01): in order — stop + disable `vpn-routing.service`, stop + disable `awg-quick@awg0`, `ip route flush dev awg0`, remove MASQUERADE rules on awg0 and eth0, remove cron entry, restore DHCP default route (via `dhclient eth0` or `ip route add default via ${KEENETIC_GW}`).
- **D-09:** Rollback output: silent execution + logs written to syslog via `logger` (same as routing.sh). No interactive prompts. Final state printed to stdout so operator can confirm.
- **D-10:** Preserved after rollback (ROLL-02): `awg0.conf`, AmneziaWG packages, `/etc/routing.sh`, `/etc/vpn-ru-subnets.txt`. Rollback does NOT uninstall packages or remove config files — only undoes the running state.

### Deploy Integration
- **D-11:** Extend `deploy.sh` with stages 12+ for Phase 3 artifacts. Pattern: SCP to `/tmp` → `sudo mv` + `chmod`. Consistent with D-11 from Phase 2.
- **D-12:** New env var `CRON_UPDATE_HOUR=5` added to `.env`. No secrets — safe to commit.

### Claude's Discretion
- Exact `vpn-routing.service` unit file content (Type=oneshot vs Type=simple, Restart policy)
- SHA256 checksum command (`sha256sum` vs `md5sum` — use sha256sum)
- `update-vpn-routes` cron format (run as root, redirect stdout/stderr to logger)
- Whether rollback restores default route via `dhclient` or static `ip route add` (use static `ip route add default via ${KEENETIC_GW}` — no DHCP dependency)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Phase 2 Code (extend these)
- `scripts/routing.sh` — core routing script; Phase 3 cron calls this with `--no-update`; vpn-routing.service calls it without flags; MUST read before writing any service or cron that invokes it
- `deploy.sh` — Phase 1+2 deploy orchestrator; Phase 3 adds stages 12+; read before adding new stages

### Configuration
- `.env` — canonical source for `KEENETIC_GW`, `VPN_SERVER_IP`, `VPN_IFACE`, `LAN_SUBNET`, `RU_SUBNET_URL`; Phase 3 adds `CRON_UPDATE_HOUR=5`
- `.planning/REQUIREMENTS.md` — Phase 3 requirements: AUTO-01–03, ROLL-01–02, VRFY-01–04

### Phase Context
- `.planning/phases/02-routing-nat/02-CONTEXT.md` — Phase 2 decisions (D-01–D-12); routing.sh behavior, deploy patterns, idempotency approach

### No External Specs
No ADRs or external specs — requirements fully captured in decisions above and REQUIREMENTS.md.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `routing.sh` — already handles D-04 download fallback; `--no-update` flag already implemented; cron and service just call it
- `deploy.sh` stage pattern (`[N/${TOTAL_STAGES}]` logging, SCP-to-tmp) — copy for stages 12+

### Established Patterns
- `set -euo pipefail` + staged logging `[N/TOTAL]` — all new scripts follow this
- SCP to `/tmp/filename.tmp` → `sudo mv` + `sudo chmod` — deploy pattern for all remote files
- `source /etc/vpn-gateway.env` — all RPi-side scripts source this for config vars
- `logger` for syslog output from RPi scripts (established in routing.sh)

### Integration Points
- `awg-quick@awg0.service` — WireGuard/AWG built-in systemd template; exists after install-awg.sh; `vpn-routing.service` must `After=` this
- `/etc/vpn-gateway.env` — deployed by Phase 1; sourced by routing.sh; rollback.sh also needs it for `KEENETIC_GW`
- `iptables-persistent` — installed by routing.sh Stage 8; rollback removes MASQUERADE rules and re-saves

</code_context>

<specifics>
## Specific Ideas

- `CRON_UPDATE_HOUR=5` in `.env` — user explicitly wants this configurable without editing cron files
- Cron via `/etc/cron.d/` (not `/etc/cron.daily/`) — RPi is always-on, predictable 5:00am time preferred
- Checksum-based cron: only rebuild routes when RU list actually changed — preserves connection stability on no-change days

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 3-autostart-cron-rollback*
*Context gathered: 2026-05-20*
