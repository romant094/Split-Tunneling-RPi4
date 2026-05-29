---
quick_id: 260523-nmr
slug: fix-nm-carrier-route-flush
description: "Fix split-tunnel route loss after NetworkManager carrier-change event (Keenetic firmware update reboot)"
date: 2026-05-23
mode: quick
must_haves:
  truths:
    - NM dispatcher script exists at scripts/10-vpn-routes
    - Dispatcher fires routing.sh --no-update on eth0 up events
    - update-vpn-routes rebuilds routes from cache when download fails AND routes are missing
    - deploy.sh Stage 22 deploys the dispatcher with chmod 755
    - Routes survive eth0 disconnect/reconnect cycle end-to-end (verified live)
  artifacts:
    - scripts/10-vpn-routes
    - scripts/update-vpn-routes (modified)
    - deploy.sh (modified)
---

# Quick Task 260523-nmr: Fix NM Carrier-Change Route Flush

## Root Cause

Keenetic router firmware updated overnight (update window 03:00–07:00 BST).
Router rebooted → Pi4 `eth0` carrier dropped for 43 seconds → NetworkManager
did a full interface reconnect cycle (`disconnected → prepare → config → ip-config → activated`).
On reconnect NM flushed all routes on eth0, removing:

- `YOUR_VPN_SERVER_IP/32 via 192.168.1.1` — VPN server host route (loop prevention)
- 1359 Russian subnet routes via `192.168.1.1`

Without the VPN server host route, traffic to `YOUR_VPN_SERVER_IP` resolved via
AmneziaWG's policy table 51820 (`default dev awg0`) → routing loop → VPN
could not re-establish → no internet.

Cron at 05:00 tried to rebuild routes but the download failed (no internet due
to broken VPN), and the previous `exit 0` on download failure left routes broken.

## Part 1: Immediate Fix (SSH, no code)

Run routing.sh directly to restore routes:

```bash
ssh pi4 sudo /etc/routing.sh
```

Verify:
```bash
ssh pi4 "ip route get YOUR_VPN_SERVER_IP"   # must show via 192.168.1.1
ssh pi4 "ip route show | wc -l"        # must be ~1363
ssh pi4 "sudo awg show"                # must show recent handshake
```

## Task 1: NM Dispatcher Script

**File:** `scripts/10-vpn-routes` → deployed to `/etc/NetworkManager/dispatcher.d/10-vpn-routes`

NM calls dispatcher scripts with `$1=interface $2=action` on every interface event.
On `eth0 up` → spawn `routing.sh --no-update` in background (required — NM kills
scripts that block).

```bash
#!/bin/bash
if [[ "$1" == "eth0" && "$2" == "up" ]]; then
    logger -t "vpn-routes" "eth0 up — restoring VPN split-tunnel routes"
    /etc/routing.sh --no-update >> /var/log/vpn-routes.log 2>&1 &
fi
```

Deploy mode: `0755 root:root` (NM requires executable dispatcher scripts).
No NM restart needed — NM discovers dispatcher scripts automatically.

## Task 2: update-vpn-routes Fallback Rebuild

**File:** `scripts/update-vpn-routes`

On download failure, current code does `exit 0` unconditionally.
If routes were flushed by NM before the cron ran, the broken state persists.

Add check after download failure: if VPN server host route missing → rebuild
from existing `/etc/white-list.txt`:

```bash
if ! curl ...; then
    log "Download failed — skipping subnet update"
    rm -f "${SUBNET_TMP}"
    if [[ -f "${SUBNET_FILE}" ]] && ! ip route show | grep -q "${VPN_SERVER_IP}"; then
        log "VPN server host route missing — rebuilding routes from existing ${SUBNET_FILE}"
        /etc/routing.sh --no-update
        log "Route rebuild complete"
    fi
    exit 0
fi
```

## Task 3: deploy.sh Stage 22

**File:** `deploy.sh`

- Add constants: `NM_DISPATCHER_LOCAL/REMOTE/TMP`
- Increment `TOTAL_STAGES` 22 → 23
- Add preflight check for `scripts/10-vpn-routes`
- Insert Stage 22 (NM dispatcher deploy), rename old Stage 22 → Stage 23
- Add to final summary output
