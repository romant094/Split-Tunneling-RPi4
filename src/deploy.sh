#!/usr/bin/env bash
# deploy.sh — macOS-side deploy orchestrator for RPi VPN Gateway (Phase 1 + 2 + Phase 10)
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
#   D-12: --no-run flag skips routing.sh final activation (stage 24); without it, runs once after all config files deployed
#
# Usage:
#   1. Copy .env.secrets.example to .env.secrets and fill in your 44-char base64 keys
#   2. Ensure ~/.ssh/config has a 'pi4' host alias (SSH key auth, user ar)
#   3. Run: bash src/deploy.sh [--no-run]
#
# This script deploys:
#   - AmneziaWG (via scripts/install-awg.sh over SSH)
#   - /etc/amnezia/amneziawg/awg0.conf (CONF-01, mode 0600 root:root)
#   - /etc/splitgate/vpn-gateway.env (CONF-02, mode 0644 root:root)
#   - /etc/splitgate/routing.sh (D-11, split-tunnel routing + NAT)
#   - /etc/splitgate/ namespace (all app scripts, configs, data files — Phase 10 D-01)
#   - /usr/local/bin/splitgate (Phase 10 D-13, ergonomic CLI dispatcher)
#   - /etc/logrotate.d/vpn-gateway (Phase 10 D-11, log rotation config for /etc/splitgate/logs/)
#
# After deploy completes, bring up the tunnel manually:
#   ssh pi4 "sudo awg-quick up awg0"
#   ssh pi4 "sudo awg show"

set -euo pipefail

# Navigate to script's own directory so all *_LOCAL relative paths resolve correctly.
cd "$(dirname "${BASH_SOURCE[0]}")"

# ─── Configuration (D-04, D-09) ─────────────────────────────────────────────
TEMPLATE="configs/amnezia.key.template.txt"
AWG_CONF_REMOTE="/etc/amnezia/amneziawg/awg0.conf"
ENV_REMOTE="/etc/splitgate/vpn-gateway.env"
INSTALLER_SCRIPT="scripts/install-awg.sh"
ROUTING_SH_LOCAL="scripts/routing.sh"
ROUTING_SH_REMOTE="/etc/splitgate/routing.sh"
ROUTING_SH_TMP="/tmp/routing.sh"
VPN_ROUTING_SERVICE_LOCAL="systemd/vpn-routing.service"
VPN_ROUTING_SERVICE_REMOTE="/etc/systemd/system/vpn-routing.service"
VPN_ROUTING_SERVICE_TMP="/tmp/vpn-routing.service.tmp"
UPDATE_VPN_ROUTES_LOCAL="scripts/update-vpn-routes"
UPDATE_VPN_ROUTES_REMOTE="/etc/splitgate/update-vpn-routes"
UPDATE_VPN_ROUTES_TMP="/tmp/update-vpn-routes.tmp"
CRON_FILE_REMOTE="/etc/cron.d/vpn-routes"
VPN_ROLLBACK_LOCAL="scripts/vpn-rollback.sh"
VPN_ROLLBACK_REMOTE="/etc/splitgate/vpn-rollback.sh"
VPN_ROLLBACK_TMP="/tmp/vpn-rollback.sh.tmp"
DNSMASQ_CONF_LOCAL="configs/dnsmasq.conf"
DNSMASQ_CONF_REMOTE="/etc/dnsmasq.conf"
DNSMASQ_CONF_TMP="/tmp/dnsmasq.conf.tmp"
VPN_STATUS_LOCAL="scripts/vpn-status.sh"
VPN_STATUS_REMOTE="/etc/splitgate/vpn-status.sh"
VPN_STATUS_TMP="/tmp/vpn-status.sh.tmp"
WATCH_ROUTES_LOCAL="scripts/watch-routes.py"
WATCH_ROUTES_REMOTE="/etc/splitgate/watch-routes.py"
WATCH_ROUTES_TMP="/tmp/watch-routes.py.tmp"
ASN_LOOKUP_LOCAL="scripts/asn-lookup.py"
ASN_LOOKUP_REMOTE="/etc/splitgate/asn-lookup.py"
ASN_LOOKUP_TMP="/tmp/asn-lookup.py.tmp"
ISP_CUSTOM_LOCAL="configs/isp-routes-custom.txt"
ISP_CUSTOM_REMOTE="/etc/splitgate/isp-routes-custom.txt"
ISP_CUSTOM_TMP="/tmp/isp-routes-custom.tmp"
VPN_FORCE_LOCAL="configs/vpn-routes-custom.txt"
VPN_FORCE_REMOTE="/etc/splitgate/vpn-routes-custom.txt"
VPN_FORCE_TMP="/tmp/vpn-routes-custom.tmp"
EXCLUDE_LIST_LOCAL="configs/ru-list-exclude.txt"
EXCLUDE_LIST_REMOTE="/etc/splitgate/ru-list-exclude.txt"
EXCLUDE_LIST_TMP="/tmp/ru-list-exclude.tmp"
NM_DISPATCHER_LOCAL="scripts/10-vpn-routes"
NM_DISPATCHER_REMOTE="/etc/NetworkManager/dispatcher.d/10-vpn-routes"
NM_DISPATCHER_TMP="/tmp/10-vpn-routes.tmp"
SPLITGATE_DIR_REMOTE="/etc/splitgate"
SPLITGATE_LOGS_REMOTE="/etc/splitgate/logs"
SPLITGATE_DISPATCHER_LOCAL="scripts/splitgate"
SPLITGATE_DISPATCHER_REMOTE="/usr/local/bin/splitgate"
SPLITGATE_DISPATCHER_TMP="/tmp/splitgate.tmp"
LOGROTATE_CONF_LOCAL="configs/logrotate-vpn-gateway"
LOGROTATE_CONF_REMOTE="/etc/logrotate.d/vpn-gateway"
LOGROTATE_CONF_TMP="/tmp/logrotate-vpn-gateway.tmp"
WATCH_SERVICE_LOCAL="systemd/splitgate-watch.service"
WATCH_SERVICE_REMOTE="/etc/systemd/system/splitgate-watch.service"
WATCH_SERVICE_TMP="/tmp/splitgate-watch.service.tmp"
ADMIN_PY_LOCAL="scripts/splitgate-admin.py"
ADMIN_PY_REMOTE="/usr/local/bin/splitgate-admin"
ADMIN_PY_TMP="/tmp/splitgate-admin.py.tmp"
ADMIN_SERVICE_LOCAL="systemd/splitgate-admin.service"
ADMIN_SERVICE_REMOTE="/etc/systemd/system/splitgate-admin.service"
ADMIN_SERVICE_TMP="/tmp/splitgate-admin.service.tmp"
ADMIN_DIST_LOCAL="admin/dist"
ADMIN_DIST_REMOTE="/etc/splitgate/admin"
ADMIN_SECRET_REMOTE="/etc/splitgate/admin.secret"

