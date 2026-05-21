---
quick_id: 260521-jex
slug: add-scripts-watch-routes-py-real-time-ip
description: "Add scripts/watch-routes.py — real-time iptables log viewer with reverse DNS caching for a specific source IP"
date: 2026-05-21
mode: quick
must_haves:
  truths:
    - scripts/watch-routes.py exists and is executable
    - Script parses [VPN] and [ISP] iptables LOG lines from journalctl
    - Reverse-DNS cache prevents repeated lookups for same DST IP
    - --src flag filters output to a specific source IP
    - stdlib only — no pip dependencies
  artifacts:
    - scripts/watch-routes.py
---

# Quick Task 260521-jex: Add scripts/watch-routes.py

## Overview

Create a real-time iptables log enricher that reads `journalctl -f -k`, parses `[VPN]`/`[ISP]` LOG lines, does cached reverse-DNS on destination IPs, and prints enriched output.

The RPi gateway already emits these log lines via iptables LOG rules (see `scripts/routing.sh` lines 127–130). This script makes them human-readable without any system changes.

## Task 1: Create scripts/watch-routes.py

**Files:** `scripts/watch-routes.py`

**Action:**

Create `scripts/watch-routes.py` with:

```
#!/usr/bin/env python3
```

### Requirements

**Input:** `journalctl -f -k --no-pager -o short-iso` stdout stream

**Parsing:** Compiled regex matching lines containing `[VPN]` or `[ISP]` prefix, extracting:
- Tag: `VPN` or `ISP`
- `SRC=<ip>`
- `DST=<ip>`
- `PROTO=<proto>`
- `DPT=<port>` (absent for ICMP → use `-`)
- Timestamp from journalctl line prefix (ISO format)

**DNS cache:**
- Module-level `dict` mapping IP → hostname string
- Cache both successful and failed lookups (failures stored as the IP itself)
- `socket.setdefaulttimeout(2.0)` set at startup
- Use `socket.gethostbyaddr(ip)[0]` for lookups

**CLI interface (argparse):**
- `--src IP` — only show lines where SRC matches this IP
- `--no-dns` — skip reverse DNS, show raw IPs
- `--tag {VPN,ISP,both}` — filter by routing tag (default: both)

**Output format (flush=True for pipeability):**
```
2026-05-21T11:36:21 [VPN] 192.168.1.175 → 17.248.209.64 (courier.push.apple.com) TCP:443
2026-05-21T11:37:41 [ISP] 192.168.1.175 → 142.250.154.157 (lga25s80-in-f13.1e100.net) TCP:443
```

Columns:
- Timestamp: 19 chars from ISO prefix
- Tag: `[VPN]` or `[ISP]` 
- SRC IP
- `→`
- DST IP (hostname in parens, truncated to 40 chars; omitted if `--no-dns` or lookup fails returning IP)
- PROTO:PORT

**Robustness:**
- Wrap journalctl spawn in try/except, print to stderr and `sys.exit(1)` on failure
- `try/except KeyboardInterrupt` + `finally: proc.terminate()` for clean Ctrl-C
- Skip (don't crash on) lines that don't match the regex

**chmod +x the file after creation.**

**Verify:**
```bash
python3 -m compileall scripts/watch-routes.py
python3 scripts/watch-routes.py --help
```

**Done:** File exists at `scripts/watch-routes.py`, compiles without errors, `--help` prints usage.
