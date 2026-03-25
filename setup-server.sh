#!/bin/bash
# set -e  # We handle errors manually for better logging


# Function to log and exit on error
fail() {
    echo "ERROR: $1"
    exit 1
}

echo "Starting Chat Application Setup on Ubuntu..."

# 1. Update and install dependencies
echo "--- 1/6: Updating packages and installing dependencies ---"
sudo apt update || fail "Apt update failed"
sudo apt install -y curl git build-essential nginx certbot python3-certbot-nginx || fail "Installing dependencies failed"

# 2. Install Node.js v20.x
if ! command -v node &> /dev/null; then
    echo "--- 2/6: Installing Node.js 20.x ---"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs || fail "Node.js installation failed"
else
    echo "--- 2/6: Node.js already installed ($(node -v)) ---"
fi

# 3. Verify Node installation
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# 4. Install PM2 globally
if ! command -v pm2 &> /dev/null; then
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

cd server
echo "Installing backend dependencies..."
npm install || fail "Backend npm install failed"

echo "Starting backend with PM2..."
pm2 restart chat-backend || pm2 start server.js --name chat-backend || fail "PM2 start failed"
pm2 save
# Fixed PM2 startup for root: remove leading '$' if present
pm2 startup | tail -n 1 | sed 's/^\$ //' | bash
cd ..

# 6. Set up Frontend
echo "--- 5/6: Configuring Frontend ---"
if [ ! -d "client" ]; then
    fail "Directory 'client' not found!"
fi

cd client
echo "Installing frontend dependencies..."
# Use --unsafe-perm if running as root to avoid permission issues
npm install --unsafe-perm || fail "Frontend npm install failed"

echo "Building React static files..."
# Ensure binaries are executable
chmod -R +x node_modules/.bin || true
npm run build || fail "Frontend build failed"
cd ..

echo "--- 6/6: Configuring NGINX ---"
APP_DIR=$(pwd)
CLIENT_DIST="$APP_DIR/client/dist"

if [ ! -d "$CLIENT_DIST" ]; then
    fail "Frontend build directory '$CLIENT_DIST' not found!"
fi

# Ensure NGINX can read the files
echo "Setting permissions for $APP_DIR..."
chmod 755 $HOME
chmod -R 755 $APP_DIR

NGINX_CONF="/etc/nginx/sites-available/chatapp"

echo "Creating Nginx configuration at $NGINX_CONF..."
sudo tee $NGINX_CONF > /dev/null <<EOF
server {
    listen 80;
    server_name _;

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
    }
}
EOF

# Enable the NGINX site
echo "Enabling the Nginx site..."
sudo ln -sf $NGINX_CONF /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx config
echo "Testing Nginx configuration..."
sudo nginx -t || fail "Nginx configuration test failed"

# Restart NGINX
echo "Restarting Nginx..."
sudo systemctl restart nginx || fail "Nginx restart failed"

echo ""
echo "===================================================="
echo "   Setup Complete! Chat Application is ready."
echo "===================================================="
echo "Access it via your server IP: http://$(curl -s ifconfig.me)"
echo "Next step (Optional): Configure SSL with 'sudo certbot --nginx'"
echo "===================================================="
