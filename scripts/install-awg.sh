#!/usr/bin/env bash
# scripts/install-awg.sh
#
# RPi-side AmneziaWG installer.
# Run via: sudo bash -s < scripts/install-awg.sh
#          (or: ssh pi4 "sudo bash -s" < scripts/install-awg.sh)
#
# Decisions honored:
#   D-01 — Primary install: bivlked/RomikB installer (official AmneziaWG community installer for RPi)
#   D-02 — Fallback: pre-built .deb from AmneziaWG GitHub releases; pass URL via AWG_DEB_URL env var
#   D-03 — Assumes RPi OS already running (Raspberry Pi OS / Debian Bookworm, arm64); no OS install step
#
# Threat mitigations:
#   T-01-01 — Installer fetched over HTTPS with curl -fsSL; URL is pinned and reviewable in git
#   T-01-02 — set -euo pipefail; no read prompts; scope limited to package install + sysctl + mkdir

set -euo pipefail

# ─── Constants ────────────────────────────────────────────────────────────────
BIVLKED_INSTALLER_URL="https://raw.githubusercontent.com/RomikB/amneziawg-install/main/amneziawg-install.sh"
AWG_CONFIG_DIR="/etc/amnezia/amneziawg"
SYSCTL_CONF="/etc/sysctl.d/99-vpn-gateway.conf"

log() {
    echo "[install-awg] $*"
}

err() {
    echo "[install-awg] ERROR: $*" >&2
}

# ─── Stage 1: Idempotency short-circuit ───────────────────────────────────────
# Check if both awg and awg-quick are already installed; if so, skip package install.
# Stages 4 (sysctl) and 5 (config dir) ALWAYS run to converge state.
AWG_ALREADY_INSTALLED=false
if command -v awg >/dev/null 2>&1 && command -v awg-quick >/dev/null 2>&1; then
    log "AmneziaWG already installed — skipping package install"
    AWG_ALREADY_INSTALLED=true
fi

if [[ "$AWG_ALREADY_INSTALLED" == false ]]; then
    # ─── Stage 2: Primary install path (D-01 — bivlked/RomikB installer) ────────
    # The bivlked installer auto-detects the RPi +rpt kernel suffix and selects
    # linux-headers-rpi-v8 (RPi 4 64-bit) instead of the generic linux-headers-arm64.
    # This handles the PPA codename mismatch between Debian Bookworm and Ubuntu (Pitfall 3).
    # Source: github.com/bivlked/amneziawg-installer ADVANCED.en.md (RomikB fork)
    log "Stage 2: Primary install — bivlked/RomikB AmneziaWG installer (D-01)"
    log "Downloading installer from: $BIVLKED_INSTALLER_URL"

    INSTALLER_TMP=$(mktemp /tmp/amneziawg-install.XXXXXX.sh)
    # shellcheck disable=SC2064
    trap "rm -f '$INSTALLER_TMP'" EXIT

    PRIMARY_OK=true
    if curl -fsSL "$BIVLKED_INSTALLER_URL" -o "$INSTALLER_TMP"; then
        log "Installer downloaded; running non-interactively..."
        # Run installer; it will auto-select prebuilt .ko or DKMS fallback for RPi arm64.
        # Expected install time: 2-3 min (prebuilt) or 10-30 min (DKMS fallback on kernel mismatch).
        if bash "$INSTALLER_TMP"; then
            log "Primary install (bivlked) succeeded"
        else
            err "Primary install (bivlked) exited non-zero — falling back to deb path (D-02)"
            PRIMARY_OK=false
        fi
    else
        err "Failed to download bivlked installer from $BIVLKED_INSTALLER_URL — falling back to deb path (D-02)"
        PRIMARY_OK=false
    fi

    rm -f "$INSTALLER_TMP"
    trap - EXIT

    # ─── Stage 3: Fallback path (D-02 — pre-built .deb from GitHub releases) ────
    # Manual fallback documented below. Use this if the bivlked installer fails.
    #
    # MANUAL FALLBACK INSTRUCTIONS (D-02):
    #   1. Go to: https://github.com/amnezia-vpn/amneziawg-linux-kernel-module/releases
    #   2. Download the .deb matching your kernel: `uname -r` tells you the version.
    #      For RPi 4 (64-bit) look for a deb with arm64 and linux-headers-rpi-v8 in the name.
    #   3. Re-run this script with AWG_DEB_URL set:
    #      AWG_DEB_URL="https://github.com/.../amneziawg_X.Y.Z_arm64.deb" sudo bash -s < install-awg.sh
    #
    # The fallback path executes only when AWG_DEB_URL is set AND primary failed.
    if [[ "$PRIMARY_OK" == false ]]; then
        if [[ -z "${AWG_DEB_URL:-}" ]]; then
            err "Primary install failed and AWG_DEB_URL not set — see scripts/install-awg.sh fallback comments"
            exit 2
        fi

        log "Stage 3: Fallback install — pre-built .deb from: $AWG_DEB_URL (D-02)"
        log "Installing kernel headers for RPi arm64..."
        apt-get update -qq
        # RPi 4 (64-bit) requires linux-headers-rpi-v8 (not linux-headers-arm64).
        # See RESEARCH.md Pitfall 2: wrong headers cause DKMS compilation failure.
        apt-get install -y linux-headers-rpi-v8

        log "Downloading and installing AmneziaWG .deb package..."
        DEB_TMP=$(mktemp /tmp/amneziawg.XXXXXX.deb)
        trap "rm -f '$DEB_TMP'" EXIT
        if curl -fsSL "$AWG_DEB_URL" -o "$DEB_TMP"; then
            apt-get install -y "$DEB_TMP"
            log "Fallback .deb install succeeded"
        else
            err "Failed to download .deb from $AWG_DEB_URL"
            rm -f "$DEB_TMP"
            trap - EXIT
            exit 3
        fi
        rm -f "$DEB_TMP"
        trap - EXIT
    fi
