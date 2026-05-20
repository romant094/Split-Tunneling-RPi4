---
phase: 02-routing-nat
reviewed: 2026-05-20T12:31:41Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - scripts/routing.sh
  - deploy.sh
findings:
  critical: 2
  warning: 5
  info: 2
  total: 9
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-20T12:31:41Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Both files implement the split-tunnel VPN gateway routing setup for an RPi 4. The overall structure is sound: download-then-flush-then-rebuild is correct, the VPN server host route is added before the default tunnel route (loop prevention), and the iptables idempotency checks are well-executed. The threat mitigations documented in the header comments (no eval, temp-file-then-mv, BatchMode SSH) are largely honored.

Two critical issues were found: the iptables NAT rules in `routing.sh` hardcode the interface name `awg0` instead of using the `${VPN_IFACE}` variable, creating a split between what the routing table does and what NAT does when `VPN_IFACE` differs; and `curl` in Stage 1 has no timeout, meaning a hung download will stall the script indefinitely — a problem when this script runs at boot via a systemd unit or cron. Five warnings cover: missing CIDR format validation before passing untrusted file contents to `ip route add`; the absence of iptables FORWARD chain rules (relying on a default-ACCEPT policy that may not hold); the ADDED counter misleadingly counting attempted routes rather than successfully added ones; inconsistent SSH BatchMode enforcement across deploy.sh stages; and no check that environment variables are non-empty after sourcing.

---

## Critical Issues

### CR-01: `curl` has no timeout — download can hang indefinitely

**File:** `scripts/routing.sh:86`
**Issue:** `curl -fsSL "${RU_SUBNET_URL}" -o "${SUBNET_TMP}"` carries no `--max-time` or `--connect-timeout` flag. If the remote server stalls (partial response, connection accepted but data never sent), `curl` will block forever. When `routing.sh` is invoked at boot (via cron or a systemd unit scheduled post-VPN bring-up), this hangs the boot sequence indefinitely. The script never proceeds to restore routes, leaving the machine with no default route and no LAN connectivity.

**Fix:**
```bash
if curl -fsSL --max-time 30 --connect-timeout 10 \
        "${RU_SUBNET_URL}" -o "${SUBNET_TMP}"; then
```
`--connect-timeout 10` aborts if the TCP handshake takes more than 10 seconds; `--max-time 30` caps the total transfer time. Adjust values to taste, but both flags are required for boot-safe operation.

---

### CR-02: iptables NAT rules hardcode `awg0` / `eth0` instead of using `${VPN_IFACE}`

**File:** `scripts/routing.sh:164,167,172,175`
**Issue:** Stage 7 iptables rules reference literal interface names:

```bash
iptables -t nat -C POSTROUTING -o awg0 -j MASQUERADE
iptables -t nat -A POSTROUTING -o awg0 -j MASQUERADE
```

Every other reference to the VPN interface uses `${VPN_IFACE}` (e.g., `ip route flush dev "${VPN_IFACE}"`, `ip route add default dev "${VPN_IFACE}"`). If `VPN_IFACE` is ever changed in `/etc/vpn-gateway.env` (e.g., a second tunnel instance named `awg1`), the routing table will forward traffic through the new interface but NAT will not cover it. Outbound packets from LAN clients will have private source IPs, be rejected by the VPN server, and connectivity will silently fail — with no error message from the script.

The hardcoded `eth0` for the ISP egress interface has the same class of problem: on RPi OS the wired interface may be named `end0` or `eth0` depending on firmware and udev rules.

**Fix:**
```bash
# NAT-01: use ${VPN_IFACE} from env
if iptables -t nat -C POSTROUTING -o "${VPN_IFACE}" -j MASQUERADE 2>/dev/null; then
    log "MASQUERADE on ${VPN_IFACE}: already present (no change)"
else
    iptables -t nat -A POSTROUTING -o "${VPN_IFACE}" -j MASQUERADE
    log "MASQUERADE on ${VPN_IFACE}: added"
fi

# NAT-02: add LAN_IFACE to /etc/vpn-gateway.env and use it here
if iptables -t nat -C POSTROUTING -o "${LAN_IFACE}" -j MASQUERADE 2>/dev/null; then
    log "MASQUERADE on ${LAN_IFACE}: already present (no change)"
else
    iptables -t nat -A POSTROUTING -o "${LAN_IFACE}" -j MASQUERADE
    log "MASQUERADE on ${LAN_IFACE}: added"
fi
```

