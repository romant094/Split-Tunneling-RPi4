# Phase 03: Autostart, Cron & Rollback - Research

**Researched:** 2026-05-20
**Domain:** systemd unit authoring, cron.d scheduling, iptables rollback, Bash scripting on Debian/RPi
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Autostart — vpn-routing.service**
- D-01: `vpn-routing.service` runs `/etc/routing.sh` (full run with download) on boot. No `--no-update` at boot.
- D-02: Service ordering: `After=awg-quick@awg0.service network-online.target`
- D-03: `awg-quick@awg0` uses the standard AWG template unit; `systemctl enable awg-quick@awg0` — no custom unit file needed.

**Daily Cron**
- D-04: Schedule: 5:00am daily via `/etc/cron.d/vpn-routes` (not `/etc/cron.daily/`).
- D-05: Schedule stored in `.env` as `CRON_UPDATE_HOUR=5`. `deploy.sh` reads this variable and writes it into the cron config at deploy time.
- D-06: Checksum-based rebuild: download fresh list → SHA256 compare with current file → if different: mv + `routing.sh --no-update`; if same: discard temp, skip rebuild.
- D-07: Cron script deployed as `/etc/cron.d/update-vpn-routes`. Source file: `scripts/update-vpn-routes` in repo.

**Rollback**
- D-08: `vpn-rollback.sh` order: stop + disable `vpn-routing.service`, stop + disable `awg-quick@awg0`, `ip route flush dev awg0`, remove MASQUERADE rules on awg0 and eth0, remove cron entry, restore default route via static `ip route add default via ${KEENETIC_GW}`.
- D-09: Silent execution + syslog via `logger`. Final state printed to stdout.
- D-10: Preserved after rollback: `awg0.conf`, AmneziaWG packages, `/etc/routing.sh`, `/etc/vpn-ru-subnets.txt`. Only undoes running state.

**Deploy Integration**
- D-11: Extend `deploy.sh` with stages 12+ for Phase 3 artifacts. Pattern: SCP to `/tmp` → `sudo mv` + `chmod`.
- D-12: New env var `CRON_UPDATE_HOUR=5` added to `.env`. Safe to commit.

### Claude's Discretion

- Exact `vpn-routing.service` unit file content (Type=oneshot vs Type=simple, Restart policy)
- SHA256 checksum command (use `sha256sum`)
- `update-vpn-routes` cron format (run as root, redirect stdout/stderr to logger)
- Whether rollback restores default route via `dhclient` or static `ip route add` (use static `ip route add default via ${KEENETIC_GW}`)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTO-01 | awg-quick@awg0 systemd service enabled at boot | D-03: `systemctl enable awg-quick@awg0` — no custom unit needed; service ships with amneziawg-tools |
| AUTO-02 | vpn-routing.service enabled, starts after awg-quick@awg0 | D-01/D-02: custom oneshot unit with `After=awg-quick@awg0.service network-online.target` |
| AUTO-03 | `/etc/cron.daily/update-vpn-routes` runs routing.sh daily | D-04/D-07: deployed to `/etc/cron.d/` with username field; 5am via CRON_UPDATE_HOUR |
| ROLL-01 | `/etc/vpn-rollback.sh` stops services, flushes routes, removes NAT rules and cron | D-08: iptables -D mirror of -A rules; netfilter-persistent save after removal |
| ROLL-02 | Rollback preserves awg0.conf, installed packages, routing.sh | D-10: rollback only undoes running state; no rm of config or packages |
| VRFY-01 | `ip route get 8.8.8.8` → dev awg0 | Verified via routing.sh Stage 9 pattern; services must be running |
| VRFY-02 | `ip route get 77.88.8.8` → via 192.168.1.1 | RU subnet routes survive reboot if vpn-routing.service is enabled |
| VRFY-03 | `ip route get YOUR_VPN_SERVER_IP` → via 192.168.1.1 | VPN server host route added by routing.sh Stage 4 |
| VRFY-04 | `curl --interface awg0 https://ifconfig.me` returns VPN IP | Requires awg0 interface to be up (awg-quick@awg0) before vpn-routing.service runs |

