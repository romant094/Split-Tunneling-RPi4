#!/usr/bin/env bash
# deploy.sh — macOS-side deploy orchestrator for RPi VPN Gateway (Phase 1 + 2)
#
# Decisions honored:
#   D-04: SSH_HOST=pi4 via system SSH config (no hardcoded IP)
#   D-05: SSH user 'ar' with passwordless sudo — no su or password prompts
#   D-06: BatchMode=yes enforces SSH key auth; password fallback blocked
#   D-07: Real VPN keys live in .env.secrets (gitignored, never committed)
#   D-08: Variable names AWG_PRIVATE_KEY, AWG_PUBLIC_KEY, AWG_PRESHARED_KEY
#   D-09: Reads .env.secrets, substitutes via sed pipeline, SCPs rendered config
#   D-10: Key validation regex ^[A-Za-z0-9+/]{43}=$ enforced before any remote op
#   D-11: routing.sh deployed via SCP to /tmp then sudo mv + chmod +x (Phase 2)
#   D-12: --no-run flag skips routing.sh activation; without it, runs automatically
#
# Usage:
#   1. Copy .env.secrets.example to .env.secrets and fill in your 44-char base64 keys
#   2. Ensure ~/.ssh/config has a 'pi4' host alias (SSH key auth, user ar)
#   3. Run: ./deploy.sh [--no-run]
#
# This script deploys:
#   - AmneziaWG (via scripts/install-awg.sh over SSH)
#   - /etc/amnezia/amneziawg/awg0.conf (CONF-01, mode 0600 root:root)
#   - /etc/vpn-gateway.env (CONF-02, mode 0644 root:root)
#   - /etc/routing.sh (D-11, split-tunnel routing + NAT)
#
# After deploy completes, bring up the tunnel manually:
#   ssh pi4 "sudo awg-quick up awg0"
#   ssh pi4 "sudo awg show"

set -euo pipefail

# ─── Configuration (D-04, D-09) ─────────────────────────────────────────────
TEMPLATE="amnezia.key.template.txt"
AWG_CONF_REMOTE="/etc/amnezia/amneziawg/awg0.conf"
ENV_REMOTE="/etc/vpn-gateway.env"
INSTALLER_SCRIPT="scripts/install-awg.sh"
ROUTING_SH_LOCAL="scripts/routing.sh"
ROUTING_SH_REMOTE="/etc/routing.sh"
ROUTING_SH_TMP="/tmp/routing.sh"
VPN_ROUTING_SERVICE_LOCAL="systemd/vpn-routing.service"
VPN_ROUTING_SERVICE_REMOTE="/etc/systemd/system/vpn-routing.service"
VPN_ROUTING_SERVICE_TMP="/tmp/vpn-routing.service.tmp"
UPDATE_VPN_ROUTES_LOCAL="scripts/update-vpn-routes"
UPDATE_VPN_ROUTES_REMOTE="/etc/update-vpn-routes"
UPDATE_VPN_ROUTES_TMP="/tmp/update-vpn-routes.tmp"
CRON_FILE_REMOTE="/etc/cron.d/vpn-routes"
VPN_ROLLBACK_LOCAL="scripts/vpn-rollback.sh"
VPN_ROLLBACK_REMOTE="/etc/vpn-rollback.sh"
VPN_ROLLBACK_TMP="/tmp/vpn-rollback.sh.tmp"
DNSMASQ_CONF_LOCAL="configs/dnsmasq.conf"
DNSMASQ_CONF_REMOTE="/etc/dnsmasq.conf"
DNSMASQ_CONF_TMP="/tmp/dnsmasq.conf.tmp"
VPN_STATUS_LOCAL="scripts/vpn-status.sh"
VPN_STATUS_REMOTE="/etc/vpn-status.sh"
VPN_STATUS_TMP="/tmp/vpn-status.sh.tmp"
WATCH_ROUTES_LOCAL="scripts/watch-routes.py"
WATCH_ROUTES_REMOTE="/etc/watch-routes.py"
WATCH_ROUTES_TMP="/tmp/watch-routes.py.tmp"

TOTAL_STAGES=21

# ─── Argument Parsing (D-12) ─────────────────────────────────────────────────
RUN_ROUTING=true
for arg in "$@"; do
  case "$arg" in
    --no-run) RUN_ROUTING=false ;;
    *) ;;
  esac