TOTAL_STAGES=29

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

if [[ ! -f ../.env ]]; then
    echo "ERROR: ../.env not found — this file should be committed in the repo" >&2
    exit 1
fi
if [[ ! -f ../.env.secrets ]]; then
    echo "ERROR: ../.env.secrets not found" >&2
    echo "       Copy .env.secrets.example to .env.secrets and fill in your real keys" >&2
    exit 1
fi
if [[ ! -f "$TEMPLATE" ]]; then
    echo "ERROR: $TEMPLATE not found — AmneziaWG config template is missing" >&2
    exit 1
fi
if [[ ! -f "$INSTALLER_SCRIPT" ]]; then
    echo "ERROR: $INSTALLER_SCRIPT not found — run as: bash src/deploy.sh" >&2
    exit 1
fi
if [[ ! -f "$ROUTING_SH_LOCAL" ]]; then
    echo "ERROR: $ROUTING_SH_LOCAL not found — run as: bash src/deploy.sh" >&2
    exit 1
fi
if [[ ! -f "$VPN_ROUTING_SERVICE_LOCAL" ]]; then
    echo "ERROR: $VPN_ROUTING_SERVICE_LOCAL not found — run as: bash src/deploy.sh" >&2
    exit 1
fi
if [[ ! -f "$UPDATE_VPN_ROUTES_LOCAL" ]]; then
    echo "ERROR: $UPDATE_VPN_ROUTES_LOCAL not found — run as: bash src/deploy.sh" >&2
    exit 1
fi
if [[ ! -f "$VPN_ROLLBACK_LOCAL" ]]; then
    echo "ERROR: $VPN_ROLLBACK_LOCAL not found — run as: bash src/deploy.sh" >&2
    exit 1
fi
if [[ ! -f "$DNSMASQ_CONF_LOCAL" ]]; then
    echo "ERROR: $DNSMASQ_CONF_LOCAL not found — run as: bash src/deploy.sh" >&2
    exit 1
fi
if [[ ! -f "$VPN_STATUS_LOCAL" ]]; then
    echo "ERROR: $VPN_STATUS_LOCAL not found — run as: bash src/deploy.sh" >&2
    exit 1
fi
if [[ ! -f "$WATCH_ROUTES_LOCAL" ]]; then
    echo "ERROR: $WATCH_ROUTES_LOCAL not found — run as: bash src/deploy.sh" >&2
    exit 1
fi
if [[ ! -f "$ASN_LOOKUP_LOCAL" ]]; then
    echo "ERROR: $ASN_LOOKUP_LOCAL not found — run as: bash src/deploy.sh" >&2
    exit 1
fi
if [[ ! -f "$NM_DISPATCHER_LOCAL" ]]; then
    echo "ERROR: $NM_DISPATCHER_LOCAL not found — run as: bash src/deploy.sh" >&2
    exit 1
fi
if [[ ! -f "$SPLITGATE_DISPATCHER_LOCAL" ]]; then
    echo "ERROR: $SPLITGATE_DISPATCHER_LOCAL not found — run as: bash src/deploy.sh" >&2
    exit 1
fi
if [[ ! -f "$LOGROTATE_CONF_LOCAL" ]]; then
    echo "ERROR: $LOGROTATE_CONF_LOCAL not found — run as: bash src/deploy.sh" >&2
    exit 1
fi
if [[ ! -f "$ADMIN_PY_LOCAL" ]]; then
    echo "ERROR: $ADMIN_PY_LOCAL not found — run as: bash src/deploy.sh" >&2
    exit 1
fi
if [[ ! -f "$ADMIN_SERVICE_LOCAL" ]]; then
    echo "ERROR: $ADMIN_SERVICE_LOCAL not found — run as: bash src/deploy.sh" >&2
    exit 1