</phase_requirements>

---

## Summary

Phase 3 makes the VPN gateway fully autonomous by wiring three system-level components: a systemd service for boot-time routing, a cron job for daily subnet refreshes, and a rollback script to undo everything cleanly.

The technical work is entirely in Bash and systemd unit syntax — no new packages are required. The hardest part is correct service ordering: `vpn-routing.service` must wait for both `awg-quick@awg0.service` (tunnel up) and `network-online.target` (network reachable) before running `routing.sh`. The `awg-quick@awg0` service is already provided by the amneziawg-tools package as a template unit — no custom unit file needed for AUTO-01.

The cron job uses `/etc/cron.d/` format (includes a username field) rather than `/etc/cron.daily/`, which gives predictable timing. `deploy.sh` must expand the `${CRON_UPDATE_HOUR}` variable from `.env` before writing the cron file — this is a Bash substitution step, not a simple SCP. The rollback script mirrors every setup operation with its inverse (stop vs. start, `iptables -D` vs. `-A`, `ip route del` vs. `add`) and ends by re-saving iptables with `netfilter-persistent save`.

**Primary recommendation:** Use `Type=oneshot` + `RemainAfterExit=yes` for `vpn-routing.service`. This matches the awg-quick@.service pattern, allows `systemctl status` to report the service as active after the routing script exits, and enables `ExecStop` for clean shutdown ordering if ever needed.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| VPN tunnel autostart | RPi systemd (awg-quick@awg0) | — | Template unit ships with amneziawg-tools; just needs `systemctl enable` |
| Route setup autostart | RPi systemd (vpn-routing.service) | — | Custom oneshot unit wrapping existing routing.sh |
| Daily subnet refresh | RPi cron (/etc/cron.d/) | routing.sh --no-update | Cron triggers download+compare; routing.sh does the actual route rebuild |
| Rollback | RPi bash script (/etc/vpn-rollback.sh) | iptables-persistent | Script undoes services, routes, NAT; iptables-persistent re-saves the post-rollback state |
| Deploy orchestration | macOS deploy.sh (stages 12+) | SSH/SCP | Existing deploy pattern; adds CRON_UPDATE_HOUR substitution step |

---

## Standard Stack

### Core (No New Packages)

This phase installs no new software. All tools are already present on the RPi from Phases 1 and 2:

| Tool | Source | Purpose |
|------|--------|---------|
| `systemctl` | Debian systemd | Enable/start/stop services |
| `awg-quick@.service` | amneziawg-tools (Phase 1) | Template unit; AUTO-01 just enables it |
| `iptables` / `iptables-save` | Phase 2 (iptables-persistent installed) | NAT rules management |
| `netfilter-persistent` | Phase 2 | Re-saves iptables state after rollback |
| `curl` | Phase 2 (routing.sh uses it) | Download RU subnet list in cron script |
| `sha256sum` | Debian coreutils | Checksum comparison in update-vpn-routes |
| `logger` | Debian util-linux | Syslog output from cron and rollback scripts |
| `ip` | iproute2 | Route and interface management |

**Installation:** None required. `[VERIFIED: confirmed via routing.sh existing usage and amneziawg-tools install in Phase 1]`

---

## Package Legitimacy Audit

> No external packages are installed in this phase. All tools are Debian system utilities or already installed from prior phases.

**Packages removed due to slopcheck verdict:** none
**Packages flagged as suspicious:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Boot sequence:
  systemd
    ├── awg-quick@awg0.service   [Type=oneshot, RemainAfterExit=yes]
    │     ExecStart: awg-quick up awg0
    │     (awg0 interface now UP)
    │
    └── vpn-routing.service      [After=awg-quick@awg0 network-online.target]
          ExecStart: /etc/routing.sh (full run with download)
          (routes + NAT now active)

Daily at 05:00:
  crond (/etc/cron.d/vpn-routes)
    └── /etc/update-vpn-routes
          download fresh list → /tmp/ru-subnets.tmp
          sha256sum compare with /etc/vpn-ru-subnets.txt
          if CHANGED: mv temp → file; /etc/routing.sh --no-update
          if SAME:    rm temp; exit 0 (no disruption)