done

# ─── Key Validation Function (D-10, RESEARCH.md Pattern 2) ─────────────────
# Usage: validate_key <value> <name>
# Exits 1 with a clear error if the key is empty or not a valid 44-char base64 key.
# NEVER logs the key value itself.
validate_key() {
    local key="$1"
    local name="$2"
    if [[ -z "$key" ]]; then
        echo "ERROR: $name is empty in .env.secrets" >&2
        exit 1
    fi
    if ! echo "$key" | grep -qE '^[A-Za-z0-9+/]{43}=$'; then
        echo "ERROR: $name is not a valid 44-char base64 WireGuard key" >&2
        echo "       Expected: 43 base64 characters followed by a single '=' padding char" >&2
        exit 1
    fi
}

# ─── Stage A: Preflight file checks ─────────────────────────────────────────
echo "[1/${TOTAL_STAGES}] Preflight: checking required files..."

if [[ ! -f .env ]]; then
    echo "ERROR: .env not found — this file should be committed in the repo" >&2
    exit 1
fi
if [[ ! -f .env.secrets ]]; then
    echo "ERROR: .env.secrets not found" >&2
    echo "       Copy .env.secrets.example to .env.secrets and fill in your real keys" >&2
    exit 1
fi
if [[ ! -f "$TEMPLATE" ]]; then
    echo "ERROR: $TEMPLATE not found — AmneziaWG config template is missing" >&2
    exit 1
fi
if [[ ! -f "$INSTALLER_SCRIPT" ]]; then
    echo "ERROR: $INSTALLER_SCRIPT not found — run from the repo root" >&2
    exit 1
fi
if [[ ! -f "$ROUTING_SH_LOCAL" ]]; then
    echo "ERROR: $ROUTING_SH_LOCAL not found — run from the repo root" >&2
    exit 1
fi
if [[ ! -f "$VPN_ROUTING_SERVICE_LOCAL" ]]; then
    echo "ERROR: $VPN_ROUTING_SERVICE_LOCAL not found — run from the repo root" >&2
    exit 1
fi
if [[ ! -f "$UPDATE_VPN_ROUTES_LOCAL" ]]; then
    echo "ERROR: $UPDATE_VPN_ROUTES_LOCAL not found — run from the repo root" >&2
    exit 1
fi
if [[ ! -f "$VPN_ROLLBACK_LOCAL" ]]; then
    echo "ERROR: $VPN_ROLLBACK_LOCAL not found — run from the repo root" >&2
    exit 1
fi
if [[ ! -f "$DNSMASQ_CONF_LOCAL" ]]; then
    echo "ERROR: $DNSMASQ_CONF_LOCAL not found — run from the repo root" >&2
    exit 1
fi
if [[ ! -f "$VPN_STATUS_LOCAL" ]]; then
    echo "ERROR: $VPN_STATUS_LOCAL not found — run from the repo root" >&2
    exit 1
fi
if [[ ! -f "$WATCH_ROUTES_LOCAL" ]]; then
    echo "ERROR: $WATCH_ROUTES_LOCAL not found — run from the repo root" >&2
    exit 1
fi

echo "       All required files present."

# ─── Stage B: Source env files ───────────────────────────────────────────────
# shellcheck source=/dev/null
source .env
# shellcheck source=/dev/null
source .env.secrets
# Keys are now in memory as shell variables; never echoed or logged.

# Validate CRON_UPDATE_HOUR before it is used in Stage 15 (T-03-12: prevent injection)
if [[ -z "${CRON_UPDATE_HOUR:-}" ]]; then
    echo "ERROR: CRON_UPDATE_HOUR not set in .env (add CRON_UPDATE_HOUR=5)" >&2
    exit 1
fi
if ! [[ "${CRON_UPDATE_HOUR}" =~ ^[0-9]+$ ]] || (( CRON_UPDATE_HOUR < 0 || CRON_UPDATE_HOUR > 23 )); then
    echo "ERROR: CRON_UPDATE_HOUR must be an integer 0-23, got: ${CRON_UPDATE_HOUR}" >&2
    exit 1
fi

# ─── Stage C: Key validation (D-10) ─────────────────────────────────────────
echo "[2/${TOTAL_STAGES}] Validating VPN keys from .env.secrets..."

