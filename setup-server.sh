#!/bin/bash
# set -e  # We handle errors manually for better logging

# --- Configuration ---
DOMAIN="${1:-_}" # Pass domain as first argument or edit here
EMAIL=""         # Optional: Email for Certbot

fail() {
    echo "ERROR: $1"
    exit 1
}

echo "Starting Chat Application Setup on Ubuntu..."
echo "Configured for domain: $DOMAIN"

# 1. Update and install dependencies
echo "--- 1/6: Updating packages and installing dependencies ---"
sudo apt update || fail "Apt update failed"
sudo apt install -y curl git build-essential nginx certbot python3-certbot-nginx || fail "Installing dependencies failed"

# 2. Install Node.js v20.x
if ! command -v node >/dev/null 2>&1; then
    echo "--- 2/6: Installing Node.js 20.x ---"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - || fail "NodeSource setup failed"
    sudo apt install -y nodejs || fail "Node.js installation failed"
else
    echo "--- 2/6: Node.js already installed ($(node -v)) ---"
fi

# 3. Verify Node installation
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# 4. Install PM2 globally
if ! command -v pm2 >/dev/null 2>&1; then
    echo "--- 3/6: Installing PM2 ---"
    sudo npm install -g pm2 || fail "PM2 installation failed"
else
    echo "--- 3/6: PM2 already installed ---"
fi

# 5. Set up Backend
echo "--- 4/6: Configuring Backend ---"
if [ ! -d "server" ]; then
    fail "Directory 'server' not found!"
fi

cd server || fail "Failed to enter server directory"

echo "Installing backend dependencies..."
unset NODE_ENV
npm install || fail "Backend npm install failed"

echo "Starting backend with PM2..."
if pm2 describe chat-backend >/dev/null 2>&1; then
    pm2 restart chat-backend --update-env || fail "PM2 restart failed"
else
    pm2 start server.js --name chat-backend || fail "PM2 start failed"
fi

pm2 save || fail "PM2 save failed"
pm2 startup systemd -u root --hp /root || true

cd .. || fail "Failed to return to project root"

# 6. Set up Frontend
echo "--- 5/6: Configuring Frontend ---"
if [ ! -d "client" ]; then
    fail "Directory 'client' not found!"
fi

cd client || fail "Failed to enter client directory"

echo "Installing frontend dependencies..."
unset NODE_ENV
npm config delete production >/dev/null 2>&1 || true
rm -rf node_modules package-lock.json
npm install --include=dev --unsafe-perm || fail "Frontend npm install failed"

if [ ! -f "node_modules/.bin/vite" ]; then
    echo "Vite not found in local dependencies, installing it explicitly..."
    npm install -D vite || fail "Explicit vite install failed"
fi

echo "Building React static files..."
chmod -R +x node_modules/.bin 2>/dev/null || true
npm run build || fail "Frontend build failed"

cd .. || fail "Failed to return to project root"

echo "--- 6/6: Configuring NGINX ---"
APP_DIR="$(pwd)"
CLIENT_DIST="$APP_DIR/client/dist"

if [ ! -d "$CLIENT_DIST" ]; then
    fail "Frontend build directory '$CLIENT_DIST' not found!"
fi

echo "Setting permissions for $APP_DIR..."
chmod 755 "$HOME" || true
chmod -R 755 "$APP_DIR" || fail "Failed setting permissions on app directory"

NGINX_CONF="/etc/nginx/sites-available/chatapp"

echo "Creating Nginx configuration at $NGINX_CONF..."
sudo tee "$NGINX_CONF" > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    root $CLIENT_DIST;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /socket.io/ {
        proxy_pass http://localhost:5000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

echo "Enabling the Nginx site..."
sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/chatapp || fail "Failed to enable Nginx site"
sudo rm -f /etc/nginx/sites-enabled/default

echo "Testing Nginx configuration..."
sudo nginx -t || fail "Nginx configuration test failed"

echo "Restarting Nginx..."
sudo systemctl restart nginx || fail "Nginx restart failed"
sudo systemctl enable nginx || fail "Failed to enable Nginx"

echo ""
echo "===================================================="
echo "   Setup Complete! Chat Application is ready."
echo "===================================================="
echo "Access it via: http://${DOMAIN:-$(curl -s ifconfig.me)}"
echo ""

# 7. SSL Configuration (Certbot)
if [ "$DOMAIN" != "_" ]; then
    echo "--- OPTIONAL: SSL Configuration (Certbot) ---"
    read -p "Would you like to perform an SSL dry-run for $DOMAIN? (y/n): " test_ssl
    if [[ "$test_ssl" =~ ^[Yy]$ ]]; then
        echo "Running Certbot dry-run..."
        sudo certbot certonly --nginx --dry-run -d "$DOMAIN" ${EMAIL:+--email $EMAIL --no-eff-email --agree-tos}
        
        if [ $? -eq 0 ]; then
            echo "SUCCESS: Dry-run verification passed!"
            read -p "Would you like to install the real SSL certificate now? (y/n): " real_ssl
            if [[ "$real_ssl" =~ ^[Yy]$ ]]; then
                sudo certbot --nginx -d "$DOMAIN" ${EMAIL:+--email $EMAIL --no-eff-email --agree-tos}
                echo "SSL Certificate installed and applied to Nginx."
            else
                echo "Skipping real SSL installation."
            fi
        else
            echo "ERROR: SSL Dry-run failed. Please check your DNS settings."
        fi
    fi
fi

echo "===================================================="