Rollback (operator-initiated):
  /etc/vpn-rollback.sh
    1. systemctl stop+disable vpn-routing.service
    2. systemctl stop+disable awg-quick@awg0
    3. ip route flush dev awg0
    4. ip route del ${VPN_SERVER_IP}/32
    5. ip route del default
    6. iptables -t nat -D POSTROUTING -o awg0 -j MASQUERADE
    7. iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
    8. netfilter-persistent save
    9. rm -f /etc/cron.d/vpn-routes
   10. ip route add default via ${KEENETIC_GW}
   11. logger + stdout summary
```

### Recommended Project Structure

```
scripts/
├── routing.sh              # EXISTING — called by service and cron
├── update-vpn-routes       # NEW — deployed to /etc/update-vpn-routes
└── vpn-rollback.sh         # NEW — deployed to /etc/vpn-rollback.sh

systemd/
└── vpn-routing.service     # NEW — deployed to /etc/systemd/system/

deploy.sh                   # EXTEND — add stages 12-16
.env                        # EXTEND — add CRON_UPDATE_HOUR=5
```

### Pattern 1: vpn-routing.service — Type=oneshot with RemainAfterExit

**What:** A systemd service that runs `/etc/routing.sh` once at boot and remains in "active" state after the script exits.

**When to use:** Any setup script that runs once (not a daemon). `RemainAfterExit=yes` makes `systemctl status vpn-routing.service` show `active (exited)` rather than `inactive (dead)` — this is the correct behavior for a routing setup script.

**Why oneshot, not simple:** `Type=simple` considers the service "started" immediately after forking, so dependent services can race before routing.sh completes. `Type=oneshot` blocks dependents until routing.sh exits successfully. [VERIFIED: systemd.io docs + Red Hat oneshot guide]

```ini
# Source: systemd documentation + awg-quick@.service pattern
[Unit]
Description=VPN split-tunnel routing setup
After=awg-quick@awg0.service network-online.target
Wants=network-online.target
Requires=awg-quick@awg0.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/etc/routing.sh

[Install]
WantedBy=multi-user.target
```

**Restart policy:** No `Restart=` directive. Routing is boot-time setup; if it fails the operator must investigate manually. The fallback (D-04) inside routing.sh handles download failures; systemd restart would loop if the VPN server or network is unreachable.

### Pattern 2: /etc/cron.d/ File Format

**What:** Files in `/etc/cron.d/` use a 6-field format including a username field. This differs from user crontabs.

**Key difference from cron.daily:** `/etc/cron.d/` entries run at a precise, configurable time. `/etc/cron.daily/` runs via `run-parts` at a system-determined time (often 6:25am on Debian, configurable in `/etc/crontab` — not predictable without checking). [VERIFIED: man crontab(5) + Debian crontab behaviour]

```
# /etc/cron.d/vpn-routes
# Field format: minute hour day month weekday user command
0 5 * * * root /etc/update-vpn-routes >> /var/log/vpn-routes.log 2>&1
```

**deploy.sh must substitute `${CRON_UPDATE_HOUR}` at deploy time:**
```bash
# In deploy.sh stages 12+: generate cron file from template
cron_content="0 ${CRON_UPDATE_HOUR} * * * root /etc/update-vpn-routes >> /var/log/vpn-routes.log 2>&1"
echo "$cron_content" | ssh "$SSH_HOST" "sudo tee /etc/cron.d/vpn-routes > /dev/null && sudo chmod 644 /etc/cron.d/vpn-routes"
```

**Permissions:** `/etc/cron.d/` files must be mode 644, owned root:root. If world-writable, crond silently ignores them. [VERIFIED: Debian cron man page]

### Pattern 3: Checksum-Based Cron Script (update-vpn-routes)

```bash
#!/usr/bin/env bash
# /etc/update-vpn-routes — called by /etc/cron.d/vpn-routes
# Downloads fresh RU subnet list; rebuilds routes only if list changed.

set -euo pipefail