---

## Warnings

### WR-01: No CIDR format validation before passing subnet file lines to `ip route add`

**File:** `scripts/routing.sh:140-146`
**Issue:** The subnet loop skips empty lines and comment lines, then passes the raw line directly to `ip route add`:

```bash
ip route add "${subnet}" via "${KEENETIC_GW}" 2>/dev/null || true
```

Errors are silenced with `2>/dev/null || true`. If the downloaded file contains malformed entries (extra whitespace, Windows CRLF line endings `\r`, HTML error pages from the CDN, or deliberate garbage), `ip route add` will silently fail for those lines. The `|| true` suppresses all error output, `ADDED` is still incremented (see WR-02), and the script reports success. The result is a partially-built routing table where some Russian subnets route via VPN instead of directly via ISP — a correctness failure with no diagnostic signal.

CRLF endings are a particularly likely real-world trigger: `curl` fetching a text file from a Windows-formatted source will leave `\r` at the end of every line, causing every `ip route add` to fail silently.

**Fix:** Add a CIDR validation regex and strip CR before use:

```bash
while IFS= read -r subnet; do
    subnet="${subnet%$'\r'}"          # strip Windows CRLF
    [[ -z "${subnet}" ]] && continue
    [[ "${subnet}" =~ ^[[:space:]]*# ]] && continue
    # Validate CIDR format: digits.digits.digits.digits/prefix
    if [[ ! "${subnet}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]]; then
        err "Skipping invalid CIDR line: '${subnet}'"
        continue
    fi
    if ip route add "${subnet}" via "${KEENETIC_GW}" 2>/dev/null; then
        (( ADDED++ )) || true
    fi
done < "${SUBNET_FILE}"
```

---

### WR-02: `ADDED` counter counts attempted lines, not successfully added routes

**File:** `scripts/routing.sh:144-145`
**Issue:**
```bash
ip route add "${subnet}" via "${KEENETIC_GW}" 2>/dev/null || true
(( ADDED++ )) || true
```
`ADDED` is incremented unconditionally after every non-blank, non-comment line, regardless of whether `ip route add` succeeded or failed. The final log message `"RU subnet routes added: ${ADDED} routes via ${KEENETIC_GW}"` is therefore misleading: if 500 out of 4000 subnets fail silently (malformed CIDRs, CRLF, duplicates), the operator sees "4000 routes" and has no way to know 500 are missing.

**Fix:** Only increment `ADDED` when `ip route add` succeeds (shown in WR-01 fix above). Separately track `SKIPPED` for validation failures and log both at the end.

---

### WR-03: No iptables FORWARD chain rules — relies on default-ACCEPT policy

**File:** `scripts/routing.sh:157-176`
**Issue:** For the RPi to act as a router, the kernel must forward packets between interfaces. `ip_forward = 1` (verified by deploy.sh Stage I) enables kernel-level forwarding. However, iptables also has a FILTER table FORWARD chain. On a fresh Debian/Raspbian install the default policy is `ACCEPT`, so packets flow. But `iptables-persistent` saves and restores whatever state is current — if an admin has previously tightened the FORWARD chain to `DROP` (a common hardening step), or if a future security audit tightens it, all forwarded LAN traffic will be silently dropped without any change to this script.

The script adds POSTROUTING NAT but never explicitly permits forwarded traffic in the FORWARD chain.

**Fix:** Add explicit FORWARD rules guarded by the same idempotency pattern as the NAT rules:

```bash
# FORWARD-01: allow established/related traffic (stateful)
if ! iptables -C FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null; then
    iptables -A FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT
    log "FORWARD ESTABLISHED rule: added"
fi

# FORWARD-02: allow LAN-originated forwarded traffic
if ! iptables -C FORWARD -i eth0 -j ACCEPT 2>/dev/null; then
    iptables -A FORWARD -i eth0 -j ACCEPT
    log "FORWARD from eth0 (LAN ingress): added"
fi
```