fi

echo "       All required files present."

# ─── Stage B: Source env files ───────────────────────────────────────────────
# shellcheck source=/dev/null
source ../.env
# shellcheck source=/dev/null
source ../.env.secrets
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

if [[ -z "${VPN_SERVER_IP:-}" ]]; then
    echo "ERROR: VPN_SERVER_IP not set in .env.secrets" >&2
    exit 1
fi

echo "       All three keys pass 44-char base64 validation. VPN_SERVER_IP present."

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

# ─── Stage 5: Create /etc/splitgate/ namespace on RPi (Phase 10 D-01, D-02) ──
# Must run BEFORE any sudo mv into /etc/splitgate/ (RESEARCH.md Pitfall 4)
echo "[5/${TOTAL_STAGES}] Creating splitgate namespace on ${SSH_HOST}..."
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mkdir -p ${SPLITGATE_LOGS_REMOTE} && sudo chmod 755 ${SPLITGATE_DIR_REMOTE}"
echo "       ${SPLITGATE_DIR_REMOTE} created (mkdir -p includes logs subdirectory; chmod 755 root:root)"

# ─── Stage F: Render awg0.conf (RESEARCH.md Pattern 1, Pitfalls 6 & 7) ─────
echo "[6/${TOTAL_STAGES}] Rendering awg0.conf from template (${TEMPLATE})..."

# Create temp file and chmod 600 BEFORE writing any key material to it (T-01-SEC)
tmp=$(mktemp)
env_merged_tmp=$(mktemp)
# Register cleanup trap immediately after mktemp — runs on every exit path (T-01-SEC)
trap 'rm -f "$tmp" "$env_merged_tmp"' EXIT
chmod 600 "$tmp"

# Sed pipeline form (no in-place flag) — BSD/macOS portable (RESEARCH.md Pitfall 6)
# Shell-variable expansion inside -e strings keeps keys out of argv (Pitfall 7)
# '|' delimiter avoids conflicts with '/' in base64 keys
sed \
    -e "s|{{PrivateKey}}|${AWG_PRIVATE_KEY}|g" \
    -e "s|{{PublicKey}}|${AWG_PUBLIC_KEY}|g" \
    -e "s|{{PresharedKey}}|${AWG_PRESHARED_KEY}|g" \
    -e "s|{{VpnServerIp}}|${VPN_SERVER_IP}|g" \
    "$TEMPLATE" > "$tmp"

echo "       Config rendered to temp file (mode 600, trap-cleaned on exit)."

# ─── Stage G: Deploy awg0.conf to RPi (CONF-01) ─────────────────────────────
echo "[7/${TOTAL_STAGES}] Deploying awg0.conf to ${SSH_HOST}:${AWG_CONF_REMOTE}..."

# Ensure target directory exists (RESEARCH.md Pitfall 4 — may not be auto-created)
ssh "$SSH_HOST" "sudo mkdir -p /etc/amnezia/amneziawg"

# Skip-if-exists guard (UI-DEPLOY, RESEARCH Pitfall 2): the Settings page edits this
# file in place on the RPi after first deploy — an unconditional overwrite here would
# silently clobber those RPi-side edits on every redeploy.
if ssh "$SSH_HOST" "sudo test -f ${AWG_CONF_REMOTE}"; then
    echo "       awg0.conf already present on ${SSH_HOST} — skipping overwrite (edit via Settings page, or delete the remote file to force redeploy)"
else
    # SCP rendered config to /tmp staging area, then sudo mv + lock down permissions
    scp "$tmp" "${SSH_HOST}:/tmp/awg0.conf.tmp"
    ssh "$SSH_HOST" "sudo mv /tmp/awg0.conf.tmp ${AWG_CONF_REMOTE} && \
                     sudo chmod 600 ${AWG_CONF_REMOTE} && \
                     sudo chown root:root ${AWG_CONF_REMOTE}"

    echo "       awg0.conf deployed with chmod 600 + chown root:root (T-01-PERM)."
fi

# ─── Stage H: Deploy /etc/splitgate/vpn-gateway.env to RPi (CONF-02) ────────
echo "[8/${TOTAL_STAGES}] Deploying vpn-gateway.env to ${SSH_HOST}:${ENV_REMOTE}..."

# Skip-if-exists guard (UI-DEPLOY, RESEARCH Pitfall 3): same rationale as Stage G —
# the Settings page is the source of truth for this file once it exists on the RPi.
if ssh "$SSH_HOST" "sudo test -f ${ENV_REMOTE}"; then
    echo "       vpn-gateway.env already present — skipping overwrite (edit via Settings page)"
else
    # Build merged env: public vars from .env + VPN_SERVER_IP from .env.secrets
    # VPN_SERVER_IP is kept out of .env (gitignored secret); injected here at deploy time
    cat ../.env > "$env_merged_tmp"
    printf 'VPN_SERVER_IP=%s\n' "${VPN_SERVER_IP}" >> "$env_merged_tmp"
    scp "$env_merged_tmp" "${SSH_HOST}:/tmp/vpn-gateway.env.tmp"
    ssh "$SSH_HOST" "sudo mv /tmp/vpn-gateway.env.tmp ${ENV_REMOTE} && \
                     sudo chmod 644 ${ENV_REMOTE} && \
                     sudo chown root:root ${ENV_REMOTE}"

    echo "       vpn-gateway.env deployed (mode 644, root:root)."