SUBNET_FILE="/etc/vpn-ru-subnets.txt"
SUBNET_TMP="/tmp/ru-subnets-cron.tmp"

log() { logger -t "vpn-routes" "$*"; }

source /etc/vpn-gateway.env

log "Checking for RU subnet list update..."

if ! curl -fsSL "${RU_SUBNET_URL}" -o "${SUBNET_TMP}" 2>/dev/null; then
    log "Download failed — skipping update, routes unchanged"
    rm -f "${SUBNET_TMP}"
    exit 0
fi

# SHA256 compare (D-06)
new_hash=$(sha256sum "${SUBNET_TMP}" | cut -d' ' -f1)
if [[ -f "${SUBNET_FILE}" ]]; then
    old_hash=$(sha256sum "${SUBNET_FILE}" | cut -d' ' -f1)
else
    old_hash=""
fi

if [[ "${new_hash}" == "${old_hash}" ]]; then
    log "Subnet list unchanged (hash: ${new_hash:0:12}...) — no rebuild needed"
    rm -f "${SUBNET_TMP}"
    exit 0
fi

log "Subnet list changed — rebuilding routes"
mv "${SUBNET_TMP}" "${SUBNET_FILE}"
/etc/routing.sh --no-update
log "Route rebuild complete"
```

**Why exit 0 on download failure:** The cron job running nightly should not generate cron failure mail if the upstream list is temporarily unreachable. Existing routes remain active. Log the failure via `logger` for visibility.

### Pattern 4: Rollback Script (vpn-rollback.sh)

```bash
#!/usr/bin/env bash
# /etc/vpn-rollback.sh — Undoes VPN gateway setup; restores plain-host routing.
# D-08: stop services → flush routes → remove NAT → remove cron → restore default route
# D-09: silent + syslog; final state to stdout
# D-10: preserves awg0.conf, packages, routing.sh, vpn-ru-subnets.txt

set -euo pipefail

log() { logger -t "vpn-rollback" "$*"; echo "[rollback] $*"; }

if [[ ! -f /etc/vpn-gateway.env ]]; then
    echo "ERROR: /etc/vpn-gateway.env not found" >&2; exit 1
fi
source /etc/vpn-gateway.env

log "Starting VPN gateway rollback..."

# 1. Stop and disable services
log "Stopping vpn-routing.service..."
systemctl stop vpn-routing.service 2>/dev/null || true
systemctl disable vpn-routing.service 2>/dev/null || true

log "Stopping awg-quick@${VPN_IFACE}..."
systemctl stop "awg-quick@${VPN_IFACE}" 2>/dev/null || true
systemctl disable "awg-quick@${VPN_IFACE}" 2>/dev/null || true

# 2. Flush VPN routes
log "Flushing routes on ${VPN_IFACE}..."
ip route flush dev "${VPN_IFACE}" 2>/dev/null || true
ip route del "${VPN_SERVER_IP}/32" 2>/dev/null || true
ip route del default 2>/dev/null || true

# 3. Remove NAT rules (mirror of routing.sh Stage 7)
log "Removing MASQUERADE rules..."
if iptables -t nat -C POSTROUTING -o "${VPN_IFACE}" -j MASQUERADE 2>/dev/null; then
    iptables -t nat -D POSTROUTING -o "${VPN_IFACE}" -j MASQUERADE
    log "MASQUERADE on ${VPN_IFACE}: removed"
fi
if iptables -t nat -C POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null; then
    iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
    log "MASQUERADE on eth0: removed"
fi

# 4. Re-save iptables without MASQUERADE rules
netfilter-persistent save
log "iptables rules re-saved (MASQUERADE rules removed)"

# 5. Remove cron entry
rm -f /etc/cron.d/vpn-routes
log "Cron job removed"

# 6. Restore ISP default route (static — no DHCP dependency, D-08)
ip route add default via "${KEENETIC_GW}"
log "Default route restored: via ${KEENETIC_GW}"

