#!/usr/bin/env bash
# /etc/vpn-status.sh — VPN Gateway Connection Visibility Tool
#
# Query script that reads journald for iptables [VPN]/[ISP] LOG entries, correlates
# with dnsmasq query log to resolve destination IPs to domain names, and presents a
# readable connection table with filtering flags.
#
# Deployed path: /etc/vpn-status.sh (chmod +x)
# Run as:        sudo vpn-status.sh
#                sudo vpn-status.sh --filter=steam
#                sudo vpn-status.sh --device=192.168.1.50
#                sudo vpn-status.sh --last=100 --filter=google --device=192.168.1.100
#
# Decisions honored: D-11 (deployed to /etc/vpn-status.sh, run as sudo),
#   D-12 (default 50 entries; columns: timestamp, src-ip, dst-ip, domain, VPN/ISP),
#   D-13 (domain: dnsmasq log correlation first, rDNS fallback via host),
#   D-14 (--filter: partial case-insensitive domain match),
#   D-15 (--device: filter by source LAN device IP),
#   D-16 (--last: override default entry count),
#   D-17 (set -euo pipefail, source /etc/vpn-gateway.env, logger -t "vpn-status")
#
# Security: --filter and --device values are never passed to eval or sh -c; used
# only as fixed-string grep patterns (T-04-07 mitigated).

set -euo pipefail

# ─── Logging ─────────────────────────────────────────────────────────────────
log() { logger -t "vpn-status" "$*"; }
err() { echo "[vpn-status] ERROR: $*" >&2; }

# ─── Source environment ───────────────────────────────────────────────────────
# /etc/vpn-gateway.env is deployed by Phase 1. Provides VPN_IFACE and other vars.
if [[ ! -f /etc/vpn-gateway.env ]]; then
    err "/etc/vpn-gateway.env not found — cannot determine interface configuration"
    exit 1
fi
# shellcheck source=/dev/null
source /etc/vpn-gateway.env

# ─── Defaults ────────────────────────────────────────────────────────────────
LAST=50
FILTER=""
DEVICE=""

# ─── Argument Parsing ────────────────────────────────────────────────────────
for arg in "$@"; do
    case "${arg}" in
        --last=*)
            val="${arg#--last=}"
            if ! [[ "${val}" =~ ^[0-9]+$ ]]; then
                err "--last value must be a positive integer, got: '${val}'"
                exit 1
            fi
            LAST="${val}"
            ;;
        --filter=*)
            FILTER="${arg#--filter=}"
            ;;
        --device=*)
            DEVICE="${arg#--device=}"
            ;;
        *)
            err "Unknown argument: '${arg}'"
            err "Usage: vpn-status.sh [--last=N] [--filter=STRING] [--device=IP]"
            exit 1
            ;;
    esac
done

# ─── Fetch iptables LOG entries from kernel journal ───────────────────────────
# (D-12, D-13) Reads [VPN] and [ISP] prefixed LOG entries set by iptables rules.
# journalctl -k: kernel messages only; -g: grep pattern on message body.
raw_lines=""
raw_lines=$(journalctl -k --no-pager -n "${LAST}" -g '\[(VPN|ISP)\]' 2>/dev/null || true)

# ─── Pre-fetch dnsmasq query log (one query, used for all correlations) ───────
# Fetch last 10 minutes of dnsmasq output once to avoid repeated journalctl calls.
dnsmasq_log=""
dnsmasq_log=$(journalctl -u dnsmasq --no-pager --since "10 minutes ago" 2>/dev/null || true)

# ─── Process each connection entry ────────────────────────────────────────────
entries=()

while IFS= read -r line; do
    # Skip lines that don't contain [VPN] or [ISP]
    if ! echo "${line}" | grep -qE '\[(VPN|ISP)\]'; then
        continue
    fi

    # Extract timestamp (first 3 fields: Month Day HH:MM:SS)
    ts=$(echo "${line}" | awk '{print $1, $2, $3}')

    # Extract routing decision: VPN or ISP
    decision=$(echo "${line}" | grep -oP '\[(VPN|ISP)\]' | tr -d '[]')

    # Extract source IP (SRC= field)
    src_ip=$(echo "${line}" | grep -oP 'SRC=\K[0-9.]+' || true)

    # Extract destination IP (DST= field)
    dst_ip=$(echo "${line}" | grep -oP 'DST=\K[0-9.]+' || true)

    # Skip malformed lines missing required fields
    [[ -z "${src_ip}" || -z "${dst_ip}" || -z "${decision}" ]] && continue

    # Apply --device filter immediately after extraction (D-15)
    if [[ -n "${DEVICE}" ]] && [[ "${src_ip}" != "${DEVICE}" ]]; then
        continue
    fi

    # ─── Domain Resolution (D-13): two-step ───────────────────────────────────
    domain=""

    # Step 1: dnsmasq log correlation
    # Search for "reply <hostname> is <dst_ip>" in the pre-fetched dnsmasq log.
    # dnsmasq logs: "reply store.steampowered.com is 104.64.0.0" when a query
    # response includes that IP — correlate by dst_ip.
    if [[ -n "${dnsmasq_log}" ]]; then
        # Look for reply lines resolving to dst_ip
        matched_reply=$(echo "${dnsmasq_log}" | grep -F "reply " | grep -F " is ${dst_ip}" | tail -1 || true)
        if [[ -n "${matched_reply}" ]]; then
            # Extract hostname: "reply <hostname> is <ip>"
            domain=$(echo "${matched_reply}" | grep -oP 'reply \K\S+(?= is )' || true)
        fi
    fi

    # Step 2: rDNS fallback via host (D-13)
    if [[ -z "${domain}" ]]; then
        rdns_out=$(host "${dst_ip}" 2>/dev/null || true)
        if [[ -n "${rdns_out}" ]]; then
            # host output: "X.X.X.X.in-addr.arpa domain name pointer hostname."
            domain=$(echo "${rdns_out}" | grep -oP '\.arpa\. domain name pointer \K\S+' | tail -1 || true)
            # Strip trailing dot if present
            domain="${domain%.}"
        fi
    fi

    # If both resolution steps failed, use raw IP
    if [[ -z "${domain}" ]]; then
        domain="${dst_ip}"
    fi

    # Apply --filter after domain resolution (D-14): case-insensitive fixed-string match
    if [[ -n "${FILTER}" ]]; then
        if ! echo "${domain}" | grep -qiF "${FILTER}"; then
            continue
        fi
    fi

    # Truncate domain to 40 chars for display
    display_domain="${domain:0:40}"

    entries+=("${ts}|${src_ip}|${dst_ip}|${display_domain}|${decision}")

done <<< "${raw_lines}"

# ─── Output ───────────────────────────────────────────────────────────────────
printf "%-20s %-18s %-18s %-40s %s\n" "TIMESTAMP" "SRC-IP" "DST-IP" "DOMAIN" "PATH"
printf "%-20s %-18s %-18s %-40s %s\n" "--------------------" "------------------" "------------------" "----------------------------------------" "----"

if [[ ${#entries[@]} -eq 0 ]]; then
    echo "(no connections matched — try --last=200 or remove filters)"
else
    for entry in "${entries[@]}"; do
        IFS='|' read -r ts src_ip dst_ip domain decision <<< "${entry}"
        printf "%-20s %-18s %-18s %-40s %s\n" "${ts}" "${src_ip}" "${dst_ip}" "${domain}" "${decision}"
    done
fi

exit 0
