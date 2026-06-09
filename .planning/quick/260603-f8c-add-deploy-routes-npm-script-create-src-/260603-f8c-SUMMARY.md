---
quick_task_id: 260603-f8c
date: 2026-06-03
type: quick
tags: [deploy, shell, docs]
key_files:
  created:
    - src/deploy-routes.sh
  modified:
    - README.md
    - docs/README.ru.md
    - docs/REFERENCE.md
    - .planning/STATE.md
decisions: []
metrics:
  duration: ~15 minutes
  completed: 2026-06-03
---

# Quick Task 260603-f8c: Add deploy-routes.sh Fast Custom-Routes Deploy — Summary

**One-liner:** 3-stage bash script (SSH preflight + conditional SCP x2 + routing.sh --no-update) that deploys only the two custom-route files, skipping the full 28-stage pipeline.

---

## What Was Built

`src/deploy-routes.sh` — an 110-line bash script mirroring `src/deploy.sh` patterns exactly:
- `set -euo pipefail`, `cd "$(dirname "${BASH_SOURCE[0]}")"` — same as deploy.sh
- Same 6 config variables (`ISP_CUSTOM_LOCAL/REMOTE/TMP`, `VPN_FORCE_LOCAL/REMOTE/TMP`) verbatim from deploy.sh
- Preflights: `.env` existence check, `SSH_HOST` set, at least one custom-route file present
- SSH connectivity check with `-o ConnectTimeout=5 -o BatchMode=yes` (D-04, D-06)
- Conditional SCP+mv+chmod+chown for each file (pattern from deploy.sh stages 21/21b)
- `routing.sh --no-update` activation
- Summary with remote paths and a verify hint

`package.json` updated locally (file is gitignored) with `"deploy-routes": "./src/deploy-routes.sh"`.

---

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1 — create script | `0d0bec6` | `src/deploy-routes.sh` (new, mode 755) |
| 2 — documentation | `fe189d7` | `README.md`, `docs/README.ru.md`, `docs/REFERENCE.md`, `.planning/STATE.md` |

---

## Documentation Changes

- **README.md:** `bash src/deploy-routes.sh` added to deploy commands block; paragraph added in custom-route subsection explaining when to use it vs full deploy
- **docs/README.ru.md:** all English changes mirrored in Russian (same two insertion points)
- **docs/REFERENCE.md:** new `### src/deploy-routes.sh` section (synopsis, 3-stage table, when to use, exit codes); ISP-bypass and VPN-force Step 4 updated to recommend `deploy-routes.sh` for routine edits with `deploy.sh` as the full-deploy fallback; quick task row added
- **No doc file** references `package.json` or `npm run deploy-routes` — docs document only `bash src/deploy-routes.sh`

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Verification

- `bash -n src/deploy-routes.sh` → syntax OK
- `grep -c 'ISP_CUSTOM_LOCAL\|VPN_FORCE_LOCAL' src/deploy-routes.sh` → 13 (≥ 2)
- `grep -c 'routing.sh --no-update' src/deploy-routes.sh` → 4 (≥ 1)
- `grep -c 'deploy-routes.sh' README.md` → 2 (≥ 2)
- `grep -c 'deploy-routes.sh' docs/README.ru.md` → 2 (≥ 2)
- `grep -c 'deploy-routes.sh' docs/REFERENCE.md` → 6 (≥ 3)
- `grep -c 'package.json\|npm run deploy-routes' README.md docs/README.ru.md docs/REFERENCE.md` → 0

## Self-Check: PASSED

- `src/deploy-routes.sh` exists at commit 0d0bec6
- Documentation commits fe189d7 contain all three doc files plus STATE.md
- No unexpected file deletions in either commit