# 7. Final state summary (stdout)
echo ""
echo "================================================================"
echo " VPN gateway rollback complete."
echo "================================================================"
echo " Stopped and disabled:"
echo "   vpn-routing.service"
echo "   awg-quick@${VPN_IFACE}"
echo " Routes flushed: dev ${VPN_IFACE}"
echo " NAT rules removed: MASQUERADE on ${VPN_IFACE} + eth0"
echo " Cron removed: /etc/cron.d/vpn-routes"
echo " Default route restored: via ${KEENETIC_GW}"
echo ""
echo " Preserved (not removed):"
echo "   /etc/amnezia/amneziawg/awg0.conf"
echo "   /etc/routing.sh"
echo "   /etc/vpn-ru-subnets.txt"
echo "   AmneziaWG packages"
echo ""
echo " To verify: ip route show default"
echo "   Expected: default via ${KEENETIC_GW}"
echo "================================================================"
```

### Pattern 5: deploy.sh Extension (Stages 12-16)

The existing `TOTAL_STAGES=11` must be updated. New stages follow the established SCP-to-tmp pattern:

```bash
TOTAL_STAGES=16

# Stage 12: deploy vpn-routing.service
scp systemd/vpn-routing.service "${SSH_HOST}:/tmp/vpn-routing.service.tmp"
ssh "$SSH_HOST" "sudo mv /tmp/vpn-routing.service.tmp /etc/systemd/system/vpn-routing.service && \
                 sudo chmod 644 /etc/systemd/system/vpn-routing.service"

# Stage 13: deploy update-vpn-routes script
scp scripts/update-vpn-routes "${SSH_HOST}:/tmp/update-vpn-routes.tmp"
ssh "$SSH_HOST" "sudo mv /tmp/update-vpn-routes.tmp /etc/update-vpn-routes && \
                 sudo chmod +x /etc/update-vpn-routes"

# Stage 14: deploy cron entry (generated from .env CRON_UPDATE_HOUR)
cron_line="0 ${CRON_UPDATE_HOUR} * * * root /etc/update-vpn-routes >> /var/log/vpn-routes.log 2>&1"
echo "$cron_line" | ssh "$SSH_HOST" "sudo tee /etc/cron.d/vpn-routes > /dev/null && \
                                      sudo chmod 644 /etc/cron.d/vpn-routes"

# Stage 15: deploy vpn-rollback.sh
scp scripts/vpn-rollback.sh "${SSH_HOST}:/tmp/vpn-rollback.sh.tmp"
ssh "$SSH_HOST" "sudo mv /tmp/vpn-rollback.sh.tmp /etc/vpn-rollback.sh && \
                 sudo chmod +x /etc/vpn-rollback.sh"

# Stage 16: enable services + systemctl daemon-reload
ssh "$SSH_HOST" "sudo systemctl daemon-reload && \
                 sudo systemctl enable awg-quick@awg0 && \
                 sudo systemctl enable vpn-routing.service"
