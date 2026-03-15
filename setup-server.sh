#!/bin/bash
set -e

# chatproject Setup Script for Ubuntu
echo "Starting Chat Application Setup on Ubuntu..."

# 1. Update and install dependencies
echo "Updating packages and installing build tools..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential nginx certbot python3-certbot-nginx

# 2. Install Node.js v20.x
echo "Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Verify Node installation
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# 4. Install PM2 globally
echo "Installing PM2..."
sudo npm install -g pm2

# 5. Set up Backend
echo "Configuring Backend..."
cd server
npm install
# Start backend via PM2 (restart if already running)
pm2 restart chat-backend || pm2 start server.js --name chat-backend
pm2 save
pm2 startup | tail -n 1 | bash # Set PM2 to start on boot
cd ..

# 6. Set up Frontend (NGINX & React Build)
echo "Building React static files..."
cd client
npm install
npm run build
cd ..

echo "Configuring NGINX for Frontend and API Proxy..."
# We assume the script is run from the root of the cloned repo
APP_DIR=$(pwd)
CLIENT_DIST="$APP_DIR/client/dist"

# Ensure NGINX can read the files in the home directory
chmod 755 $HOME
chmod -R 755 $APP_DIR

NGINX_CONF="/etc/nginx/sites-available/chatapp"

sudo tee $NGINX_CONF > /dev/null <<EOF
server {
    listen 80;
    server_name _; # Change this to your domain later

    root $CLIENT_DIST;
    index index.html;

    # Serve static React frontend
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Proxy API requests to Node backend
    location /api/ {
        proxy_pass http://localhost:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        
        # Real IP Forwarding
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Proxy Socket.io connections
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
sudo ln -sf $NGINX_CONF /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Restart NGINX
sudo systemctl restart nginx

echo "Setup Complete! Your application should now be accessible on this server's IP address."
echo "If you want to configure SSL for a domain, simply run: sudo certbot --nginx -d yourdomain.com"