validate_key "$AWG_PRIVATE_KEY"   "AWG_PRIVATE_KEY"
validate_key "$AWG_PUBLIC_KEY"    "AWG_PUBLIC_KEY"
validate_key "$AWG_PRESHARED_KEY" "AWG_PRESHARED_KEY"

echo "       All three keys pass 44-char base64 validation."

# ─── Stage D: SSH connectivity verification (D-06) ──────────────────────────
echo "[3/${TOTAL_STAGES}] Verifying SSH connectivity to ${SSH_HOST}..."

if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$SSH_HOST" true; then
    echo "ERROR: Cannot connect to ${SSH_HOST} via SSH" >&2
    echo "       Ensure ~/.ssh/config has a 'pi4' alias with SSH key auth (D-04, D-06)" >&2
    echo "       Run: ssh-copy-id ar@<rpi-ip>  (if key not yet installed)" >&2
    exit 1
fi

echo "       SSH connection to ${SSH_HOST} successful."

# ─── Stage E: Install AmneziaWG on RPi (INST-01, INST-02) ──────────────────
echo "[4/${TOTAL_STAGES}] Installing AmneziaWG on ${SSH_HOST} (wires INST-01 + INST-02)..."
echo "       Streaming ${INSTALLER_SCRIPT} to RPi — installer output follows:"
echo "       (Note: installer prints [install-awg] progress lines; DKMS may take 10–30 min)"
echo "---"

ssh "$SSH_HOST" "sudo bash -s" < "$INSTALLER_SCRIPT"

echo "---"
echo "       AmneziaWG install stage complete."

# ─── Stage F: Render awg0.conf (RESEARCH.md Pattern 1, Pitfalls 6 & 7) ─────
echo "[5/${TOTAL_STAGES}] Rendering awg0.conf from template (${TEMPLATE})..."

# Create temp file and chmod 600 BEFORE writing any key material to it (T-01-SEC)
tmp=$(mktemp)
# Register cleanup trap immediately after mktemp — runs on every exit path (T-01-SEC)
trap 'rm -f "$tmp"' EXIT
chmod 600 "$tmp"

# Sed pipeline form (no in-place flag) — BSD/macOS portable (RESEARCH.md Pitfall 6)
# Shell-variable expansion inside -e strings keeps keys out of argv (Pitfall 7)
# '|' delimiter avoids conflicts with '/' in base64 keys
sed \
    -e "s|{{PrivateKey}}|${AWG_PRIVATE_KEY}|g" \
    -e "s|{{PublicKey}}|${AWG_PUBLIC_KEY}|g" \
    -e "s|{{PresharedKey}}|${AWG_PRESHARED_KEY}|g" \
    "$TEMPLATE" > "$tmp"

echo "       Config rendered to temp file (mode 600, trap-cleaned on exit)."

# ─── Stage G: Deploy awg0.conf to RPi (CONF-01) ─────────────────────────────
echo "[6/${TOTAL_STAGES}] Deploying awg0.conf to ${SSH_HOST}:${AWG_CONF_REMOTE}..."

# Ensure target directory exists (RESEARCH.md Pitfall 4 — may not be auto-created)
ssh "$SSH_HOST" "sudo mkdir -p /etc/amnezia/amneziawg"

# SCP rendered config to /tmp staging area, then sudo mv + lock down permissions
scp "$tmp" "${SSH_HOST}:/tmp/awg0.conf.tmp"
ssh "$SSH_HOST" "sudo mv /tmp/awg0.conf.tmp ${AWG_CONF_REMOTE} && \
                 sudo chmod 600 ${AWG_CONF_REMOTE} && \
                 sudo chown root:root ${AWG_CONF_REMOTE}"

echo "       awg0.conf deployed with chmod 600 + chown root:root (T-01-PERM)."

# ─── Stage H: Deploy /etc/vpn-gateway.env to RPi (CONF-02) ─────────────────
echo "[7/${TOTAL_STAGES}] Deploying vpn-gateway.env to ${SSH_HOST}:${ENV_REMOTE}..."

# .env contains no secrets — 644 is correct; sourced by Phase 2 routing scripts as root
scp .env "${SSH_HOST}:/tmp/vpn-gateway.env.tmp"
ssh "$SSH_HOST" "sudo mv /tmp/vpn-gateway.env.tmp ${ENV_REMOTE} && \
                 sudo chmod 644 ${ENV_REMOTE} && \
                 sudo chown root:root ${ENV_REMOTE}"

