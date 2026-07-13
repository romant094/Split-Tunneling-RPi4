# Phase 16: Web Admin UX Upgrade - Context

**Gathered:** 2026-07-13

<domain>
## Phase Boundary

Upgrade the existing Web Admin Interface (Phase 15) for daily usability: Logs page dedupe/context-menu/batch-exceptions, persistent auth sessions, Resources progress bars, a new Diagnostics page (whois/ASN/traceroute/route-match check), Add Route auto-org-lookup, route list backup/export, and non-destructive deploy.sh redeploys.

</domain>

<decisions>
## Implementation Decisions

### Auth Session (UI-AUTH)
- **D-01:** This is a bug fix, not new design — Phase 15 D-09 already specifies a `sg_session` HttpOnly cookie meant to persist auth across page loads. User reports still being prompted every visit. Investigate why the cookie isn't persisting (missing `Max-Age`/`Expires`, `SameSite` issue, cookie not set on all routes, or session validation logic) and fix root cause.

### Logs Dedupe (UI-LOGS)
- **D-02:** Duplicate = same line content **after** stripping the leading timestamp and `[VPN]`/`[ISP]` tag — i.e. compare on `IP → IP (hostname) TCP:port | ORG` substring, not full line.
- **D-03:** "Hide duplicates" hides **all** matching lines currently rendered on screen (not just consecutive/adjacent repeats) — collapse to one visible instance of each unique content signature within the current view.
- **D-04:** Toggle behavior (checkbox/filter), not permanent transform — raw log data unaffected, only display filtering.

### Context Menu / Batch Route Add (UI-LOGS, UI-ADDROUTE)
- **D-05:** "Add route to ISP/VPN" from context menu or batch-selection goes into a **pending changes list**, matching the existing Routes page pattern (D-... in Phase 15: edit CIDR lists → Apply → `routing.sh --no-update`). No direct-to-file writes from Logs page.
- **D-06:** Pending changes must be previewed in a **git-diff-style view** before Apply: additions shown on top in green, removals shown below in red, using standard diff coloring. If one side is empty (e.g., only additions, no removals), that block is omitted entirely — don't render an empty section.
- **D-07:** This diff preview applies both to normal Routes-page edits and to batch adds sourced from Logs page context menu / multi-select — same pending+diff+Apply flow either way.

### Diagnostics Page & Add Route Lookup (UI-DIAG, UI-ADDROUTE)
- **D-08:** Reuse `src/scripts/asn-lookup.py` (built in Phase 7) for whois/ASN/org lookups — stdlib-only Python, file-backed cache, Team Cymru bulk whois, graceful degradation on network failure. Do not introduce a new whois client or add a `whois` package dependency on the RPi.
- **D-09:** Add Route form's auto-org-lookup (pre-filling the CIDR comment) and the Diagnostics page's IP/ASN lookup both call into `asn-lookup.py` (or a shared helper wrapping it) rather than duplicating lookup logic.
- **D-10 (open — resolve in planning/research):** Diagnostics traceroute mechanism on RPi (needs raw socket / ICMP privileges — Flask already runs as root per Phase 15 D-11, so subprocess to system `traceroute`/`tracepath` is viable; confirm binary availability on target Debian/Raspbian image during research).

</decisions>

<deferred>
## Deferred Ideas

- Resources refresh interval change (1s vs current 5s) — flagged as a perf trade-off to evaluate during planning/research, not a locked decision; default to keeping current SSE cadence unless research shows negligible cost.
- Multi-user auth / RBAC — out of scope, single shared secret remains sufficient (carried forward from Phase 15).

</deferred>

<canonical_refs>
## Canonical References

- `.planning/phases/15-web-admin-interface/15-CONTEXT.md` — prior Web Admin decisions (auth cookie design D-09, Routes page pending+Apply pattern, SSE architecture, file/route inventory)
- `src/scripts/asn-lookup.py` — existing ASN/org lookup helper (Phase 7) to reuse for UI-DIAG and UI-ADDROUTE
- `src/scripts/splitgate-admin.py` — Flask backend to extend with new endpoints (diagnostics, route diff preview, session fix)
- `src/admin/src/pages/Routes.jsx` — existing pending+Apply CIDR pattern to extend with diff-preview UI and to receive batch adds from Logs
- `src/admin/src/pages/Logs.jsx` — Logs page to extend with dedupe filter, hover highlight, context menu, multi-select

</canonical_refs>

---

*Phase: 16-web-admin-ux-upgrade*
*Context gathered: 2026-07-13*
