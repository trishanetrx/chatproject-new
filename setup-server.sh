#!/bin/bash
# setup-server.sh - Standalone deployment for ChatApp
# Serves React frontend + Node backend from the same server (no Netlify)
#
# Usage:
#   bash setup-server.sh <domain>        e.g. bash setup-server.sh chat.copythingz.shop
#   bash setup-server.sh _               (use server IP, no SSL)
#
set -e

DOMAIN="${1:-_}"
EMAIL="admin@copythingz.shop"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIST="$APP_DIR/client/dist"
NGINX_CONF="/etc/nginx/sites-available/chatapp"

fail() { echo "ERROR: $1"; exit 1; }

echo "================================================"
echo "  ChatApp Standalone Deploy"
echo "  Domain : $DOMAIN"
echo "  App dir: $APP_DIR"
echo "================================================"

# ── 1. System deps ────────────────────────────────────────────────────────────
echo "==> Installing system dependencies..."
apt-get update -y
apt-get install -y curl git nginx certbot python3-certbot-nginx

# ── 2. Node.js 20 ─────────────────────────────────────────────────────────────
if ! node -v 2>/dev/null | grep -q "^v20"; then
    echo "==> Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
echo "==> Node $(node -v) / npm $(npm -v)"

# ── 3. PM2 ────────────────────────────────────────────────────────────────────
npm install -g pm2@latest

# ── 4. Backend deps ───────────────────────────────────────────────────────────
echo "==> Installing backend dependencies..."
cd "$APP_DIR/server"
npm install --omit=dev

# ── 5. Frontend build ─────────────────────────────────────────────────────────
echo "==> Installing frontend dependencies and building..."
cd "$APP_DIR/client"
npm install
npm run build

[ -d "$CLIENT_DIST" ] || fail "Frontend build failed — dist/ not found"
echo "==> Frontend built at $CLIENT_DIST"

# ── 6. .env check ─────────────────────────────────────────────────────────────
cd "$APP_DIR/server"
if [ ! -f ".env" ]; then
    echo "==> No .env found — generating one..."
    JWT_SECRET=$(openssl rand -hex 32)
    COOKIE_SECRET=$(openssl rand -hex 16)
    cat > .env <<EOF
PORT=5000
DB_PATH=./database/chat.db
JWT_SECRET=${JWT_SECRET}
COOKIE_SECRET=${COOKIE_SECRET}
ADMIN_USERNAME=Admin
ADMIN_PASSWORD=ChangeMe123!
EOF
    echo "  .env created. Change ADMIN_PASSWORD before going live."
else
    echo "==> .env already exists, skipping."
fi

# ── 7. PM2 ────────────────────────────────────────────────────────────────────
echo "==> Starting app with PM2..."
cat > "$APP_DIR/ecosystem.config.js" <<'ECOSYSTEM'
require('dotenv').config({ path: __dirname + '/server/.env' });
module.exports = {
    apps: [{
        name: 'chat-backend',
        script: './server/server.js',
        cwd: __dirname,
        exec_mode: 'fork',
        instances: 1,
        autorestart: true,
        max_memory_restart: '400M',
        watch: false,
        env_production: {
            NODE_ENV: 'production'
        }
    }]
};
ECOSYSTEM

pm2 stop chat-backend   2>/dev/null || true
pm2 delete chat-backend 2>/dev/null || true
pm2 start "$APP_DIR/ecosystem.config.js" --env production
pm2 save
pm2 startup systemd -u root --hp /root

# ── 8. Nginx ──────────────────────────────────────────────────────────────────
echo "==> Configuring Nginx..."

chmod 755 "$(dirname "$APP_DIR")" || true
chmod -R 755 "$APP_DIR"

CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

# Initial HTTP-only config (for certbot challenge on first run)
if [ "$DOMAIN" != "_" ] && [ ! -f "$CERT_PATH" ]; then
    cat > "$NGINX_CONF" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF
    ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/chatapp
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx

    echo "==> Requesting SSL certificate for ${DOMAIN}..."
    certbot --nginx -d "$DOMAIN" \
        --agree-tos --no-eff-email --email "$EMAIL" \
        --redirect --non-interactive
fi

# Final Nginx config
if [ "$DOMAIN" = "_" ]; then
    # No SSL — plain HTTP (use server IP)
    cat > "$NGINX_CONF" <<EOF
server {
    listen 80 default_server;
    server_name _;

    client_max_body_size 50M;

    location /api/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    location /socket.io/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           \$http_upgrade;
        proxy_set_header   Connection        "Upgrade";
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }

    error_log  /var/log/nginx/chatapp_error.log;
    access_log /var/log/nginx/chatapp_access.log;
}
EOF
else
    # HTTPS config
    cat > "$NGINX_CONF" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 50M;

    location /api/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    location /socket.io/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           \$http_upgrade;
        proxy_set_header   Connection        "Upgrade";
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }

    error_log  /var/log/nginx/chatapp_error.log;
    access_log /var/log/nginx/chatapp_access.log;
}
EOF
fi

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/chatapp
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "================================================"
echo "  ChatApp deployed!"
if [ "$DOMAIN" = "_" ]; then
    echo "  URL: http://$(curl -s ifconfig.me 2>/dev/null || echo '<server-ip>')"
else
    echo "  URL: https://${DOMAIN}"
fi
echo ""
echo "  pm2 logs chat-backend     - live logs"
echo "  pm2 restart chat-backend  - restart app"
echo "  pm2 status                - process status"
echo "================================================"
