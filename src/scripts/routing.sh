#!/usr/bin/env bash
# scripts/routing.sh
#
# RPi-side split-tunnel routing + NAT setup.
# Deployed to /etc/splitgate/routing.sh by deploy.sh Phase 2 stage (D-11).
# Run via: sudo bash /etc/splitgate/routing.sh
#          sudo bash /etc/splitgate/routing.sh --no-update
#
# Decisions honored:
#   D-01 — Routes go into the main routing table (no custom policy tables, no ip rule)
#   D-02 — RU subnets saved to /etc/splitgate/white-list.txt (one CIDR per line)
#   D-03 — Always attempts fresh download from $RU_SUBNET_URL on each run
#   D-04 — Download failure fallback: use existing file if present; abort if missing
#   D-05 — --no-update flag: skip download, use existing /etc/splitgate/white-list.txt
#   D-06 — Flush-and-rebuild: delete all awg0 routes + VPN server host route, then rebuild
#   D-07 — iptables idempotency: iptables -C check before every iptables -A
#   D-08 — Single script: download, flush, routes, NAT, iptables-persistent (all in one)
#   D-08(P5) — Stage 5b loads /etc/splitgate/isp-routes-custom.txt if present (silent skip if absent)
#   D-08(P5b) — Stage 5c loads /etc/splitgate/vpn-routes-custom.txt if present; overrides ISP routes (silent skip if absent)
#   D-09 — Default route via awg0 set by this script (ROUT-04)
#   D-10 — NAT iptables rules configured inside this script (NAT-01, NAT-02)
#
# Threat mitigations honored:
#   T-02-01 — Download to temp file; mv only on success; D-04 fallback on failure
#   T-02-02 — Subnet file used only as ip route add argument; no eval or shell execution
#   T-02-04 — set -euo pipefail; no eval; no dynamic command construction from downloaded data
#   T-02-05 — iptables-persistent installed via DEBIAN_FRONTEND=noninteractive apt-get
#
# Variables sourced from /etc/splitgate/vpn-gateway.env (deployed by Phase 1):
#   KEENETIC_GW      — ISP gateway (Keenetic router LAN IP, e.g. 192.168.1.1)
#   VPN_SERVER_IP    — AmneziaWG server IP (from .env.secrets, injected into vpn-gateway.env at deploy)
#   VPN_IFACE        — VPN tunnel interface (e.g. awg0)
#   LAN_SUBNET       — Local LAN subnet (e.g. 192.168.1.0/24)
#   RU_SUBNET_URL    — URL for RU CIDR list (https://russia.iplist.opencck.org/?format=text&data=cidr4)

set -euo pipefail

# ─── Constants ────────────────────────────────────────────────────────────────
WHITE_LIST_FILE="/etc/splitgate/white-list.txt"
ISP_CUSTOM_FILE="/etc/splitgate/isp-routes-custom.txt"
VPN_FORCE_FILE="/etc/splitgate/vpn-routes-custom.txt"
LAST_APPLY_FILE="/etc/splitgate/.last-apply"
SUBNET_TMP="/tmp/ru-subnets.tmp"
IPTABLES_RULES="/etc/iptables/rules.v4"

# ─── Logging functions (Phase 9: file-append to /etc/splitgate/logs/) ────────
LOG_FILE="/etc/splitgate/logs/install.log"

log() {
    echo "[$(date '+%F %T')] [routing] $*" >> "${LOG_FILE}"
}

err() {
    echo "[$(date '+%F %T')] [routing] ERROR: $*" | tee -a "${LOG_FILE}" >&2
}