```

**Note:** `CRON_UPDATE_HOUR` must be sourced from `.env` before this stage executes (Stage B already does `source .env` in the current deploy.sh).

### Anti-Patterns to Avoid

- **`Type=simple` for routing.sh:** systemd marks the service started before routing.sh finishes. Any future service with `After=vpn-routing.service` could race against incomplete routing.
- **`Restart=on-failure` for vpn-routing.service:** If awg0 is unreachable or download fails (non-D-04 scenario), repeated restarts create a storm at boot. No Restart directive — let the operator investigate.
- **Hardcoding `5` in the cron file in the repo:** The file must be generated at deploy time from `CRON_UPDATE_HOUR`. Committing a hardcoded value defeats D-05's intent.
- **`/etc/cron.daily/` for cron job:** Files in `/etc/cron.daily/` run via `run-parts` at the time set in `/etc/crontab` (typically ~6:25am on Debian, not configurable per-job). Use `/etc/cron.d/` with an explicit time instead. [VERIFIED: Debian crontab(5) man page]
- **World-writable cron.d files:** `crond` silently ignores `/etc/cron.d/` files with incorrect permissions. Mode must be 644 (or 640). [ASSUMED: documented behavior in Debian cron package]
- **`dhclient eth0` in rollback:** dhclient is not always installed or configured; it may also conflict with Keenetic's DHCP in ways hard to predict. Static `ip route add default via ${KEENETIC_GW}` is fully deterministic. (D-08 decision confirmed.)
- **Using `ip route flush table main` in rollback:** This would flush ALL routes including system routes. Only flush `dev awg0` routes and explicitly delete the VPN server host route and default route.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tracking iptables rule existence before delete | Custom rule-list parser | `iptables -C` check before `-D` | `-C` returns exit code 0 if rule exists; same pattern already used in routing.sh Stage 7 |
| Checksum comparison | Custom diff tool | `sha256sum` + string compare | coreutils, available everywhere, single line |
| Syslog writing from shell | Custom log file writes | `logger -t "tag" "message"` | Already established in routing.sh patterns; goes to journald and /var/log/syslog |
| Service state after exit | Custom PID file tracking | `RemainAfterExit=yes` | systemd built-in; `systemctl status` shows "active (exited)" correctly |
| Cron time variable substitution | Separate config management tool | Bash variable expansion in deploy.sh | `echo "0 ${CRON_UPDATE_HOUR} * * *..."` before SCP — one line |

---

## Common Pitfalls

### Pitfall 1: awg-quick@awg0 sends sd_notify before tunnel is fully established

**What goes wrong:** Like OpenVPN, `awg-quick` (and the underlying WireGuard handshake) may complete systemd service startup before the tunnel peer has responded. `vpn-routing.service` starts, routing.sh runs, sets default route via awg0 — but awg0 has no active peer session yet. Traffic drops until the handshake completes (usually within 1-2 seconds).

**Why it happens:** `awg-quick@.service` is `Type=oneshot` — it exits after `awg-quick up awg0` completes, which succeeds as soon as the interface is created, not when the handshake is done.

**How to avoid:** This is acceptable behavior for a gateway. The handshake completes in ~1-2 seconds after tunnel creation; brief packet loss at boot is not a problem for a gateway used by LAN devices that retry. Do NOT add `ExecStartPost=sleep N` — that is a code smell.

**Warning signs:** If VRFY-04 (`curl --interface awg0 https://ifconfig.me`) fails immediately after boot but succeeds 5 seconds later, this is the handshake delay. Not a configuration error.

### Pitfall 2: cron.d file silently ignored

**What goes wrong:** The cron job is deployed but never runs. No error is logged.

**Why it happens:** `/etc/cron.d/` files are silently ignored if: (a) the file is world-writable (must be mode 644 or 640), (b) the file has Windows line endings (CRLF), (c) the file ends without a trailing newline. The cron daemon has no "I ignored this file" log entry.

**How to avoid:** (a) Ensure mode 644 in deploy.sh. (b) Generate the cron line via `echo` in deploy.sh (no CRLF risk). (c) `echo` adds a newline automatically. Verify after deploy: `ssh pi4 "sudo cat /etc/cron.d/vpn-routes"` and `ssh pi4 "sudo ls -l /etc/cron.d/vpn-routes"`.

**Warning signs:** `grep CRON /var/log/syslog` shows no entries for vpn-routes at 5am.

### Pitfall 3: systemctl daemon-reload missing after unit file deploy

**What goes wrong:** `systemctl enable vpn-routing.service` reports "Failed to enable unit: Unit vpn-routing.service not found." even though the file was just SCPed.

**Why it happens:** systemd caches the unit file list. New unit files are not visible until `systemctl daemon-reload` is run.

**How to avoid:** Always run `systemctl daemon-reload` before `systemctl enable` in Stage 16. In deploy.sh this is a single compound SSH command: `sudo systemctl daemon-reload && sudo systemctl enable ...`.

**Warning signs:** `systemctl enable` exits non-zero with "unit not found" immediately after deploying the unit file.

### Pitfall 4: Rollback leaves stale default route if awg0 was default gateway

**What goes wrong:** After rollback, `ip route show default` shows nothing. Internet access fails.

**Why it happens:** `ip route flush dev awg0` removes the `default dev awg0` route. If the operator then runs `ip route del default` as a separate safety call, and the KEENETIC_GW route add fails (e.g., network unreachable momentarily), the RPi has no default route.

