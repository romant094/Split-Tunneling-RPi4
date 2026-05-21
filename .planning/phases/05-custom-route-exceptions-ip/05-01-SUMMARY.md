---
phase: 05-custom-route-exceptions-ip
plan: "01"
subsystem: routing-scripts
tags: [routing, split-tunnel, exception-routes, rename, bash]
dependency_graph:
  requires: []
  provides:
    - routing.sh writes to /etc/white-list.txt (renamed from /etc/vpn-ru-subnets.txt)
    - routing.sh Stage 5b loads /etc/white-list-extended.txt when present (silent skip when absent)
    - update-vpn-routes compares and swaps to /etc/white-list.txt
    - vpn-rollback.sh removes /etc/white-list-extended.txt on rollback
  affects:
    - scripts/routing.sh
    - scripts/update-vpn-routes
    - scripts/vpn-rollback.sh
tech_stack:
  added: []
  patterns:
    - Conditional file loading with silent skip (EXCEPTIONS_FILE presence check before while-read loop)
    - Same `ip route add ... 2>/dev/null || true` trust model as existing Stage 5 (T-02-02 extended to T-05-01)
    - rm -f for optional file cleanup in rollback (Pattern 4 — absence is not an error)
key_files:
  created: []
  modified:
    - scripts/routing.sh
    - scripts/update-vpn-routes
    - scripts/vpn-rollback.sh
decisions:
  - "WHITE_LIST_FILE constant used in routing.sh (not SUBNET_FILE); update-vpn-routes keeps SUBNET_FILE internally to minimize blast radius"
  - "EX_ADDED initialized to 0 before the if-block so Stage 9 summary always has a defined value"
  - "Stage 5b inserted at lines 163-183 of routing.sh — immediately after Stage 5 log line"
  - "Step 4c inserted at lines 107-111 of vpn-rollback.sh — between Step 4b and Step 5 (netfilter-persistent save)"
metrics:
  duration: ~8 minutes
  completed: "2026-05-21T13:55:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 3
---

# Phase 5 Plan 01: Rename white-list.txt and add Stage 5b exception loader

**One-liner:** Renamed `/etc/vpn-ru-subnets.txt` to `/etc/white-list.txt` across three scripts and inserted Stage 5b in routing.sh that reads `/etc/white-list-extended.txt` when present (silent skip if absent), routing each CIDR via KEENETIC_GW.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Rename SUBNET_FILE to WHITE_LIST_FILE, add EXCEPTIONS_FILE, insert Stage 5b in routing.sh | 3320e1f | scripts/routing.sh |
| 2 | Rename SUBNET_FILE path in update-vpn-routes to /etc/white-list.txt | aa056e9 | scripts/update-vpn-routes |
| 3 | Extend vpn-rollback.sh with Step 4c exception file removal and white-list.txt rename | fc99153 | scripts/vpn-rollback.sh |

## Changes Detail

### scripts/routing.sh

- **Line 38:** `WHITE_LIST_FILE="/etc/white-list.txt"` (renamed from `SUBNET_FILE="/etc/vpn-ru-subnets.txt"`)
- **Line 39:** `EXCEPTIONS_FILE="/etc/white-list-extended.txt"` (new constant)
- **Stage 1 (lines 77-99):** All SUBNET_FILE refs replaced with WHITE_LIST_FILE
- **Stage 2 (lines 102-113):** SUBNET_FILE → WHITE_LIST_FILE; SUBNET_COUNT → WHITE_LIST_COUNT
- **Stage 5 (line 160):** Loop reads `< "${WHITE_LIST_FILE}"` instead of SUBNET_FILE
- **Stage 5b (lines 163-183):** New conditional block — checks `[[ -f "${EXCEPTIONS_FILE}" ]]`; if present: loops with same while-read pattern, increments EX_ADDED; if absent: logs skip message with D-05 tag
- **Stage 9 (line 297):** Added: `log "  Exceptions:      ${EX_ADDED} routes via ${KEENETIC_GW} (from ${EXCEPTIONS_FILE})"`
- **Doc header (line 18):** Added `D-08(P5) — Stage 5b loads /etc/white-list-extended.txt if present (silent skip if absent)`

### scripts/update-vpn-routes

- **Line 13:** Doc comment updated: `/etc/vpn-ru-subnets.txt` → `/etc/white-list.txt`
- **Line 19:** `SUBNET_FILE="/etc/white-list.txt"` (path changed; variable name kept as SUBNET_FILE per plan to minimize blast radius)
- All other logic unchanged: sha256 compare, atomic mv, `/etc/routing.sh --no-update` call

### scripts/vpn-rollback.sh

- **Lines 6, 13, 25:** Doc comments updated: `vpn-ru-subnets.txt` → `white-list.txt`
- **Lines 107-111:** New Step 4c inserted between Step 4b and Step 5:
  ```
  log "Removing /etc/white-list-extended.txt (if present)..."
  rm -f /etc/white-list-extended.txt
  log "/etc/white-list-extended.txt: removed (or was not present)"
  ```
- **Step 8 summary:** Added echo `"   Exception file removed: /etc/white-list-extended.txt (if present)"`
- **Step 8 preserved-files echo:** `vpn-ru-subnets.txt` → `white-list.txt`

## Verification Results

```
bash -n scripts/routing.sh       → exit 0  PASS
bash -n scripts/update-vpn-routes → exit 0  PASS
bash -n scripts/vpn-rollback.sh  → exit 0  PASS
grep -r '/etc/vpn-ru-subnets.txt' scripts/  → zero matches  PASS
grep -l '/etc/white-list.txt' scripts/{routing.sh,update-vpn-routes,vpn-rollback.sh}  → all three listed  PASS
grep -l 'EXCEPTIONS_FILE|white-list-extended' scripts/{routing.sh,vpn-rollback.sh}  → both listed  PASS
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all three files are fully wired. Stage 5b reads a real file path; EX_ADDED is always initialized; rollback rm -f is unconditional.

## Threat Flags

No new security surface introduced. Stage 5b uses the same trust model as Stage 5 (T-02-02 extended to T-05-01): CIDRs from /etc/white-list-extended.txt passed as positional arguments to `ip route add`, no eval, `2>/dev/null || true` suppresses errors from malformed entries.

## Self-Check: PASSED

- scripts/routing.sh: exists, contains WHITE_LIST_FILE, EXCEPTIONS_FILE, Stage 5b, EX_ADDED
- scripts/update-vpn-routes: exists, contains /etc/white-list.txt
- scripts/vpn-rollback.sh: exists, contains rm -f /etc/white-list-extended.txt, /etc/white-list.txt references
- Commits 3320e1f, aa056e9, fc99153: verified in git log
