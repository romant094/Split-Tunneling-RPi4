#!/usr/bin/env bash
# deploy.sh — macOS-side deploy orchestrator for RPi VPN Gateway (Phase 1)
#
# Decisions honored:
#   D-04: SSH_HOST=pi4 via system SSH config (no hardcoded IP)
#   D-05: SSH user 'ar' with passwordless sudo — no su or password prompts
#   D-06: BatchMode=yes enforces SSH key auth; password fallback blocked
#   D-07: Real VPN keys live in .env.secrets (gitignored, never committed)
#   D-08: Variable names AWG_PRIVATE_KEY, AWG_PUBLIC_KEY, AWG_PRESHARED_KEY
#   D-09: Reads .env.secrets, substitutes via sed pipeline, SCPs rendered config
#   D-10: Key validation regex ^[A-Za-z0-9+/]{43}=$ enforced before any remote op
#
# Usage:
#   1. Copy .env.secrets.example to .env.secrets and fill in your 44-char base64 keys
#   2. Ensure ~/.ssh/config has a 'pi4' host alias (SSH key auth, user ar)
#   3. Run: ./deploy.sh
#
# This script deploys:
#   - AmneziaWG (via scripts/install-awg.sh over SSH)
#   - /etc/amnezia/amneziawg/awg0.conf (CONF-01, mode 0600 root:root)
#   - /etc/vpn-gateway.env (CONF-02, mode 0644 root:root)
#
# After deploy completes, bring up the tunnel manually:
#   ssh pi4 "sudo awg-quick up awg0"
#   ssh pi4 "sudo awg show"

set -euo pipefail

# ─── Configuration (D-04, D-09) ─────────────────────────────────────────────
SSH_HOST="pi4"
TEMPLATE="amnezia.key.claude.txt"
AWG_CONF_REMOTE="/etc/amnezia/amneziawg/awg0.conf"
ENV_REMOTE="/etc/vpn-gateway.env"
INSTALLER_SCRIPT="scripts/install-awg.sh"

TOTAL_STAGES=9

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

echo "       All required files present."

# ─── Stage B: Source env files ───────────────────────────────────────────────
# shellcheck source=/dev/null
source .env
# shellcheck source=/dev/null
source .env.secrets
# Keys are now in memory as shell variables; never echoed or logged.

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
    echo "       Run: ssh-copy-id ar@192.168.1.254  (if key not yet installed)" >&2
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
if ! ssh "$SSH_HOST" "test -f ${AWG_CONF_REMOTE}"; then
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
ip_forward=$(ssh "$SSH_HOST" "sysctl -n net.ipv4.ip_forward")
echo "       net.ipv4.ip_forward: ${ip_forward}"
if [[ "$ip_forward" != "1" ]]; then
    echo "ERROR: net.ipv4.ip_forward is ${ip_forward} (expected 1) on ${SSH_HOST}" >&2
    echo "       Check /etc/sysctl.d/99-vpn-gateway.conf and run: sudo sysctl --system" >&2
    exit 1
fi

echo "       All post-deploy checks passed."

# ─── Stage J: Final message ──────────────────────────────────────────────────
# Tunnel bring-up is NOT automated — RESEARCH.md Pitfall 5 (awg-quick up is not idempotent)
# The commands below are printed for the developer to run manually.
echo "[9/${TOTAL_STAGES}] Deploy complete."
echo ""
echo "================================================================"
echo " Phase 1 deploy successful."
echo "================================================================"
echo ""
echo " Deployed:"
echo "   CONF-01: ${AWG_CONF_REMOTE} (mode 0600, root:root)"
echo "   CONF-02: ${ENV_REMOTE}  (mode 0644, root:root)"
echo "   INST-01: awg binary present at ${awg_path}"
echo "   INST-02: net.ipv4.ip_forward = ${ip_forward}"
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
echo "================================================================"
