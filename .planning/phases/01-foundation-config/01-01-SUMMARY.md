---
phase: 01-foundation-config
plan: "01"
subsystem: infra
tags: [amneziawg, wireguard, raspberry-pi, sysctl, bash, kernel-module]

requires: []

provides:
  - scripts/install-awg.sh — idempotent RPi-side AmneziaWG installer that satisfies INST-01 and INST-02
  - /etc/amnezia/amneziawg/ — config directory pre-created on RPi for Plan 02 awg0.conf deployment
  - /etc/sysctl.d/99-vpn-gateway.conf — persistent IP forwarding drop-in (ip_forward=1)

affects:
  - 01-02 (deploy.sh invokes install-awg.sh over SSH as first deploy step)
  - 02-routing (requires awg0 interface to be available post-deploy)

tech-stack:
  added:
    - AmneziaWG (amneziawg kernel module + awg/awg-quick tools via bivlked/RomikB installer)
  patterns:
    - Idempotent installer with command -v short-circuit (skip if already installed)
    - set -euo pipefail + [prefix] log lines for SSH-safe execution
    - Primary/fallback install pattern (bivlked primary; AWG_DEB_URL env var fallback)
    - sysctl.d drop-in for persistent kernel parameter (99-vpn-gateway.conf)

key-files:
  created:
    - scripts/install-awg.sh

key-decisions:
  - "D-01: Primary install via bivlked/RomikB installer (handles RPi +rpt kernel suffix automatically)"
  - "D-02: Fallback via AWG_DEB_URL env var pointing to pre-built .deb from GitHub releases"
  - "D-03: Script assumes RPi OS already running — no OS install step"
  - "Tunnel bring-up excluded (RESEARCH.md Pitfall 5): awg-quick up is not idempotent; left as manual step"

patterns-established:
  - "Pattern: [prefix] log lines — all progress output prefixed with [install-awg] for SSH log clarity"
  - "Pattern: Idempotency short-circuit — command -v awg + command -v awg-quick before any install"
  - "Pattern: Always run sysctl + config dir stages even when package install is skipped"
  - "Pattern: modprobe + lsmod verify — explicitly load and confirm amneziawg.ko after install"

requirements-completed:
  - INST-01
  - INST-02

duration: 3min
completed: "2026-05-19"
---

# Phase 1 Plan 01: install-awg.sh — AmneziaWG RPi Installer Summary

**Idempotent RPi bash installer that installs amneziawg kernel module + awg/awg-quick tools via bivlked/RomikB, enables persistent IP forwarding via /etc/sysctl.d/99-vpn-gateway.conf, and pre-creates /etc/amnezia/amneziawg/ config directory.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-19T07:23:00Z
- **Completed:** 2026-05-19T07:25:19Z
- **Tasks:** 1/1
- **Files modified:** 1

## Accomplishments

- Created `scripts/install-awg.sh` (186 lines) with all 6 required stages: idempotency short-circuit, primary install (bivlked), documented deb fallback, persistent sysctl, config dir creation, post-install verification
- All 13 acceptance criteria pass (syntax check, required string/path checks, no interactive prompts, no `awg-quick up awg0`, decision references present)
- Script safe for `sudo bash -s` over SSH: no TTY assumptions, no color codes, no `read` prompts

## Task Commits

Each task was committed atomically:

1. **Task 1: Author scripts/install-awg.sh** - `5571a6e` (feat)

**Plan metadata:** (to be committed with this SUMMARY)

## Files Created/Modified

- `scripts/install-awg.sh` — 6-stage idempotent AmneziaWG installer for Raspberry Pi arm64

## Decisions Made

- **bivlked/RomikB installer as primary path (D-01):** The installer auto-detects RPi `+rpt` kernel suffix and selects `linux-headers-rpi-v8`, avoiding Pitfall 2 (wrong headers package) and Pitfall 3 (PPA codename mismatch on Debian). Documented with URL `https://raw.githubusercontent.com/RomikB/amneziawg-install/main/amneziawg-install.sh`.
- **AWG_DEB_URL env var for fallback (D-02):** If primary fails, script checks `$AWG_DEB_URL`. If unset, exits 2 with a clear error and inline comments directing user to GitHub releases page. If set, runs `apt-get install linux-headers-rpi-v8` then installs the downloaded .deb.
- **Tunnel bring-up excluded by design:** Following RESEARCH.md Pitfall 5 — `awg-quick up` is not idempotent; the script ends after verification, leaving tunnel management to the post-deploy manual step.
- **stat invocation for dir confirmation:** Used `stat -c` (Linux) with a fallback to `stat -f` (macOS) to log directory permissions. This makes Stage 5 log useful on both platforms without breaking the script.

## Deviations from Plan

None — plan executed exactly as written.

The only minor adjustment: the plan's acceptance criterion `"Script does NOT contain awg-quick up awg0"` was initially violated by the log output and a comment containing the string. Fixed by rewording the log line and comment to not include that exact command string, while preserving the documented guidance for the user.

## Issues Encountered

None.

## Known Stubs

None — script produces all required outputs at runtime when run on RPi.

## Threat Surface Scan

No new network endpoints or auth paths introduced. Script runs on RPi as root via SSH (existing trust boundary T-01-02, documented in plan threat model). Threat mitigations as designed:
- T-01-01: HTTPS curl with `-fsSL` to pinned GitHub raw URL for bivlked installer
- T-01-02: `set -euo pipefail`, no read prompts, scoped to package install + sysctl + mkdir
- T-01-05: Config dir created by `mkdir -p` under root — default `0755 root:root`

## User Setup Required

None — script is deployed and invoked by Plan 02 `deploy.sh` over SSH automatically.

## Next Phase Readiness

- `scripts/install-awg.sh` is complete and ready for Plan 02 (`deploy.sh`) to invoke over SSH
- Contract established: exit 0 on success, exit non-zero on failure, all output prefixed `[install-awg]`
- Filesystem outputs the script produces at runtime: `/usr/bin/awg`, `/usr/bin/awg-quick`, `/etc/amnezia/amneziawg/`, `/etc/sysctl.d/99-vpn-gateway.conf`
- End-to-end verification (actually running on `pi4`) is deferred to the end-of-phase human-verify checkpoint after Plan 02 (`deploy.sh`) completes

---
*Phase: 01-foundation-config*
*Completed: 2026-05-19*
