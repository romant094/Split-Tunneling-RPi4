# Phase 7: ASN Enrichment & Traffic Attribution - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-23
**Phase:** 07-asn-enrichment-traffic-attribution
**Areas discussed:** ASN data source, Integration target, Attribution output format

---

## ASN Data Source

### Question 1: Primary data source

| Option | Description | Selected |
|--------|-------------|----------|
| ip-api.com (online, free) | HTTP call per IP, rate-limited at 45 req/min | |
| MaxMind GeoLite2 (local MMDB) | Download once, query locally, no rate limits, requires license | |
| Team Cymru bulk whois (free, no key) | Batch TCP query to whois.cymru.com — free, no signup, handles batches | ✓ |

**User's choice:** Team Cymru
**Notes:** User asked about comparing all three sources for reliability cross-check. Explained that all three use the same underlying BGP data — differences are purely operational (rate limits, privacy, setup). User then chose Cymru for zero-setup simplicity.

User also asked how Cymru's bulk whois works (was unfamiliar). Explained: TCP to whois.cymru.com:43, send `begin\nverbose\n<ips>\nend\n`, get back ASN | IP | Prefix | CC | Registry | Allocated | AS Name per line.

---

### Question 2: Caching strategy

| Option | Description | Selected |
|--------|-------------|----------|
| File cache on RPi | Write IP→ASN mappings to /tmp/vpn-asn-cache.json, persist across calls | ✓ |
| In-memory only | Cache within one script invocation only, re-query each run | |
| You decide | Let Claude pick | |

**User's choice:** File cache on RPi
**Notes:** No TTL — ASN assignments change rarely.

---

## Integration Target

### Question 1: Which tools get enriched

| Option | Description | Selected |
|--------|-------------|----------|
| Both vpn-status.sh and watch-routes.py | Consistent experience across both tools | ✓ |
| vpn-status.sh only | Simpler, watch-routes.py stays lightweight | |
| watch-routes.py only | Real-time stream only | |

**User's choice:** Both tools

---

### Question 2: Shared implementation

| Option | Description | Selected |
|--------|-------------|----------|
| Python helper script called by both | scripts/asn-lookup.py, stdlib only, single implementation | ✓ |
| Duplicate logic (bash + python) | Implement Cymru client twice | |
| Bash helper called via subprocess from Python | Keep everything bash | |

**User's choice:** Python helper `scripts/asn-lookup.py`
**Notes:** Follows existing stdlib-only constraint from watch-routes.py.

---

## Attribution Output Format

### Question 1: vpn-status.sh table format

| Option | Description | Selected |
|--------|-------------|----------|
| New ORG column in the table | Add after DOMAIN column, e.g. "Apple Inc. (AS714)" | ✓ |
| Inline with domain | Show as "hostname [Org/ASN]" in DOMAIN column | |
| You decide | Let Claude pick | |

**User's choice:** New ORG column

---

### Question 2: Summary/aggregate mode

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — add --summary flag | Top N orgs ranked by connection count, VPN/ISP split | ✓ |
| No — ORG column is enough | Per-connection enrichment only | |
| You decide | Let Claude decide | |

**User's choice:** Add `--summary` flag
**Notes:** This is the "Traffic Attribution" part of the phase name — answers "where does my traffic actually go?" at org level.

---

### Question 3: watch-routes.py format

| Option | Description | Selected |
|--------|-------------|----------|
| Append org name to existing line | Add " | Apple Inc." at end of each line | ✓ |
| New column with fixed width | Reformat output with fixed-width ORG column | |
| You decide | Let Claude pick | |

**User's choice:** Append ` | {org}` at end of line
**Notes:** Minimal change, stays readable, doesn't break existing output format.

---

## Claude's Discretion

- Exact deployed path for `asn-lookup.py` on RPi
- Default number of items in `--summary` mode (top 10 or 20)
- Whether `watch-routes.py` does ASN lookups in a background thread
- How `vpn-status.sh` batches IPs for the Cymru call
- Whether `asn-lookup.py` has standalone CLI mode for testing

## Deferred Ideas

- None — discussion stayed within phase scope