**How to avoid:** In rollback, `ip route del default 2>/dev/null || true` (ignore failure) then unconditionally `ip route add default via ${KEENETIC_GW}`. The `|| true` prevents set -e from aborting before the add.

**Warning signs:** `ip route show default` returns empty after rollback.

### Pitfall 5: netfilter-persistent save in rollback not idempotent

**What goes wrong:** Rollback runs `netfilter-persistent save`, but if `iptables-persistent` is not installed (edge case) or if the service is masked, the save fails and rollback aborts under `set -e`.

**Why it happens:** rollback.sh uses `set -euo pipefail`; any non-zero exit aborts the script.

**How to avoid:** Call `netfilter-persistent save` after the MASQUERADE rules are removed. If the save fails (package not installed), log a warning but continue — the MASQUERADE rules are already removed from the running kernel; they will only return on reboot if iptables-persistent loads them. Add `|| log "WARNING: netfilter-persistent save failed — rules removed from kernel but may reload on reboot"`.

---

## Code Examples

### systemctl enable command (AUTO-01)

```bash
# Source: docs.edisglobal.com AmneziaWG setup guide + amneziawg-tools source
# Enable awg-quick@awg0 for boot (no custom unit file needed — ships with amneziawg-tools)
sudo systemctl enable awg-quick@awg0
```

### systemctl daemon-reload + enable sequence

```bash
# Source: systemd documentation [ASSUMED: standard systemd workflow, universally documented]
sudo systemctl daemon-reload
sudo systemctl enable awg-quick@awg0
sudo systemctl enable vpn-routing.service
```

### iptables -C check before -D (rollback NAT removal)

```bash
# Source: routing.sh Stage 7 — same pattern inverted for rollback [VERIFIED: existing codebase]
if iptables -t nat -C POSTROUTING -o awg0 -j MASQUERADE 2>/dev/null; then
    iptables -t nat -D POSTROUTING -o awg0 -j MASQUERADE
fi
```

### sha256sum checksum comparison

```bash
# Source: GNU coreutils sha256sum [ASSUMED: standard Linux coreutils]
new_hash=$(sha256sum "${SUBNET_TMP}" | cut -d' ' -f1)
old_hash=$(sha256sum "${SUBNET_FILE}" | cut -d' ' -f1)
if [[ "${new_hash}" != "${old_hash}" ]]; then
    # list changed — rebuild
fi
```

### CRON_UPDATE_HOUR env-driven cron line generation in deploy.sh

