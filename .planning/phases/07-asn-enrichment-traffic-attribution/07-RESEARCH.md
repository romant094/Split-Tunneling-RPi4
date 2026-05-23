# Phase 7: ASN Enrichment & Traffic Attribution — Research

**Researched:** 2026-05-23
**Domain:** Python stdlib TCP socket; Team Cymru bulk whois; Bash subprocess integration; file-backed JSON cache
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Team Cymru bulk whois — batch TCP to `whois.cymru.com:43`. Send `begin\nverbose\n<ip1>\n<ip2>\nend\n`, receive pipe-separated ASN | IP | prefix | CC | registry | allocated | AS Name.
- **D-02:** File-based persistent cache at `/tmp/vpn-asn-cache.json` on RPi. Format: `{ip: {asn: "15169", org: "GOOGLE"}}`. No TTL — ASN assignments change rarely; cache grows indefinitely (fine for home gateway use).
- **D-03:** Both `vpn-status.sh` and `watch-routes.py` get ASN enrichment.
- **D-04:** Shared Python helper `scripts/asn-lookup.py` — stdlib only (socket, json). Single implementation of Cymru client + file cache. `vpn-status.sh` calls it via subprocess (passes IPs on stdin, parses JSON output). `watch-routes.py` calls it via subprocess or imports directly.
- **D-05:** `asn-lookup.py` deployed to RPi. New `deploy.sh` stage added.
- **D-06:** `vpn-status.sh` — new `ORG` column added after `DOMAIN`. Column value: `{org} (AS{asn})`, e.g. `Apple Inc. (AS714)`. Lookup fail or unreachable: show `-`.
- **D-07:** `vpn-status.sh --summary` — new flag showing top N orgs ranked by connection count, split by VPN/ISP path. Format TBD by planner: table with `ORG | VPN_COUNT | ISP_COUNT | TOTAL`.
- **D-08:** `watch-routes.py` — append ` | {org}` at end of each output line. If lookup fails: omit the suffix (don't break stream).
- **D-09:** `asn-lookup.py` uses stdlib only — no pip dependencies.

### Claude's Discretion

- Exact deployed path for `asn-lookup.py` on RPi (`/etc/asn-lookup.py` vs `/usr/local/bin/asn-lookup` vs alongside `/etc/vpn-status.sh`)
- Number of items shown in `--summary` mode (default top 10 or top 20)
- Whether `watch-routes.py` does ASN lookups in a background thread to avoid blocking the real-time stream
- How `vpn-status.sh` passes IPs to `asn-lookup.py` (all unique DST IPs at once, then join results)
- Whether `asn-lookup.py` has its own `--help` and direct CLI mode (run standalone to test lookups)

### Deferred Ideas (OUT OF SCOPE)

- None — discussion stayed within phase scope
</user_constraints>

---

## Summary

Phase 7 adds ISP/org attribution to two existing traffic visibility tools (`vpn-status.sh` and `watch-routes.py`) by creating a shared Python helper (`asn-lookup.py`) that performs bulk TCP lookups against the Team Cymru whois service. All implementation uses Python stdlib (socket, json, sys, os, tempfile, threading) — no pip packages — matching the established convention from `watch-routes.py`.

The Team Cymru bulk whois protocol is simple and well-documented: open a single TCP connection to `whois.cymru.com:43`, transmit `begin\nverbose\n<IPs>\nend\n`, read pipe-separated response lines until EOF, parse ASN and AS Name fields. A file-backed JSON cache at `/tmp/vpn-asn-cache.json` means the Cymru service is only queried for IPs not already seen. The cache has no TTL by design — BGP ASN assignments are highly stable.

The four integration points are precisely specified in CONTEXT.md: `vpn-status.sh` gains an ORG column and a `--summary` aggregation mode; `watch-routes.py` appends `| {org}` to each output line in a non-blocking way; `deploy.sh` gains a new stage (Stage 24, bumping TOTAL_STAGES from 23 to 24) using the established SCP-to-tmp → sudo mv → chmod +x pattern; and `asn-lookup.py` is written fresh as a standalone script that reads IPs from stdin and emits a JSON dict to stdout.

**Primary recommendation:** Implement `asn-lookup.py` as a stdin→stdout JSON script with file cache and a direct-run CLI mode for on-RPi testing. Deploy to `/etc/asn-lookup.py` (consistent with all other per-phase scripts). In `watch-routes.py` perform ASN lookup in a background `threading.Thread` with a short timeout so the real-time log stream never blocks on network. In `vpn-status.sh` collect all unique DST IPs from the entries array, pipe them to `asn-lookup.py` once, capture the JSON, then format the table.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cymru TCP query + response parse | asn-lookup.py (Python, RPi) | — | Network I/O requires Python socket; runs on RPi where IPs are visible |
| File cache read/write | asn-lookup.py (Python, RPi) | — | Cache lives at /tmp on RPi, owned by the lookup script |
| IP batch collection | vpn-status.sh (Bash, RPi) | — | IPs are already extracted inside the entries loop |
| JSON parse of asn-lookup output | vpn-status.sh (Bash, RPi) | — | Bash reads stdout; uses python3 -c or a second python3 invocation |
| ORG column formatting | vpn-status.sh (Bash, RPi) | — | printf table format is already in vpn-status.sh |
| --summary aggregation | vpn-status.sh (Bash, RPi) | — | Counts VPN/ISP rows per org from entries array |
| Real-time org lookup | watch-routes.py (Python, RPi) | — | Background thread reads from module-level ASN cache dict |
| Deploy orchestration | deploy.sh (Bash, macOS) | — | SCP + sudo mv pattern matches all prior stages |

---

## Project Constraints (from CLAUDE.md)

- **Platform:** Raspberry Pi 4, Debian/Raspbian, arm64
- **Python:** stdlib only — no pip. Confirmed by D-09 and existing `watch-routes.py` pattern.
- **Scripts must be idempotent:** `asn-lookup.py` is stateless for lookups; cache file is additive (merge-write, never truncate).
- **Safety:** Secrets never in repo. `asn-lookup.py` handles no secrets.
- **Rollback:** `vpn-rollback.sh` does NOT need to handle `asn-lookup.py` removal — it is a read-only enrichment tool with no routing side effects.
- **After every commit, immediately run `git push`.**
- **Conventions:** `set -euo pipefail` + `source /etc/vpn-gateway.env` in bash scripts; argument parsing via `case "${arg}" in --flag=*)` pattern.

---

## Standard Stack

### Core

No new packages. This phase is entirely stdlib Python + bash.

| Module | Source | Purpose | Why Standard |
|--------|--------|---------|--------------|
| `socket` | Python stdlib | TCP connection to whois.cymru.com:43 | Built-in; handles makefile() for line-by-line reads |
| `json` | Python stdlib | Cache file serialization; stdout output | Built-in; matches existing watch-routes.py style |
| `sys` | Python stdlib | stdin reading, stdout writing, argv | Built-in |
| `os` | Python stdlib | os.replace() for atomic cache write | Built-in; atomic rename on POSIX |
| `tempfile` | Python stdlib | mkstemp() for safe temp file before atomic rename | Built-in |
| `threading` | Python stdlib | Background ASN lookup in watch-routes.py | Built-in; prevents stream blocking |

[VERIFIED: Python 3.14.3 on macOS, modules confirmed importable]

### Supporting (Bash side)

| Tool | Available | Purpose |
|------|-----------|---------|
| `python3` | System RPi Debian | Run asn-lookup.py |
| `ssh` / `scp` | OpenSSH 9.9p2 on macOS | Deploy stage (already used) |

**Installation:** No packages to install. All functionality is stdlib Python + existing bash tools.

---

## Package Legitimacy Audit

> **Not applicable.** This phase installs zero external packages. All code uses Python stdlib and existing system tools already present on RPi. No `npm install`, `pip install`, or `apt install` required.

---

## Architecture Patterns

### System Architecture Diagram

```
macOS (deploy.sh)
  └─ Stage 24: scp scripts/asn-lookup.py → /tmp/asn-lookup.py.tmp
                ssh: sudo mv + chmod +x → /etc/asn-lookup.py

RPi (runtime)
  ┌─────────────────────────────────────────────────────────────────┐
  │  vpn-status.sh                                                   │
  │   1. Build entries[] (existing — IPs already extracted)          │
  │   2. Collect unique DST IPs → print to stdin                     │
  │   3. python3 /etc/asn-lookup.py ← reads IPs from stdin          │
  │      ├─ Load /tmp/vpn-asn-cache.json (cache hit → skip Cymru)   │
  │      ├─ Batch uncached IPs → TCP whois.cymru.com:43              │
  │      │    send: begin\nverbose\n<IPs>\nend\n                     │
  │      │    recv: pipe-sep lines until EOF                         │
  │      ├─ Merge new results into cache → atomic write              │
  │      └─ Print JSON {ip: {asn, org}} to stdout                    │
  │   4. Parse JSON → build org_map[ip] = "Org (ASN)"               │
  │   5. Render table with ORG column (or --summary aggregate)       │
  └─────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────┐
  │  watch-routes.py (main thread — streaming)                       │
  │   journalctl -f → parse _LOG_RE → format_line()                 │
  │      └─ check _asn_cache dict (in-memory)                       │
  │         hit → append " | {org}" immediately                      │
  │         miss → fire background thread to lookup + populate cache │
  │                (if thread slow/fails: print line without org)    │
  └─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new directories needed. New file:
```
scripts/
├── asn-lookup.py        # NEW: shared stdlib Cymru TCP client + file cache
├── vpn-status.sh        # MODIFIED: add ORG column + --summary flag
├── watch-routes.py      # MODIFIED: append | {org} per line via background thread
deploy.sh                # MODIFIED: TOTAL_STAGES=23→24; add Stage 24 for asn-lookup.py
```

Deployed path on RPi: `/etc/asn-lookup.py` — consistent with all other Phase scripts (`/etc/vpn-status.sh`, `/etc/watch-routes.py`, etc.). [ASSUMED: planner may choose differently per discretion note in CONTEXT.md]

### Pattern 1: Team Cymru Bulk Whois TCP Query (Python stdlib)

**What:** Open a single TCP socket to `whois.cymru.com:43`, send the bulk query, read all response lines until EOF using `socket.makefile()`.

**When to use:** Called from `asn-lookup.py` for any IPs not found in the file cache.

**Wire format verified by:** multiple open-source implementations (cymru-asnmap, python-cymruwhois) and Team Cymru's own documentation. [CITED: https://www.team-cymru.com/ip-asn-mapping] [CITED: https://github.com/JustinAzoff/python-cymruwhois/blob/master/cymruwhois.py]

```python
# Source: adapted from Team Cymru documented protocol + python-cymruwhois pattern
import socket

def _cymru_bulk_lookup(ips: list[str], timeout: float = 10.0) -> dict[str, dict]:
    """Send batch query to Team Cymru whois. Returns {ip: {asn, org}} for found IPs."""
    if not ips:
        return {}
    query = "begin\nverbose\n" + "\n".join(ips) + "\nend\n"
    results = {}
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        s.connect(("whois.cymru.com", 43))
        s.sendall(query.encode())
        # socket.makefile gives a file-like object for easy line iteration
        f = s.makefile("rb")
        for raw_line in f:
            line = raw_line.decode("utf-8", errors="replace").strip()
            # First line is header: "Bulk mode; whois.cymru.com [timestamp]" — skip
            if line.startswith("Bulk mode") or not line:
                continue
            parts = [p.strip() for p in line.split("|")]
            # Verbose mode: AS | IP | BGP Prefix | CC | Registry | Allocated | AS Name
            if len(parts) >= 7:
                asn = parts[0]
                ip  = parts[1]
                org = parts[6]  # "AS Name" field — e.g. "GOOGLE, US"
                results[ip] = {"asn": asn, "org": org}
        f.close()
        s.close()
    except (socket.timeout, OSError):
        pass  # Caller handles partial results gracefully
    return results
```

**Key details:**
- The first response line is always `Bulk mode; whois.cymru.com [timestamp]` — must be skipped. [CITED: https://www.team-cymru.com/ip-asn-mapping]
- Field index 0 = ASN, index 1 = IP, index 6 = AS Name (verbose mode adds fields 4–6 vs non-verbose). [VERIFIED: cross-checked cymru-asnmap + python-cymruwhois implementations]
- Timeout handling: `socket.settimeout(10.0)` for the whole connection; on timeout the partial results dict is returned — any uncached IPs will show `-` in output.
- Team Cymru policy: **do not send individual queries in a loop** — always batch. Abusers get null-routed. [CITED: https://www.team-cymru.com/ip-asn-mapping]

### Pattern 2: Atomic JSON Cache Write

**What:** Load existing cache, merge new results, write atomically using tempfile + os.replace().

**When to use:** After every Cymru query that returns new results.

```python
# Source: standard POSIX atomic replace pattern [ASSUMED: training knowledge, widely documented]
import json, os, tempfile

CACHE_FILE = "/tmp/vpn-asn-cache.json"

def load_cache() -> dict:
    try:
        with open(CACHE_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_cache(cache: dict) -> None:
    """Atomic write — never leaves a half-written cache file."""
    cache_dir = os.path.dirname(CACHE_FILE) or "."
    fd, tmp_path = tempfile.mkstemp(dir=cache_dir)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(cache, f)
        os.replace(tmp_path, CACHE_FILE)  # atomic on POSIX
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
```

**Key detail:** `os.replace()` is atomic on POSIX (Linux). Creating the temp file in the same directory as the cache (`/tmp`) ensures no cross-filesystem copy. [ASSUMED: standard POSIX semantics — training knowledge]

### Pattern 3: Background Thread for watch-routes.py (non-blocking enrichment)

**What:** ASN lookup is a network call (up to ~200ms). Running it synchronously in `format_line()` blocks the real-time stream. A background thread with a short timeout allows the line to be printed immediately, then updated if the org resolves quickly.

**Recommended approach:** Print the line immediately (without org), then if org resolves within ~500ms via a background thread, the cache is populated and subsequent lines with the same IP get the org. This is acceptable because `watch-routes.py` is a live tail, not a report — users tolerate org name appearing after 1–2 lines.

**Simpler alternative:** For each line, call `asn-lookup.py` as a subprocess synchronously but with a very short timeout (1s). If it times out, emit line without org. This avoids threading complexity at the cost of occasional 1s delays. **Planner should decide** based on desired complexity vs reliability trade-off.

```python
# Source: Python threading.Thread + dict as shared cache (stdlib) [ASSUMED: training knowledge]
import threading

_asn_cache: dict[str, dict | None] = {}  # None = lookup in progress
_asn_lock = threading.Lock()

def lookup_async(ip: str) -> None:
    """Fire-and-forget: populate _asn_cache[ip] in background."""
    with _asn_lock:
        if ip in _asn_cache:
            return
        _asn_cache[ip] = None  # mark in-progress
    try:
        result = _cymru_bulk_lookup([ip], timeout=3.0)
        with _asn_lock:
            _asn_cache[ip] = result.get(ip)
    except Exception:
        with _asn_lock:
            _asn_cache[ip] = {}
```

### Pattern 4: vpn-status.sh Calling asn-lookup.py and Parsing JSON

**What:** Bash collects unique DST IPs, calls python3, captures JSON, then uses `python3 -c` or inline Python to build an associative array for the table.

**Key constraint:** `jq` is NOT used in any existing script and may not be present on RPi (Debian minimal). Parse JSON with Python. [VERIFIED: grep found zero jq usage in project scripts]

```bash
# Collect unique DST IPs from entries array
declare -A org_map
unique_ips=()
seen_ips=()
for entry in "${entries[@]}"; do
    IFS='|' read -r ts src_ip dst_ip domain decision <<< "${entry}"
    if ! printf '%s\n' "${seen_ips[@]:-}" | grep -qxF "${dst_ip}"; then
        unique_ips+=("${dst_ip}")
        seen_ips+=("${dst_ip}")
    fi
done

# Call asn-lookup.py once with all unique IPs on stdin
if [[ ${#unique_ips[@]} -gt 0 ]]; then
    asn_json=$(printf '%s\n' "${unique_ips[@]}" | python3 /etc/asn-lookup.py 2>/dev/null || true)
    # Parse JSON with Python into key=value lines for bash eval
    if [[ -n "${asn_json}" ]]; then
        while IFS='=' read -r ip org; do
            org_map["${ip}"]="${org}"
        done < <(python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
for ip, info in data.items():
    asn = info.get('asn', '')
    org = info.get('org', '-')
    label = f'{org} (AS{asn})' if asn else '-'
    print(f'{ip}={label}')
" <<< "${asn_json}" 2>/dev/null || true)
    fi
fi
# Lookup: org_map["${dst_ip}"] or "-" if key absent
```

**Alternative (simpler):** Have `asn-lookup.py` emit one `IP TAB org_label` line per IP when called with `--flat` flag, removing the need to parse JSON in bash entirely.

### Anti-Patterns to Avoid

- **Individual per-IP Cymru queries in a loop:** Team Cymru null-routes abusive single-query clients. Always batch all IPs into one TCP session. [CITED: https://www.team-cymru.com/ip-asn-mapping]
- **Blocking watch-routes.py stream on network I/O:** Any synchronous socket call inside `format_line()` will freeze the live tail. Use background thread or subprocess with timeout.
- **Truncating cache file on write:** A crash mid-write leaves a corrupt JSON file. Always write to tmpfile + os.replace(). [ASSUMED: standard practice]
- **Parsing JSON with bash string manipulation:** Use Python for JSON parsing. jq may not be present on the RPi. [VERIFIED: no jq in any existing project script]
- **Hardcoding `/tmp/vpn-asn-cache.json`** only in `asn-lookup.py`: the path should be a module-level constant (or env var override) so tests can redirect it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TCP socket line-by-line reading | Custom buffer/split logic | `socket.makefile("rb")` | Returns file-like object; `for line in f:` handles buffering correctly |
| Atomic file write | Manual write-then-rename with open() | `tempfile.mkstemp()` + `os.replace()` | mkstemp creates file in correct dir; os.replace is atomic on Linux |
| JSON parsing in bash | `sed`/`awk` string extraction from JSON | `python3 -c "import json, sys; ..."` | jq absent; sed/awk fragile on nested JSON |
| Background thread dict access | Manual flag variable | `threading.Lock()` + dict | Prevents race on shared `_asn_cache` dict |

**Key insight:** The Team Cymru protocol is simple enough that no library is needed — but the TCP socket reading, atomic cache write, and thread-safe dict access each have stdlib primitives that must be used correctly to avoid subtle data corruption bugs.

---

## Common Pitfalls

### Pitfall 1: Skipping the Cymru Response Header Line
**What goes wrong:** First line from Cymru is `Bulk mode; whois.cymru.com [2026-05-23 ...]` — not a data row. Parsing it as a data row produces a garbled result dict.
**Why it happens:** Line-by-line iteration starts immediately after EOF detection.
**How to avoid:** Skip lines starting with `"Bulk mode"` or that don't contain `"|"` as separator.
**Warning signs:** First result in org_map has `asn="Bulk mode"`.

### Pitfall 2: Pipe Separator Has Leading/Trailing Spaces
**What goes wrong:** `line.split("|")` produces `[" 15169 ", " 8.8.8.8 ", ...]` — IPs in the result dict don't match raw IPs from iptables logs.
**Why it happens:** Cymru formats columns with padding spaces.
**How to avoid:** Strip all parts: `parts = [p.strip() for p in line.split("|")]`.
**Warning signs:** `org_map` always returns `-` even for Google/Apple IPs.

### Pitfall 3: Socket Timeout Leaves Connection Hanging
**What goes wrong:** If Cymru is unreachable, `s.connect()` or `f.read()` blocks indefinitely.
**Why it happens:** Default socket timeout is None (blocking forever).
**How to avoid:** Always call `s.settimeout(10.0)` before `connect()`. Wrap in `try/except (socket.timeout, OSError)`.
**Warning signs:** `vpn-status.sh` hangs for 30+ seconds.

### Pitfall 4: Cache File Written with Wrong Permissions
**What goes wrong:** `asn-lookup.py` run as non-root cannot write to `/tmp/vpn-asn-cache.json` if it was previously created by root.
**Why it happens:** `vpn-status.sh` runs as root (sudo); `watch-routes.py` may run as non-root; both call `asn-lookup.py`.
**How to avoid:** Create cache with mode 0o666 (`os.chmod(CACHE_FILE, 0o666)` after first write) so both root and non-root can update it.
**Warning signs:** `PermissionError` in asn-lookup.py stderr.

### Pitfall 5: Bash Associative Array Requires `declare -A` Before Use
**What goes wrong:** `org_map["${ip}"]="${org}"` silently fails if `declare -A org_map` is not called first; bash treats it as an indexed array with string key "0".
**Why it happens:** Bash 4+ requires explicit declaration of associative arrays.
**How to avoid:** `declare -A org_map` at top of the script, before the entries loop.
**Warning signs:** All entries show `-` for ORG despite valid JSON from asn-lookup.py.

### Pitfall 6: vpn-status.sh Passes IPs After --via Filter
**What goes wrong:** Calling asn-lookup.py only on visible (post-filter) IPs wastes cache hits when filter is active; calling it before filter queries more IPs but ensures cache is warm for future invocations.
**Why it happens:** Filtering happens at output time (Phase 5 D-10); IP collection and org lookup should happen on the full entries array.
**How to avoid:** Collect all DST IPs from `entries[]` before the `--via` / `--filter` check, so the Cymru call and cache write happen on the full set.

### Pitfall 7: deploy.sh TOTAL_STAGES Off-By-One
**What goes wrong:** Adding Stage 24 without incrementing `TOTAL_STAGES=23` to `TOTAL_STAGES=24` causes `[24/23]` in output, which looks wrong.
**Why it happens:** TOTAL_STAGES is a constant set at the top of deploy.sh; new stages don't auto-update it.
**How to avoid:** Change `TOTAL_STAGES=23` → `TOTAL_STAGES=24` and add Stage 24 variable declarations to the top block.

### Pitfall 8: watch-routes.py Import vs Subprocess Ambiguity
**What goes wrong:** Importing `asn-lookup` as a module fails because the filename has a hyphen (`asn-lookup.py`), which is not a valid Python identifier for import.
**Why it happens:** Python module names cannot contain hyphens.
**How to avoid:** Either rename to `asn_lookup.py` (underscore), or always call via `subprocess`. CONTEXT.md D-04 says "calls via subprocess or imports directly" — if hyphen name is kept, subprocess is the only option.
**Warning signs:** `import asn-lookup` raises `SyntaxError`.
**Recommendation:** Keep `asn-lookup.py` (hyphenated, consistent with other scripts) and call exclusively via subprocess in both `vpn-status.sh` and `watch-routes.py`.

---

## Code Examples

### Reading IPs from stdin in asn-lookup.py

```python
# Source: Python stdlib sys.stdin — standard pattern [ASSUMED: training knowledge]
import sys

def main() -> None:
    ips = [line.strip() for line in sys.stdin if line.strip()]
    # ... lookup and print JSON
    import json
    result = lookup_ips(ips)
    print(json.dumps(result))

if __name__ == "__main__":
    main()
```

### --summary aggregation in vpn-status.sh

```bash
# Source: bash associative array counting pattern [ASSUMED: training knowledge]
if [[ "${SUMMARY}" == "true" ]]; then
    declare -A vpn_count isp_count
    for entry in "${entries[@]}"; do
        IFS='|' read -r ts src_ip dst_ip domain decision org <<< "${entry}"
        org_key="${org:-unknown}"
        if [[ "${decision}" == "VPN" ]]; then
            vpn_count["${org_key}"]=$(( ${vpn_count["${org_key}"]:-0} + 1 ))
        else
            isp_count["${org_key}"]=$(( ${isp_count["${org_key}"]:-0} + 1 ))
        fi
    done
    # Sort and print top N — requires collecting totals into a sortable form
    # Use python3 for sort since bash arrays can't be sorted by value
fi
```

**Note:** The `--summary` sort step is easiest with a small inline `python3 -c` call that reads the collected counts from stdin (bash associative arrays → python3 dict sort). This avoids needing `sort -t` on associative array data. Planner should specify the exact mechanism.

### Appending org to watch-routes.py format_line()

```python
# Existing format_line() return — add org lookup at end
# Source: existing watch-routes.py line 72 pattern + [ASSUMED: threading approach]
def format_line(ts, tag, src, dst, proto, dpt, no_dns, asn_cache=None):
    hostname = resolve(dst, no_dns)
    ...
    line = f"{ts} [{tag}] {src} → {dst_part} {port_part}"
    if asn_cache is not None:
        org_info = asn_cache.get(dst)
        if org_info and org_info.get("org"):
            line += f" | {org_info['org']}"
    return line
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Per-IP DNS-only enrichment | Batch TCP ASN lookup via Team Cymru | ASN/org not available from DNS; Cymru is the BGP-native source |
| In-memory DNS cache only | File-backed ASN cache | Survives across invocations; no repeat queries for stable IPs |

**Deprecated/outdated:**
- Individual whois queries per IP: Team Cymru documents this as abuse-triggering; batch is the correct approach.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Deployed path for asn-lookup.py is `/etc/asn-lookup.py` | Architecture Patterns | Wrong path in deploy.sh + callers; easy to fix if planner chooses differently |
| A2 | `jq` not available on RPi Debian minimal | Don't Hand-Roll, Anti-Patterns | If jq is present, simpler bash JSON parsing is possible; stdlib Python approach still works |
| A3 | Background thread is the right approach for watch-routes.py | Architecture Patterns, Pattern 3 | Subprocess-with-timeout may be simpler; planner should decide |
| A4 | `os.replace()` is atomic on RPi Linux tmpfs | Pattern 2 | tmpfs rename atomicity is standard POSIX — highly unlikely to be wrong |
| A5 | Python 3 is installed on RPi Debian (as `python3`) | Environment Availability | RPi OS Lite ships Python 3.11 by default since Bookworm; confirmed by existing watch-routes.py deploy |

---

## Open Questions

1. **Subprocess vs direct import in watch-routes.py**
   - What we know: hyphenated filename prevents `import`; subprocess works but adds process overhead per lookup event
   - What's unclear: whether subprocess-per-lookup or a persistent subprocess with stdin pipe is preferred
   - Recommendation: Use a subprocess call with `communicate()` per batch (not per-line), or inline the Cymru logic directly into watch-routes.py as a second module-level function. Planner should decide.

2. **--summary sort mechanism**
   - What we know: bash associative arrays cannot be sorted by value; Python is present
   - What's unclear: whether to use inline `python3 -c` in the `--summary` branch or a separate function
   - Recommendation: inline `python3 -c` to sort and print the summary table; keeps vpn-status.sh self-contained.

3. **Cache file permissions on RPi**
   - What we know: vpn-status.sh runs as root; watch-routes.py may run as root or non-root
   - What's unclear: which user runs watch-routes.py in practice
   - Recommendation: write cache with mode 0o666 after creation so both root and non-root invocations can update it.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| python3 | asn-lookup.py, vpn-status.sh (subprocess), watch-routes.py | ✓ (macOS dev) | 3.14.3 | RPi Debian Bookworm ships Python 3.11 — confirmed by existing watch-routes.py |
| ssh / scp | deploy.sh Stage 24 | ✓ | OpenSSH 9.9p2 | — (already used by all prior stages) |
| whois.cymru.com:43 | asn-lookup.py (runtime, RPi) | Cannot test from macOS | — | Graceful: empty result if unreachable; ORG shows `-` |
| /tmp filesystem on RPi | Cache file | ✓ (tmpfs standard) | — | If /tmp absent: asn-lookup.py degrades to no-cache mode |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- `whois.cymru.com:43` reachability: if unreachable at runtime, asn-lookup.py returns empty dict and callers show `-` for all ORG values. This is the documented graceful degradation path (D-06, D-08).

---

## Sources

### Primary (HIGH confidence)
- [Team Cymru IP-ASN Mapping](https://www.team-cymru.com/ip-asn-mapping) — official protocol documentation: bulk TCP query format, response field order, abuse policy
- [python-cymruwhois (JustinAzoff)](https://github.com/JustinAzoff/python-cymruwhois/blob/master/cymruwhois.py) — reference Python implementation; confirmed socket.makefile pattern, field parsing
- [cymru-asnmap (0xc0da)](https://github.com/0xc0da/cymru-asnmap/blob/master/cymru-asnmap.py) — confirmed `begin\nverbose\n...\nend\n` wire format; pipe-delimited response; header skip

### Secondary (MEDIUM confidence)
- Python 3 stdlib docs (subprocess, socket, json, os, tempfile, threading) — via direct Python import verification on Python 3.14.3
- Existing project scripts — `vpn-status.sh`, `watch-routes.py`, `deploy.sh` — read fully; integration points extracted directly from source

### Tertiary (LOW confidence)
- Standard atomic-write pattern (`tempfile.mkstemp` + `os.replace`) — training knowledge; POSIX semantics are stable

---

## Metadata

**Confidence breakdown:**
- Team Cymru protocol (wire format, field positions): HIGH — confirmed by official docs + two independent implementations
- Python stdlib patterns (socket, json, threading): HIGH — verified via import on local Python
- Integration points in vpn-status.sh / watch-routes.py: HIGH — read source code directly
- deploy.sh stage numbering: HIGH — read deploy.sh source directly (TOTAL_STAGES=23, Stage 23 is last)
- Background threading approach: MEDIUM — training knowledge + stdlib confirmation; planner may choose subprocess instead

**Research date:** 2026-05-23
**Valid until:** 2026-07-23 (Team Cymru protocol is stable; Python stdlib is stable)
