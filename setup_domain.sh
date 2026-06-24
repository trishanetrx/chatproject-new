#!/bin/bash
set -e

DOMAIN="clipmanz.shop"
EMAIL="admin@clipmanz.shop"
NGINX_CONF="/etc/nginx/sites-available/chatapp"

echo "==> Writing initial HTTP Nginx config for cert challenge..."
cat > "$NGINX_CONF" << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/chatapp
nginx -t && systemctl reload nginx

echo "==> Requesting SSL certificate..."
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
    --agree-tos --no-eff-email --email "$EMAIL" \
    --redirect --non-interactive

echo "==> Writing final HTTPS Nginx config..."
cat > "$NGINX_CONF" << 'EOF'
server {
    listen 80;
    server_name clipmanz.shop www.clipmanz.shop;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name clipmanz.shop www.clipmanz.shop;

    ssl_certificate     /etc/letsencrypt/live/clipmanz.shop/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/clipmanz.shop/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 50M;

    location /api/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    location /socket.io/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "Upgrade";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    error_log  /var/log/nginx/chatapp_error.log;
    access_log /var/log/nginx/chatapp_access.log;
}
EOF

nginx -t && systemctl reload nginx

echo ""
echo "================================================"
echo "  Done! Chat app live at https://clipmanz.shop"
echo "================================================"
