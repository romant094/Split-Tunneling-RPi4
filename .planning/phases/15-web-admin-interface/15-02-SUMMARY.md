---
plan: "15-02"
phase: "15-web-admin-interface"
status: complete
---

## What Was Built

- `src/admin/` — Vite + React SPA project
- `src/admin/src/api.js` — shared fetch helper with Basic Auth + cookie support
- `src/admin/src/App.jsx` — HashRouter with login form + 6 routes
- `src/admin/src/pages/Dashboard.jsx` — status cards, 10s auto-refresh
- `src/admin/src/pages/Services.jsx` — service table with start/stop/restart, correct disabled states
- `src/admin/src/pages/Routes.jsx` — VPN + ISP CIDR CRUD + Apply button
- `src/admin/src/pages/Logs.jsx` — 4-tab log viewer, SSE with withCredentials, [VPN]=cyan [ISP]=yellow
- `src/admin/src/pages/Config.jsx` — ru-list-exclude.txt editor + RU list refresh
- `src/admin/src/pages/Settings.jsx` — env/secrets KV editor, password change, Rollback modal
- `src/admin/dist/` — built and committed to repo

## Key Decisions Implemented

- D-01: React + Vite SPA
- D-02: dist/ committed to repo (no Node.js on RPi)
- D-03: src/admin/ source, src/admin/dist/ build output
- D-04: HashRouter (hash mode)
- D-12: Services button disabled states
- D-13: 4-tab Logs with SSE EventSource withCredentials
- D-14: Settings KV editor with masking + Rollback modal

## Verification

- npm run build: OK
- dist/index.html: present
- HashRouter: present in App.jsx
- EventSource withCredentials:true: present in Logs.jsx
- node_modules: not staged
