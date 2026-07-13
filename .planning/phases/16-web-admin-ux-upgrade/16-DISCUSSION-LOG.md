# Phase 16: Web Admin UX Upgrade - Discussion Log

**Date:** 2026-07-13

## Areas Discussed

### Log Dedupe
- **Options presented:** compare full line vs strip timestamp+tag, consecutive-only vs all-visible, collapse-with-counter vs plain hide.
- **Selection:** Compare on content after stripping timestamp + `[VPN]`/`[ISP]` tag (IP → IP (hostname) TCP:port | ORG). Hide ALL matching lines currently on screen, not just consecutive ones.

### Context Menu / Batch Route Add
- **Options presented:** pending-list+Apply (matches current Routes page) vs direct-write+auto-apply.
- **Selection:** Pending list + Apply. Additional requirement raised: diff-style preview before Apply — additions on top (green), removals below (red), empty sections omitted. User attached a screenshot as visual reference for the diff coloring convention (unrelated PowerShell script diff, used only to illustrate the add/remove color pattern).

### Diagnostics / Add Route Lookup Source
- **Options presented:** reuse `asn-lookup.py` (Phase 7) vs new system `whois` client via subprocess.
- **Selection:** Reuse `asn-lookup.py`.

## Deferred Ideas
- Resources SSE refresh interval (1s vs current cadence) — perf trade-off noted, not decided; left for research/planning.

## Claude's Discretion
- Auth session issue framed as a bug fix against Phase 15 D-09 design intent, not a new feature — root cause to be found during research/execution.
- Traceroute mechanism on RPi (subprocess to system binary, root-Flask) flagged as an open item for research to confirm binary availability.

---

*Phase: 16-web-admin-ux-upgrade*
