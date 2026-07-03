---
plan: "15-01"
phase: "15-web-admin-interface"
status: complete
---

## What Was Built

- `src/scripts/splitgate-admin.py` — single-file Flask admin backend (402 lines)
- `src/admin/.gitignore` — excludes node_modules/, dist/ tracked

## Key Decisions Implemented

- D-08: Single-file Flask, no external Python deps beyond Flask
- D-09: HTTP Basic Auth via /etc/splitgate/admin.secret with secrets.compare_digest
- D-10: ADMIN_PORT env var (default 8080)
- D-11: Runs as root (systemd)

## API Endpoints Created

GET /api/status, GET/POST/DELETE /api/routes/vpn, GET/POST/DELETE /api/routes/isp,
GET /api/services, POST /api/services/{name}/{action},
POST /api/config/apply, GET /api/logs/watch (SSE), GET /api/logs/install,
GET /api/logs/watch-errors, GET /api/logs/journal,
GET/PUT /api/config/exclude, POST /api/config/update,
GET/PUT /api/settings/env, GET/PUT /api/settings/secrets,
POST /api/settings/password, POST /api/auth/logout, POST /api/settings/rollback

## Verification

- python3 AST parse: OK
- secrets.compare_digest: present
- shell=True: absent
- File length: 402 lines (≥300)
- .gitignore: node_modules/ only, no dist
