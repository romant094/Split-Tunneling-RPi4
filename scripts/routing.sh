#!/usr/bin/env bash
# scripts/routing.sh
#
# RPi-side split-tunnel routing + NAT setup.
# Deployed to /etc/routing.sh by deploy.sh Phase 2 stage (D-11).
# Run via: sudo bash /etc/routing.sh
#          sudo bash /etc/routing.sh --no-update
#
# Decisions honored:
#   D-01 — Routes go into the main routing table (no custom policy tables, no ip rule)
#   D-02 — RU subnets saved to /etc/white-list.txt (one CIDR per line)
#   D-03 — Always attempts fresh download from $RU_SUBNET_URL on each run
#   D-04 — Download failure fallback: use existing file if present; abort if missing
#   D-05 — --no-update flag: skip download, use existing /etc/white-list.txt
#   D-06 — Flush-and-rebuild: delete all awg0 routes + VPN server host route, then rebuild
#   D-07 — iptables idempotency: iptables -C check before every iptables -A
#   D-08 — Single script: download, flush, routes, NAT, iptables-persistent (all in one)
#   D-08(P5) — Stage 5b loads /etc/white-list-extended.txt if present (silent skip if absent)
#   D-09 — Default route via awg0 set by this script (ROUT-04)
#   D-10 — NAT iptables rules configured inside this script (NAT-01, NAT-02)
#
# Threat mitigations honored:
#   T-02-01 — Download to temp file; mv only on success; D-04 fallback on failure
#   T-02-02 — Subnet file used only as ip route add argument; no eval or shell execution
#   T-02-04 — set -euo pipefail; no eval; no dynamic command construction from downloaded data
#   T-02-05 — iptables-persistent installed via DEBIAN_FRONTEND=noninteractive apt-get
#
# Variables sourced from /etc/vpn-gateway.env (deployed by Phase 1):
#   KEENETIC_GW      — ISP gateway (Keenetic router LAN IP, e.g. 192.168.1.1)
#   VPN_SERVER_IP    — AmneziaWG server IP (e.g. YOUR_VPN_SERVER_IP)
#   VPN_IFACE        — VPN tunnel interface (e.g. awg0)
#   LAN_SUBNET       — Local LAN subnet (e.g. 192.168.1.0/24)
#   RU_SUBNET_URL    — URL for RU CIDR list (https://russia.iplist.opencck.org/?format=text&data=cidr4)

set -euo pipefail

# ─── Constants ────────────────────────────────────────────────────────────────
WHITE_LIST_FILE="/etc/white-list.txt"
EXCEPTIONS_FILE="/etc/white-list-extended.txt"
VPN_FORCE_FILE="/etc/vpn-force.txt"
SUBNET_TMP="/tmp/ru-subnets.tmp"
IPTABLES_RULES="/etc/iptables/rules.v4"

# ─── Logging functions ────────────────────────────────────────────────────────
log() {
    echo "[routing] $*"
}

err() {
    echo "[routing] ERROR: $*" >&2
}

# ─── Argument parsing (D-05) ─────────────────────────────────────────────────
SKIP_DOWNLOAD=false
for arg in "$@"; do
    if [[ "$arg" == "--no-update" ]]; then
        SKIP_DOWNLOAD=true
    fi
done

# ─── Source environment (D-01 through D-10) ──────────────────────────────────
# /etc/vpn-gateway.env is deployed by Phase 1 (deploy.sh Stage H, CONF-02).
# It contains: KEENETIC_GW, VPN_SERVER_IP, VPN_IFACE, LAN_SUBNET, RU_SUBNET_URL
if [[ ! -f /etc/vpn-gateway.env ]]; then
    err "/etc/vpn-gateway.env not found — run deploy.sh Phase 1 first"
    exit 1
fi
# shellcheck source=/dev/null
source /etc/vpn-gateway.env

log "Environment sourced from /etc/vpn-gateway.env"
log "  VPN_IFACE:    ${VPN_IFACE}"
log "  VPN_SERVER_IP: ${VPN_SERVER_IP}"
log "  KEENETIC_GW:  ${KEENETIC_GW}"
log "  LAN_SUBNET:   ${LAN_SUBNET}"