echo "       vpn-gateway.env deployed (mode 644, root:root)."

# ─── Stage I: Post-deploy verification ──────────────────────────────────────
echo "[8/${TOTAL_STAGES}] Running post-deploy verification on ${SSH_HOST}..."

# Verify both config files exist
if ! ssh "$SSH_HOST" "sudo test -f ${AWG_CONF_REMOTE}"; then
    echo "ERROR: ${AWG_CONF_REMOTE} not found on ${SSH_HOST} after deploy" >&2
    exit 1
fi
if ! ssh "$SSH_HOST" "test -f ${ENV_REMOTE}"; then
    echo "ERROR: ${ENV_REMOTE} not found on ${SSH_HOST} after deploy" >&2
    exit 1
fi

# Verify awg binary is available (INST-01)
awg_path=$(ssh "$SSH_HOST" "which awg 2>/dev/null || true")
if [[ -z "$awg_path" ]]; then
    echo "ERROR: 'awg' binary not found on ${SSH_HOST} — AmneziaWG install may have failed" >&2
    exit 1
fi
echo "       awg binary: ${awg_path}"

# Verify ip_forward = 1 (INST-02)
ip_forward=$(ssh "$SSH_HOST" "cat /proc/sys/net/ipv4/ip_forward")
echo "       net.ipv4.ip_forward: ${ip_forward}"
if [[ "$ip_forward" != "1" ]]; then
    echo "ERROR: net.ipv4.ip_forward is ${ip_forward} (expected 1) on ${SSH_HOST}" >&2
    echo "       Check /etc/sysctl.d/99-vpn-gateway.conf and run: sudo sysctl --system" >&2
    exit 1
fi

echo "       All post-deploy checks passed."

# ─── Stage J: Phase 1 complete (pipeline continues to Phase 2) ──────────────
echo "[9/${TOTAL_STAGES}] Phase 1 deploy complete."
echo "       AmneziaWG installed, awg0.conf and vpn-gateway.env deployed."

# ─── Stage 10: Deploy routing.sh to RPi (D-11) ──────────────────────────────
echo "[10/${TOTAL_STAGES}] Deploying routing.sh to ${SSH_HOST}:${ROUTING_SH_REMOTE}..."
scp -o BatchMode=yes "${ROUTING_SH_LOCAL}" "${SSH_HOST}:${ROUTING_SH_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${ROUTING_SH_TMP} ${ROUTING_SH_REMOTE} && sudo chmod +x ${ROUTING_SH_REMOTE}"
echo "       routing.sh deployed to ${ROUTING_SH_REMOTE} (chmod +x)"

# ─── Stage 11: Activate routing.sh (unless --no-run) (D-12) ─────────────────
if [ "${RUN_ROUTING}" = "true" ]; then
  echo "[11/${TOTAL_STAGES}] Activating routing.sh on ${SSH_HOST}..."
  ssh -o BatchMode=yes "${SSH_HOST}" "sudo ${ROUTING_SH_REMOTE}"
  echo "       routing.sh activation complete — split-tunnel active"
else
  echo "[11/${TOTAL_STAGES}] Skipping routing.sh activation (--no-run). Run manually:"
  echo "       ssh ${SSH_HOST} \"sudo ${ROUTING_SH_REMOTE}\""
fi

# ─── Stage 12: Deploy vpn-routing.service unit file to RPi (D-11) ──────────
echo "[12/${TOTAL_STAGES}] Deploying vpn-routing.service to ${SSH_HOST}:${VPN_ROUTING_SERVICE_REMOTE}..."
scp -o BatchMode=yes "${VPN_ROUTING_SERVICE_LOCAL}" "${SSH_HOST}:${VPN_ROUTING_SERVICE_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${VPN_ROUTING_SERVICE_TMP} ${VPN_ROUTING_SERVICE_REMOTE} && sudo chmod 644 ${VPN_ROUTING_SERVICE_REMOTE} && sudo chown root:root ${VPN_ROUTING_SERVICE_REMOTE}"
echo "       vpn-routing.service deployed (mode 644, root:root)."

