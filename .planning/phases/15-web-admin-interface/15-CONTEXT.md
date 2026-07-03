# Phase 15: Web Admin Interface - Context

**Gathered:** 2026-06-30
**Status:** Complete — all batches shipped, deployed to RPi

<domain>
## Phase Boundary

React SPA admin interface deployed to RPi — lets any LAN device manage the entire gateway via browser without SSH. Covers: service control (start/stop/restart), route exceptions management, all system logs, config editing, and systemd deploy.

Accessible at `http://192.168.1.254:8080` from LAN.

</domain>

<decisions>
## Implementation Decisions

### Frontend Technology
- **D-01:** React + Vite SPA (not vanilla JS, not embedded HTML in Python)
- **D-02:** Built dist committed to repo — no Node.js on RPi, no build step at deploy time
- **D-03:** `src/admin/` — React project source; `src/admin/dist/` — committed build output
- **D-04:** Flask serves `src/admin/dist/` as static files; SPA routing via React Router HashRouter

### Deploy Integration
- **D-05 (revised):** Separate `deploy-admin.sh` script — NOT conditional stages in `deploy.sh`
  - Steps: [1/5] Build React SPA → [2/5] Upload dist/ → [3/5] Upload splitgate-admin.py → [4/5] Sync ru-exclude.txt → [5/5] Restart service
  - `deploy.sh` retains Stage 29 for initial systemd unit + secret install; `deploy-admin.sh` handles iterative redeployment
- **D-06:** Admin files deploy to `/etc/splitgate/admin/` on RPi; Flask backend at `/usr/local/bin/splitgate-admin`
- **D-07:** `src/admin/dist/` committed to repo; developer runs `npm run build` locally before commit

### Backend
- **D-08:** Python Flask (`src/scripts/splitgate-admin.py`) — single file, no external Python deps beyond Flask
- **D-09 (revised):** Auth via HTTP Basic Auth **without** `WWW-Authenticate` header (removed to prevent Chrome native auth dialog). Cookie `sg_session` (HttpOnly) persists auth across page loads. `secrets.compare_digest` for timing-safe compare. Password at `/etc/splitgate/admin.secret`.
- **D-10:** Port: `ADMIN_PORT=8080` in `/etc/splitgate/vpn-gateway.env`; accessible at `http://192.168.1.254:8080`
- **D-11:** Flask runs as root — needs `sudo systemctl` and file writes to `/etc/splitgate/`

### Pages / Navigation
Six top-level pages (React Router HashRouter):

1. **`/` → Dashboard** — Services status + Routes counts (2-column grid) + Resources card. All data via SSE.
2. **`/services` → Services** — per-service start/stop/restart with correct disabled states + Bulk Actions card
3. **`/routes` → Routes** — add/remove CIDRs in vpn-routes-custom.txt + isp-routes-custom.txt; Apply → `routing.sh --no-update`
4. **`/logs` → Logs** — 5 sub-routes (see D-13)
5. **`/config` → Config** — ru-list-exclude.txt editor + RU list refresh with last-updated timestamp
6. **`/settings` → Settings** — env KV editor, AWG config upload, ADMIN_PORT with countdown redirect, theme selector, Rollback button

### Services Page (D-12)
- Managed: `awg0`, `splitgate-watch`, `networking`, `dnsmasq` (admin excluded — avoids self-disconnection)
- Per-service row: name, status Badge, Start/Stop/Restart buttons with correct disabled states
- Status via SSE (`/api/services/watch`, 5s interval); manual refresh after actions
- Bulk Actions card: Start All / Stop All / Restart All

### Logs Page (D-13 — revised)
Each log source is a **separate sub-route** (not tabs in one component):

| Route | Source |
|-------|--------|
| `/logs/live` (`/logs` index) | SSE stream from `watch-YYYY-MM-DD.log` — live with colorize, filter, download, background mode |
| `/logs/history` | Historical by date range — Calendar+Popover datepicker, colorize, filter, download |
| `/logs/install` | `/etc/splitgate/logs/install.log` — static with Refresh button |
| `/logs/errors` | `/etc/splitgate/logs/watch-error.log` — static with Refresh button |
| `/logs/journal` | `journalctl -u splitgate-watch -u awg0 --no-pager -n 200` — static with Refresh button |

Color coding: `[VPN]` = cyan, `[ISP]` = yellow. Sub-nav uses NavLinks with active underline indicator.

### Settings Page (D-14 — revised)
- Env editor: `ADMIN_PORT` (with countdown redirect after port change), `RU_SUBNET_URL`, `UPDATE_INTERVAL`
- AWG Config: upload `awg0.conf` to RPi; inline Restart awg0 button after upload
- Theme selector: System / Light / Dark — persisted in localStorage, applied via CSS `dark` class on `<html>`
- Rollback: red button with confirmation modal (type "ROLLBACK")
- Settings moved **secrets out of scope** — `.env.secrets` / VPN keys NOT editable via UI (deferred; security posture)

### Theme System
- CSS custom properties in `:root` (light) and `.dark` (dark) → referenced via `@theme` Tailwind v4
- `@custom-variant dark (&:where(.dark, .dark *))` enables `dark:` utilities
- Init script in `index.html` applies class before React mounts — no flash on load
- `useTheme` hook manages state + system media query listener

### SSE Architecture
All real-time data via Server-Sent Events (not polling):

| Endpoint | Interval | Consumer |
|----------|----------|---------|
| `/api/status/watch` | 10s | Dashboard (status + route counts) |
| `/api/services/watch` | 5s | Dashboard (services list), Services page |
| `/api/resources/watch` | 5s | Dashboard (CPU/RAM/Disk + per-service table) |
| `/api/logs/watch` | stream | Logs/Live (live traffic log) |