fi

# ─── Stage I: Post-deploy verification ──────────────────────────────────────
echo "[9/${TOTAL_STAGES}] Running post-deploy verification on ${SSH_HOST}..."

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
echo "[10/${TOTAL_STAGES}] Phase 1 deploy complete."
echo "       AmneziaWG installed, awg0.conf and vpn-gateway.env deployed."

# ─── Stage 11: Deploy routing.sh to RPi (D-11) ──────────────────────────────
echo "[11/${TOTAL_STAGES}] Deploying routing.sh to ${SSH_HOST}:${ROUTING_SH_REMOTE}..."
scp -o BatchMode=yes "${ROUTING_SH_LOCAL}" "${SSH_HOST}:${ROUTING_SH_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${ROUTING_SH_TMP} ${ROUTING_SH_REMOTE} && sudo chmod +x ${ROUTING_SH_REMOTE}"
echo "       routing.sh deployed to ${ROUTING_SH_REMOTE} (chmod +x)"


# ─── Stage 13: Deploy vpn-routing.service unit file to RPi (D-11) ──────────
echo "[12/${TOTAL_STAGES}] Deploying vpn-routing.service to ${SSH_HOST}:${VPN_ROUTING_SERVICE_REMOTE}..."
scp -o BatchMode=yes "${VPN_ROUTING_SERVICE_LOCAL}" "${SSH_HOST}:${VPN_ROUTING_SERVICE_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${VPN_ROUTING_SERVICE_TMP} ${VPN_ROUTING_SERVICE_REMOTE} && sudo chmod 644 ${VPN_ROUTING_SERVICE_REMOTE} && sudo chown root:root ${VPN_ROUTING_SERVICE_REMOTE}"
echo "       vpn-routing.service deployed (mode 644, root:root)."

# ─── Stage 14: Reload systemd daemon and enable autostart services ───────────
echo "[13/${TOTAL_STAGES}] Reloading systemd and enabling autostart services on ${SSH_HOST}..."
ssh -o BatchMode=yes "${SSH_HOST}" "sudo systemctl daemon-reload && sudo systemctl enable awg-quick@awg0 && sudo systemctl enable vpn-routing.service"
echo "       systemctl daemon-reload complete; awg-quick@awg0 + vpn-routing.service enabled (AUTO-01, AUTO-02)."

# ─── Stage 15: Deploy update-vpn-routes to RPi (D-11, D-07, T-03-08) ────────
echo "[14/${TOTAL_STAGES}] Deploying update-vpn-routes to ${SSH_HOST}:${UPDATE_VPN_ROUTES_REMOTE}..."
scp -o BatchMode=yes "${UPDATE_VPN_ROUTES_LOCAL}" "${SSH_HOST}:${UPDATE_VPN_ROUTES_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${UPDATE_VPN_ROUTES_TMP} ${UPDATE_VPN_ROUTES_REMOTE} && sudo chmod +x ${UPDATE_VPN_ROUTES_REMOTE} && sudo chown root:root ${UPDATE_VPN_ROUTES_REMOTE}"
echo "       update-vpn-routes deployed (chmod +x, root:root)."

# ─── Stage 16: Write /etc/cron.d/vpn-routes (D-04, D-05, D-07, T-03-07) ─────
echo "[15/${TOTAL_STAGES}] Writing cron entry to ${SSH_HOST}:${CRON_FILE_REMOTE} (CRON_UPDATE_HOUR=${CRON_UPDATE_HOUR})..."
# Build the cron line locally so CRON_UPDATE_HOUR is substituted on the macOS side (D-05)
# 6-field cron.d format: minute hour day month weekday user command
cron_line="0 ${CRON_UPDATE_HOUR} * * * root ${UPDATE_VPN_ROUTES_REMOTE} >> /var/log/vpn-routes.log 2>&1"
# printf '%s\n' guarantees a trailing newline — cron.d files without trailing newline are silently ignored (Pitfall 2)
printf '%s\n' "${cron_line}" | ssh -o BatchMode=yes "${SSH_HOST}" "sudo tee ${CRON_FILE_REMOTE} > /dev/null && sudo chmod 644 ${CRON_FILE_REMOTE} && sudo chown root:root ${CRON_FILE_REMOTE}"
echo "       /etc/cron.d/vpn-routes installed (mode 644, root:root, runs daily at ${CRON_UPDATE_HOUR}:00)."

# ─── Stage 17: Deploy vpn-rollback.sh to RPi (D-11, ROLL-01, ROLL-02) ────────
echo "[16/${TOTAL_STAGES}] Deploying vpn-rollback.sh to ${SSH_HOST}:${VPN_ROLLBACK_REMOTE}..."
scp -o BatchMode=yes "${VPN_ROLLBACK_LOCAL}" "${SSH_HOST}:${VPN_ROLLBACK_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${VPN_ROLLBACK_TMP} ${VPN_ROLLBACK_REMOTE} && sudo chmod +x ${VPN_ROLLBACK_REMOTE} && sudo chown root:root ${VPN_ROLLBACK_REMOTE}"
echo "       vpn-rollback.sh deployed (chmod +x, root:root)."

