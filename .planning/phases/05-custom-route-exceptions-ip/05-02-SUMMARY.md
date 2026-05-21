---
phase: 05-custom-route-exceptions-ip
plan: "02"
subsystem: deploy-tooling
tags: [deploy, vpn-status, bash, exception-routes, gitignore]
dependency_graph:
  requires:
    - 05-01 (routing.sh Stage 5b loads /etc/white-list-extended.txt; paths renamed to white-list.txt)
  provides:
    - vpn-status.sh --via=vpn|isp flag for filtering output by routing decision
    - deploy.sh Stage 21 conditionally SCPs configs/white-list-extended.txt to /etc/white-list-extended.txt
    - deploy.sh Stage 22 (renamed from 21) activates routing.sh without --no-update
    - configs/white-list-extended.txt.example committed template for user reference
    - configs/white-list-extended.txt gitignored (user-populated, never committed)
  affects:
    - scripts/vpn-status.sh
    - deploy.sh
    - configs/white-list-extended.txt.example
    - .gitignore
tech_stack:
  added: []
  patterns:
    - Output-time filter (applied in for-loop over entries[], not during journald while-read)
    - Conditional deploy stage (if [[ -f "${LOCAL}" ]]; then scp + ssh; else echo skip; fi)
    - Strict string-equality validation for CLI flag values (no regex, no shell injection surface)
key_files:
  created:
    - configs/white-list-extended.txt.example
  modified:
    - scripts/vpn-status.sh
    - deploy.sh
    - .gitignore
decisions:
  - "--via filter applied at output time (inside entries[] for-loop), not during entry collection — avoids rDNS lookups for filtered-out entries (Pitfall 3)"
  - "--no-update removed from Stage 22 activation so first Phase 5 deploy freshly downloads /etc/white-list.txt to renamed path (Pitfall 2 fix)"
  - "configs/ (plural) used for white-list-extended.txt.example — matches existing dnsmasq.conf location, overrides CONTEXT D-04 which said config/ (singular)"
  - "Stage A preflight intentionally does NOT check for WHITE_LIST_EXT_LOCAL — absence is normal state per D-05 (Pitfall 1 avoided)"
  - "Remaining --no-update in Phase 4 verification echo removed for full compliance with grep -c test"
metrics:
  duration: ~12 minutes
  completed: "2026-05-21T14:30:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 4
---

# Phase 5 Plan 02: vpn-status.sh --via flag, deploy.sh Stage 21, example template

**One-liner:** Added --via=vpn|isp output filter to vpn-status.sh, a conditional Stage 21 to deploy.sh that SCPs configs/white-list-extended.txt to the RPi when present (silent skip otherwise), dropped --no-update from the final activation stage, and committed the configs/white-list-extended.txt.example user template with gitignore entry for the real file.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add --via=vpn|isp flag to vpn-status.sh | 1b5502b | scripts/vpn-status.sh |
| 2 | Add white-list-extended.txt.example template and gitignore real file | 3c581a3 | configs/white-list-extended.txt.example, .gitignore |
| 3 | Add deploy.sh Stage 21 conditional exception deploy; drop --no-update from activation | f19788b | deploy.sh |

## Changes Detail

### scripts/vpn-status.sh

- **Line 44:** `VIA=""` added to defaults block (alongside LAST, FILTER, DEVICE)
- **Lines 69-75:** New `--via=*)` case arm inserted before `*)` catch-all:
  - Extracts val, validates against exact strings `vpn` and `isp` (exits 1 with error if not)
  - Stores `VIA="${val^^}"` (uppercase: vpn→VPN, isp→ISP to match decision field)
- **Line 64:** catch-all usage hint updated to include `[--via=vpn|isp]`
- **Line 174:** Filter applied inside output for-loop: `if [[ -n "${VIA}" ]] && [[ "${decision}" != "${VIA}" ]]; then continue; fi` — placed after `IFS='|' read` and before `printf`; NOT in entry-collection while-loop

### configs/white-list-extended.txt.example

New committed template file. Header comment block explains:
- Purpose (ISP-bypass exceptions alongside auto-downloaded /etc/white-list.txt)
- Format constraint: one CIDR per line, whole-line comments only (trailing comments after a CIDR are not supported by routing.sh)
- Discovery workflow: `sudo /etc/vpn-status.sh --via=vpn` → add CIDRs → `./deploy.sh`
- Deploy target: `/etc/white-list-extended.txt` (Stage 21 in deploy.sh)
- Silent drop behavior for malformed lines

