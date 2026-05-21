#!/usr/bin/env bash
# scripts/vpn-rollback.sh — Deployed to /etc/vpn-rollback.sh on RPi
#
# Purpose: Fully undoes the VPN gateway setup in one idempotent command.
# Requirements satisfied: ROLL-01 (stops services, flushes routes, removes NAT/cron),
#                         ROLL-02 (preserves awg0.conf, packages, routing.sh, vpn-ru-subnets.txt)
#
# Decisions honored:
#   D-08: Rollback order — stop+disable services, flush routes, remove NAT, remove cron,
#         restore ISP default route via static ip route add (no dhclient dependency)
#   D-09: Silent execution + syslog via logger; final state printed to stdout
#   D-10: Preserved files: /etc/amnezia/amneziawg/awg0.conf, /etc/routing.sh,
#         /etc/vpn-ru-subnets.txt, AmneziaWG packages — rollback only undoes running state
#
# REMOVED by this script:
#   - vpn-routing.service (stopped + disabled)
#   - awg-quick@${VPN_IFACE} (stopped + disabled)
#   - Routes on ${VPN_IFACE} (flushed)
#   - MASQUERADE iptables rules on ${VPN_IFACE} + eth0
#   - /etc/cron.d/vpn-routes
#
# PRESERVED by this script (ROLL-02):
#   - /etc/amnezia/amneziawg/awg0.conf (mode 600)
#   - /etc/routing.sh
#   - /etc/vpn-ru-subnets.txt
#   - AmneziaWG packages (awg, awg-quick, etc.)
#
# Usage: sudo /etc/vpn-rollback.sh
# To re-activate the gateway after rollback: ./deploy.sh

set -euo pipefail

# ─── Logging (D-09: syslog via logger + echo to stdout for operator visibility) ─
log() { logger -t "vpn-rollback" "$*"; echo "[rollback] $*"; }

# ─── Guard: source env file (D-10) ───────────────────────────────────────────
if [[ ! -f /etc/vpn-gateway.env ]]; then
    echo "ERROR: /etc/vpn-gateway.env not found — cannot determine KEENETIC_GW, VPN_IFACE, VPN_SERVER_IP" >&2
    exit 1
fi
# shellcheck source=/dev/null
source /etc/vpn-gateway.env

log "Starting VPN gateway rollback..."

# ─── Step 1: Stop + disable vpn-routing.service (D-08 step 1) ────────────────
log "Stopping vpn-routing.service..."
systemctl stop vpn-routing.service 2>/dev/null || true
systemctl disable vpn-routing.service 2>/dev/null || true
log "vpn-routing.service: stopped and disabled"

# ─── Step 1b: Stop + disable dnsmasq (D-21) ───────────────────────────────────────
log "Stopping dnsmasq..."
systemctl stop dnsmasq 2>/dev/null || true
systemctl disable dnsmasq 2>/dev/null || true
log "dnsmasq: stopped and disabled"

# ─── Step 2: Stop + disable awg-quick@${VPN_IFACE} (D-08 step 2) ────────────
log "Stopping awg-quick@${VPN_IFACE}..."
systemctl stop "awg-quick@${VPN_IFACE}" 2>/dev/null || true
systemctl disable "awg-quick@${VPN_IFACE}" 2>/dev/null || true
log "awg-quick@${VPN_IFACE}: stopped and disabled"

# ─── Step 3: Flush VPN interface routes (D-08 step 3; Pitfall 4) ─────────────
# All three with || true so set -e does not abort before Step 7 (restore-default).
log "Flushing routes on ${VPN_IFACE}..."
ip route flush dev "${VPN_IFACE}" 2>/dev/null || true
ip route del "${VPN_SERVER_IP}/32" 2>/dev/null || true
ip route del default 2>/dev/null || true
log "Routes flushed on ${VPN_IFACE}"

# ─── Step 4: Remove MASQUERADE iptables rules (D-08 step 4) ──────────────────
# Mirrors routing.sh Stage 7 iptables -C pattern, inverted to -D (no blind -D calls).
log "Removing MASQUERADE rules..."
if iptables -t nat -C POSTROUTING -o "${VPN_IFACE}" -j MASQUERADE 2>/dev/null; then
    iptables -t nat -D POSTROUTING -o "${VPN_IFACE}" -j MASQUERADE
    log "MASQUERADE on ${VPN_IFACE}: removed"