# ─── Stage 18: Ensure dnsmasq is installed (D-18) ───────────────────────────
# Install BEFORE deploying config — apt ships its own /etc/dnsmasq.conf and would
# prompt interactively if our config is already at that path when the package lands.
echo "[17/${TOTAL_STAGES}] Ensuring dnsmasq is installed on ${SSH_HOST}..."
ssh -o BatchMode=yes "${SSH_HOST}" "if ! dpkg -l dnsmasq 2>/dev/null | grep -q '^ii'; then sudo DEBIAN_FRONTEND=noninteractive apt-get install -y dnsmasq; fi"
echo "       dnsmasq installed (or already present)."

# ─── Stage 19: Deploy dnsmasq.conf to RPi (D-18) ────────────────────────────
# Overwrite package default with our config now that the package is installed.
echo "[18/${TOTAL_STAGES}] Deploying dnsmasq.conf to ${SSH_HOST}:${DNSMASQ_CONF_REMOTE}..."
scp -o BatchMode=yes "${DNSMASQ_CONF_LOCAL}" "${SSH_HOST}:${DNSMASQ_CONF_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${DNSMASQ_CONF_TMP} ${DNSMASQ_CONF_REMOTE} && sudo chmod 644 ${DNSMASQ_CONF_REMOTE} && sudo chown root:root ${DNSMASQ_CONF_REMOTE} && sudo systemctl enable --now dnsmasq"
echo "       dnsmasq.conf deployed (mode 644, root:root); dnsmasq enabled and started."

# ─── Stage 20: Deploy vpn-status.sh to RPi (D-19) ───────────────────────────
echo "[19/${TOTAL_STAGES}] Deploying vpn-status.sh to ${SSH_HOST}:${VPN_STATUS_REMOTE}..."
scp -o BatchMode=yes "${VPN_STATUS_LOCAL}" "${SSH_HOST}:${VPN_STATUS_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${VPN_STATUS_TMP} ${VPN_STATUS_REMOTE} && sudo chmod +x ${VPN_STATUS_REMOTE} && sudo chown root:root ${VPN_STATUS_REMOTE}"
echo "       vpn-status.sh deployed (chmod +x, root:root)."

# ─── Stage 21: Deploy watch-routes.py to RPi ────────────────────────────────
echo "[20/${TOTAL_STAGES}] Deploying watch-routes.py to ${SSH_HOST}:${WATCH_ROUTES_REMOTE}..."
scp -o BatchMode=yes "${WATCH_ROUTES_LOCAL}" "${SSH_HOST}:${WATCH_ROUTES_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${WATCH_ROUTES_TMP} ${WATCH_ROUTES_REMOTE} && sudo chmod +x ${WATCH_ROUTES_REMOTE} && sudo chown root:root ${WATCH_ROUTES_REMOTE}"
echo "       watch-routes.py deployed (chmod +x, root:root)."

# ─── Stage 22: Deploy isp-routes-custom.txt to RPi (D-05) ───────────────────
echo "[21/${TOTAL_STAGES}] Deploying isp-routes-custom.txt to ${SSH_HOST} (if present)..."
if [[ -f "${ISP_CUSTOM_LOCAL}" ]]; then
    scp -o BatchMode=yes "${ISP_CUSTOM_LOCAL}" "${SSH_HOST}:${ISP_CUSTOM_TMP}"
    ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${ISP_CUSTOM_TMP} ${ISP_CUSTOM_REMOTE} && sudo chmod 644 ${ISP_CUSTOM_REMOTE} && sudo chown root:root ${ISP_CUSTOM_REMOTE}"
    echo "       isp-routes-custom.txt deployed (mode 644, root:root)."
else
    echo "       ${ISP_CUSTOM_LOCAL} not found in repo — skipping ISP-custom file deploy (D-05)."
fi

# ─── Stage 22b: Deploy vpn-routes-custom.txt to RPi (D-05) ──────────────────
echo "[21b/${TOTAL_STAGES}] Deploying vpn-routes-custom.txt to ${SSH_HOST} (if present)..."
if [[ -f "${VPN_FORCE_LOCAL}" ]]; then
    scp -o BatchMode=yes "${VPN_FORCE_LOCAL}" "${SSH_HOST}:${VPN_FORCE_TMP}"
    ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${VPN_FORCE_TMP} ${VPN_FORCE_REMOTE} && sudo chmod 644 ${VPN_FORCE_REMOTE} && sudo chown root:root ${VPN_FORCE_REMOTE}"
    echo "       vpn-routes-custom.txt deployed (mode 644, root:root)."
else
    echo "       ${VPN_FORCE_LOCAL} not found in repo — skipping VPN-force file deploy (D-05)."
fi

# ─── Stage 22c: Deploy ru-list-exclude.txt to RPi (D-07, D-08) ──────────────
echo "[21c/${TOTAL_STAGES}] Deploying ru-list-exclude.txt to ${SSH_HOST} (if present)..."
if [[ -f "${EXCLUDE_LIST_LOCAL}" ]]; then
    ssh -o BatchMode=yes "${SSH_HOST}" "[ -f /etc/splitgate/ru-exclude.txt ] && sudo mv /etc/splitgate/ru-exclude.txt /etc/splitgate/ru-list-exclude.txt || true"
    scp -o BatchMode=yes "${EXCLUDE_LIST_LOCAL}" "${SSH_HOST}:${EXCLUDE_LIST_TMP}"
    ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${EXCLUDE_LIST_TMP} ${EXCLUDE_LIST_REMOTE} && sudo chmod 644 ${EXCLUDE_LIST_REMOTE} && sudo chown root:root ${EXCLUDE_LIST_REMOTE}"
    echo "       ru-list-exclude.txt deployed (mode 644, root:root)."