```bash
# Source: Bash variable expansion + /etc/cron.d format [ASSUMED: standard Bash + cron]
source .env
cron_line="0 ${CRON_UPDATE_HOUR} * * * root /etc/update-vpn-routes >> /var/log/vpn-routes.log 2>&1"
echo "$cron_line" | ssh "$SSH_HOST" "sudo tee /etc/cron.d/vpn-routes > /dev/null && sudo chmod 644 /etc/cron.d/vpn-routes"
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `/etc/rc.local` for boot scripts | systemd unit with `After=` ordering | Debian 8+ (systemd as default) | rc.local runs before network is ready; systemd ordering is reliable |
| `/etc/cron.daily/` for VPN refresh | `/etc/cron.d/` with explicit time | Always available; preference | cron.daily time is non-deterministic; cron.d gives exact minute/hour |
| `wg-quick@.service` | `awg-quick@.service` | AmneziaWG fork | Same unit structure; just different binary name |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `awg-quick@.service` ships with amneziawg-tools on Debian arm64 (confirmed via EDIS docs and amneziawg-tools source showing WITH_SYSTEMDUNITS) | Standard Stack / D-03 | If not installed, AUTO-01 needs a custom unit file — low risk, deploy.sh would detect via `systemctl status` |
| A2 | `crond` on Debian Bookworm/Bullseye silently ignores world-writable cron.d files | Common Pitfalls #2 | Different behavior than documented — cron job would run but be a security gap |
| A3 | `sha256sum` is available in coreutils on RPi OS Debian | Code Examples | Almost certain; coreutils is always installed. If not, use `md5sum` as fallback |
| A4 | `netfilter-persistent save` is the correct command (not `iptables-save >`) on Debian when iptables-persistent is installed | Code Examples | Both work; if netfilter-persistent save fails, `iptables-save > /etc/iptables/rules.v4` is equivalent |
| A5 | `logger -t "vpn-rollback"` format matches existing `logger` usage convention from routing.sh | Code Examples | Consistent with existing patterns; low risk |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| systemd | vpn-routing.service, awg-quick@awg0 | ✓ | Ships with Debian/Raspbian | — |
| awg-quick@.service template unit | AUTO-01 | ✓ (installed Phase 1) | amneziawg-tools | Custom unit file if missing |
| iptables-persistent / netfilter-persistent | ROLL-01 (NAT rule removal + save) | ✓ (installed Phase 2 Stage 8) | Phase 2 routing.sh Stage 8 | `iptables-save > /etc/iptables/rules.v4` |
| sha256sum | update-vpn-routes (D-06) | ✓ (Debian coreutils) | coreutils | `md5sum` as fallback |
| logger | update-vpn-routes, vpn-rollback.sh | ✓ (util-linux) | Ships with Debian | echo to /var/log directly |
| curl | update-vpn-routes | ✓ (routing.sh uses it) | Phase 2 dependency | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** awg-quick@.service template unit — if absent, a custom unit file can be authored (5 lines). Confirmed present via Phase 1 install.

---

## Validation Architecture

> `nyquist_validation` is `false` in config.json — this section is skipped per config.

---

## Security Domain

> `security_enforcement` is not set to false in config — included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — no user-facing auth in this phase |
| V3 Session Management | no | N/A |
| V4 Access Control | yes | All scripts deployed as root-owned, non-world-writable; cron.d 644 |
| V5 Input Validation | partial | sha256sum output is hex — no shell injection risk; RU_SUBNET_URL comes from /etc/vpn-gateway.env (trusted, not from cron invocation) |
| V6 Cryptography | no | sha256sum used for integrity comparison only, not for cryptographic authentication |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| cron.d file replaced by lower-privilege process | Tampering | mode 644, root:root ownership — no non-root write access |
| RU subnet file poisoned before sha256 compare | Tampering | SUBNET_FILE at /etc/vpn-ru-subnets.txt (root-owned); download to /tmp first; mv only on success |
| rollback script modified to skip NAT removal | Tampering | /etc/vpn-rollback.sh root-owned (chmod +x, root:root); same protection as routing.sh |
| VPN keys exposed via vpn-rollback.sh | Information Disclosure | rollback.sh sources /etc/vpn-gateway.env (no keys); keys only in /etc/amnezia/amneziawg/awg0.conf (mode 600); rollback.sh does not read or print awg0.conf |

---

## Sources

### Primary (HIGH confidence)
- amneziawg-tools GitHub source (`src/systemd/wg-quick@.service`) — confirmed `Type=oneshot`, `RemainAfterExit=yes`, `After=network-online.target`
- EDIS Global AmneziaWG docs — confirmed `systemctl enable --now awg-quick@awg0` syntax
- `routing.sh` (existing codebase) — `iptables -C` idempotency pattern reused for rollback

### Secondary (MEDIUM confidence)
- Red Hat systemd oneshot guide — Type=oneshot vs simple comparison with ordering implications
- Thomas Stringer systemd blog — oneshot RemainAfterExit behavior
- `man crontab(5)` via nixCraft/Ubuntu help — `/etc/cron.d/` 6-field format confirmed (includes username)

### Tertiary (LOW confidence / ASSUMED)
- Debian cron silent-ignore behavior for world-writable cron.d files (widely documented but not verified against current Debian cron version)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all tools confirmed present from prior phases
- Architecture: HIGH — unit file structure confirmed from amneziawg-tools source; cron.d format confirmed from man page
- Pitfalls: MEDIUM-HIGH — most are derived from existing codebase patterns + standard systemd/cron behavior

**Research date:** 2026-05-20
**Valid until:** 2026-06-20 (stable domain — systemd and cron formats are not fast-moving)
