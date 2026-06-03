#!/usr/bin/env bash
# deploy-routes.sh — fast custom-routes-only deploy for RPi VPN Gateway
#
# Skips AmneziaWG install, key validation, systemd setup.
# Use after editing src/configs/isp-routes-custom.txt or src/configs/vpn-routes-custom.txt.
# Runs routing.sh --no-update on the RPi to apply changes without re-downloading the RU list.
#
# Decisions honored:
#   D-04: SSH_HOST=pi4 via system SSH config (no hardcoded IP)
#   D-06: BatchMode=yes enforces SSH key auth; password fallback blocked
#   Phase 5 D-05: conditional custom-route deploy — skip file if absent, skip stage cleanly
#
# Usage:
#   bash src/deploy-routes.sh
#
# Requires:
#   - ~/.ssh/config has a 'pi4' host alias with SSH key auth
#   - .env exists (provides SSH_HOST)
#   - At least one of src/configs/isp-routes-custom.txt or src/configs/vpn-routes-custom.txt exists

set -euo pipefail

# Navigate to script's own directory so all *_LOCAL relative paths resolve correctly.
cd "$(dirname "${BASH_SOURCE[0]}")"

# ─── Configuration ───────────────────────────────────────────────────────────
ISP_CUSTOM_LOCAL="configs/isp-routes-custom.txt"
ISP_CUSTOM_REMOTE="/etc/splitgate/isp-routes-custom.txt"
ISP_CUSTOM_TMP="/tmp/isp-routes-custom.tmp"

VPN_FORCE_LOCAL="configs/vpn-routes-custom.txt"
VPN_FORCE_REMOTE="/etc/splitgate/vpn-routes-custom.txt"
VPN_FORCE_TMP="/tmp/vpn-routes-custom.tmp"

ROUTING_SH_REMOTE="/etc/splitgate/routing.sh"

# ─── Preflight: source .env ──────────────────────────────────────────────────
if [[ ! -f ../.env ]]; then
    echo "ERROR: ../.env not found — this file should be committed in the repo" >&2
    exit 1
fi

# shellcheck source=/dev/null
source ../.env

if [[ -z "${SSH_HOST:-}" ]]; then
    echo "ERROR: SSH_HOST not set in .env" >&2
    echo "       Add SSH_HOST=pi4 (or your RPi SSH alias) to .env" >&2
    exit 1
fi

# ─── Preflight: at least one custom-route file must exist ────────────────────
if [[ ! -f "${ISP_CUSTOM_LOCAL}" && ! -f "${VPN_FORCE_LOCAL}" ]]; then
    echo "ERROR: Neither custom-route file found:" >&2
    echo "       ${ISP_CUSTOM_LOCAL}" >&2
    echo "       ${VPN_FORCE_LOCAL}" >&2
    echo "       Create at least one file before running deploy-routes.sh." >&2
    echo "       Copy from example: cp src/configs/isp-routes-custom.txt.example src/configs/isp-routes-custom.txt" >&2
    exit 1
fi

# ─── Preflight: SSH connectivity check (D-06) ────────────────────────────────
echo "[1/3] Verifying SSH connectivity to ${SSH_HOST}..."

if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$SSH_HOST" true; then
    echo "ERROR: Cannot connect to ${SSH_HOST} via SSH" >&2
    echo "       Ensure ~/.ssh/config has a 'pi4' alias with SSH key auth (D-04, D-06)" >&2
    echo "       Run: ssh-copy-id ar@<rpi-ip>  (if key not yet installed)" >&2
    exit 1
fi

echo "       SSH connection to ${SSH_HOST} successful."

# ─── Stage 1/3: Deploy isp-routes-custom.txt (D-05) ─────────────────────────
echo "[2/3] Deploying isp-routes-custom.txt to ${SSH_HOST} (if present)..."
if [[ -f "${ISP_CUSTOM_LOCAL}" ]]; then
    scp -o BatchMode=yes "${ISP_CUSTOM_LOCAL}" "${SSH_HOST}:${ISP_CUSTOM_TMP}"
    ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${ISP_CUSTOM_TMP} ${ISP_CUSTOM_REMOTE} && sudo chmod 644 ${ISP_CUSTOM_REMOTE} && sudo chown root:root ${ISP_CUSTOM_REMOTE}"
    echo "       isp-routes-custom.txt deployed (mode 644, root:root)."
else
    echo "       ${ISP_CUSTOM_LOCAL} not found — skipping ISP-custom deploy."
fi

# ─── Stage 2/3: Deploy vpn-routes-custom.txt (D-05) ─────────────────────────
echo "[2b/3] Deploying vpn-routes-custom.txt to ${SSH_HOST} (if present)..."
if [[ -f "${VPN_FORCE_LOCAL}" ]]; then
    scp -o BatchMode=yes "${VPN_FORCE_LOCAL}" "${SSH_HOST}:${VPN_FORCE_TMP}"
    ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${VPN_FORCE_TMP} ${VPN_FORCE_REMOTE} && sudo chmod 644 ${VPN_FORCE_REMOTE} && sudo chown root:root ${VPN_FORCE_REMOTE}"
    echo "       vpn-routes-custom.txt deployed (mode 644, root:root)."
else
    echo "       ${VPN_FORCE_LOCAL} not found — skipping VPN-force deploy."
fi

# ─── Stage 3/3: Activate routing.sh --no-update ──────────────────────────────
echo "[3/3] Activating routing.sh --no-update on ${SSH_HOST}..."
ssh -o BatchMode=yes "${SSH_HOST}" "sudo ${ROUTING_SH_REMOTE} --no-update"
echo "       routing.sh --no-update complete — custom routes applied without RU list re-download."

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "================================================================"
echo " deploy-routes.sh complete."
echo "================================================================"
echo ""
echo " Deployed:"
[[ -f "${ISP_CUSTOM_LOCAL}" ]] && echo "   ${ISP_CUSTOM_REMOTE} (mode 644, root:root)"
[[ -f "${VPN_FORCE_LOCAL}" ]] && echo "   ${VPN_FORCE_REMOTE} (mode 644, root:root)"
echo ""
echo " Verify:"
echo "   ssh ${SSH_HOST} \"ls -l /etc/splitgate/{isp,vpn}-routes-custom.txt\""