Example header (first line):
```
# configs/white-list-extended.txt.example
```

Two example CIDR entries (commented out with leading `#`):
```
# 23.55.0.0/16
# 95.181.176.0/22
```

### .gitignore

Two lines added after `/awg0.conf`:
```
# Phase 5: user-defined ISP-bypass exceptions — never commit
configs/white-list-extended.txt
```

### deploy.sh

- **Lines 59-61:** Three new constants added after WATCH_ROUTES_TMP:
  - `WHITE_LIST_EXT_LOCAL="configs/white-list-extended.txt"`
  - `WHITE_LIST_EXT_REMOTE="/etc/white-list-extended.txt"`
  - `WHITE_LIST_EXT_TMP="/tmp/white-list-extended.tmp"`
- **Line 63:** `TOTAL_STAGES=22` (bumped from 21)
- **Lines 347-355 (Stage 21):** New conditional exception file deploy stage:
  - Prints `[21/${TOTAL_STAGES}] Deploying white-list-extended.txt to ${SSH_HOST} (if present)...`
  - On present: SCP + sudo mv + chmod 644 + chown root:root + success log
  - On absent: `${WHITE_LIST_EXT_LOCAL} not found in repo — skipping exception file deploy (D-05).`
- **Lines 357-359 (Stage 22):** Former Stage 21 renumbered to 22; `--no-update` removed from ssh activation command; comment updated to reference Phase 5
- **Line 383:** Phase 5 entry added to " Deployed:" summary block (references WHITE_LIST_EXT_REMOTE + "optional")
- **Lines 459-466:** Phase 5 verification block added before closing separator with `--via=vpn`, `--via=isp`, `ls /etc/white-list-extended.txt`, and `ip route get` examples

## Verification Results

```
bash -n scripts/vpn-status.sh        → exit 0  PASS
bash -n deploy.sh                     → exit 0  PASS
git check-ignore -q configs/white-list-extended.txt       → exit 0  PASS (ignored)
git check-ignore -q configs/white-list-extended.txt.example → exit 1  PASS (NOT ignored)
git check-ignore -q configs/dnsmasq.conf                  → exit 1  PASS (NOT ignored)
grep -c 'TOTAL_STAGES=22' deploy.sh   → 1       PASS
grep -c 'TOTAL_STAGES=21' deploy.sh   → 0       PASS
grep -c '--no-update' deploy.sh       → 0       PASS
Stage A preflight (lines ~89-138): no WHITE_LIST_EXT_LOCAL check PASS
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed --no-update from Phase 4 verification echo**
- **Found during:** Task 3
- **Issue:** Plan acceptance criteria require `grep -c -- '--no-update' deploy.sh` returns 0. The Phase 4 verification echo block contained `ssh pi4 "sudo /etc/routing.sh --no-update && ..."` as a printed example command.
- **Fix:** Changed to `ssh pi4 "sudo /etc/routing.sh && ..."` in the verification echo (line 447). This is a printed-to-stdout help string, not an actual SSH call. The change is logically correct: after Phase 5 deploy, the idempotency check should also not use --no-update.
- **Files modified:** deploy.sh
- **Commit:** f19788b

## Known Stubs

None — all three capabilities are fully wired end-to-end:
- vpn-status.sh --via reads VIA from argument parsing and applies it at output time
- deploy.sh Stage 21 checks real file presence and uses real remote path constants
- configs/white-list-extended.txt.example has real format documentation (no placeholder text)

## Threat Flags

No new security surface beyond what is documented in the plan's threat model (T-05-06 through T-05-10). The --via flag uses strict string equality (no regex, no eval), fully mitigating T-05-06.

## Self-Check: PASSED

- scripts/vpn-status.sh: exists, contains VIA="", --via=*) arm, val^^, [--via=vpn|isp] in usage hint, VIA filter in output loop (line 174)
- configs/white-list-extended.txt.example: exists, 30 lines, header comment at line 1, contains white-list-extended.txt and configs/white-list-extended.txt references, 2 commented CIDR examples
- .gitignore: contains `configs/white-list-extended.txt` (exact match)
- deploy.sh: syntax OK; WHITE_LIST_EXT_LOCAL/REMOTE/TMP constants; TOTAL_STAGES=22; Stage 21 conditional block (lines 347-355); Stage 22 without --no-update; Phase 5 verification block; zero --no-update occurrences
- Commits 1b5502b, 3c581a3, f19788b: all verified in git log