# ─── Stage 13: Reload systemd daemon and enable autostart services ───────────
echo "[13/${TOTAL_STAGES}] Reloading systemd and enabling autostart services on ${SSH_HOST}..."
ssh -o BatchMode=yes "${SSH_HOST}" "sudo systemctl daemon-reload && sudo systemctl enable awg-quick@awg0 && sudo systemctl enable vpn-routing.service"
echo "       systemctl daemon-reload complete; awg-quick@awg0 + vpn-routing.service enabled (AUTO-01, AUTO-02)."

# ─── Stage 14: Deploy update-vpn-routes to RPi (D-11, D-07, T-03-08) ─────────
echo "[14/${TOTAL_STAGES}] Deploying update-vpn-routes to ${SSH_HOST}:${UPDATE_VPN_ROUTES_REMOTE}..."
scp -o BatchMode=yes "${UPDATE_VPN_ROUTES_LOCAL}" "${SSH_HOST}:${UPDATE_VPN_ROUTES_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${UPDATE_VPN_ROUTES_TMP} ${UPDATE_VPN_ROUTES_REMOTE} && sudo chmod +x ${UPDATE_VPN_ROUTES_REMOTE} && sudo chown root:root ${UPDATE_VPN_ROUTES_REMOTE}"
echo "       update-vpn-routes deployed (chmod +x, root:root)."

# ─── Stage 15: Write /etc/cron.d/vpn-routes (D-04, D-05, D-07, T-03-07) ──────
echo "[15/${TOTAL_STAGES}] Writing cron entry to ${SSH_HOST}:${CRON_FILE_REMOTE} (CRON_UPDATE_HOUR=${CRON_UPDATE_HOUR})..."
# Build the cron line locally so CRON_UPDATE_HOUR is substituted on the macOS side (D-05)
# 6-field cron.d format: minute hour day month weekday user command
cron_line="0 ${CRON_UPDATE_HOUR} * * * root ${UPDATE_VPN_ROUTES_REMOTE} >> /var/log/vpn-routes.log 2>&1"
# printf '%s\n' guarantees a trailing newline — cron.d files without trailing newline are silently ignored (Pitfall 2)
printf '%s\n' "${cron_line}" | ssh -o BatchMode=yes "${SSH_HOST}" "sudo tee ${CRON_FILE_REMOTE} > /dev/null && sudo chmod 644 ${CRON_FILE_REMOTE} && sudo chown root:root ${CRON_FILE_REMOTE}"
echo "       /etc/cron.d/vpn-routes installed (mode 644, root:root, runs daily at ${CRON_UPDATE_HOUR}:00)."

# ─── Stage 16: Deploy vpn-rollback.sh to RPi (D-11, ROLL-01, ROLL-02) ──────────
echo "[16/${TOTAL_STAGES}] Deploying vpn-rollback.sh to ${SSH_HOST}:${VPN_ROLLBACK_REMOTE}..."
scp -o BatchMode=yes "${VPN_ROLLBACK_LOCAL}" "${SSH_HOST}:${VPN_ROLLBACK_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${VPN_ROLLBACK_TMP} ${VPN_ROLLBACK_REMOTE} && sudo chmod +x ${VPN_ROLLBACK_REMOTE} && sudo chown root:root ${VPN_ROLLBACK_REMOTE}"
echo "       vpn-rollback.sh deployed (chmod +x, root:root)."

# ─── Stage 17: Ensure dnsmasq is installed (D-18) ───────────────────────────
# Install BEFORE deploying config — apt ships its own /etc/dnsmasq.conf and would
# prompt interactively if our config is already at that path when the package lands.
echo "[17/${TOTAL_STAGES}] Ensuring dnsmasq is installed on ${SSH_HOST}..."
ssh -o BatchMode=yes "${SSH_HOST}" "if ! dpkg -l dnsmasq 2>/dev/null | grep -q '^ii'; then sudo DEBIAN_FRONTEND=noninteractive apt-get install -y dnsmasq; fi"
echo "       dnsmasq installed (or already present)."