# ─── Route-file line parsing ─────────────────────────────────────────────────
# Route files come in two formats and both must work identically:
#   leading-comment  — "# Akamai CDN" on its own line, CIDR on the next
#                      (used by the repo-managed src/configs/*.txt files)
#   inline           — "2.21.65.0/24 # Akamai"
#                      (written by the web admin, splitgate-admin.py
#                       write_routes_with_desc)
# Stages 5/5b/5c used to skip only lines STARTING with '#' and pass the rest of
# the line verbatim to `ip route`, so an inline-format entry became
# `ip route add "2.21.65.0/24 # Akamai"` — rejected by iproute2, silenced by
# `2>/dev/null || true`, yet still counted as applied. Net effect: every route
# added through the web admin WITH a description was never applied. Normalizing
# here is what makes both formats equivalent.
#
# Echoes the bare CIDR, or nothing for blank/comment-only lines.
# T-02-02 still holds: the result is passed to `ip route` as a single argument,
# never eval'd.
normalize_route_line() {
    local line="${1%%#*}"          # drop inline comment (and whole-line comments)
    line="${line//$'\t'/ }"        # tabs -> spaces so the trims below catch them
    line="${line#"${line%%[![:space:]]*}"}"   # ltrim
    line="${line%"${line##*[![:space:]]}"}"   # rtrim
    printf '%s' "${line}"
}

# Add a route, logging the failure instead of swallowing it. A rejected CIDR must
# be visible in install.log — the silent-drop bug above went unnoticed precisely
# because failures were discarded. Returns non-zero on failure so the caller can
# keep a FAILED tally for the Stage 9 summary.
add_route() {
    local cidr="$1"
    shift
    local errmsg
    if errmsg=$(ip route add "${cidr}" "$@" 2>&1); then
        return 0
    fi
    # "File exists" is expected and harmless: Stage 5 runs after a flush, but the
    # RU list and the custom lists legitimately overlap.
    if [[ "${errmsg}" == *"File exists"* ]]; then
        return 0
    fi
    err "ip route add ${cidr} $* failed: ${errmsg}"
    return 1
}

# ─── Argument parsing (D-05) ─────────────────────────────────────────────────
SKIP_DOWNLOAD=false
for arg in "$@"; do
    if [[ "$arg" == "--no-update" ]]; then
        SKIP_DOWNLOAD=true
    fi
done

# ─── Source environment (D-01 through D-10) ──────────────────────────────────
# /etc/splitgate/vpn-gateway.env is deployed by Phase 1 (deploy.sh Stage H, CONF-02).
# It contains: KEENETIC_GW, VPN_SERVER_IP, VPN_IFACE, LAN_SUBNET, RU_SUBNET_URL
if [[ ! -f /etc/splitgate/vpn-gateway.env ]]; then
    err "/etc/splitgate/vpn-gateway.env not found — run deploy.sh Phase 1 first"
    exit 1
fi
# shellcheck source=/dev/null
source /etc/splitgate/vpn-gateway.env

log "Environment sourced from /etc/splitgate/vpn-gateway.env"
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
    # Build effective URL: append &exclude[cidr4]=CIDR for each line in ru-list-exclude.txt.
    # Mirrors update-vpn-routes logic so both scripts produce the same filtered list.
    EFFECTIVE_URL="${RU_SUBNET_URL}"
    EXCLUDE_FILE="/etc/splitgate/ru-list-exclude.txt"
    if [[ -f "${EXCLUDE_FILE}" ]]; then
        exclude_count=0
        exclude_list=""
        while IFS= read -r line; do
            [[ "${line}" =~ ^# || -z "${line}" ]] && continue
            EFFECTIVE_URL="${EFFECTIVE_URL}&exclude[cidr4]=${line}"
            (( exclude_count++ )) || true
            exclude_list+="${line} "
        done < "${EXCLUDE_FILE}"
        if (( exclude_count > 0 )); then
            log "Stage 1: Applying ${exclude_count} exclusion(s) from ${EXCLUDE_FILE}: ${exclude_list%% }"
        fi
    fi
    log "Stage 1: Downloading RU subnet list"
    # T-02-01: Download to temp file first; mv to WHITE_LIST_FILE only on success.
    # This prevents a partial/corrupt download from replacing a good existing file.
    if curl -fsSLg "${EFFECTIVE_URL}" -o "${SUBNET_TMP}"; then
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
log "Stage 3: Flushing FORWARD ACCEPT, LOG, and NAT rules (if present)..."
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
log "Stage 3: Flushing existing VPN routes (D-06)..."
ip route flush dev "${VPN_IFACE}" 2>/dev/null || true
ip route del "${VPN_SERVER_IP}/32" 2>/dev/null || true
ip route del default 2>/dev/null || true
# Flush all ISP routes via KEENETIC_GW — required so stale routes from a previous
# white-list.txt (e.g. CIDRs later moved to ru-list-exclude.txt) don't persist after rebuild.
while IFS= read -r cidr; do
    [[ -z "$cidr" ]] && continue
    ip route del "$cidr" via "${KEENETIC_GW}" 2>/dev/null || true
done < <(ip route show via "${KEENETIC_GW}" 2>/dev/null | awk '{print $1}')
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
ADD_FAILED=0
while IFS= read -r rawline; do
    # Skip empty lines and comment lines, strip inline comments (D-02)
    subnet=$(normalize_route_line "${rawline}")
    [[ -z "${subnet}" ]] && continue
    if add_route "${subnet}" via "${KEENETIC_GW}"; then
        (( ADDED++ )) || true
    else
        (( ADD_FAILED++ )) || true
    fi
done < "${WHITE_LIST_FILE}"
log "RU subnet routes added: ${ADDED} routes via ${KEENETIC_GW} (${ADD_FAILED} failed)"

# ─── Stage 5b: Load ISP-custom CIDRs from ISP_CUSTOM_FILE (D-05, D-08(P5)) ───
# If /etc/splitgate/isp-routes-custom.txt is present, add each CIDR via KEENETIC_GW.
# Absence of the file is a normal state — skip silently with a log message (D-05).
# T-05-01: CIDRs passed as args to ip route add — no eval (same trust model as
#          Stage 5 T-02-02). Failures are logged, not swallowed.
# Both file formats are accepted — see normalize_route_line.
EX_ADDED=0
EX_FAILED=0
if [[ -f "${ISP_CUSTOM_FILE}" ]]; then
    log "Stage 5b: Loading ISP-custom CIDRs from ${ISP_CUSTOM_FILE}..."
    while IFS= read -r rawline; do
        subnet=$(normalize_route_line "${rawline}")
        [[ -z "${subnet}" ]] && continue
        if add_route "${subnet}" via "${KEENETIC_GW}"; then
            (( EX_ADDED++ )) || true
        else
            (( EX_FAILED++ )) || true
        fi
    done < "${ISP_CUSTOM_FILE}"
    log "ISP-custom routes added: ${EX_ADDED} routes via ${KEENETIC_GW} (${EX_FAILED} failed)"
else
    log "Stage 5b: ${ISP_CUSTOM_FILE} not found — no ISP-custom routes loaded (D-05)"
fi

# ─── Stage 5c: Load VPN-force CIDRs from VPN_FORCE_FILE (D-05, D-08(P5b)) ────
# If /etc/splitgate/vpn-routes-custom.txt is present, delete any existing ISP route
# for each CIDR and add it via awg0. This overrides the RU list and isp-routes-custom.txt.
# Absence of the file is a normal state — skip silently with a log message (D-05).
VPN_FORCED=0
VPN_FAILED=0
if [[ -f "${VPN_FORCE_FILE}" ]]; then
    log "Stage 5c: Loading VPN-force CIDRs from ${VPN_FORCE_FILE}..."
    while IFS= read -r rawline; do
        subnet=$(normalize_route_line "${rawline}")
        [[ -z "${subnet}" ]] && continue
        # del first: the CIDR may already be routed via ISP by Stage 5 or 5b.
        # Absence is the normal case, so this failure stays silent.
        ip route del "${subnet}" 2>/dev/null || true
        if add_route "${subnet}" dev "${VPN_IFACE}"; then
            (( VPN_FORCED++ )) || true
        else
            (( VPN_FAILED++ )) || true
        fi
    done < "${VPN_FORCE_FILE}"
    log "VPN-force routes added: ${VPN_FORCED} routes via ${VPN_IFACE} (${VPN_FAILED} failed)"
else
    log "Stage 5c: ${VPN_FORCE_FILE} not found — no VPN-force routes loaded (D-05)"
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

# ─── Stage 8b: Stamp the apply timestamp ─────────────────────────────────────
# The web admin compares this file's mtime against the mtimes of
# isp-routes-custom.txt / vpn-routes-custom.txt to decide whether its
# "Apply Changes" button has anything to do (splitgate-admin.py _routes_dirty).
# Stamped here rather than in the admin backend so EVERY apply path counts —
# the admin's /api/config/apply, update-vpn-routes from cron, and the boot-time
# vpn-routing.service all reach this point.
touch "${LAST_APPLY_FILE}"
log "Stage 8b: apply timestamp stamped at ${LAST_APPLY_FILE}"

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
log "  ISP-custom:      ${EX_ADDED} routes via ${KEENETIC_GW} (from ${ISP_CUSTOM_FILE})"
log "  VPN-force:       ${VPN_FORCED} routes via ${VPN_IFACE} (from ${VPN_FORCE_FILE})"
TOTAL_FAILED=$(( ADD_FAILED + EX_FAILED + VPN_FAILED ))
if (( TOTAL_FAILED > 0 )); then
    log "  REJECTED:        ${TOTAL_FAILED} route(s) rejected by iproute2 — see ERROR lines above"
    log "                   (RU list: ${ADD_FAILED}, ISP-custom: ${EX_FAILED}, VPN-force: ${VPN_FAILED})"
else
    log "  Rejected:        none"
fi
log "  Default:         dev ${VPN_IFACE} (all other traffic → VPN)"
log "  iptables rules:  ${IPTABLES_RULES}"
log "  iptables LOG:    [VPN] on ${VPN_IFACE}, [ISP] on eth0 (NEW only, 10/min limit)"
log "──────────────────────────────────────────────"
