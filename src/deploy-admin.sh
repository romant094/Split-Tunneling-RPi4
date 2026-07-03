#!/usr/bin/env bash
# deploy-admin.sh — build React SPA and deploy admin backend to RPi
# Usage: bash src/deploy-admin.sh
# Or:   npm run deploy:admin  (from project root)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

SSH_HOST="pi4"
ADMIN_DIST_REMOTE="/etc/splitgate/admin"
ADMIN_PY_REMOTE="/usr/local/bin/splitgate-admin"

echo "[1/4] Building React SPA..."
cd admin
npm run build
cd ..

echo "[2/4] Uploading dist/ to ${SSH_HOST}:${ADMIN_DIST_REMOTE}..."
ssh -o BatchMode=yes "${SSH_HOST}" "sudo rm -rf /tmp/sg-admin-tmp && mkdir -p /tmp/sg-admin-tmp"
scp -r -o BatchMode=yes admin/dist/. "${SSH_HOST}:/tmp/sg-admin-tmp/"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mkdir -p ${ADMIN_DIST_REMOTE} && sudo cp -r /tmp/sg-admin-tmp/. ${ADMIN_DIST_REMOTE}/ && sudo rm -rf /tmp/sg-admin-tmp && sudo chown -R root:root ${ADMIN_DIST_REMOTE}"

echo "[3/4] Uploading splitgate-admin.py to ${SSH_HOST}:${ADMIN_PY_REMOTE}..."
scp -o BatchMode=yes scripts/splitgate-admin.py "${SSH_HOST}:/tmp/sg-admin-py.tmp"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv /tmp/sg-admin-py.tmp ${ADMIN_PY_REMOTE} && sudo chmod +x ${ADMIN_PY_REMOTE} && sudo chown root:root ${ADMIN_PY_REMOTE}"

echo "[4/4] Restarting splitgate-admin.service..."
ssh -o BatchMode=yes "${SSH_HOST}" "sudo systemctl restart splitgate-admin.service"

echo ""
echo "Admin deployed → http://192.168.1.254:8080"
