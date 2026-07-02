---
plan: "15-03"
phase: "15-web-admin-interface"
status: complete
---

## What Was Built

- `src/systemd/splitgate-admin.service` — systemd unit (ExecStart, EnvironmentFile, User=root, Restart=on-failure)
- `src/deploy.sh` — TOTAL_STAGES=29, admin vars, preflight checks, conditional Stage 29 block
- `src/scripts/vpn-rollback.sh` — Step 0 stops splitgate-admin.service; removes binary and unit file
- `.env` — ADMIN_PORT=8080 added

## Key Decisions Implemented

- D-05: deploy.sh skips admin stages if src/admin/dist/ missing (graceful)
- D-06: New conditional Stage 29 in deploy.sh
- D-07: Admin files deploy to /etc/splitgate/admin/ on RPi
- D-10: ADMIN_PORT=8080 in .env

## Verification

- bash -n src/deploy.sh: OK
- bash -n src/scripts/vpn-rollback.sh: OK
- TOTAL_STAGES=29: present
- Admin UI skip message: present
- splitgate-admin.service in rollback: present