else
    echo "       ${EXCLUDE_LIST_LOCAL} not found in repo — skipping exclude list deploy (D-04)."
fi

# ─── Stage 23: Deploy NM dispatcher for carrier-change route recovery ────────
echo "[22/${TOTAL_STAGES}] Deploying NM dispatcher ${NM_DISPATCHER_LOCAL} to ${SSH_HOST}:${NM_DISPATCHER_REMOTE}..."
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mkdir -p /etc/NetworkManager/dispatcher.d"
scp -o BatchMode=yes "${NM_DISPATCHER_LOCAL}" "${SSH_HOST}:${NM_DISPATCHER_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${NM_DISPATCHER_TMP} ${NM_DISPATCHER_REMOTE} && sudo chmod 755 ${NM_DISPATCHER_REMOTE} && sudo chown root:root ${NM_DISPATCHER_REMOTE}"
echo "       10-vpn-routes deployed (chmod 755, root:root) — restores routes on eth0 up events."

# ─── Stage 23: Deploy asn-lookup.py to RPi (Phase 7) ────────────────────────
echo "[23/${TOTAL_STAGES}] Deploying asn-lookup.py to ${SSH_HOST}:${ASN_LOOKUP_REMOTE}..."
scp -o BatchMode=yes "${ASN_LOOKUP_LOCAL}" "${SSH_HOST}:${ASN_LOOKUP_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${ASN_LOOKUP_TMP} ${ASN_LOOKUP_REMOTE} && sudo chmod +x ${ASN_LOOKUP_REMOTE} && sudo chown root:root ${ASN_LOOKUP_REMOTE}"
echo "       asn-lookup.py deployed (chmod +x, root:root)."

# ─── Stage 24: Bring up VPN tunnel + Activate routing.sh (D-12, D-18, D-04, D-06/P5) ──
# Single routing.sh run — after all config files (ru-list-exclude.txt, isp-routes-custom.txt, vpn-routes-custom.txt) are deployed.
# awg-quick up is not idempotent (Pitfall 5) — guard with ip link show before running.
if [ "${RUN_ROUTING}" = "true" ]; then
  echo "[24/${TOTAL_STAGES}] Bringing up VPN tunnel and activating routing.sh on ${SSH_HOST}..."
  if ssh -o BatchMode=yes "${SSH_HOST}" "ip link show awg0" &>/dev/null; then
    echo "       awg0 already up — skipping awg-quick up."
  else
    echo "       awg0 not up — running awg-quick up awg0..."
    ssh -o BatchMode=yes "${SSH_HOST}" "sudo awg-quick up awg0"
    echo "       awg0 tunnel up."
  fi
  ssh -o BatchMode=yes "${SSH_HOST}" "sudo ${ROUTING_SH_REMOTE}"
  echo "       routing.sh activation complete — split-tunnel active; exception routes and exclusions applied."
else
  echo "[24/${TOTAL_STAGES}] Skipping routing.sh activation (--no-run). Run manually:"
  echo "       ssh ${SSH_HOST} \"sudo awg-quick up awg0 && sudo ${ROUTING_SH_REMOTE}\""
fi

# ─── Stage 26: Deploy splitgate dispatcher to RPi (Phase 10 D-13, D-17) ──────
echo "[25/${TOTAL_STAGES}] Deploying splitgate dispatcher to ${SSH_HOST}:${SPLITGATE_DISPATCHER_REMOTE}..."
scp -o BatchMode=yes "${SPLITGATE_DISPATCHER_LOCAL}" "${SSH_HOST}:${SPLITGATE_DISPATCHER_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${SPLITGATE_DISPATCHER_TMP} ${SPLITGATE_DISPATCHER_REMOTE} && sudo chmod +x ${SPLITGATE_DISPATCHER_REMOTE} && sudo chown root:root ${SPLITGATE_DISPATCHER_REMOTE}"
echo "       splitgate dispatcher deployed (chmod +x, root:root)."

# ─── Stage 27: Deploy logrotate config to RPi (Phase 10 D-11, D-19) ──────────
echo "[26/${TOTAL_STAGES}] Deploying logrotate config to ${SSH_HOST}:${LOGROTATE_CONF_REMOTE}..."
scp -o BatchMode=yes "${LOGROTATE_CONF_LOCAL}" "${SSH_HOST}:${LOGROTATE_CONF_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${LOGROTATE_CONF_TMP} ${LOGROTATE_CONF_REMOTE} && sudo chmod 644 ${LOGROTATE_CONF_REMOTE} && sudo chown root:root ${LOGROTATE_CONF_REMOTE}"
echo "       logrotate config deployed (mode 644, root:root)."

# ─── Stage 28: Deploy splitgate-watch.service to RPi (Phase 13 D-10) ─────────
echo "[27/${TOTAL_STAGES}] Deploying splitgate-watch.service and enabling daemon on ${SSH_HOST}..."
scp -o BatchMode=yes "${WATCH_SERVICE_LOCAL}" "${SSH_HOST}:${WATCH_SERVICE_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${WATCH_SERVICE_TMP} ${WATCH_SERVICE_REMOTE} && sudo chmod 644 ${WATCH_SERVICE_REMOTE} && sudo chown root:root ${WATCH_SERVICE_REMOTE}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo systemctl daemon-reload && sudo systemctl enable --now splitgate-watch.service"
echo "       splitgate-watch.service deployed and enabled (auto-starts on boot)."

