# Phase 15: Web Admin Interface - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning

<domain>
## Phase Boundary

React SPA admin interface deployed to RPi — lets any LAN device manage the entire gateway via browser without SSH. Covers: service control (start/stop/restart), route exceptions management, all system logs, config editing (including secrets), and systemd deploy.

Replaces the 4 existing DRAFT plans — those are superseded by this context.

</domain>

<decisions>
## Implementation Decisions

### Frontend Technology
- **D-01:** React + Vite SPA (not vanilla JS, not embedded HTML in Python)
- **D-02:** Built dist committed to repo — no Node.js on RPi, no build step at deploy time
- **D-03:** `src/admin/` — React project source; `src/admin/dist/` — committed build output
- **D-04:** Flask serves `src/admin/dist/` as static files; SPA routing via React Router (hash or history mode)

### Deploy Integration
- **D-05:** deploy.sh checks for `src/admin/dist/` before deploying admin UI:
  - If present: SCP dist/ to RPi + deploy Flask backend + systemd unit
  - If absent: skip admin UI stages entirely, log "Admin UI not built — skipping"
- **D-06:** New conditional stages in deploy.sh for admin (after existing Stage 28 splitgate-watch)
- **D-07:** Admin files deploy to `/etc/splitgate/admin/` on RPi; Flask backend at `/usr/local/bin/splitgate-admin`

### Backend
- **D-08:** Python Flask (`src/scripts/splitgate-admin.py`) — single file, no external Python deps beyond Flask
- **D-09:** Auth: HTTP Basic Auth, password stored at `/etc/splitgate/admin.secret` (bcrypt hash or plain — TBD by researcher)
- **D-10:** Port: `ADMIN_PORT=8080` in `.env`; accessible at `http://192.168.1.254:8080` from LAN
- **D-11:** Flask runs as root (needs `sudo systemctl` and file writes to `/etc/splitgate/`) — or via sudo rules (researcher decides safer approach)

### Pages / Navigation
Six top-level pages (React Router):

1. **`/` → Dashboard** — VPN tunnel status card, daemon state, RU list last-updated, active route counts. Auto-refreshes every 10s.
2. **`/services` → Services** — list of managed systemd services with start/stop/restart buttons (see D-12)
3. **`/routes` → Routes** — add/remove CIDRs in `vpn-routes-custom.txt` and `isp-routes-custom.txt`; Apply button triggers `routing.sh --no-update` (equivalent to `deploy-routes` npm script)
4. **`/logs` → Logs** — subsections for all system logs (see D-13)
5. **`/config` → Config** — view/edit `ru-list-exclude.txt`; Trigger RU list refresh button (`update-vpn-routes`)
6. **`/settings` → Settings** — view/edit `.env` and `.env.secrets` variables (see D-14)

### Services Page (D-12)
- Managed services: `awg0`, `splitgate-watch`, `networking`, `dnsmasq`
- Each service row: service name + current status (active/inactive/failed) + three buttons
- Button state rules:
  - **Start**: disabled when service is active
  - **Stop**: disabled when service is inactive/stopped
  - **Restart**: disabled when service is inactive/stopped (available only when active)
- Backend: `systemctl start|stop|restart <service>` via subprocess; `systemctl is-active` for status polling
- Status auto-refreshes every 5s

### Logs Page (D-13)
- Separate subsections (tabs or accordion) for each log source:
  - **Watch Live** — real-time SSE stream from `watch-YYYY-MM-DD.log` (same as current WEB-02 plan)
  - **Install Log** — `/etc/splitgate/logs/install.log` — polling or static read + refresh button
  - **Watch Errors** — `/etc/splitgate/logs/watch-error.log` — polling
  - **System Journal** — `journalctl -u splitgate-watch -u awg0 --no-pager -n 200` — refresh button
- Filters on Watch Live: [VPN]/[ISP] tag filter, domain substring filter (mirrors `splitgate status --filter`)
- Color coding: `[VPN]` = cyan, `[ISP]` = yellow (matches terminal output from Phase 13)

### Settings Page (D-14)
- Edits `.env` AND `.env.secrets` (including AWG_PRIVATE_KEY, PUBLIC_KEY, PRESHARED_KEY)
- ⚠️ VPN keys visible in browser — user accepted this risk; LAN-only + Basic Auth gate
- Display as key=value editor (not raw file textarea) — mask secret values by default, toggle to reveal
- Save writes back to `/etc/splitgate/` env files on RPi; does NOT auto-apply (user must restart services manually after key change)
- Admin password change also lives here (writes new hash to `/etc/splitgate/admin.secret`)

### Commands Visualization
- User wants splitgate CLI commands visible as UI — map to existing pages:
  - `splitgate status` → Dashboard page
  - `splitgate watch` → Logs / Watch Live tab
  - `splitgate update` → Config page "Refresh RU List" button
  - `splitgate rollback` → Settings page, destructive action with confirmation dialog
