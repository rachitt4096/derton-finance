#!/usr/bin/env bash
set -euo pipefail

VPS_HOST="root@45.196.196.161"
VPS_DIR="/opt/derton-server"
DERTON_SSH_KEY="${DERTON_SSH_KEY:-/tmp/derton_deploy_key}"

# Connection multiplexing: authenticate once, reuse the same SSH connection for
# rsync + every ssh call below (so the password is only typed a single time).
CTRL_PATH="/tmp/derton_ssh_%h_%p_%r"
SSH_OPTS=(-F none -o StrictHostKeyChecking=accept-new \
  -o ControlMaster=auto -o "ControlPath=${CTRL_PATH}" -o ControlPersist=300)
RSYNC_SSH="ssh -F none -o StrictHostKeyChecking=accept-new -o ControlMaster=auto -o ControlPath=${CTRL_PATH} -o ControlPersist=300"

if [[ -f "$DERTON_SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$DERTON_SSH_KEY")
  RSYNC_SSH="$RSYNC_SSH -i $DERTON_SSH_KEY"
fi

echo "==> Building frontend..."
cd "$(dirname "$0")/derton-finance"
VITE_BACKEND_URL= VITE_BACKEND_WS_URL= npm run build
cd ..

# Open the master connection up front (single password prompt for the whole run).
echo "==> Connecting to VPS (enter the root password once)..."
ssh "${SSH_OPTS[@]}" "$VPS_HOST" "echo connected"

echo "==> Copying frontend dist into Server..."
rm -rf Server/frontend_dist
cp -r derton-finance/dist Server/frontend_dist

echo "==> Syncing code to VPS..."
rsync -az --delete \
  -e "$RSYNC_SSH" \
  --exclude='.env' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.venv' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='*.egg-info' \
  Server/ "$VPS_HOST:$VPS_DIR/"

echo "==> Building Docker image on VPS..."
ssh "${SSH_OPTS[@]}" "$VPS_HOST" "cd $VPS_DIR && docker compose -f docker-compose.prod.yml build api"

echo "==> Restarting services..."
ssh "${SSH_OPTS[@]}" "$VPS_HOST" "cd $VPS_DIR && docker compose -f docker-compose.prod.yml up -d --remove-orphans"

echo "==> Waiting for health (boot does instrument sync + NSE delivery + company master, ~40-90s)..."
ssh "${SSH_OPTS[@]}" "$VPS_HOST" '
  for i in $(seq 1 40); do
    if curl -sf http://localhost:4000/api/health >/tmp/health.json 2>/dev/null; then
      python3 -m json.tool </tmp/health.json
      exit 0
    fi
    sleep 3
  done
  echo "Health check still pending after 120s — the app may still be ingesting data."
  echo "Check: docker logs derton-server-api-1 --tail 40"
  exit 0
'

echo "==> Deploy complete."
