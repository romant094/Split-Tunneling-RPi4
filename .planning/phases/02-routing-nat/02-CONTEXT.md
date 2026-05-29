# Phase 2: Routing & NAT - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Create `scripts/routing.sh` (deployed to `/etc/routing.sh` on RPi) that:
1. Downloads the RU subnet list and saves it to `/etc/vpn-ru-subnets.txt`
2. Flushes and rebuilds all VPN-related routes in the main routing table
3. Sets default route via awg0 (all traffic → VPN)
4. Adds host route for VPN server (YOUR_VPN_SERVER_IP) via ISP (prevents tunnel loop)
5. Adds RU subnet routes via ISP (Keenetic gw)
6. Configures iptables MASQUERADE on awg0 and eth0
7. Installs iptables-persistent so rules survive reboot

Phase 3 will handle systemd autostart, cron scheduling, and rollback. This phase ends when routing.sh is deployed and the split-tunnel is manually verified as working.

</domain>

<decisions>
## Implementation Decisions

### Route Table Strategy
- **D-01:** Routes go into the main routing table (`ip route` — no custom policy routing tables or `ip rule` needed). Simple, debuggable, correct for a single-gateway RPi. tun0 (Promwad) is a separate interface and won't conflict.

### Subnet File Management
- **D-02:** RU subnets saved to `/etc/vpn-ru-subnets.txt` (one CIDR per line). This file is the source of truth for routing.sh and can be manually edited to add/remove subnets.
- **D-03:** routing.sh always attempts to download a fresh list from `$RU_SUBNET_URL` (`https://russia.iplist.opencck.org/?format=text&data=cidr4`) on each run, saves it to `/etc/vpn-ru-subnets.txt`.
- **D-04:** Download failure fallback: if download fails but `/etc/vpn-ru-subnets.txt` already exists, log a warning and continue with the existing file. If download fails AND file is missing, abort with a clear error message.
- **D-05:** `--no-update` flag: when passed, routing.sh skips the download step and uses the existing `/etc/vpn-ru-subnets.txt` as-is. Useful for offline runs and debugging.

### Idempotency
- **D-06:** Flush-and-rebuild strategy: on each run, delete all routes pointing to `awg0` (and the VPN server host route), then re-add everything from the subnet file. Clean slate avoids duplicate route errors. Brief routing gap (~milliseconds) during rebuild is acceptable.
- **D-07:** Idempotency for iptables: check if MASQUERADE rules already exist (via `iptables -C`) before adding. No duplicate rules.

### Script Scope (Single Script)
- **D-08:** `routing.sh` is one script that does everything: download subnet list, flush routes, add RU routes via ISP, add VPN server host route via ISP, set default route via awg0, set up iptables MASQUERADE (awg0 + eth0), save iptables rules via `iptables-save`.
- **D-09:** routing.sh sets the default route via awg0 (ROUT-04) — not delegated to a separate step.
- **D-10:** NAT iptables rules are set up inside routing.sh (NAT-01, NAT-02) — not a separate script.

### Deploy Integration
- **D-11:** Extend existing `deploy.sh` with a Phase 2 stage: SCP `scripts/routing.sh` → `/etc/routing.sh` on RPi, `chmod +x`. Consistent with Phase 1 deploy pattern.
- **D-12:** deploy.sh activates routing.sh automatically by default after deploying it (`ssh pi4 'sudo /etc/routing.sh'`). Pass `--no-run` flag to deploy.sh to skip activation (for first-time debugging/manual verification).

### Claude's Discretion
- Exact `ip route flush` command scope (flush all awg0 routes vs. flush table main then re-add system routes — Claude picks safer approach that doesn't break non-VPN connectivity)
- Whether to use `ipset` for the ~5000 RU subnets or plain `ip route` loop (Claude picks based on RPi4 performance characteristics)
- Exact iptables idempotency check commands
- deploy.sh stage numbering/labeling for Phase 2 additions
- Whether routing.sh sources `/etc/vpn-gateway.env` directly or expects env vars pre-set

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Network Configuration
- `.env` — canonical source for `RPI_LAN_IP`, `LAN_SUBNET`, `KEENETIC_GW`, `VPN_SERVER_IP`, `VPN_IFACE`, `RU_SUBNET_URL`
- `.planning/REQUIREMENTS.md` — Phase 2 requirements: ROUT-01–04, NAT-01–03

### Existing Phase 1 Code (extend these)
- `deploy.sh` — Phase 1 deploy orchestrator; Phase 2 adds stages here (D-11, D-12)
- `scripts/install-awg.sh` — Established scripting patterns: `set -euo pipefail`, idempotency short-circuit, staged logging `[N/TOTAL]`, `log()` + `err()` functions

### No External Specs
No ADRs or external specs — requirements fully captured in decisions above and REQUIREMENTS.md.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Patterns from Phase 1
- `set -euo pipefail` + `log()` / `err()` functions — routing.sh should follow the same pattern
- Idempotency short-circuit (check if already done, skip stage) — apply to both route setup and iptables
- Stage counter pattern `[N/TOTAL]` in deploy.sh — Phase 2 stages extend the counter
- SCP to `/tmp` → `sudo mv` → permissions — same deploy pattern for routing.sh

### Integration Points
- routing.sh sources `/etc/vpn-gateway.env` (deployed by Phase 1) to get `KEENETIC_GW`, `VPN_SERVER_IP`, `VPN_IFACE`, `LAN_SUBNET`
- awg0 interface must be up (Phase 1) before routing.sh can set default route via awg0
- deploy.sh extended by Phase 2 — new stages after the existing Phase 1 stages

</code_context>

<specifics>
## Specific Ideas

- `/etc/vpn-ru-subnets.txt` should be a plain text file, one CIDR per line — same format as the URL output. User can manually add/replace subnets in this file between runs.
- User wants to be able to debug the first activation manually. The `--no-run` flag in deploy.sh enables this workflow: deploy routing.sh, then `ssh pi4 sudo /etc/routing.sh` and verify each step.
- Timer-based subnet refresh (daily) is Phase 3 scope (AUTO-03 cron job calls routing.sh). Not part of Phase 2.

</specifics>

<deferred>
## Deferred Ideas

- **Timer-based subnet refresh**: User wants daily automatic refresh. This is Phase 3 scope (AUTO-03: `/etc/cron.daily/update-vpn-routes` calls routing.sh). routing.sh's `--no-update` flag supports the cron use case.

</deferred>

---

*Phase: 2-routing-nat*
*Context gathered: 2026-05-19*