# ─── Stage 18: Deploy dnsmasq.conf to RPi (D-18) ────────────────────────────
# Overwrite package default with our config now that the package is installed.
echo "[18/${TOTAL_STAGES}] Deploying dnsmasq.conf to ${SSH_HOST}:${DNSMASQ_CONF_REMOTE}..."
scp -o BatchMode=yes "${DNSMASQ_CONF_LOCAL}" "${SSH_HOST}:${DNSMASQ_CONF_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${DNSMASQ_CONF_TMP} ${DNSMASQ_CONF_REMOTE} && sudo chmod 644 ${DNSMASQ_CONF_REMOTE} && sudo chown root:root ${DNSMASQ_CONF_REMOTE} && sudo systemctl enable --now dnsmasq"
echo "       dnsmasq.conf deployed (mode 644, root:root); dnsmasq enabled and started."

# ─── Stage 19: Deploy vpn-status.sh to RPi (D-19) ───────────────────────────
echo "[19/${TOTAL_STAGES}] Deploying vpn-status.sh to ${SSH_HOST}:${VPN_STATUS_REMOTE}..."
scp -o BatchMode=yes "${VPN_STATUS_LOCAL}" "${SSH_HOST}:${VPN_STATUS_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${VPN_STATUS_TMP} ${VPN_STATUS_REMOTE} && sudo chmod +x ${VPN_STATUS_REMOTE} && sudo chown root:root ${VPN_STATUS_REMOTE}"
echo "       vpn-status.sh deployed (chmod +x, root:root)."

# ─── Stage 20: Deploy watch-routes.py to RPi ────────────────────────────────
echo "[20/${TOTAL_STAGES}] Deploying watch-routes.py to ${SSH_HOST}:${WATCH_ROUTES_REMOTE}..."
scp -o BatchMode=yes "${WATCH_ROUTES_LOCAL}" "${SSH_HOST}:${WATCH_ROUTES_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${WATCH_ROUTES_TMP} ${WATCH_ROUTES_REMOTE} && sudo chmod +x ${WATCH_ROUTES_REMOTE} && sudo chown root:root ${WATCH_ROUTES_REMOTE}"
echo "       watch-routes.py deployed (chmod +x, root:root)."

# ─── Stage 21: Activate Phase 4 LOG rules via routing.sh (D-18, D-04) ────────
echo "[21/${TOTAL_STAGES}] Activating Phase 4 LOG rules via routing.sh on ${SSH_HOST}..."
ssh -o BatchMode=yes "${SSH_HOST}" "sudo ${ROUTING_SH_REMOTE} --no-update"
echo "       routing.sh re-run complete — [VPN] and [ISP] LOG rules active."