fi

# ─── Stage 4: Persistent IP forwarding (INST-02) ─────────────────────────────
# Apply immediately and persist via sysctl.d (survives reboot).
# /etc/sysctl.d/ is the standard drop-in location on Debian Bookworm.
# File 99-vpn-gateway.conf sorts last, winning over any conflicting entries.
log "Stage 4: Enabling persistent IP forwarding (INST-02)"
sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward=1" | tee "$SYSCTL_CONF" >/dev/null
log "Written: $SYSCTL_CONF"
sysctl --system >/dev/null
# Verify immediately
IP_FWD=$(sysctl -n net.ipv4.ip_forward)
if [[ "$IP_FWD" != "1" ]]; then
    err "net.ipv4.ip_forward is '$IP_FWD' (expected 1) after sysctl --system"
    exit 4
fi
log "IP forwarding confirmed: net.ipv4.ip_forward = $IP_FWD"

# ─── Stage 5: Pre-create AmneziaWG config directory ──────────────────────────
# The amneziawg-tools package may not create /etc/amnezia/amneziawg/ automatically.
# See RESEARCH.md Pitfall 4: github.com/amnezia-vpn/amneziawg-tools/issues/16
# Default permissions (0755, root:root) are correct — Plan 02 deploy.sh sets 0600 on awg0.conf.
log "Stage 5: Pre-creating config directory: $AWG_CONFIG_DIR"
mkdir -p "$AWG_CONFIG_DIR"
log "Directory confirmed: $AWG_CONFIG_DIR ($(stat -c '%a %U:%G' "$AWG_CONFIG_DIR" 2>/dev/null || stat -f '%Sp %Su:%Sg' "$AWG_CONFIG_DIR" 2>/dev/null || echo 'stat unavailable'))"

# ─── Stage 6: Post-install verification ──────────────────────────────────────
log "Stage 6: Post-install verification"

# Load amneziawg kernel module (required before awg0 can come up).
# See RESEARCH.md Pitfall 1: module may be installed but not loaded.
log "Loading amneziawg kernel module..."
if ! modprobe amneziawg; then
    err "modprobe amneziawg failed — kernel module may not be installed correctly"
    exit 5
fi

# Verify module is now listed
if ! lsmod | grep -q '^amneziawg '; then
    err "amneziawg module not visible in lsmod after modprobe"
    exit 6
fi
log "Kernel module loaded: amneziawg (verified via lsmod)"

# Verify awg binary
AWG_PATH=$(command -v awg 2>/dev/null || true)
if [[ -z "$AWG_PATH" ]]; then
    err "awg binary not found in PATH after install (INST-01 not satisfied)"
    exit 7
fi
log "Binary: awg -> $AWG_PATH"

# Verify awg-quick binary
AWGQ_PATH=$(command -v awg-quick 2>/dev/null || true)
if [[ -z "$AWGQ_PATH" ]]; then
    err "awg-quick binary not found in PATH after install (INST-01 not satisfied)"
    exit 8
fi
log "Binary: awg-quick -> $AWGQ_PATH"

# NOTE: Tunnel bring-up is NOT performed by this script (RESEARCH.md Pitfall 5).
# awg-quick up is NOT idempotent — it fails if the interface is already up.
# Tunnel management belongs to post-deploy manual verification, not the installer.

log "──────────────────────────────────────────────"
log "AmneziaWG install complete. Summary:"
log "  awg:           $AWG_PATH"
log "  awg-quick:     $AWGQ_PATH"
log "  sysctl:        $SYSCTL_CONF (ip_forward=1)"
log "  config dir:    $AWG_CONFIG_DIR"
log "  kernel module: amneziawg (loaded)"
log ""
log "Next: deploy awg0.conf via deploy.sh, then bring up the tunnel manually."
log "──────────────────────────────────────────────"