# ─── Stage 1: Download RU subnet list (D-03, D-04, D-05, ROUT-01) ────────────
# D-05: skip download if --no-update flag is passed
if [[ "$SKIP_DOWNLOAD" == true ]]; then
    log "Stage 1: Skipping download (--no-update), using existing ${WHITE_LIST_FILE}"
    if [[ ! -f "${WHITE_LIST_FILE}" ]]; then
        err "--no-update passed but ${WHITE_LIST_FILE} does not exist — cannot continue"
        exit 1
    fi
else
    log "Stage 1: Downloading RU subnet list from ${RU_SUBNET_URL}"
    # T-02-01: Download to temp file first; mv to WHITE_LIST_FILE only on success.
    # This prevents a partial/corrupt download from replacing a good existing file.
    if curl -fsSL "${RU_SUBNET_URL}" -o "${SUBNET_TMP}"; then
        mv "${SUBNET_TMP}" "${WHITE_LIST_FILE}"
        log "Subnet list downloaded and saved to ${WHITE_LIST_FILE}"
    else
        # D-04: if download fails, use existing file as fallback; abort if missing
        rm -f "${SUBNET_TMP}"
        if [[ -f "${WHITE_LIST_FILE}" ]]; then
            log "WARNING: Download failed — continuing with existing ${WHITE_LIST_FILE} (D-04 fallback)"
        else
            err "Download failed AND ${WHITE_LIST_FILE} does not exist — cannot continue (D-04 abort)"
            exit 1
        fi
    fi
fi

# ─── Stage 2: Validate subnet file ───────────────────────────────────────────
log "Stage 2: Validating subnet file..."
if [[ ! -f "${WHITE_LIST_FILE}" ]]; then
    err "${WHITE_LIST_FILE} does not exist after Stage 1 — aborting"
    exit 1
fi
if [[ ! -s "${WHITE_LIST_FILE}" ]]; then
    err "${WHITE_LIST_FILE} is empty — aborting to avoid wiping all routes"
    exit 1
fi
WHITE_LIST_COUNT=$(grep -c . "${WHITE_LIST_FILE}" || true)
log "Subnet file valid: ${WHITE_LIST_COUNT} lines in ${WHITE_LIST_FILE}"

# ─── Stage 3: Flush existing routes (D-06, ROUT-02) ─────────────────────────
# Flush-and-rebuild gives a clean slate on every run.
# ip route flush dev <iface> removes ALL routes using awg0 (including default via awg0).
# The VPN server host route lives in the main table via ISP (not via awg0), so we
# delete it separately.
log "Stage 3: Flushing FORWARD ACCEPT, LOG, NAT, and mangle rules (if present)..."
# Remove MSS clamp rule (mangle table) — rebuilt in Stage 7d
iptables -t mangle -C FORWARD -o "${VPN_IFACE}" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null && \
    iptables -t mangle -D FORWARD -o "${VPN_IFACE}" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu || true
# Remove old eth0 MASQUERADE without LAN exclusion (superseded by ! -d LAN variant)
iptables -t nat -C POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null && \
    iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE || true
iptables -C FORWARD -i eth0 -j ACCEPT 2>/dev/null && \
    iptables -D FORWARD -i eth0 -j ACCEPT || true
iptables -C FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null && \
    iptables -D FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT || true
iptables -C FORWARD -o "${VPN_IFACE}" -m state --state NEW -m limit --limit 10/min --limit-burst 20 -j LOG --log-prefix "[VPN] " --log-level 6 2>/dev/null && \
    iptables -D FORWARD -o "${VPN_IFACE}" -m state --state NEW -m limit --limit 10/min --limit-burst 20 -j LOG --log-prefix "[VPN] " --log-level 6 || true
iptables -C FORWARD -o eth0 -m state --state NEW -m limit --limit 10/min --limit-burst 20 -j LOG --log-prefix "[ISP] " --log-level 6 2>/dev/null && \
    iptables -D FORWARD -o eth0 -m state --state NEW -m limit --limit 10/min --limit-burst 20 -j LOG --log-prefix "[ISP] " --log-level 6 || true
