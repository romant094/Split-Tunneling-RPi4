---
phase: 16-web-admin-ux-upgrade
plan: 01
subsystem: web-admin-backend
tags: [flask, auth, diagnostics, backup]
requires: []
provides:
  - "/api/auth/check"
  - "/api/routes/backup"
  - "/api/diag/whois"
  - "/api/diag/traceroute"
  - "/api/diag/route-match"
affects:
  - src/admin (Wave 2/3 frontend plans consume these endpoints)
tech-stack:
  added: []
  patterns:
    - "subprocess.run with arg lists (never shell=True) for all new user-input-driven subprocess calls"
    - "IP_RE bare-IP validation distinct from existing CIDR_RE"
key-files:
  created: []
  modified:
    - src/scripts/splitgate-admin.py
decisions:
  - "D-01: sg_session cookie gains max_age=60*60*24*30 (30 days) so it survives browser restarts (Phase 15 D-09 cookie had no expiry)"
  - "D-08: whois/ASN lookups reuse src/scripts/asn-lookup.py via subprocess (python3 <script> <ip>) — no new whois client or pip dependency"
  - "D-09: /api/diag/whois and (future) Add Route auto-org-lookup share the single lookup_org() helper — no duplicated lookup logic"
metrics:
  duration: "~15 minutes"
  completed: 2026-07-13
---

# Phase 16 Plan 01: Web Admin Backend Extensions Summary

Extended `splitgate-admin.py` with 5 new endpoints (auth-check, routes-backup, diag-whois, diag-traceroute, diag-route-match) plus a 30-day Max-Age fix on the session cookie — closing the UI-AUTH persistence bug and laying the server-side contract for Wave 2/3 frontend plans.

## What Was Built

**Task 1 — UI-AUTH backend:**
- `GET /api/auth/check` — unauthenticated-challenge-free endpoint; reads `sg_session` cookie, checks membership in in-memory `_sessions` set, returns `{"authenticated": true}` (200) or `{"authenticated": false}` (401). Deliberately does NOT use `@require_auth` and never emits `WWW-Authenticate` (Phase 15 anti-pattern — breaks custom login UX).
- `require_auth`'s `resp.set_cookie(...)` call now passes `max_age=60*60*24*30` (30 days), fixing the root cause of "still prompted every visit" (Phase 15 D-09 cookie had no expiry — it died when the browser process fully closed).
- Documented in-code that `_sessions` is in-memory and resets on `splitgate-admin.service` restart (Pitfall 5) — this endpoint reports current validity only.

**Task 2 — UI-BACKUP backend:**
- `GET /api/routes/backup` (authenticated) returns a `text/plain` attachment (`Content-Disposition: attachment; filename=splitgate-routes-backup-<date>.txt`) concatenating VPN custom routes then ISP custom routes, each formatted as `cidr # description` (or bare `cidr` when no description exists).

**Task 3 — UI-DIAG backend:**
- Added module-level `IP_RE` (bare-IP validation, distinct from `CIDR_RE`) and `ipaddress` import.
- `lookup_org(ip)` helper: subprocess-invokes `python3 /etc/splitgate/asn-lookup.py <ip>`, parses the single-line JSON `{ip: {asn, org}}` stdout, returns the per-IP dict or `None` on timeout/decode/missing-file errors. `timeout=12`.
- `GET /api/diag/whois?ip=<ip>` — validates `ip` against `IP_RE` (400 on failure), returns `lookup_org(ip)` result (or `{}`).
- `GET /api/diag/traceroute?target=<ip>` — validates `target` against `IP_RE` (400 on failure), runs `subprocess.run(['traceroute', '-n', '-w', '2', '-m', '15', target], ...)` as an argument list (never `shell=True`), `timeout=60`. Returns 503 if `traceroute` binary is missing (it is not installed on the RPi by default — apt install lands in a later plan per RESEARCH).
- `GET /api/diag/route-match?ip=<ip>` — validates `ip`, delegates to `check_route_decision(ip)`, which replicates `routing.sh`'s precedence: `vpn-routes-custom.txt` (VPN) > `isp-routes-custom.txt` (ISP) > `white-list.txt` (ISP, RU subnet) > default (VPN, `matched_by: "default route (dev awg0)"`, `cidr: null`). Each CIDR-vs-IP membership check is wrapped in try/except `ValueError` to tolerate malformed hand-edited entries in the route files.

## Deviations from Plan

None — plan executed exactly as written. All three tasks' acceptance criteria were verified via the exact grep/AST commands specified in each task's `<verify>` block, all passing.

## Verification Results

```
python3 -c "import ast; ast.parse(open('src/scripts/splitgate-admin.py').read())"  → parses OK
grep -c "def api_auth_check" src/scripts/splitgate-admin.py                        → 1
grep -c "max_age=60\*60\*24\*30" src/scripts/splitgate-admin.py                    → 1
grep -c "WWW-Authenticate" src/scripts/splitgate-admin.py                         → 0
grep -c "def api_routes_backup" src/scripts/splitgate-admin.py                     → 1
grep -c "splitgate-routes-backup-" src/scripts/splitgate-admin.py                 → 1
grep -c "def api_diag_route_match\|def check_route_decision"                      → 2
grep -c "shell=True" src/scripts/splitgate-admin.py                               → 0
grep -c "ipaddress.ip_network" src/scripts/splitgate-admin.py                      → 3
```

All 5 new routes present: `/api/auth/check`, `/api/routes/backup`, `/api/diag/whois`, `/api/diag/traceroute`, `/api/diag/route-match`.

## Threat Model Compliance

- T-16-01 (command injection): all subprocess calls with user input use argument lists; zero `shell=True` in the file.
- T-16-02 (information disclosure): all new endpoints except `/api/auth/check` are behind `@require_auth`; `/api/auth/check` returns no secret data.
- T-16-04 (DoS): traceroute bounded via `-w 2 -m 15` flags plus `timeout=60` on `subprocess.run`.
- T-16-SC: no new npm/pip packages added — confirmed by RESEARCH's Package Legitimacy Audit (none recommended) and by this plan's implementation (subprocess reuse of existing `asn-lookup.py` only).

## Known Stubs

None. All 5 endpoints are fully implemented with real file/subprocess logic — no placeholder/mock data paths introduced. (Note: the `traceroute` system binary itself is not yet installed on the RPi — that apt-get stage is explicitly deferred to a later plan per RESEARCH; the endpoint correctly returns 503 in that case rather than silently stubbing output.)

## Threat Flags

None — all new surface (5 endpoints) was explicitly anticipated and dispositioned in this plan's `<threat_model>` block (T-16-01 through T-16-04, T-16-SC). No undocumented new attack surface was introduced.

## Self-Check: PASSED

- FOUND: src/scripts/splitgate-admin.py (modified, contains all 5 new endpoints)
- FOUND: commit 04c709c (Task 1 — auth/check + Max-Age cookie)
- FOUND: commit 650102e (Task 2 — routes/backup)
- FOUND: commit 2740ff8 (Task 3 — diag whois/traceroute/route-match)
