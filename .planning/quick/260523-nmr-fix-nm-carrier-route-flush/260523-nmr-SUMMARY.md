---
quick_id: 260523-nmr
slug: fix-nm-carrier-route-flush
phase: quick
plan: 260523-nmr
subsystem: networking/routing
tags: [bugfix, NetworkManager, routing, resilience, dispatcher]
dependency_graph:
  requires: [scripts/routing.sh, /etc/vpn-gateway.env, /etc/white-list.txt]
  provides: [scripts/10-vpn-routes, scripts/update-vpn-routes (fallback rebuild)]
  affects: [deploy.sh]
tech_stack:
  added: [NM dispatcher script]
  patterns: [NM dispatcher hook, background exec (&) in dispatcher, ip route presence check]
key_files:
  created: [scripts/10-vpn-routes]
  modified: [scripts/update-vpn-routes, deploy.sh]
decisions:
  - Dispatcher runs routing.sh in background (&) — NM kills blocking dispatcher scripts after timeout
  - update-vpn-routes checks VPN_SERVER_IP host route presence (not route count) as proxy for "routes intact"
  - Static IP on eth0 was considered and rejected — DHCP loss is not the root cause, carrier drop is
  - Dispatcher uses "up" action (not "dhcp4-change") — fires after full NM activation, eth0 IP already set
metrics:
  duration: "~2 hours (diagnosis + fix + live test)"
  completed: "2026-05-23"
  tasks_completed: 3
  files_created: 1
  files_modified: 2
---

# Quick Task 260523-nmr: Fix NM Carrier-Change Route Flush — Summary

## One-liner

Keenetic firmware update rebooted the router, eth0 carrier dropped, NM flushed all split-tunnel routes — added NM dispatcher to auto-restore on `eth0 up` + added cron fallback rebuild.

## Incident Timeline

| Time (BST) | Event |
|---|---|
| May 21 15:41 | `routing.sh` ran at boot, 1359 routes + VPN host route added |
| May 23 02:40 | DHCP lease renewed (no route loss — NM only touched DHCP-tagged routes) |
| May 23 02:45 | **Keenetic rebooted (firmware update)** → `eth0` carrier dropped |
| May 23 02:46 | `eth0` carrier restored, NM full reconnect cycle — **all eth0 routes flushed** |
| May 23 02:47 | NM activated `eth0`, but custom routes gone — VPN routing loop active |
| May 23 05:00 | Cron `update-vpn-routes` ran — download failed (no internet) → `exit 0` — routes still broken |
| May 23 ~05:20 | User noticed internet down, reverted Keenetic DNS/DHCP to router |

## Root Cause

NetworkManager performs a full interface reconfiguration on carrier-change events
(link down → link up). This flushes all routes associated with eth0, including
routes added by `routing.sh` outside of NM's management:

- `YOUR_VPN_SERVER_IP/32 via 192.168.1.1` (VPN server host route — loop prevention)
- 1359 × `x.x.x.x/xx via 192.168.1.1` (Russian subnet routes)

Without the VPN server host route, `ip route get YOUR_VPN_SERVER_IP` resolves via
AmneziaWG's policy table 51820 (`default dev awg0`) — creating a routing loop
that prevents VPN reconnection. No VPN → no internet → cron download failure
→ no self-heal.

## What Was Built

### scripts/10-vpn-routes (NM dispatcher)

Deployed to `/etc/NetworkManager/dispatcher.d/10-vpn-routes` (mode 0755).
NM calls it on every interface event. On `eth0 up` fires `routing.sh --no-update`
in background:

```bash
if [[ "$1" == "eth0" && "$2" == "up" ]]; then
    logger -t "vpn-routes" "eth0 up — restoring VPN split-tunnel routes"
    /etc/routing.sh --no-update >> /var/log/vpn-routes.log 2>&1 &
fi
```

### scripts/update-vpn-routes (fallback rebuild)

Added route-presence check on download failure — if VPN server host route is
absent, rebuilds from existing `/etc/white-list.txt` without waiting for the
next carrier event:

```bash
if [[ -f "${SUBNET_FILE}" ]] && ! ip route show | grep -q "${VPN_SERVER_IP}"; then
    log "VPN server host route missing — rebuilding routes from existing ${SUBNET_FILE}"
    /etc/routing.sh --no-update
fi
```

### deploy.sh

Added Stage 22 (NM dispatcher deploy), shifted old Stage 22 → 23.
`TOTAL_STAGES` 22 → 23. Preflight check added. Final summary updated.

## Live Verification

Test: `nmcli device disconnect eth0` + `nmcli device connect eth0` via `sudo bash`.

```
=== BEFORE bounce
1363
Routes after disconnect:
2                          ← all eth0 routes flushed by NM
=== AFTER reconnect
1363                       ← dispatcher restored all routes
YOUR_VPN_SERVER_IP via 192.168.1.1 dev eth0  ← loop-prevention route back
```

Syslog confirmation:
```
May 23 05:38:33 raspberrypi vpn-routes[165731]: eth0 up — restoring VPN split-tunnel routes
```

Routes drop from 1363 → 2 on disconnect, restore to 1363 within ~10s of reconnect.

## Deviations from Plan

None — implemented as planned.

## Commits

| Hash | Message |
|---|---|
| 847ff31 | fix: restore split-tunnel routes after NM carrier-change event |

## Self-Check: PASSED

- scripts/10-vpn-routes: FOUND, mode 755
- scripts/update-vpn-routes (fallback): FOUND
- deploy.sh Stage 22 NM dispatcher: FOUND
- Dispatcher live test: PASSED (routes 2 → 1363 on eth0 up)
- Commit 847ff31: FOUND
