---
quick_id: 260521-jex
slug: add-scripts-watch-routes-py-real-time-ip
phase: quick
plan: 260521-jex
subsystem: scripts
tags: [observability, iptables, logging, python]
dependency_graph:
  requires: [scripts/routing.sh (LOG rules at Stage 7b)]
  provides: [scripts/watch-routes.py]
  affects: []
tech_stack:
  added: []
  patterns: [subprocess.Popen streaming stdout, module-level DNS cache dict, argparse]
key_files:
  created: [scripts/watch-routes.py]
  modified: [.gitignore]
decisions:
  - Regex anchored to search() not match() so it works on full journalctl output lines regardless of hostname length
  - DNS failures cached as raw IP so each address is looked up at most once per run
  - hostname truncated to 40 chars to keep output scannable on an 80-char terminal
  - __pycache__ added to .gitignore as a Rule-2 housekeeping deviation
metrics:
  duration: "~3 minutes"
  completed: "2026-05-21"
  tasks_completed: 1
  files_created: 1
  files_modified: 1
---

# Quick Task 260521-jex: Add scripts/watch-routes.py Summary

## One-liner

Real-time iptables log enricher — parses `[VPN]`/`[ISP]` journalctl lines with cached reverse-DNS and `--src`/`--no-dns`/`--tag` CLI filters.

## What Was Built

`scripts/watch-routes.py` spawns `journalctl -f -k --no-pager -o short-iso`, scans each line with a compiled regex for `[VPN]`/`[ISP]` LOG prefixes emitted by `routing.sh` Stage 7b, then prints enriched lines:

```
2026-05-21T11:36:21 [VPN] 192.168.1.175 → 17.248.209.64 (courier.push.apple.com) TCP:443
2026-05-21T11:37:41 [ISP] 192.168.1.175 → 142.250.154.157 (lga25s80-in-f13.1e100.net) TCP:443
```

Key design points:
- Module-level `_dns_cache` dict avoids repeated `gethostbyaddr` calls per destination IP
- `socket.setdefaulttimeout(2.0)` prevents DNS hangs on unreachable servers
- ICMP traffic (no `DPT=`) shows `PROTO` without port (e.g., `ICMP`)
- `flush=True` on every print makes output pipe-friendly (`| grep`, `| tee`)
- `KeyboardInterrupt` + `finally: proc.terminate()` gives clean Ctrl-C exit
- stdlib only — zero pip dependencies

## Verification

```
$ python3 -m compileall scripts/watch-routes.py
Compiling 'scripts/watch-routes.py'...

$ python3 scripts/watch-routes.py --help
usage: watch-routes.py [-h] [--src IP] [--no-dns] [--tag {VPN,ISP,both}]
...
```

Both checks passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added __pycache__ to .gitignore**
- **Found during:** Post-commit untracked file check (git status showed `?? scripts/__pycache__/`)
- **Issue:** `python3 -m compileall` creates `__pycache__/` which would be left as untracked noise
- **Fix:** Added `__pycache__/` and `*.pyc` entries to `.gitignore`
- **Files modified:** `.gitignore`
- **Commit:** 69cdc90

## Commits

| Hash | Message |
|------|---------|
| cf6bafa | feat(260521-jex): add scripts/watch-routes.py real-time iptables log enricher |
| 69cdc90 | chore(260521-jex): ignore Python __pycache__ and .pyc files |

## Known Stubs

None — script is fully wired; live output depends on the RPi emitting `[VPN]`/`[ISP]` log lines (requires `routing.sh` to be running on the device with LOG rules active).

## Self-Check: PASSED

- scripts/watch-routes.py: FOUND
- .gitignore (updated): FOUND
- Commit cf6bafa: FOUND
- Commit 69cdc90: FOUND