log "Stage 3: Flushing VPN force-override ip rules (if present)..."
# Remove priority-100 ip rules added by Stage 5c on previous runs.
# ip rule del is idempotent via || true; iterates vpn-force.txt if present.
if [[ -f "${VPN_FORCE_FILE}" ]]; then
    while IFS= read -r subnet; do
        [[ -z "${subnet}" ]] && continue
        [[ "${subnet}" =~ ^[[:space:]]*# ]] && continue
        ip rule del to "${subnet}" table 51820 priority 100 2>/dev/null || true
    done < "${VPN_FORCE_FILE}"
fi
log "Stage 3: Flushing existing VPN routes (D-06)..."
ip route flush dev "${VPN_IFACE}" 2>/dev/null || true
ip route del "${VPN_SERVER_IP}/32" 2>/dev/null || true
ip route del default 2>/dev/null || true
log "Routes flushed, rebuilding..."

# ─── Stage 4: Add VPN server host route (ROUT-03, D-01) ─────────────────────
# MUST be added BEFORE the default route via awg0.
# Without this, the awg0 default route would send VPN server traffic into the tunnel,
# creating a routing loop that breaks the tunnel (Pitfall: tunnel loop).
# D-01: main routing table only.
log "Stage 4: Adding VPN server host route via ISP (ROUT-03 — loop prevention)..."
ip route add "${VPN_SERVER_IP}/32" via "${KEENETIC_GW}"
log "Host route added: ${VPN_SERVER_IP}/32 via ${KEENETIC_GW}"

# ─── Stage 5: Add RU subnet routes via ISP (ROUT-01, D-01, D-02) ─────────────
# Loop over each non-empty, non-comment line in the subnet file.
# T-02-02: subnet CIDRs are passed directly to ip route add as arguments — no eval.
# || true: handles any subnet already present (belt-and-suspenders after flush).
log "Stage 5: Adding RU subnet routes via ${KEENETIC_GW} (ROUT-01)..."
ADDED=0
while IFS= read -r subnet; do
    # Skip empty lines and comment lines (D-02)
    [[ -z "${subnet}" ]] && continue
    [[ "${subnet}" =~ ^[[:space:]]*# ]] && continue
    ip route add "${subnet}" via "${KEENETIC_GW}" 2>/dev/null || true
    (( ADDED++ )) || true
done < "${WHITE_LIST_FILE}"
log "RU subnet routes added: ${ADDED} routes via ${KEENETIC_GW}"

# ─── Stage 5b: Load exception CIDRs from EXCEPTIONS_FILE (D-05, D-08(P5)) ────
# If /etc/white-list-extended.txt is present, add each CIDR via KEENETIC_GW.
# Absence of the file is a normal state — skip silently with a log message (D-05).
# T-05-01: CIDRs passed as args to ip route add — no eval; malformed entries
#          suppressed by 2>/dev/null || true (same trust model as Stage 5 T-02-02).
EX_ADDED=0
if [[ -f "${EXCEPTIONS_FILE}" ]]; then
    log "Stage 5b: Loading exception CIDRs from ${EXCEPTIONS_FILE}..."
    while IFS= read -r subnet; do
        [[ -z "${subnet}" ]] && continue
        [[ "${subnet}" =~ ^[[:space:]]*# ]] && continue
        ip route add "${subnet}" via "${KEENETIC_GW}" 2>/dev/null || true
        (( EX_ADDED++ )) || true
    done < "${EXCEPTIONS_FILE}"
    log "Exception routes added: ${EX_ADDED} routes via ${KEENETIC_GW}"
else
    log "Stage 5b: ${EXCEPTIONS_FILE} not found — no exception routes loaded (D-05)"
fi

# ─── Stage 5c: VPN force-overrides (vpn-force.txt) ──────────────────────────
# CIDRs in this file bypass the main routing table entirely via high-priority
# ip rules (priority 100). This is necessary because the RU subnet list may
# contain more-specific prefixes (e.g. /24) that would win over a broader
# /15 route added to the main table via `ip route`. `ip rule` fires before
# the main table lookup, so more-specific RU routes are never consulted.
# Use case: Google GGC nodes (142.250.0.0/15 etc.) are in the RU list but
# their content is blocked by ISP — force them through VPN.
# Absence of the file is normal — skip silently (same pattern as Stage 5b).
VPN_FORCED=0
if [[ -f "${VPN_FORCE_FILE}" ]]; then
    log "Stage 5c: Adding high-priority ip rules for VPN force-overrides from ${VPN_FORCE_FILE}..."
    while IFS= read -r subnet; do
        [[ -z "${subnet}" ]] && continue
        [[ "${subnet}" =~ ^[[:space:]]*# ]] && continue
        ip rule add to "${subnet}" table 51820 priority 100 2>/dev/null || true
        (( VPN_FORCED++ )) || true
    done < "${VPN_FORCE_FILE}"
    log "VPN force-overrides applied: ${VPN_FORCED} ip rules priority 100 → table 51820"
else
    log "Stage 5c: ${VPN_FORCE_FILE} not found — no VPN force-overrides loaded"
fi

# ─── Stage 6: Set default route via VPN (ROUT-04, D-09) ─────────────────────
# All non-RU traffic exits through the VPN tunnel.
# Added AFTER host route (Stage 4) and RU routes (Stage 5) so that more-specific
# prefixes take precedence over this catch-all default.
log "Stage 6: Setting default route via ${VPN_IFACE} (ROUT-04)..."
ip route add default dev "${VPN_IFACE}"
log "Default route set: default dev ${VPN_IFACE}"

# ─── Stage 7: iptables MASQUERADE (NAT-01, NAT-02, D-07, D-10) ──────────────
# D-07: check before adding — no duplicate iptables rules.
# NAT-01: MASQUERADE on awg0 (VPN-bound LAN traffic needs source NAT).
# NAT-02: MASQUERADE on eth0 (ISP-bound RU traffic from LAN devices also needs source NAT).
log "Stage 7: Configuring iptables MASQUERADE rules (NAT-01, NAT-02, D-07)..."

# NAT-01: MASQUERADE on awg0 — VPN-bound LAN traffic (D-07 idempotency check)
if iptables -t nat -C POSTROUTING -o awg0 -j MASQUERADE 2>/dev/null; then
    log "MASQUERADE on awg0: already present (no change)"
else
    iptables -t nat -A POSTROUTING -o awg0 -j MASQUERADE
    log "MASQUERADE on awg0: added"
fi

# NAT-02: MASQUERADE on eth0 — ISP-bound RU traffic, excluding local LAN.
# ! -d LAN_SUBNET ensures intra-LAN traffic (e.g. to router at 192.168.1.1) is NOT
# masqueraded — router web/app access stays with real device IP, not RPi's IP.
if iptables -t nat -C POSTROUTING -o eth0 ! -d "${LAN_SUBNET}" -j MASQUERADE 2>/dev/null; then
    log "MASQUERADE on eth0 (! LAN): already present (no change)"
else
    iptables -t nat -A POSTROUTING -o eth0 ! -d "${LAN_SUBNET}" -j MASQUERADE
    log "MASQUERADE on eth0: added"
fi

# ─── Stage 7b: iptables LOG rules (D-01–D-05) ────────────────────────────────
# LOG must come BEFORE ACCEPT — LOG is non-terminating (continues to next rule),
# ACCEPT terminates. Wrong order = packets accepted before being logged.
# D-01: FORWARD chain only (LAN device traffic through RPi)
# D-02: --state NEW — log connection initiations only, not every packet
# D-03: --limit 10/min --limit-burst 20 — rate cap against flood
# D-04: iptables -C idempotency guard before every -A
# D-05: --log-level 6 → syslog info → journald

log "Stage 7b: Configuring iptables LOG rules (D-01–D-05)..."

if iptables -C FORWARD -o "${VPN_IFACE}" -m state --state NEW -m limit --limit 10/min --limit-burst 20 -j LOG --log-prefix "[VPN] " --log-level 6 2>/dev/null; then
    log "LOG rule [VPN] on ${VPN_IFACE}: already present (no change)"
else
    iptables -A FORWARD -o "${VPN_IFACE}" -m state --state NEW -m limit --limit 10/min --limit-burst 20 -j LOG --log-prefix "[VPN] " --log-level 6
    log "LOG rule [VPN] on ${VPN_IFACE}: added"
fi

if iptables -C FORWARD -o eth0 -m state --state NEW -m limit --limit 10/min --limit-burst 20 -j LOG --log-prefix "[ISP] " --log-level 6 2>/dev/null; then
    log "LOG rule [ISP] on eth0: already present (no change)"
else
    iptables -A FORWARD -o eth0 -m state --state NEW -m limit --limit 10/min --limit-burst 20 -j LOG --log-prefix "[ISP] " --log-level 6
    log "LOG rule [ISP] on eth0: added"
fi

# ─── Stage 7c: iptables FORWARD ACCEPT rules ─────────────────────────────────
# Added AFTER LOG so LOG fires first on new connections.
# FORWARD chain default policy is DROP (Docker sets this).
log "Stage 7c: Configuring FORWARD ACCEPT rules for LAN traffic..."

if iptables -C FORWARD -i eth0 -j ACCEPT 2>/dev/null; then
    log "FORWARD ACCEPT -i eth0: already present (no change)"
else
    iptables -A FORWARD -i eth0 -j ACCEPT
    log "FORWARD ACCEPT -i eth0: added"
fi

if iptables -C FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null; then
    log "FORWARD ACCEPT RELATED,ESTABLISHED: already present (no change)"
else
    iptables -A FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT
    log "FORWARD ACCEPT RELATED,ESTABLISHED: added"
fi

# ─── Stage 7d: MSS clamping for TCP through VPN (MTU fix) ───────────────────
# LAN devices negotiate TCP MSS=1460 (eth0 MTU 1500 − 40). awg0 MTU is 1420, so
# 1500-byte packets from LAN can't pass through the tunnel — silently dropped.
# TCPMSS --clamp-mss-to-pmtu rewrites the MSS in SYN packets to match awg0 PMTU
# (1420 − 40 = 1380), preventing PMTUD black-hole for HTTPS/streaming traffic.
# D-07 pattern: check before add.
log "Stage 7d: Configuring MSS clamp for TCP through ${VPN_IFACE}..."

if iptables -t mangle -C FORWARD -o "${VPN_IFACE}" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null; then
    log "MSS clamp on ${VPN_IFACE}: already present (no change)"
else
    iptables -t mangle -A FORWARD -o "${VPN_IFACE}" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
    log "MSS clamp on ${VPN_IFACE}: added"
fi

# ─── Stage 8: iptables-persistent (NAT-03) ────────────────────────────────────
# Install iptables-persistent if not already installed; save rules so they survive reboot.
# T-02-05: DEBIAN_FRONTEND=noninteractive prevents any interactive prompts during apt install.
log "Stage 8: Ensuring iptables-persistent is installed and saving rules (NAT-03)..."

if ! dpkg -l iptables-persistent 2>/dev/null | grep -q '^ii'; then
    log "Installing iptables-persistent..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
    log "iptables-persistent installed"
else
    log "iptables-persistent already installed"
fi

mkdir -p /etc/iptables
iptables-save > "${IPTABLES_RULES}"
log "iptables rules saved to ${IPTABLES_RULES}"

# ─── Stage 9: Verification log ────────────────────────────────────────────────
# Informational only — failures here are not script errors.
# Operator can use this to confirm routing is correct without extra commands.
log "Stage 9: Current routing state (informational)..."

log "  default route:"
ip route show default 2>/dev/null || log "  (no default route shown)"

log "  VPN server route (expect: via ${KEENETIC_GW}):"
ip route get "${VPN_SERVER_IP}" 2>/dev/null || log "  (ip route get ${VPN_SERVER_IP} failed)"

log "  Foreign IP 8.8.8.8 (expect: dev ${VPN_IFACE}):"
ip route get 8.8.8.8 2>/dev/null || log "  (ip route get 8.8.8.8 failed)"

log "  RU IP 77.88.8.8 (expect: via ${KEENETIC_GW}):"
ip route get 77.88.8.8 2>/dev/null || log "  (ip route get 77.88.8.8 failed)"

log "──────────────────────────────────────────────"
log "routing.sh complete — split-tunnel active"
log "  VPN interface:   ${VPN_IFACE}"
log "  VPN server:      ${VPN_SERVER_IP}/32 via ${KEENETIC_GW} (loop prevention)"
log "  RU subnets:      ${ADDED} routes via ${KEENETIC_GW}"
log "  Exceptions:      ${EX_ADDED} routes via ${KEENETIC_GW} (from ${EXCEPTIONS_FILE})"
log "  VPN overrides:   ${VPN_FORCED} routes via ${VPN_IFACE} (from ${VPN_FORCE_FILE})"
log "  Default:         dev ${VPN_IFACE} (all other traffic → VPN)"
log "  iptables rules:  ${IPTABLES_RULES}"
log "  iptables LOG:    [VPN] on ${VPN_IFACE}, [ISP] on eth0 (NEW only, 10/min limit)"
log "──────────────────────────────────────────────"
