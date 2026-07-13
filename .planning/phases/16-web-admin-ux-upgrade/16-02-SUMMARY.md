---
phase: 16-web-admin-ux-upgrade
plan: 02
subsystem: deploy
tags: [deploy.sh, idempotency, traceroute, non-destructive-redeploy]
requires: []
provides:
  - "Non-destructive redeploy of vpn-gateway.env and awg0.conf (skip-if-exists guard)"
  - "traceroute apt-install stage (UI-DIAG dependency)"
affects:
  - "src/deploy.sh"
  - "README.md"
  - "docs/README.ru.md"
  - "docs/REFERENCE.md"
tech-stack:
  added: []
  patterns:
    - "skip-if-exists guard (ssh sudo test -f) mirroring existing idempotent dpkg -l apt-install pattern"
key-files:
  created: []
  modified:
    - src/deploy.sh
    - README.md
    - docs/README.ru.md
    - docs/REFERENCE.md
decisions:
  - "Skip-if-exists with warning (not merge/diff) chosen for non-destructive redeploy — simplest correct strategy given Settings page is now the source of truth for these two files post-first-deploy"
  - "traceroute install stage placed immediately after dnsmasq install (new Stage 18b/18), before dnsmasq config deploy — groups apt-installs together"
metrics:
  duration: "~25 min"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 4
  completed: 2026-07-13
---

# Phase 16 Plan 02: Deploy.sh Non-Destructive Redeploy + Traceroute Dependency Summary

Guarded `deploy.sh` Stage G/H (awg0.conf, vpn-gateway.env) with skip-if-exists checks so RPi-side Settings-page edits survive redeploy, and added an idempotent `traceroute` apt-install stage for the Diagnostics page; TOTAL_STAGES bumped 29 → 30 with all subsequent stage labels renumbered contiguously.

## What Was Built

**Task 1 — Non-destructive redeploy (UI-DEPLOY):** Stage G (`awg0.conf`) and Stage H (`vpn-gateway.env`) now run `ssh "$SSH_HOST" "sudo test -f <remote-path>"` before overwriting. If the remote file already exists, the stage prints a warning ("already present ... skipping overwrite — edit via Settings page, or delete the remote file to force redeploy") and skips the scp/mv/chmod/chown steps entirely. If absent (first deploy), the existing render → scp → mv path runs unchanged. Stage I's post-deploy verification (`test -f` on both paths) is untouched — both files are guaranteed to exist afterward whether freshly deployed or pre-existing.

**Task 2 — traceroute apt-install stage (UI-DIAG dependency):** New Stage 18b installs `traceroute` idempotently via the same `dpkg -l | grep '^ii'` guard pattern used for dnsmasq (Stage 18), placed immediately after the dnsmasq install and before the dnsmasq config deploy. `TOTAL_STAGES` incremented from 29 to 30; every `[N/${TOTAL_STAGES}]` progress label at or after the insertion point was renumbered by +1 (19→20 vpn-status.sh, 20→21 watch-routes.py, 21→22/22b/22c custom routes, 22→23 NM dispatcher, 23→24 asn-lookup.py, 24→25 tunnel activation, 25→26/27/28 splitgate artifacts, 29→30 admin UI). Stale narrative "Stage N" comment headers referencing the shifted numbers were also corrected.

**Task 3 — Docs sync:** README.md, docs/README.ru.md, and docs/REFERENCE.md now document (1) the non-destructive redeploy behavior — edit via Settings page or delete the remote file to force a fresh deploy, and (2) the traceroute apt dependency. docs/REFERENCE.md's "Deploy Stage Groups" table was updated to 30 stages with a new "Diagnostics dependency" row and corrected stale stage-number cross-references elsewhere in the file (custom-route deploy stages, splitgate-watch.service stage, dnsmasq troubleshooting section, NM dispatcher section).

## Deviations from Plan

None — plan executed as written. The stale narrative comment-header renumbering (e.g. `# ─── Stage 23: Deploy asn-lookup.py` → `Stage 24`) was a minor cleanup beyond the plan's literal scope but required by CLAUDE.md's "no stale references" convention; grouped under normal task execution rather than a separate deviation since it's the same file/task and doesn't change behavior.

## Verification

```
bash -n src/deploy.sh                              # exits 0
grep -c "TOTAL_STAGES=30" src/deploy.sh             # 1
grep -c "apt-get install -y traceroute" src/deploy.sh  # 1
grep -c "already present" src/deploy.sh             # 4 (2 guard warnings + verify greps overlap)
grep -c "traceroute" README.md docs/REFERENCE.md docs/README.ru.md   # 1 each
```

Final admin stage confirmed at `[30/${TOTAL_STAGES}]` (3 occurrences within the conditional admin block, matching pre-existing multi-echo pattern).

## Self-Check: PASSED

- FOUND: src/deploy.sh (modified, syntax valid)
- FOUND: README.md (modified)
- FOUND: docs/README.ru.md (modified)
- FOUND: docs/REFERENCE.md (modified)
- FOUND commit 2a4b95d (Task 1 — skip-if-exists guards)
- FOUND commit 2b0cc6f (Task 2 — traceroute stage + renumbering)
- FOUND commit 982ab2c (Task 3 — docs sync)
