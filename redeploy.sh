#!/bin/bash
set -e
git config --global --add safe.directory /root/chatproject-new
cd /root/chatproject-new
git fetch origin
git reset --hard origin/main
cd server && npm install --omit=dev
cd /root/chatproject-new/client
unset NODE_ENV
npm install --include=dev
chmod -R +x node_modules/.bin/ node_modules/vite/bin/
node node_modules/vite/bin/vite.js build
cd /root/chatproject-new
pm2 restart chat-backend
pm2 save
echo "Redeployed OK"