# ─── Stage 29: Deploy splitgate-admin (conditional on src/admin/dist/ — D-05) ─
echo "[29/${TOTAL_STAGES}] Checking for admin UI build at ${ADMIN_DIST_LOCAL}..."
if [ -d "${ADMIN_DIST_LOCAL}" ]; then
  echo "[29/${TOTAL_STAGES}] Deploying splitgate admin UI and backend to ${SSH_HOST}..."

  # 29a: Deploy splitgate-admin.py backend
  scp -o BatchMode=yes "${ADMIN_PY_LOCAL}" "${SSH_HOST}:${ADMIN_PY_TMP}"
  ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${ADMIN_PY_TMP} ${ADMIN_PY_REMOTE} && sudo chmod +x ${ADMIN_PY_REMOTE} && sudo chown root:root ${ADMIN_PY_REMOTE}"
  echo "       splitgate-admin.py deployed to ${ADMIN_PY_REMOTE} (chmod +x, root:root)"

  # 29b: Deploy admin dist/ to /etc/splitgate/admin/
  ssh -o BatchMode=yes "${SSH_HOST}" "sudo rm -rf /tmp/admin-dist-tmp && mkdir -p /tmp/admin-dist-tmp"
  scp -r -o BatchMode=yes "${ADMIN_DIST_LOCAL}/." "${SSH_HOST}:/tmp/admin-dist-tmp/"
  ssh -o BatchMode=yes "${SSH_HOST}" "sudo mkdir -p ${ADMIN_DIST_REMOTE} && sudo cp -r /tmp/admin-dist-tmp/. ${ADMIN_DIST_REMOTE}/ && sudo rm -rf /tmp/admin-dist-tmp && sudo chown -R root:root ${ADMIN_DIST_REMOTE}"
  echo "       admin/dist deployed to ${ADMIN_DIST_REMOTE} (root:root)"

  # 29c: Deploy splitgate-admin.service
  scp -o BatchMode=yes "${ADMIN_SERVICE_LOCAL}" "${SSH_HOST}:${ADMIN_SERVICE_TMP}"
  ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${ADMIN_SERVICE_TMP} ${ADMIN_SERVICE_REMOTE} && sudo chmod 644 ${ADMIN_SERVICE_REMOTE} && sudo chown root:root ${ADMIN_SERVICE_REMOTE}"
  echo "       splitgate-admin.service deployed (mode 644, root:root)"

  # 29d: Create admin.secret if not present, reload systemd, enable service
  ssh -o BatchMode=yes "${SSH_HOST}" "[ -f ${ADMIN_SECRET_REMOTE} ] || (sudo sh -c 'printf admin > ${ADMIN_SECRET_REMOTE}' && sudo chmod 600 ${ADMIN_SECRET_REMOTE} && sudo chown root:root ${ADMIN_SECRET_REMOTE} && echo '       Created default admin.secret with password: admin — CHANGE THIS')"
  ssh -o BatchMode=yes "${SSH_HOST}" "sudo systemctl daemon-reload && sudo systemctl enable --now splitgate-admin.service"
  echo "       splitgate-admin.service enabled and started (accessible at http://192.168.1.254:${ADMIN_PORT:-8080})"
  echo "       Default password: admin — change via Settings page or: echo NEWPASS | sudo tee ${ADMIN_SECRET_REMOTE}"
else
  echo "[29/${TOTAL_STAGES}] Admin UI not built — skipping admin stages (${ADMIN_DIST_LOCAL}/ missing)"
  echo "       To deploy admin: cd src/admin && npm run build && cd ../.. && bash src/deploy.sh"
fi

# ─── Final Summary ───────────────────────────────────────────────────────────
# Tunnel bring-up is automated in Stage 12 (guarded by ip link show — Pitfall 5 safe).
# --no-run skips both tunnel bring-up and routing.sh; run manually in that case.
echo ""
echo "================================================================"
echo " Phase 1 + 2 + 3 (autostart + cron + rollback) + Phase 10 (splitgate ergonomics) deploy successful."
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
echo "   PHASE 5: ${ISP_CUSTOM_REMOTE} (mode 644, root:root, optional — deployed only if ${ISP_CUSTOM_LOCAL} exists)
   PHASE 5: ${VPN_FORCE_REMOTE} (mode 644, root:root, optional — deployed only if ${VPN_FORCE_LOCAL} exists)
   PHASE 6: ${NM_DISPATCHER_REMOTE} (chmod 755, root:root — restores routes on eth0 up)"
