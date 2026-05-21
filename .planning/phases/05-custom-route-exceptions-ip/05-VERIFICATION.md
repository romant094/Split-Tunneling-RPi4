# Phase 05: Custom Route Exceptions — Verification

**Date:** 2026-05-21
**Status:** passed
**Plans verified:** 2/2

## Results

### Plan 05-01: Script rename + exception loader

| Criterion | Result |
|-----------|--------|
| `WHITE_LIST_FILE="/etc/white-list.txt"` in routing.sh | ✓ |
| `EXCEPTIONS_FILE="/etc/white-list-extended.txt"` in routing.sh | ✓ |
| No `SUBNET_FILE` references in routing.sh | ✓ |
| No `/etc/vpn-ru-subnets.txt` references in routing.sh | ✓ |
| No `SUBNET_COUNT` in routing.sh (renamed to `WHITE_LIST_COUNT`) | ✓ |
| Stage 5b exception loader exists in routing.sh | ✓ |
| `scripts/update-vpn-routes` uses `/etc/white-list.txt` | ✓ |
| `vpn-rollback.sh` has `rm -f /etc/white-list-extended.txt` | ✓ |

### Plan 05-02: User-facing surface

| Criterion | Result |
|-----------|--------|
| `--via=vpn\|isp` flag in vpn-status.sh with validation | ✓ |
| `TOTAL_STAGES=22` in deploy.sh | ✓ |
| Stage 21 conditional exception deploy in deploy.sh | ✓ |
| `--no-update` removed from final activation stage | ✓ |
| `configs/white-list-extended.txt.example` committed | ✓ |
| `configs/white-list-extended.txt` in `.gitignore` | ✓ |

## Phase Goal Verification

**Goal:** Define per-IP and per-domain overrides that force traffic through ISP, bypassing the default VPN route

| Condition | Status |
|-----------|--------|
| `routing.sh` loads `white-list-extended.txt` alongside `white-list.txt` | ✓ Stage 5b implemented |
| `vpn-status.sh --via=vpn` shows only VPN-routed connections | ✓ Filter implemented |
| CIDR in `white-list-extended.txt` routes via ISP after `./deploy.sh` | ✓ Stage 21 + routing.sh Stage 5b |

## Commits

- `3320e1f` feat(05-01): rename SUBNET_FILE to WHITE_LIST_FILE and add Stage 5b exception loader
- `aa056e9` feat(05-01): rename SUBNET_FILE path in update-vpn-routes to /etc/white-list.txt
- `fc99153` feat(05-01): extend vpn-rollback.sh with Step 4c exception file removal and white-list.txt rename
- `07b344a` docs(05-01): complete plan 01 summary
- `1b5502b` feat(05-02): add --via=vpn|isp output filter to vpn-status.sh
- `3c581a3` feat(05-02): add white-list-extended.txt.example template and gitignore real file
- `f19788b` feat(05-02): add Stage 21 conditional exception file deploy; drop --no-update from activation
- `6f4b65c` docs(05-02): complete plan 02 summary

## Verification: PASSED