fi
if iptables -t nat -C POSTROUTING -o eth0 ! -d "${LAN_SUBNET}" -j MASQUERADE 2>/dev/null; then
    iptables -t nat -D POSTROUTING -o eth0 ! -d "${LAN_SUBNET}" -j MASQUERADE
    log "MASQUERADE on eth0 (! LAN): removed"
fi
# Also remove old variant without LAN exclusion if present from previous deploys
iptables -t nat -C POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null && \
    iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE || true

# ─── Step 4b: Remove FORWARD ACCEPT and LOG rules (Phase 4) ─────────────────────
log "Removing FORWARD ACCEPT rules..."
if iptables -C FORWARD -i eth0 -j ACCEPT 2>/dev/null; then
    iptables -D FORWARD -i eth0 -j ACCEPT
    log "FORWARD ACCEPT -i eth0: removed"
fi
if iptables -C FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null; then
    iptables -D FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT
    log "FORWARD ACCEPT RELATED,ESTABLISHED: removed"
fi
log "Removing iptables LOG rules (Phase 4)..."
if iptables -C FORWARD -o "${VPN_IFACE}" -m state --state NEW -m limit --limit 10/min --limit-burst 20 -j LOG --log-prefix "[VPN] " --log-level 6 2>/dev/null; then
    iptables -D FORWARD -o "${VPN_IFACE}" -m state --state NEW -m limit --limit 10/min --limit-burst 20 -j LOG --log-prefix "[VPN] " --log-level 6
    log "LOG rule [VPN] on ${VPN_IFACE}: removed"
fi
if iptables -C FORWARD -o eth0 -m state --state NEW -m limit --limit 10/min --limit-burst 20 -j LOG --log-prefix "[ISP] " --log-level 6 2>/dev/null; then
    iptables -D FORWARD -o eth0 -m state --state NEW -m limit --limit 10/min --limit-burst 20 -j LOG --log-prefix "[ISP] " --log-level 6
    log "LOG rule [ISP] on eth0: removed"
fi

# ─── Step 5: Re-save iptables without MASQUERADE rules (Pitfall 5 tolerance) ──
# MASQUERADE rules are already removed from the running kernel above.
# netfilter-persistent save persists the clean state to survive reboots.
# The || fallback prevents set -e from aborting if netfilter-persistent is unavailable.
netfilter-persistent save || log "WARNING: netfilter-persistent save failed — rules removed from kernel but may reload on reboot"
log "iptables rules saved"

# ─── Step 6: Remove cron entry (D-08 step 5) ─────────────────────────────────
log "Removing cron entry..."
rm -f /etc/cron.d/vpn-routes
log "Cron entry removed: /etc/cron.d/vpn-routes"

# ─── Step 7: Restore ISP default route (D-08 step 6; static, no dhclient) ────
# Static ip route add — fully deterministic; no DHCP client dependency (D-08 confirmed).
# Pitfall 4: ip route del default (Step 3) used || true so set -e cannot abort here.
log "Restoring ISP default route via ${KEENETIC_GW}..."
ip route add default via "${KEENETIC_GW}"
log "Default route restored: default via ${KEENETIC_GW}"

# ─── Step 8: Final state summary to stdout (D-09) ────────────────────────────
echo ""
echo "================================================================"
echo " VPN gateway rollback complete."
echo "================================================================"
echo " Stopped and disabled:"
echo "   vpn-routing.service"
echo "   awg-quick@${VPN_IFACE}"
echo " Routes flushed: dev ${VPN_IFACE}"
echo " NAT rules removed: MASQUERADE on ${VPN_IFACE} + eth0"
echo "   dnsmasq: stopped and disabled"
echo "   LOG rules removed: [VPN] on ${VPN_IFACE}, [ISP] on eth0"
echo "   Note: /etc/dnsmasq.conf and /etc/vpn-status.sh remain on disk (not removed)"
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