- `splitgate rollback` in UI: prominent red button, confirmation modal ("This will tear down the entire VPN gateway. Type ROLLBACK to confirm.")

### Systemd & Rollback
- New systemd unit: `splitgate-admin.service` (ExecStart=splitgate-admin, Restart=on-failure)
- `vpn-rollback.sh` teardown: stop + disable `splitgate-admin.service`, remove `/etc/splitgate/admin/` and `/usr/local/bin/splitgate-admin`
- `splitgate admin` subcommand added to dispatcher: `status`, `start`, `stop`, `restart`

### Build & Repo
- `src/admin/` gitignored patterns: `node_modules/`, but NOT `dist/` — dist is committed
- `src/admin/package.json` has `build` script: `vite build`
- Developer workflow: `cd src/admin && npm run build` → commit `src/admin/dist/`
- Deploy detects dist presence before deploying admin stages

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing System State
- `.planning/STATE.md` — all prior phase decisions (D-01 through D-10-03), filesystem layout, service names
- `.planning/ROADMAP.md` §Phase 15 — original WEB-01..WEB-06 requirements (still valid, expanded)
- `.planning/PROJECT.md` — constraints (arm64, AmneziaWG, no secrets in repo)

### Key Scripts (read to understand integration points)
- `src/scripts/splitgate` — dispatcher; `admin` subcommand to be added here
- `src/scripts/routing.sh` — triggered by Routes Apply button (`--no-update` flag)
- `src/scripts/update-vpn-routes` — triggered by Config Refresh button
- `src/scripts/vpn-rollback.sh` — triggered by Settings Rollback button; teardown steps must be added
- `src/deploy.sh` — new conditional admin stages added here; read TOTAL_STAGES and stage ordering

### Config Files
- `src/.env` — ADMIN_PORT goes here
- `src/configs/isp-routes-custom.txt` — managed by Routes page
- `src/configs/vpn-routes-custom.txt` — managed by Routes page

### Log Paths on RPi
- `/etc/splitgate/logs/watch-YYYY-MM-DD.log` — SSE stream source
- `/etc/splitgate/logs/watch-error.log` — daemon stderr
- `/etc/splitgate/logs/install.log` — routing/update events

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/scripts/watch-routes.py` — SSE log streaming pattern already proven; Flask admin SSE endpoint mirrors `--daemon` mode file tail logic
- `src/scripts/vpn-status.sh` — JSON-serializable output can back Dashboard API
- Phase 13 D-05/D-06: daemon writes to `/etc/splitgate/logs/watch-YYYY-MM-DD.log` with midnight rotation — admin SSE must handle date rotation

### Established Patterns
- `subprocess.run` with timeout — used in `watch-routes.py` for ASN lookups; same pattern for `systemctl` calls in Flask
- `/etc/splitgate/` as namespace for all RPi files (D-10-01 through D-10-03)
- TOTAL_STAGES counter in `deploy.sh` — increment for each new admin stage; current value is 28 (Phase 13 added Stage 28)
- Conditional SCP pattern in deploy.sh (Stage 21b ru-exclude, Stage 22b migration) — admin dist check follows same pattern

### Integration Points
- Flask backend reads/writes `/etc/splitgate/vpn-routes-custom.txt` and `/etc/splitgate/isp-routes-custom.txt` directly
- Routes Apply = `subprocess.run(['sudo', '/etc/splitgate/routing.sh', '--no-update'])`
- `journalctl` output via `subprocess.run(['journalctl', '-u', 'splitgate-watch', '-u', 'awg0', '--no-pager', '-n', '200'])`
- deploy.sh Stage N: `if [ -d "src/admin/dist" ]; then ... SCP admin/dist ... fi`

</code_context>

<specifics>
## Specific Ideas

- User explicitly wants button state logic: Start disabled when active, Stop disabled when inactive, Restart disabled when inactive
- User wants `deploy-routes` npm script behavior replicated as Routes page "Apply" button
- Settings page: mask secret values by default, toggle to reveal (not raw file textarea)
- Rollback in UI: confirmation modal with typed confirmation ("ROLLBACK")
- deploy.sh: graceful skip if `src/admin/dist/` missing — not an error, just skip admin stages
- User plans to build once and commit dist — no CI/CD for React, no build on RPi

</specifics>

<deferred>
## Deferred Ideas

- Multi-user auth / role-based access — out of scope, single shared secret is sufficient
- HTTPS / TLS termination — LAN-only, HTTP acceptable for now
- Mobile-responsive design — not explicitly required; standard desktop layout
- Real-time metrics / graphs (CPU, RAM, bandwidth) — separate phase if needed
- Phase 14 (dnsmasq ipset) integration in Routes UI — Phase 15 depends on Phase 14 optionally; domain-based route entries deferred until Phase 14 is implemented

</deferred>

---

*Phase: 15-web-admin-interface*
*Context gathered: 2026-06-30*
