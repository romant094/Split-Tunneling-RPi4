# Phase 16: Web Admin UX Upgrade - Research

**Researched:** 2026-07-13
**Domain:** Flask backend extension + React SPA extension (auth bug fix, log filtering UX, whois/ASN/traceroute diagnostics, route diff-preview, deploy idempotency)
**Confidence:** HIGH

## Summary

This phase extends the existing Phase 15 Web Admin (Flask + React SPA on the RPi) rather than introducing new frameworks. Every requirement maps to code already read in full: `src/scripts/splitgate-admin.py` (Flask backend), `src/admin/src/pages/Routes.jsx` and `Logs.jsx` (React), `src/scripts/asn-lookup.py` (Phase 7 whois helper), and `src/deploy.sh` / `src/deploy-admin.sh` (deploy scripts).

The UI-AUTH bug has a confirmed root cause: the backend cookie mechanism (Phase 15 D-09) works correctly, but the **frontend never uses it**. `src/admin/src/api.js` stores credentials in `sessionStorage` and sends `Authorization: Basic ...` on every single request via `getAuthHeader()`, and `sessionStorage` itself does not persist across browser restarts/new tabs by design. The `sg_session` cookie is set by the backend on every successful Basic-Auth request but is never actually relied upon by the frontend to skip re-sending credentials — and since `sessionStorage` is cleared when the tab/window closes, the user is re-prompted. Fix is entirely client-side (and one small backend gap): stop keying persistence off `sessionStorage`, rely on the httponly cookie's presence via a lightweight `/api/auth/check` probe, and extend cookie lifetime with `Max-Age`.

UI-DIAG traceroute requires installing the `traceroute` apt package on the RPi (confirmed NOT present by default on Debian bookworm/Raspberry Pi OS) — deploy.sh needs a new stage mirroring the existing dnsmasq install-then-configure pattern (Stage 18). `whois` CLI is unlikely to be present either and is explicitly NOT to be used per CONTEXT D-08 (reuse `asn-lookup.py` instead). The route-match checker requires re-implementing routing.sh's decision precedence in Python (vpn-routes-custom > isp-routes-custom > ru-list-exclude > default-VPN) — this is pure Python logic against the same three files, no subprocess needed.

The diff-preview UI (UI-LOGS D-06/D-07) does not need a new npm dependency — the underlying data is a flat list of CIDR add/remove operations, not text; a trivial JS set-difference against `existingCidrs` (already computed in `Routes.jsx`) produces the additions/removals arrays needed for git-diff-style rendering with plain Tailwind classes.

