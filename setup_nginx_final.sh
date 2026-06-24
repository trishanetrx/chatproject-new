#!/bin/bash
set -e

cat > /etc/nginx/sites-available/chatapp << 'EOF'
server {
    listen 80;
    server_name clipmanz.shop;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name clipmanz.shop;

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

ln -sf /etc/nginx/sites-available/chatapp /etc/nginx/sites-enabled/chatapp
nginx -t && systemctl reload nginx && echo "Nginx reloaded OK"
