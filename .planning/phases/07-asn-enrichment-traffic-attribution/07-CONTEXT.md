# Phase 7: ASN Enrichment & Traffic Attribution - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Enrich existing traffic visibility tools with ISP/org attribution by mapping destination IPs to ASN + org name via Team Cymru bulk whois. 

Deliverables:
1. **`scripts/asn-lookup.py`** — shared Python helper (stdlib only): reads IPs from stdin, returns `{ip: {asn, org}}` JSON; uses file cache at `/tmp/vpn-asn-cache.json`; batch TCP call to `whois.cymru.com:43`
2. **`scripts/vpn-status.sh`** extended — new `ORG` column in output table; new `--summary` flag for aggregate "top orgs by connection count" view
3. **`scripts/watch-routes.py`** extended — org name appended inline to each output line
4. **`deploy.sh`** extended — new stage(s) to deploy `asn-lookup.py` to RPi

Phase ends when: `vpn-status.sh` shows ORG column and `--summary` mode; `watch-routes.py` appends org name per line; `asn-lookup.py` deployed on RPi; file cache works across invocations.

</domain>

<decisions>
## Implementation Decisions

### ASN Data Source
- **D-01:** Team Cymru bulk whois — batch TCP to `whois.cymru.com:43`. Format: send `begin\nverbose\n<ip1>\n<ip2>\nend\n`, receive tab-separated ASN | IP | prefix | CC | registry | allocated | AS Name.
- **D-02:** File-based persistent cache at `/tmp/vpn-asn-cache.json` on RPi. Cache format: `{ip: {asn: "15169", org: "GOOGLE"}}`. No TTL — ASN assignments change rarely; cache grows indefinitely (fine for home gateway use).

### Integration Target
- **D-03:** Both `vpn-status.sh` and `watch-routes.py` get ASN enrichment.
- **D-04:** Shared Python helper `scripts/asn-lookup.py` — stdlib only (socket, json). Single implementation of Cymru client + file cache. `vpn-status.sh` calls it via subprocess (passes collected IPs on stdin, parses JSON output). `watch-routes.py` calls it via subprocess or imports directly.
- **D-05:** `asn-lookup.py` deployed to RPi (path TBD by planner — likely `/etc/asn-lookup.py` or alongside other scripts). New `deploy.sh` stage added.

### Output Format
- **D-06:** `vpn-status.sh` — new `ORG` column added after `DOMAIN`. Column value: `{org} (AS{asn})`, e.g. `Apple Inc. (AS714)`. If lookup fails or IP not in cache and Cymru unreachable: show `-`.
- **D-07:** `vpn-status.sh --summary` — new flag showing aggregate view: top N orgs ranked by connection count, split by VPN/ISP path. Output format TBD by planner (table with ORG | VPN_COUNT | ISP_COUNT | TOTAL).
- **D-08:** `watch-routes.py` — append ` | {org}` at end of each output line. Example: `2026-05-21T11:36 [VPN] 192.168.1.175 → 17.248.209.64 (albert.apple.com) TCP:443 | Apple Inc.`. If lookup fails: omit the ` | org` suffix (don't break stream).

### Python / stdlib Constraint
- **D-09:** `asn-lookup.py` uses stdlib only — no pip dependencies. Matches existing `watch-routes.py` pattern. Required for RPi where pip may not be available / not desirable.

### Claude's Discretion
- Exact deployed path for `asn-lookup.py` on RPi (`/etc/asn-lookup.py` vs `/usr/local/bin/asn-lookup` vs alongside `/etc/vpn-status.sh`)
- Number of items shown in `--summary` mode (default top 10 or top 20)
- Whether `watch-routes.py` does ASN lookups in a background thread to avoid blocking the real-time stream
- How `vpn-status.sh` passes IPs to `asn-lookup.py` (all unique DST IPs at once, then join results)
- Whether `asn-lookup.py` has its own `--help` and direct CLI mode (run standalone to test lookups)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Tools to Extend
- `scripts/vpn-status.sh` — read fully before modifying; note argument parsing pattern, entries array, output printf format, existing columns
- `scripts/watch-routes.py` — read fully before modifying; note `_dns_cache` pattern (file cache follows same shape), `format_line()` function (where org name is appended), `_LOG_RE` regex
- `configs/dnsmasq.conf` — context for Phase 4 domain resolution (not directly modified in Phase 7)

### Deploy Infrastructure
- `deploy.sh` — read Stages 17–22 for pattern: SCP to `/tmp`, `sudo mv`, `sudo chmod +x`. New stage follows same pattern.
- `.env` — check if any new env vars are needed (e.g. `ASN_CACHE_FILE` path or Cymru host override)

### Project Constraints
- `CLAUDE.md` §Constraints — RPi arm64, stdlib-only Python, idempotent scripts, secrets never in repo
- `.planning/STATE.md` §Decisions — D-series decisions from prior phases (especially D-09 re stdlib, deploy patterns)

### Team Cymru Whois Protocol
- No external doc URL — protocol is: TCP to `whois.cymru.com:43`, send `begin\nverbose\n{ip}\n...\nend\n`, read response lines until EOF. Response format: `AS | IP | Prefix | CC | Registry | Allocated | AS Name`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `watch-routes.py` `_dns_cache: dict[str, str]` — same in-memory cache pattern applies to ASN cache; `asn-lookup.py` extends to file-backed version
- `vpn-status.sh` entries array with `|`-delimited fields — new ORG field appended as 6th field `${ts}|${src_ip}|${dst_ip}|${display_domain}|${decision}|${org}`
- `watch-routes.py` `format_line()` — append ` | {org}` here after existing return value

### Established Patterns
- stdlib-only Python (watch-routes.py uses no imports beyond stdlib)
- Deploy pattern: `SCP /tmp/ → sudo mv → sudo chmod +x` (all scripts follow this)
- `set -euo pipefail` + `source /etc/vpn-gateway.env` in bash scripts
- Argument parsing in vpn-status.sh: `case "${arg}" in --flag=*) val=${arg#--flag=} ;;` pattern

### Integration Points
- `vpn-status.sh` line 161: entries array append — add ORG as 6th field after DST-IP lookup
- `vpn-status.sh` line 166–176: output printf — add ORG column to header and data rows
- `watch-routes.py` line 72: `format_line()` return — append ` | {org}` from asn_cache lookup
- `deploy.sh` after Stage 21 (exception file) — add Stage 23 for asn-lookup.py deploy

</code_context>

<specifics>
## Specific Ideas

- User asked about comparing multiple ASN sources for reliability — decided against (same BGP data, operational tradeoffs only); Team Cymru chosen for zero-setup simplicity
- "Attribution" in phase name specifically means the `--summary` aggregate view — "where does my traffic actually go?" answered at org level

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-asn-enrichment-traffic-attribution*
*Context gathered: 2026-05-23*