echo "   PHASE 7: ${ASN_LOOKUP_REMOTE} (chmod +x, root:root — ASN/org enrichment helper)"
echo "   PHASE 8: ${EXCLUDE_LIST_REMOTE} (mode 644, root:root, optional — deployed only if ${EXCLUDE_LIST_LOCAL} exists)"
echo "   PHASE 10: ${SPLITGATE_DISPATCHER_REMOTE} (chmod +x, root:root — ergonomic CLI dispatcher)"
echo "   PHASE 10: ${LOGROTATE_CONF_REMOTE} (mode 644, root:root — log rotation config for /etc/splitgate/logs/install.log)"
echo "   PHASE 13: ${WATCH_SERVICE_REMOTE} (mode 644, root:root — splitgate-watch daemon)"
echo "   PHASE 15: ${ADMIN_PY_REMOTE} + ${ADMIN_DIST_REMOTE} + ${ADMIN_SERVICE_REMOTE} (conditional on src/admin/dist/)"
echo ""
echo " Next steps:"
echo ""
echo "   # Tunnel was brought up automatically in Stage 24 (if --no-run not passed)."
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
echo "   ip route get \${VPN_SERVER_IP}                    # expect via 192.168.1.1 (ISP)"
echo "   ip route get 77.88.8.8                          # expect via 192.168.1.1 (RU -> ISP)"
echo "   ip route get 8.8.8.8                            # expect dev awg0 (foreign -> VPN)"
echo "   sudo iptables -t nat -L POSTROUTING -n -v       # expect MASQUERADE on awg0 + eth0"
echo ""
echo " If --no-run was used, activate routing manually:"
echo "   ssh pi4 \"sudo /etc/splitgate/routing.sh\""
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
echo "   # expect: 0 ${CRON_UPDATE_HOUR} * * * root /etc/splitgate/update-vpn-routes >> /var/log/vpn-routes.log 2>&1"
echo "   ssh pi4 \"sudo ls -l /etc/cron.d/vpn-routes\""
echo "   # expect: -rw-r--r-- root root"
echo "   ssh pi4 \"sudo /etc/splitgate/update-vpn-routes\""
echo "   # one-off manual run; expect exit 0"
echo "   ssh pi4 \"sudo journalctl -t vpn-routes -n 20 --no-pager\""
echo "   # expect syslog entries from the manual run"
echo ""
echo " Rollback (when needed):"
echo "   ssh pi4 \"sudo /etc/splitgate/vpn-rollback.sh\""
echo "   # After rollback: ip route show default → default via 192.168.1.1"
echo "   # To re-activate: bash src/deploy.sh  (re-installs everything; awg0.conf preserved)"
echo ""
echo " Phase 4 verification:"
echo "   ssh pi4 \"sudo iptables -L FORWARD -n -v | grep LOG\""
echo "   # expect: two LOG rules — [VPN] on awg0, [ISP] on eth0"
echo "   ssh pi4 \"sudo systemctl is-active dnsmasq\""
echo "   # expect: active"
echo "   ssh pi4 \"sudo /etc/splitgate/vpn-status.sh\""
echo "   # expect: table header + connection rows (generate LAN traffic first)"
echo "   ssh pi4 \"sudo journalctl -k -n 20 --no-pager | grep -E '\[VPN\]|\[ISP\]'\""
echo "   # expect: kernel lines with SRC= DST= and [VPN] or [ISP] prefix"
echo "   sudo ${WATCH_ROUTES_REMOTE} --src <device-ip>"
echo "   # real-time enriched view: [VPN]/[ISP] + reverse-DNS hostnames"
echo "   # Idempotency check (must not duplicate LOG rules):"
echo "   ssh pi4 \"sudo /etc/splitgate/routing.sh && sudo iptables -L FORWARD -n -v | grep -c LOG\""
echo "   # expect: 2"
echo "   # Keenetic manual step: Home network -> Segments -> DNS server -> 192.168.1.254"
echo "   # Without this dnsmasq won't receive queries and domain column shows raw IPs"
echo ""
echo " Phase 5 verification:"
echo "   ssh pi4 \"sudo /etc/splitgate/vpn-status.sh --via=vpn\""
echo "   # expect: only rows with VPN in the PATH column (or empty if no VPN traffic)"
echo "   ssh pi4 \"sudo /etc/splitgate/vpn-status.sh --via=isp\""
echo "   # expect: only rows with ISP in the PATH column"
echo "   ssh pi4 \"ls -l /etc/splitgate/isp-routes-custom.txt /etc/splitgate/vpn-routes-custom.txt 2>/dev/null || echo 'no custom route files present'\""
echo "   ssh pi4 \"sudo /etc/splitgate/routing.sh && ip route get <YOUR-EXCEPTION-CIDR-IP>\""
echo "   # expect: route via 192.168.1.1 (KEENETIC_GW) for any IP inside an exception CIDR"
echo ""
echo " Phase 10 (splitgate ergonomics) verification:"
echo "   ssh pi4 \"ls -ld /etc/splitgate /etc/splitgate/logs\""
echo "   # expect: both directories present, mode 755"
echo "   ssh pi4 \"ls -l /usr/local/bin/splitgate\""
echo "   # expect: -rwxr-xr-x root root"
echo "   ssh pi4 \"splitgate status\""
echo "   # expect: exec sudo /etc/splitgate/vpn-status.sh (verify usage line if no args)"
echo "   ssh pi4 \"splitgate\""
echo "   # expect: Usage: splitgate {status|watch|rollback|routing|update} [args...] (exit 1)"
echo "   ssh pi4 \"ls -l /etc/logrotate.d/vpn-gateway\""
echo "   # expect: -rw-r--r-- root root"
echo "   ssh pi4 \"sudo logrotate -d /etc/logrotate.d/vpn-gateway\""
echo "   # dry-run must exit 0"
echo "================================================================"
