#!/bin/bash
set -e
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"
if ! git -c safe.directory="$APP_DIR" diff --quiet || ! git -c safe.directory="$APP_DIR" diff --cached --quiet; then
    echo "Deployment stopped: commit or reconcile local changes before updating."
    exit 1
fi
git -c safe.directory="$APP_DIR" pull --ff-only origin main
cd server
npm ci --omit=dev
cd "$APP_DIR/client"
unset NODE_ENV
npm ci --include=dev
chmod -R +x node_modules/.bin/ node_modules/vite/bin/
node node_modules/vite/bin/vite.js build
cd "$APP_DIR"
pm2 restart chat-backend
pm2 save
echo "Redeployed OK"