---

### WR-04: SSH commands in deploy.sh inconsistently enforce `BatchMode=yes`

**File:** `deploy.sh:132,161,164,165,175,176,186,190,196,204`
**Issue:** Stages D (line 117), J (line 220-221, 227) correctly pass `-o BatchMode=yes`. But Stages E, F, G, H, and I make SSH/SCP calls without `BatchMode=yes`:

```bash
ssh "$SSH_HOST" "sudo bash -s" < "$INSTALLER_SCRIPT"          # line 132
scp "$tmp" "${SSH_HOST}:/tmp/awg0.conf.tmp"                    # line 164
ssh "$SSH_HOST" "sudo mv /tmp/awg0.conf.tmp ..."               # line 165
scp .env "${SSH_HOST}:/tmp/vpn-gateway.env.tmp"                # line 175
ssh "$SSH_HOST" "test -f ${AWG_CONF_REMOTE}"                   # line 186
awg_path=$(ssh "$SSH_HOST" "which awg ...")                    # line 196
ip_forward=$(ssh "$SSH_HOST" "sysctl -n ...")                  # line 204
```

Without `BatchMode=yes`, SSH will prompt for a password if key authentication fails (e.g., expired agent, wrong key). The script hangs waiting for input in an automated/CI context. Decision D-06 requires BatchMode everywhere.

**Fix:** Add `-o BatchMode=yes` to every `ssh` and `scp` call in the script, or set it globally in `~/.ssh/config` for the `pi4` host alias (preferred approach since it's documented as D-04).

---

### WR-05: No validation that required env vars are non-empty after sourcing

**File:** `scripts/routing.sh:66-72`
**Issue:** After `source /etc/vpn-gateway.env`, the script logs all five variables but never checks that they are non-empty. `set -u` protects against *unset* variables but not against *empty* variables. If `/etc/vpn-gateway.env` contains `VPN_IFACE=` (empty value), `ip route flush dev ""` and `ip route add default dev ""` will fail with cryptic kernel errors rather than a clear diagnostic. `KEENETIC_GW=` (empty) would cause `ip route add "${VPN_SERVER_IP}/32" via ""` to fail under `set -e`, aborting the script mid-flush — leaving the machine with no default route.

**Fix:** Add explicit non-empty checks immediately after sourcing:

```bash
for var in KEENETIC_GW VPN_SERVER_IP VPN_IFACE LAN_SUBNET RU_SUBNET_URL; do
    if [[ -z "${!var:-}" ]]; then
        err "Required variable ${var} is empty in /etc/vpn-gateway.env — aborting"
        exit 1
    fi
done
```

---

## Info

### IN-01: `LAN_SUBNET` is sourced and logged but never used

**File:** `scripts/routing.sh:72`
**Issue:** `LAN_SUBNET` is sourced from `/etc/vpn-gateway.env`, printed in the startup log, but never used in any routing or iptables command. Its presence in the log implies it has operational significance that it currently lacks. If the intent is to scope MASQUERADE or FORWARD rules to LAN traffic only (a legitimate hardening), the variable should be used. If it is genuinely unused, it is dead configuration that adds confusion.

**Fix:** Either use `LAN_SUBNET` to scope an iptables rule (e.g., `-s "${LAN_SUBNET}"` on FORWARD rules, per WR-03), or remove it from the log output and document why it is present-but-unused.

---

### IN-02: Stage naming is inconsistent in `deploy.sh` (letters A-J then numbers 10-11)

**File:** `deploy.sh:214-232`
**Issue:** Stages are labeled A through J in comments, then switch to "Stage 10" and "Stage 11" at lines 218 and 224. This is a cosmetic inconsistency that makes scanning the file harder.

**Fix:** Rename "Stage 10" and "Stage 11" to "Stage K" and "Stage L" (or convert all to numbers) for uniformity.

---

_Reviewed: 2026-05-20T12:31:41Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