**Primary recommendation:** Fix UI-AUTH by removing `sessionStorage`-keyed Basic Auth reliance from `api.js` in favor of the existing httponly cookie + a `/api/auth/check` endpoint; extend `asn-lookup.py`'s existing `lookup_ips()` function via subprocess invocation from Flask (not import, to avoid coupling backend startup to network I/O); add `traceroute` as an apt-installed stage in deploy.sh; hand-roll the CIDR diff computation in JS without a new dependency; fix deploy.sh's env-file stomping (Stage H unconditionally overwrites `/etc/splitgate/vpn-gateway.env` from local `.env`, clobbering RPi-side edits made via Settings page).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Auth session persistence | Browser (client storage strategy) | API/Backend (cookie issuance) | Bug is in browser-side storage choice; backend cookie already correct |
| Log dedupe filter | Browser (client-side JS) | — | Pure display filter over already-streamed SSE data (CONTEXT D-04) — no server round-trip |
| Log context menu / multi-select | Browser (client-side JS) | API/Backend (bulk route POST) | UI interaction is client-only; persistence goes through existing `/api/routes/*/bulk` endpoints |
| Resources progress bars | Browser (client-side render) | API/Backend (`_collect_resources()`) | Data already streamed via SSE; only rendering changes |
| Diagnostics whois/ASN | API/Backend (subprocess to asn-lookup.py) | Browser (display) | Network I/O (Cymru whois) must happen server-side (RPi has the network path; browser CORS/sandboxing would block direct whois) |
| Diagnostics traceroute | API/Backend (subprocess to system `traceroute`) | — | Requires raw socket/ICMP privileges only available server-side (Flask runs as root, D-11) |
| Route-match checker | API/Backend (new endpoint replicating routing.sh precedence) | — | Must read the same three route files Flask already has paths for; logic is server-side to avoid duplicating file-parsing in JS |
| Add Route auto-org-lookup | API/Backend (asn-lookup.py) | Browser (pre-fill form) | Same lookup path as Diagnostics — single shared backend helper endpoint |
| Route diff-preview | Browser (client-side JS) | — | Pure array diff over in-memory pending vs. existing state; no new library needed |
| Route list backup/export | API/Backend (new download endpoint) | Browser (trigger download) | Files live on RPi filesystem; browser triggers `<a download>` against a Flask response |
| Deploy non-destructive redeploy | Deploy script (bash, macOS-side) | — | Not a runtime tier — build/deploy tooling boundary |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Flask | already installed (Phase 15) | Backend framework | Existing stack; no change |
| React 19 + Vite | 19.2.7 / 8.1.1 (from package.json) | SPA frontend | Existing stack; no change |
| `asn-lookup.py` (in-repo) | N/A (custom script) | Whois/ASN lookup for Diagnostics + Add Route | CONTEXT D-08 mandates reuse; stdlib-only, already deployed and cached |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `traceroute` (Debian apt package) | bookworm repo version (not pinned by this research — confirm at deploy time via `apt-cache policy traceroute` on RPi) | ICMP/UDP route tracing for Diagnostics page | New apt-installed dependency — NOT present by default `[VERIFIED: WebSearch cross-referenced with packages.debian.org]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled JS diff for pending routes | `jsdiff`/`diff` npm package | Overkill — jsdiff computes text/line diffs; this phase's data is a flat CIDR list, a `Set`-difference is simpler, zero new dependency, no bundle size cost |
| `traceroute` apt package | `tracepath` (also in `iputils-tracepath`) | `tracepath` confirmed NOT installed on this machine either (checked via `which`); `traceroute` is the more common/expected tool and is explicitly named in CONTEXT D-10 |
| subprocess to `asn-lookup.py` | Python `import` of `asn-lookup.py` as a module | Filename has a hyphen (`asn-lookup.py`), not import-safe as a standard module name without `importlib` tricks; subprocess also matches existing pattern (vpn-status.sh already calls it via subprocess) — see Code Examples |

**Installation (RPi, via new deploy.sh stage):**
```bash
ssh -o BatchMode=yes "${SSH_HOST}" "if ! dpkg -l traceroute 2>/dev/null | grep -q '^ii'; then sudo DEBIAN_FRONTEND=noninteractive apt-get install -y traceroute; fi"
```

**Version verification:** No new npm packages are recommended for this phase (see rationale above) — nothing to verify via `npm view`. The only new install target is the Debian `traceroute` apt package on the RPi itself; version is whatever bookworm ships (not user-controllable without a specific pin, and pinning apt packages is out of scope for this project's existing conventions).

## Package Legitimacy Audit

No new npm/pip packages are recommended by this research (traceroute is an OS-level apt package, not a language-ecosystem package; the diff UI is hand-rolled to avoid a dependency). `slopcheck` was not run because there is nothing to check — the audit table below documents this explicitly per the "nothing found" convention.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| — | — | — | — | — | — | N/A — no new packages recommended |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck was not invoked (sandbox denied install of an unrelated tool mid-session, and it was not needed since zero new packages are recommended). If the planner or a later discuss-phase round decides to add `jsdiff`/`diff` after all, it must be run through the Package Legitimacy Gate before being added to a plan.*

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser (React SPA, HashRouter)                                     │
│                                                                       │
│  Logs.jsx ──selects/right-clicks──▶ pending-route staging (client)  │
│     │                                        │                      │
│     │ dedupe filter (pure JS, D-04)          │ opens Diff Preview   │
│     ▼                                        ▼                      │
│  filtered display                     Routes.jsx (extended)         │
│                                        │  Set-diff(existing,new) │
│                                        │  render +green/-red     │
│                                        ▼                            │
│                                    Apply button                     │
│                                        │                             │
│  Diagnostics.jsx (new) ──whois/ASN/traceroute/route-match──▶  ┌──────┴───────┐
│  AddRoute form (Routes.jsx) ──auto-org-lookup──────────────▶  │  apiFetch()  │
│  Login persistence probe ──/api/auth/check────────────────▶  │  (api.js)    │
│  Resources progress bars ◀──SSE /api/resources/watch──────── └──────┬───────┘
└────────────────────────────────────────────────────────────────────┼──────┘
                                                                       │ HTTP/SSE
┌──────────────────────────────────────────────────────────────────┴──────┐
│ Flask backend (splitgate-admin.py, root on RPi)                          │
│                                                                            │
│  require_auth() ── cookie sg_session check ── Basic Auth fallback         │
│                                                                            │
│  /api/diag/whois     ──subprocess──▶ asn-lookup.py <ip>                  │
│  /api/diag/traceroute──subprocess──▶ /usr/bin/traceroute -n <validated IP>│
│  /api/diag/route-match──reads──▶ vpn-routes-custom.txt                   │
│                          │        isp-routes-custom.txt                  │
│                          │        ru-list-exclude.txt (white-list.txt)   │
│                          └──replicates routing.sh precedence in Python   │
│  /api/routes/backup  ──reads──▶ isp-routes-custom.txt + vpn-routes-custom.txt │
│                        ──returns──▶ concatenated download (Content-Disposition)│
│  /api/routes/*/bulk (existing) ◀── batch adds from Logs context menu     │
└────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/admin/src/
├── pages/
│   ├── Diagnostics.jsx     # NEW — whois/ASN, traceroute, route-match checker
│   ├── Routes.jsx          # EXTEND — diff-preview, auto-org-lookup on Add
│   └── Logs.jsx            # EXTEND — dedupe toggle, context menu, multi-select, legend
├── components/
│   └── DiffPreview.jsx     # NEW — shared additions/removals renderer (git-diff style)
└── api.js                  # FIX — remove sessionStorage-keyed Basic Auth reliance

src/scripts/
└── splitgate-admin.py      # EXTEND — new /api/diag/*, /api/routes/backup, auth fix, route-match logic
```