Python helpers: `_collect_status()`, `_collect_services()`, `_collect_resources()` extracted to serve both REST and SSE endpoints.

### Dashboard Resources Card
- 3 system rows: CPU%, RAM (used/total GB), Disk (used/total GB)
- Per-service table: name | CPU% | RAM (font-mono, text-sm)
- Data via SSE `/api/resources/watch` — `psutil` on RPi

### Deploy — ru-exclude.txt
- `src/configs/ru-exclude.txt` (local) → deployed to `/etc/splitgate/ru-list-exclude.txt` on RPi
- `deploy-admin.sh` detects both `ru-list-exclude.txt` and `ru-exclude.txt` filenames (handles legacy)

### Commands Visualization (implemented as)
- `splitgate status` → Dashboard page
- `splitgate watch` → Logs / Watch Live sub-route
- `splitgate update` → Config page "Refresh RU List" button
- `splitgate rollback` → Settings page Rollback button (confirmation modal)
- `splitgate admin` CLI subcommand added to `src/scripts/splitgate` dispatcher

### Systemd & Rollback
- `splitgate-admin.service` — ExecStart, EnvironmentFile, User=root, Restart=on-failure
- `vpn-rollback.sh` Step 0: stop + disable `splitgate-admin.service`, remove `/etc/splitgate/admin/` and `/usr/local/bin/splitgate-admin`

</decisions>

<deviations>
## Deviations from Original Plan

| Original | Actual | Reason |
|----------|--------|--------|
| `WWW-Authenticate: Basic` on 401 | Header removed; cookie-based session | Chrome shows native auth dialog on `WWW-Authenticate` — blocked UX |
| Conditional Stage 29 in `deploy.sh` | Separate `deploy-admin.sh` script | Cleaner separation; deploy.sh handles initial infra only |
| Log subsections as tabs in one component | 5 separate sub-routes via React Router nested routing | User requested each tab as separate page |
| ADMIN_PORT=80 / splitgate.lan domain | Reverted to 8080; domain abandoned | Mac DNS from Keenetic, not RPi dnsmasq — domain didn't resolve |
| `.env.secrets` / VPN keys editable in Settings | Only `.env` vars; secrets excluded | Deferred; acceptable security trade-off |
| Settings page: no AWG restart button | Added inline Restart awg0 button after config upload | User request during batch 5 |
| No theme system | Light/Dark/System theme with CSS vars | User request during batch 5 |
| Dashboard: no resources | Added Resources card (CPU/RAM/Disk + per-service) | User request during batch 5 |
| Polling for services/status | SSE for all real-time data | User confirmed during batch 7 |

</deviations>

<canonical_refs>
## Canonical References

### Shipped Files
- `src/scripts/splitgate-admin.py` — Flask backend (single file, ~500 lines)
- `src/admin/src/App.jsx` — HashRouter, 6 routes, nested /logs/*
- `src/admin/src/pages/Dashboard.jsx` — SSE status + resources
- `src/admin/src/pages/Services.jsx` — SSE services + bulk actions
- `src/admin/src/pages/Routes.jsx` — CIDR CRUD
- `src/admin/src/pages/Logs.jsx` — LogsLayout + LogsLive/History/Install/Errors/Journal
- `src/admin/src/pages/Config.jsx` — exclude list + last-updated
- `src/admin/src/pages/Settings.jsx` — env editor, AWG upload, theme, rollback
- `src/admin/src/hooks/useTheme.js` — theme management hook
- `src/admin/src/logStream.js` — module-level SSE singleton (persists across navigation)
- `src/admin/src/index.css` — CSS vars + @custom-variant dark + @theme
- `src/admin/index.html` — title, meta description, no-flash theme init script
- `src/deploy-admin.sh` — 5-step build + deploy script
- `src/systemd/splitgate-admin.service` — systemd unit
- `src/configs/ru-exclude.txt` — local exclude list (deployed to RPi by deploy-admin.sh)

### Key Scripts
- `src/scripts/splitgate` — dispatcher with `admin` subcommand
- `src/scripts/routing.sh` — triggered by Routes Apply button (`--no-update`)
- `src/scripts/update-vpn-routes` — triggered by Config Refresh button
- `src/scripts/vpn-rollback.sh` — triggered by Settings Rollback button

### Config Files
- `src/configs/isp-routes-custom.txt` — managed by Routes page
- `src/configs/vpn-routes-custom.txt` — managed by Routes page

### Log Paths on RPi
- `/etc/splitgate/logs/watch-YYYY-MM-DD.log` — SSE stream source (LogsLive)
- `/etc/splitgate/logs/watch-error.log` — daemon stderr (LogsErrors)
- `/etc/splitgate/logs/install.log` — routing/update events (LogsInstall)

</canonical_refs>

<deferred>
## Deferred Ideas

- `.env.secrets` / VPN key editing in Settings — LAN + Basic Auth deemed sufficient gate; not built
- HTTPS / TLS termination — LAN-only, HTTP acceptable
- Multi-user auth / RBAC — single shared secret is sufficient
- Mobile-responsive design — not explicitly required
- Phase 14 (dnsmasq ipset) integration in Routes UI — deferred until Phase 14 is implemented
- splitgate.lan mDNS / local domain — Mac gets DNS from Keenetic, not RPi; not feasible without Keenetic config

</deferred>

---

*Phase: 15-web-admin-interface*
*Context gathered: 2026-06-30*
*Phase completed: 2026-07-03*
*Commits: 9e530c4 (batch 4), 5b5be60 (batch 5), abe23db (batch 6), f4aa475 (batch 7)*