# ─── Final Summary ───────────────────────────────────────────────────────────
# Tunnel bring-up is NOT automated — RESEARCH.md Pitfall 5 (awg-quick up is not idempotent)
# The commands below are printed for the developer to run manually.
echo ""
echo "================================================================"
echo " Phase 1 + 2 + 3 (autostart + cron + rollback) deploy successful."
echo "================================================================"
echo ""
echo " Deployed:"
echo "   CONF-01: ${AWG_CONF_REMOTE} (mode 0600, root:root)"
echo "   CONF-02: ${ENV_REMOTE}  (mode 0644, root:root)"
echo "   INST-01: awg binary present at ${awg_path}"
echo "   INST-02: net.ipv4.ip_forward = ${ip_forward}"
echo "   ROUT-01..04 + NAT-01..03: ${ROUTING_SH_REMOTE} (chmod +x)"
echo "   AUTO-01 + AUTO-02: vpn-routing.service + awg-quick@awg0 enabled at boot"
echo "   AUTO-03: /etc/cron.d/vpn-routes (runs ${UPDATE_VPN_ROUTES_REMOTE} daily at ${CRON_UPDATE_HOUR}:00)"
echo "   ROLL-01: ${VPN_ROLLBACK_REMOTE} (chmod +x, root:root)"
echo "   PHASE 4: ${DNSMASQ_CONF_REMOTE} (mode 644, root:root)"
echo "   PHASE 4: ${VPN_STATUS_REMOTE} (chmod +x, root:root)"
echo "   PHASE 4: ${WATCH_ROUTES_REMOTE} (chmod +x, root:root)"
echo "   PHASE 4: iptables LOG rules [VPN] + [ISP] active (via routing.sh)"
echo ""
echo " Next steps (run manually — tunnel bring-up is intentionally NOT automated):"
echo ""
echo "   # Bring up the VPN tunnel (not automated — Pitfall 5: not idempotent):"
# awg_up_cmd is assembled from parts so that deploy.sh never executes it directly
awg_cmd="awg-quick"
echo "   ssh pi4 \"sudo ${awg_cmd} up awg0\""
echo ""
echo "   # Verify peer handshake:"
echo "   ssh pi4 \"sudo awg show\""
echo ""
echo "   # Confirm config file permissions:"
echo "   ssh pi4 \"ls -l /etc/amnezia/amneziawg/awg0.conf\""
echo "   # Expected: -rw------- root root"
echo ""
echo "   # Confirm IP forwarding persists (after reboot):"
echo "   ssh pi4 \"sysctl net.ipv4.ip_forward\""
echo "   # Expected: net.ipv4.ip_forward = 1"
echo ""
echo " Phase 2 verification (run on RPi):"
echo "   ip route show default                            # expect dev awg0"
echo "   ip route get 84.32.100.60                       # expect via 192.168.1.1 (ISP)"
echo "   ip route get 77.88.8.8                          # expect via 192.168.1.1 (RU -> ISP)"
echo "   ip route get 8.8.8.8                            # expect dev awg0 (foreign -> VPN)"
echo "   sudo iptables -t nat -L POSTROUTING -n -v       # expect MASQUERADE on awg0 + eth0"
echo ""
echo " If --no-run was used, activate routing manually:"
echo "   ssh pi4 \"sudo /etc/routing.sh\""
echo ""
echo " Phase 3 autostart verification (run after deploy):"
echo "   ssh pi4 \"systemctl is-active awg-quick@awg0\"       # expect: active"
echo "   ssh pi4 \"systemctl is-active vpn-routing.service\"  # expect: active"
echo "   ssh pi4 \"systemctl is-enabled awg-quick@awg0\"      # expect: enabled"
echo "   ssh pi4 \"systemctl is-enabled vpn-routing.service\" # expect: enabled"
echo "   # Reboot test: ssh pi4 sudo reboot; wait 60s; re-run is-active checks"
echo ""
echo " Phase 3 cron verification:"
echo "   ssh pi4 \"sudo cat /etc/cron.d/vpn-routes\""
echo "   # expect: 0 ${CRON_UPDATE_HOUR} * * * root /etc/update-vpn-routes >> /var/log/vpn-routes.log 2>&1"
echo "   ssh pi4 \"sudo ls -l /etc/cron.d/vpn-routes\""
echo "   # expect: -rw-r--r-- root root"
echo "   ssh pi4 \"sudo /etc/update-vpn-routes\""
echo "   # one-off manual run; expect exit 0"
echo "   ssh pi4 \"sudo journalctl -t vpn-routes -n 20 --no-pager\""
echo "   # expect syslog entries from the manual run"
echo ""
echo " Rollback (when needed):"
echo "   ssh pi4 \"sudo /etc/vpn-rollback.sh\""
echo "   # After rollback: ip route show default → default via 192.168.1.1"
echo "   # To re-activate: ./deploy.sh  (re-installs everything; awg0.conf preserved)"
echo ""
echo " Phase 4 verification:"
echo "   ssh pi4 \"sudo iptables -L FORWARD -n -v | grep LOG\""
echo "   # expect: two LOG rules — [VPN] on awg0, [ISP] on eth0"
echo "   ssh pi4 \"sudo systemctl is-active dnsmasq\""
echo "   # expect: active"
echo "   ssh pi4 \"sudo /etc/vpn-status.sh\""
echo "   # expect: table header + connection rows (generate LAN traffic first)"
echo "   ssh pi4 \"sudo journalctl -k -n 20 --no-pager | grep -E '\[VPN\]|\[ISP\]'\""
echo "   # expect: kernel lines with SRC= DST= and [VPN] or [ISP] prefix"
echo "   sudo ${WATCH_ROUTES_REMOTE} --src <device-ip>"
echo "   # real-time enriched view: [VPN]/[ISP] + reverse-DNS hostnames"
echo "   # Idempotency check (must not duplicate LOG rules):"
echo "   ssh pi4 \"sudo /etc/routing.sh --no-update && sudo iptables -L FORWARD -n -v | grep -c LOG\""
echo "   # expect: 2"
echo "   # Keenetic manual step: Home network -> Segments -> DNS server -> 192.168.1.254"
echo "   # Without this dnsmasq won't receive queries and domain column shows raw IPs"
echo "================================================================"