### Pattern 1: Server-side route-match replication (UI-DIAG route-match checker)
**What:** Read the three route-decision inputs and replicate `routing.sh`'s precedence order in Python, given a probe CIDR/IP.
**When to use:** `/api/diag/route-match?ip=<addr>` endpoint.
**Precedence (from `routing.sh`, highest to lowest):**
1. `vpn-routes-custom.txt` (Stage 5c) — forces VPN, deletes any ISP route first
2. `isp-routes-custom.txt` (Stage 5b) — forces ISP
3. RU subnet list `white-list.txt` (with `ru-list-exclude.txt` already subtracted server-side by `update-vpn-routes` before download — the exclude list is NOT a separate check at routing.sh time; it only affects what's IN white-list.txt)
4. Default — VPN (`awg0`, since routing.sh sets `ip route add default dev awg0`)

```python
# Source: derived from src/scripts/routing.sh Stage ordering (lines ~172-233), read this session
import ipaddress

def check_route_decision(target_ip):
    ip = ipaddress.ip_address(target_ip)
    # 1. VPN-force override — highest priority
    for cidr in read_routes_file(VPN_CUSTOM_ROUTES):
        if ip in ipaddress.ip_network(cidr, strict=False):
            return {'decision': 'VPN', 'matched_by': 'vpn-routes-custom.txt', 'cidr': cidr}
    # 2. ISP-custom override
    for cidr in read_routes_file(ISP_CUSTOM_ROUTES):
        if ip in ipaddress.ip_network(cidr, strict=False):
            return {'decision': 'ISP', 'matched_by': 'isp-routes-custom.txt', 'cidr': cidr}
    # 3. RU subnet list (already exclusion-filtered at download time)
    for cidr in read_routes_file('/etc/splitgate/white-list.txt'):
        if ip in ipaddress.ip_network(cidr, strict=False):
            return {'decision': 'ISP', 'matched_by': 'white-list.txt (RU subnet)', 'cidr': cidr}
    # 4. Default
    return {'decision': 'VPN', 'matched_by': 'default route (dev awg0)', 'cidr': None}
```
**Important caveat (flag for planner):** `read_routes_file()` already exists in `splitgate-admin.py` and returns CIDR-only lists — directly reusable. But `ipaddress.ip_network(cidr, strict=False)` must handle malformed/legacy entries gracefully (wrap in try/except) since these files are hand-edited.

### Pattern 2: Reusing `asn-lookup.py` via subprocess (UI-DIAG, UI-ADDROUTE)
**What:** Flask backend shells out to the already-deployed `/etc/splitgate/asn-lookup.py` (or repo-relative path in dev) for single ad-hoc IP lookups.
**Why subprocess, not import:** the file is named with a hyphen (`asn-lookup.py`), which is not directly importable as `import asn-lookup`; it CAN be imported via `importlib.util.spec_from_file_location`, but subprocess is simpler, matches the existing `vpn-status.sh` calling convention (Phase 7 D-04: "`vpn-status.sh` calls it via subprocess"), and avoids the Flask process eating socket-timeout stalls in its own event loop — a subprocess with a `timeout=` kwarg on `subprocess.run` cleanly bounds worst-case latency instead of blocking Flask's own thread indefinitely if Cymru is slow.
```python
# Source: pattern derived from existing splitgate-admin.py subprocess usage
# (see api_status() → systemctl subprocess.run pattern, this session)
ASN_LOOKUP_SCRIPT = '/etc/splitgate/asn-lookup.py'  # or repo-relative in dev

def lookup_org(ip):
    try:
        r = subprocess.run(['python3', ASN_LOOKUP_SCRIPT, ip],
                            capture_output=True, text=True, timeout=12)
        data = json.loads(r.stdout or '{}')
        return data.get(ip)  # {'asn': '...', 'org': '...'} or None
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        return None
```
CONTEXT D-08 explicitly forbids adding a new `whois` client or pip dependency — this pattern honors that.

### Pattern 3: Client-side log dedupe (UI-LOGS, no server change)
**What:** Filter toggle that hides all lines sharing a content signature (post-tag, post-timestamp substring), computed purely in the React component.
**When to use:** `Logs.jsx` `LogsLive`/`LogsHistory` — apply as an additional filter step alongside existing `applyFilters()`.
```javascript
// Source: pattern extends existing applyFilters() in src/admin/src/pages/Logs.jsx
// Signature = everything after [VPN]/[ISP] tag, i.e. "IP → IP (hostname) TCP:port | ORG" (CONTEXT D-02)
const TAG_STRIP_RE = /^\S+\s+\[(VPN|ISP)\]\s*/  // adjust to actual observed line format
function dedupeSignature(line) {
  return line.replace(TAG_STRIP_RE, '').trim()
}
function dedupeLines(lines) {
  const seen = new Set()
  const result = []
  for (const line of lines) {
    const sig = dedupeSignature(line)
    if (seen.has(sig)) continue
    seen.add(sig)
    result.push(line)
  }
  return result
}
```
**Verify actual line format before implementing:** research did not capture a live sample log line from `watch-routes.py`'s `format_line()` output; the planner/executor MUST grep `src/scripts/watch-routes.py`'s `format_line()` return statement to confirm the exact tag position and delimiter before finalizing `TAG_STRIP_RE` — this is flagged as an assumption below.

### Pattern 4: CIDR set-diff for pending-changes preview (UI-LOGS D-06/D-07)
**What:** Compute additions/removals between the currently-applied route list and the in-memory pending list, without any diff library.
```javascript
// Source: derived from existing existingCidrs Set pattern in src/admin/src/pages/Routes.jsx (line 232)
function computeRouteDiff(existingEntries, pendingEntries) {
  const existingCidrs = new Set(existingEntries.map(e => e.cidr))
  const pendingCidrs = new Set(pendingEntries.map(e => e.cidr))
  const additions = pendingEntries.filter(e => !existingCidrs.has(e.cidr))
  const removals = existingEntries.filter(e => !pendingCidrs.has(e.cidr))
  return { additions, removals }  // CONTEXT D-06: omit whichever section is empty
}
```

### Anti-Patterns to Avoid
- **Re-introducing `WWW-Authenticate` header:** Phase 15 deviation log explicitly removed this because it triggers Chrome's native auth dialog, breaking the custom login UX. Do not add it back while fixing UI-AUTH.
- **Importing `asn-lookup.py` as a Python module:** the hyphenated filename makes this awkward; subprocess is the established, simpler pattern (see Pattern 2).
- **Adding a `whois` pip/apt dependency for Diagnostics:** explicitly forbidden by CONTEXT D-08 — everything must route through `asn-lookup.py`.
- **Computing route-match decision in the browser:** the three route files live only on the RPi filesystem; the browser has no access to them directly — this must be a backend endpoint.
- **Using `eval` or raw shell interpolation for traceroute target:** user input (an IP/CIDR) must be validated against a strict IP regex before being passed as a subprocess argument list element (never `shell=True`) — mirrors the existing `CIDR_RE` validation pattern already in `splitgate-admin.py`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ASN/whois lookups | Custom `whois` protocol client or a new Team Cymru integration | `src/scripts/asn-lookup.py` (Phase 7, already exists) | CONTEXT D-08 mandates reuse; already has file-backed caching and graceful degradation |
| Traceroute | Custom raw-socket ICMP implementation in Python | System `traceroute` binary via subprocess | Raw ICMP requires CAP_NET_RAW or root — Flask already runs as root (D-11), so shelling out to the battle-tested system tool is strictly simpler and safer than reimplementing traceroute's TTL-increment/ICMP-response logic |
| Text diffing for route changes | `jsdiff`/`diff-match-patch` npm package | Plain `Set`/array difference (Pattern 4) | The data is a flat list of discrete CIDR entries, not free text — line/char diffing algorithms are the wrong tool and add unnecessary bundle weight |

**Key insight:** every "don't hand-roll" candidate for this phase already has an existing, working implementation in the codebase (asn-lookup.py) or a standard OS tool (traceroute) — the work is integration, not invention.

## Runtime State Inventory

> Not applicable — this phase does not rename, rebrand, or migrate any existing state. All work is additive (new endpoints/pages) or a targeted bug fix (auth persistence, deploy overwrite). Skipping this section per its own trigger condition.

## Common Pitfalls

### Pitfall 1: UI-AUTH — treating the cookie as broken when the frontend never checks it
**What goes wrong:** Assuming the `sg_session` httponly cookie mechanism itself is buggy (missing `Max-Age`, wrong `SameSite`) and rewriting the backend cookie logic, when the actual bug is that `api.js`'s `apiFetch()` always sends `Authorization: Basic ...` computed from `sessionStorage`, so the browser prompts for password whenever `sessionStorage` is empty (new tab, browser restart) — regardless of whether a valid, unexpired `sg_session` cookie already exists.
**Why it happens:** The cookie IS set correctly server-side (confirmed by reading `require_auth()` — `resp.set_cookie('sg_session', session_token, httponly=True, samesite='Strict', path='/')`), so backend-only debugging looks "correct" and the bug hides in the frontend's storage strategy.
**How to avoid:** Add a lightweight `/api/auth/check` GET endpoint that returns 200 if the `sg_session` cookie is valid (no Basic Auth challenge needed), and have the SPA call it on mount before showing a login prompt. Only fall back to prompting for Basic Auth credentials if `/api/auth/check` returns 401. Also add `max_age=<seconds>` to `set_cookie()` — currently no expiry is set, meaning the cookie is a session cookie that dies when the browser process fully closes, which is part of why "closing the tab" (not just navigating) still re-prompts.
**Warning signs:** User reports "still prompted every visit" despite Phase 15 D-09 claiming persistence — this is the exact symptom already reported in CONTEXT D-01.

### Pitfall 2: deploy.sh unconditionally overwrites `/etc/splitgate/vpn-gateway.env` on every redeploy (UI-DEPLOY)
**What goes wrong:** Stage H (`[8/${TOTAL_STAGES}]`) in `deploy.sh` does `cat ../.env > "$env_merged_tmp"` then SCPs and `mv`s it straight over `/etc/splitgate/vpn-gateway.env` with no existence check or diff — any RPi-side edit made through the Settings page's env editor (`PUT /api/settings/env`, which merges into the SAME file) is silently clobbered on the next `bash src/deploy.sh`.
**Why it happens:** `deploy.sh`'s original design (Phase 1) assumed `.env` was the single source of truth and the RPi copy was purely derived/disposable. Phase 15's Settings page introduced a second write path (the web UI) to the same file, creating a divergence the deploy script was never updated to reconcile.
**How to avoid:** Before overwriting, either (a) skip the env deploy stage entirely if the remote file already exists (matching the existing `ISP_CUSTOM_LOCAL`/`VPN_FORCE_LOCAL` "skip if present on RPi... no wait, skip if absent locally" pattern is the opposite direction and not directly reusable) — more correctly: fetch the remote file first, merge only NEW keys from local `.env` that don't already exist remotely, and warn on any value that differs, OR (b) restrict `deploy.sh`'s env-file responsibility to first-deploy only (guard with `ssh ... test -f ${ENV_REMOTE}` before the overwrite) and route all subsequent env changes exclusively through the Settings page / a separate lightweight sync script — mirroring the same `deploy.sh` vs `deploy-admin.sh` separation Phase 15 already established for admin redeploys.
**Warning signs:** User's `ADMIN_PORT` or other env var edited via Settings reverts after running `bash src/deploy.sh` again.

### Pitfall 3: deploy.sh also unconditionally overwrites `awg0.conf` on every redeploy
**What goes wrong:** Stage G/F re-renders `awg0.conf` from the local template + `.env.secrets` on every run and SCPs it over the remote file unconditionally — same clobbering pattern as Pitfall 2, but for VPN keys/config. This is a second, related instance of the same UI-DEPLOY bug class and should be checked/fixed in the same pass since the user's complaint ("deploy.sh must not overwrite existing config files on redeploy") is almost certainly about both files, not just the env file.
**Why it happens:** Same root design assumption as Pitfall 2 — Phase 1's deploy.sh predates any RPi-side editing capability (Settings page added AWG config upload in Phase 15 D-14).
**How to avoid:** Apply the same guard strategy as Pitfall 2 — check for remote file existence before overwriting, or make deploy.sh idempotent-safe by comparing checksums and skipping/warning on divergence rather than blind overwrite.
**Warning signs:** AWG key uploaded via Settings page (Phase 15 D-14 "AWG Config: upload awg0.conf to RPi") reverts to the value baked from `.env.secrets` after the next full `deploy.sh` run.

### Pitfall 4: traceroute target validation must prevent command injection
**What goes wrong:** User-supplied CIDR/IP text for the Diagnostics route-match checker or traceroute target is passed into a `subprocess` call; if `shell=True` is used or the value isn't validated, arbitrary shell metacharacters could be injected.
**Why it happens:** Easy to reach for `subprocess.run(f"traceroute {ip}", shell=True)` for a "quick" implementation.
**How to avoid:** Validate against a strict IP regex (reuse the existing `CIDR_RE` pattern style already in `splitgate-admin.py`, adapted to bare-IP-only since traceroute takes a host not a CIDR) BEFORE constructing the subprocess argument list; always pass `subprocess.run(['traceroute', '-n', '-w', '2', '-m', '15', ip], ...)` as a list, never `shell=True`.
**Warning signs:** Any endpoint that builds a shell command string via f-string/concatenation.

### Pitfall 5: `_sessions` in-memory session store resets on every Flask restart
**What goes wrong:** `_sessions = set()` at module level means any `systemctl restart splitgate-admin.service` (which happens on every `deploy-admin.sh` run, per its Step 5) invalidates ALL existing sessions immediately, forcing every open browser tab to re-authenticate — compounding the UI-AUTH complaint even after the cookie/storage fix.
**Why it happens:** Single-file Flask app with no persistent session backend (by design, Phase 15 D-08 "no external Python deps beyond Flask").
**How to avoid:** This is an acceptable tradeoff to document rather than "fix" (adding Redis/a session DB would violate the no-external-deps constraint) — but the planner should note this explicitly so the UI-AUTH fix doesn't over-promise persistence across a service restart. Consider persisting `_sessions` to a small JSON file at `/etc/splitgate/admin-sessions.json` if the user wants persistence to survive redeploys too — but this trades off against the honest expectation-setting option (documenting the limitation) and is a discretion call for the planner.
**Warning signs:** Auth still resets after `bash src/deploy-admin.sh` even after the frontend fix ships.

## Code Examples

### Auth check endpoint (fixes UI-AUTH)
```python
# Source: pattern derived from existing require_auth() in splitgate-admin.py (read this session)
@app.route('/api/auth/check')
def api_auth_check():
    token = request.cookies.get('sg_session')
    if token and token in _sessions:
        return jsonify({'authenticated': True})
    return jsonify({'authenticated': False}), 401
```

### Cookie with explicit Max-Age (fixes UI-AUTH persistence across browser restarts)
```python
# Source: modification of existing require_auth() set_cookie call (line 60 of splitgate-admin.py)
resp.set_cookie('sg_session', session_token, httponly=True, samesite='Strict',
                 path='/', max_age=60*60*24*30)  # 30 days
```

### Route list backup/export endpoint (UI-BACKUP)
```python
# Source: pattern derived from existing file-read helpers already in splitgate-admin.py
from flask import Response
from datetime import date

@app.route('/api/routes/backup')
@require_auth
def api_routes_backup():
    parts = []
    parts.append('# splitgate route backup — ' + date.today().isoformat())
    parts.append('# --- VPN routes (vpn-routes-custom.txt) ---')
    for e in read_routes_with_desc(VPN_CUSTOM_ROUTES):
        parts.append(f"{e['cidr']} # {e['description']}" if e['description'] else e['cidr'])
    parts.append('# --- ISP routes (isp-routes-custom.txt) ---')
    for e in read_routes_with_desc(ISP_CUSTOM_ROUTES):
        parts.append(f"{e['cidr']} # {e['description']}" if e['description'] else e['cidr'])
    content = '\n'.join(parts) + '\n'
    filename = f"splitgate-routes-backup-{date.today().isoformat()}.txt"
    return Response(content, mimetype='text/plain',
                     headers={'Content-Disposition': f'attachment; filename={filename}'})
```

### Browser download trigger (UI-BACKUP frontend)
```javascript
// Source: pattern already exists in Logs.jsx's downloadLines() (read this session) —
// for a server-generated file, simplest approach is a direct navigation/anchor to
// the authenticated endpoint since apiFetch() already sends the auth cookie via credentials:'include'
async function downloadBackup() {
  const r = await apiFetch('/api/routes/backup')
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `splitgate-routes-backup-${new Date().toISOString().slice(0,10)}.txt`
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| N/A | N/A | — | This phase is a pure UX/bugfix upgrade to an existing internal tool — no external framework "state of the art" shift applies. |

**Deprecated/outdated:** none identified — Flask, React 19, Vite, and the existing SSE architecture remain current and are not being replaced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exact watch-routes.py log line format for dedupe signature stripping (`TAG_STRIP_RE`) was not directly read from `watch-routes.py`'s `format_line()` in this research session | Pattern 3 (Common Pitfalls / Code Examples) | If the assumed regex doesn't match the real format, dedupe will silently fail to collapse duplicates or over-collapse distinct lines — planner MUST have the executor grep `format_line()` before implementing |
| A2 | `traceroute` Debian bookworm package is not installed by default on Raspberry Pi OS | Standard Stack, Pitfall 4 | `[VERIFIED: WebSearch cross-referenced with packages.debian.org + Pi My Life Up]` — low risk, multiple sources agree, but not confirmed by direct SSH to the actual target RPi in this session |
| A3 | Whether `whois` binary is present on the target RPi | Anti-Patterns | Not checked on the actual RPi (only checked on the local macOS dev machine, where it happens to be present via Homebrew) — irrelevant risk since CONTEXT D-08 forbids using `whois` CLI regardless |
| A4 | Recommendation to guard deploy.sh's env/awg0.conf overwrite via remote-file-existence check (Pitfall 2/3) is one of several valid strategies; the "merge only new keys + warn on divergence" alternative was not fully designed | Pitfall 2 | Planner must choose and fully design the specific non-destructive strategy — this research surfaces the bug and candidate strategies but does not lock one in, per CONTEXT D-10-style "resolve in planning" pattern |

**If this table is empty:** N/A — see rows above.

## Open Questions (RESOLVED)

1. **Exact watch-routes.py log line format**
   - What we know: format includes timestamp, `[VPN]`/`[ISP]` tag, `IP → IP (hostname) TCP:port`, and ` | {org}` suffix (per Phase 7 D-08 format string: `2026-05-21T11:36 [VPN] 192.168.1.175 → 17.248.209.64 (albert.apple.com) TCP:443 | Apple Inc.`)
   - What's unclear: whether this exact format is still current after Phase 13's `watch-routes.py` daemon changes (STATUS_DELAY, ✓/✗ conntrack suffix per Phase 13 D-04) — the ✓/✗ icon mentioned in UI-LOGS ("legend explaining the ✓/✗ icons shown right after the [VPN]/[ISP] tag") is NOT visible in the Phase 7 example line above, confirming the format changed again in Phase 13 and was not re-read in full in this session.
   - Recommendation: executor must `grep -n "format_line\|STATUS_DELAY\|✓\|✗" src/scripts/watch-routes.py` and capture a real sample line before finalizing the dedupe signature regex AND the legend copy.
   - **RESOLVED:** confirmed from `watch-routes.py` `_write_daemon_line` (line 466) — format is `{ts} [{tag}] {status} {src} → {dst_part} {port_part} | {org}` with `ts` = ISO 8601 + offset, `status` = ✓/✗ (may be empty). This confirmed format is used downstream in plan 16-07 (dedupe signature = substring after timestamp+tag, and the ✓/✗ legend copy).

2. **Deploy.sh non-destructive strategy — merge vs. skip-if-exists vs. checksum-compare**
   - What we know: the bug (Pitfalls 2/3) and three candidate fix strategies.
   - What's unclear: which strategy the user prefers — skip-if-exists is simplest but means a genuinely-desired `.env` change (e.g. new `CRON_UPDATE_HOUR`) would never propagate without manual SSH; merge-new-keys-only is safer but more complex to implement correctly for `awg0.conf`'s key/value format.
   - Recommendation: flag as a planning-time or discuss-phase-round-2 decision point — this is a legitimate design choice, not something research should lock in unilaterally.
   - **RESOLVED:** planning locked the non-destructive strategy (skip-if-exists for existing remote `.env`/`awg0.conf`, preserving operator edits) and it is used downstream in the deploy.sh redeploy plan. The candidate strategies surfaced here fed that decision.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `traceroute` (RPi apt package) | UI-DIAG traceroute | ✗ (not installed by default) | — | Install via new deploy.sh stage (apt-get install traceroute); no viable in-process fallback since raw ICMP needs root+syscall access |
| `whois` binary (RPi) | Not required — explicitly avoided per D-08 | N/A | — | `asn-lookup.py` used instead |
| Python 3 stdlib `ipaddress` module | Route-match checker (Pattern 1) | ✓ (stdlib, all Python 3.3+) | bundled | — |
| Existing `asn-lookup.py` deploy | UI-DIAG, UI-ADDROUTE | ✓ (already deployed per Phase 7 D-10 / deploy.sh Stage 23) | already on RPi | — |

**Missing dependencies with no fallback:**
- `traceroute` — must be installed via a new deploy.sh apt-get stage before UI-DIAG traceroute can function; there is no in-Python fallback for raw ICMP traceroute without root+raw-socket privileges being reimplemented from scratch (explicitly avoided per Don't Hand-Roll table).

**Missing dependencies with fallback:**
- none — the only missing dependency (`traceroute`) has no fallback other than installing it, which is straightforward via the existing deploy.sh apt-get pattern (Stage 18 dnsmasq precedent).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing HTTP Basic Auth + httponly session cookie (Phase 15 D-09) — this phase fixes persistence, does not change the auth mechanism itself |
| V3 Session Management | yes | `sg_session` httponly, `SameSite=Strict` cookie; fix adds `Max-Age`; in-memory `_sessions` set (acceptable for single-shared-secret LAN-only tool per Phase 15 deferred decisions) |
| V4 Access Control | no | Single shared-secret model, no roles/permissions (explicitly out of scope, both Phase 15 and this phase's CONTEXT deferred section) |
| V5 Input Validation | yes | New endpoints (`/api/diag/*`, route-match checker) accept user-supplied IP/CIDR strings that flow into `subprocess` calls — MUST validate against strict regex before use (Pitfall 4); reuse existing `CIDR_RE` pattern style |
| V6 Cryptography | no | No new cryptographic operations introduced by this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection via traceroute/route-match IP input | Tampering / Elevation of Privilege | Strict IP regex validation + `subprocess.run([...])` as argument list, never `shell=True` (Pitfall 4) |
| Session fixation / cookie theft over LAN | Spoofing | `httponly`, `SameSite=Strict` already set; LAN-only HTTP (no TLS) is an accepted Phase 15 tradeoff, not reopened by this phase |
| Session persistence surviving service restarts unexpectedly (or not surviving when user expects it to) | (UX correctness, not strictly a STRIDE threat) | Document the `_sessions` in-memory reset behavior explicitly (Pitfall 5) rather than silently leaving it as a surprise |

## Sources

### Primary (HIGH confidence)
- `src/scripts/splitgate-admin.py` (read in full, this session) — auth decorator, all existing endpoints, resource collection, route file parsing helpers
- `src/scripts/asn-lookup.py` (read in full, this session) — CLI interface, `lookup_ips()` function signature, cache mechanism, stdlib-only constraint
- `src/admin/src/pages/Routes.jsx` (read in full, this session) — existing pending+Apply CIDR pattern, `existingCidrs` Set pattern reused for diff computation
- `src/admin/src/pages/Logs.jsx` (read in full, this session) — existing filter/download pattern, SSE subscription pattern
- `src/admin/src/api.js` (read in full, this session) — confirms root cause of UI-AUTH bug (sessionStorage-keyed Basic Auth, ignoring cookie)
- `src/deploy.sh` (read in full, this session) — confirms unconditional overwrite of `vpn-gateway.env` (Stage H) and `awg0.conf` (Stage F/G) on every run
- `src/deploy-admin.sh` (read in full, this session) — confirms `systemctl restart splitgate-admin` on every admin redeploy (relevant to Pitfall 5)
- `src/admin/package.json` (read in full, this session) — confirms no diff library currently present
- `.planning/phases/15-web-admin-interface/15-CONTEXT.md` — auth cookie design (D-09), pages/routes inventory, deferred decisions
- `.planning/phases/07-asn-enrichment-traffic-attribution/07-CONTEXT.md` — asn-lookup.py design decisions, subprocess-calling convention precedent
- `src/scripts/routing.sh` (grepped for route-decision logic, this session) — confirms VPN-force > ISP-custom > RU-list > default-VPN precedence

### Secondary (MEDIUM confidence)
- WebSearch: "traceroute package Raspberry Pi OS Debian bookworm default installed" — cross-referenced packages.debian.org + Pi My Life Up + ServerMania, consistent conclusion that traceroute is not installed by default on Debian/RPi OS
- `which traceroute tracepath whois` on local macOS dev machine — confirms these tools' typical availability profile on a Unix system generally, but does NOT confirm the actual RPi's installed state (RPi state not directly checked via SSH in this research session)

### Tertiary (LOW confidence)
- Exact current `watch-routes.py` log line format including the ✓/✗ conntrack suffix — inferred from Phase 7/Phase 13 CONTEXT/STATE.md descriptions, not directly read from current `format_line()` source in this session (flagged as Open Question 1 / Assumption A1)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new frameworks, all extensions of already-read existing code
- Architecture: HIGH — every new endpoint/component maps directly to an existing pattern already present in the codebase
- Pitfalls: HIGH for UI-AUTH and UI-DEPLOY (root causes confirmed by direct code reading); MEDIUM for the exact watch-routes.py log format pitfall (not re-read in full this session)

**Research date:** 2026-07-13
**Valid until:** 30 days (internal tool, stable stack, no fast-moving external dependencies)
