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
#   bash src/deploy-routes.sh [--keep-remote]
#
#   --keep-remote  Leave the device's route files untouched and only re-apply them.
#                  Use when routes are being managed from the web admin and the
#                  local src/configs/ copies are stale.
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

# ─── Argument parsing ────────────────────────────────────────────────────────
KEEP_REMOTE=false
for arg in "$@"; do
  case "$arg" in
    --keep-remote) KEEP_REMOTE=true ;;
    *) ;;
  esac
done

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

# ─── Route-file push ─────────────────────────────────────────────────────────
# Pushing the local route files IS this script's purpose, so unlike deploy.sh it
# overwrites by default. But routes are also managed from the web admin and live
# only on the device, so every overwrite is preceded by a timestamped .bak and the
# route counts are printed before and after — a replacement that loses entries is
# then visible in the output instead of being discovered days later.
# --keep-remote skips the push entirely and only re-applies what is already there.
push_route_file() {
    local local_path="$1" remote_path="$2" tmp_path="$3" label="$4"

    if [[ ! -f "${local_path}" ]]; then
        echo "       ${local_path} not found — skipping ${label} deploy."
        return 0
    fi

    local local_count remote_count
    local_count=$(grep -c '^[^#]' "${local_path}" || true)

    if ssh -o BatchMode=yes "${SSH_HOST}" "test -f ${remote_path}"; then
        remote_count=$(ssh -o BatchMode=yes "${SSH_HOST}" "grep -c '^[^#]' ${remote_path} || true")
        if [[ "${KEEP_REMOTE}" == true ]]; then
            echo "       ${remote_path} kept as-is (${remote_count} route line(s)) — --keep-remote."
            return 0
        fi
        local stamp
        stamp=$(date '+%Y%m%d-%H%M%S')
        ssh -o BatchMode=yes "${SSH_HOST}" "sudo cp ${remote_path} ${remote_path}.bak-${stamp}"
        echo "       Backed up remote copy to ${remote_path}.bak-${stamp}"
        echo "       Replacing ${remote_count} remote route line(s) with ${local_count} local one(s)."
        if (( local_count < remote_count )); then
            echo "       NOTE: the local file has FEWER routes than the device — entries added via the"
            echo "             web admin are about to be dropped. Restore from the .bak above if unintended."
        fi
    else
        echo "       No remote copy yet — deploying ${local_count} route line(s)."
    fi

    scp -o BatchMode=yes "${local_path}" "${SSH_HOST}:${tmp_path}"
    ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${tmp_path} ${remote_path} && sudo chmod 644 ${remote_path} && sudo chown root:root ${remote_path}"
    echo "       ${label} deployed (mode 644, root:root)."
}

# ─── Stage 1/3: Deploy isp-routes-custom.txt (D-05) ─────────────────────────
echo "[2/3] Deploying isp-routes-custom.txt to ${SSH_HOST} (if present)..."
push_route_file "${ISP_CUSTOM_LOCAL}" "${ISP_CUSTOM_REMOTE}" "${ISP_CUSTOM_TMP}" "isp-routes-custom.txt"

# ─── Stage 2/3: Deploy vpn-routes-custom.txt (D-05) ─────────────────────────
echo "[2b/3] Deploying vpn-routes-custom.txt to ${SSH_HOST} (if present)..."
push_route_file "${VPN_FORCE_LOCAL}" "${VPN_FORCE_REMOTE}" "${VPN_FORCE_TMP}" "vpn-routes-custom.txt"

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
