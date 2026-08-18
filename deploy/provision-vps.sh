#!/usr/bin/env bash
# One-time VPS provisioning for RideMesh at track.zeekerstech.com.
# Run as root (or with sudo) on a fresh Ubuntu 22.04/24.04 VPS.
# Review each section before running -- this is a starting point, not a black box.
set -euo pipefail

echo "== System packages =="
apt-get update
apt-get install -y curl git nginx postgresql postgresql-contrib ufw certbot python3-certbot-nginx

echo "== Node.js 20 LTS (via nodesource) =="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2

echo "== Firewall: only SSH, HTTP, HTTPS reach the box. Postgres (5432) and the Node app"
echo "   (4000) are NOT opened -- they stay bound to 127.0.0.1 only. =="
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "== PostgreSQL: create the app database + a least-privilege app user =="
sudo -u postgres psql <<'SQL'
CREATE DATABASE ridemesh;
CREATE USER ridemesh_app WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE ridemesh TO ridemesh_app;
SQL
echo "   -> Edit /etc/postgresql/*/main/postgresql.conf to confirm listen_addresses = 'localhost'"
echo "   -> Then: node db/migrate.js  (from backend/, with DATABASE_URL set in .env)"

echo "== Nginx site =="
cp deploy/nginx-track.zeekerstech.com.conf /etc/nginx/sites-available/track.zeekerstech.com
ln -sf /etc/nginx/sites-available/track.zeekerstech.com /etc/nginx/sites-enabled/track.zeekerstech.com
nginx -t

echo "== SSL certificate (run AFTER DNS for track.zeekerstech.com points at this server) =="
echo "   certbot --nginx -d track.zeekerstech.com"

echo "== Deploy frontend static files =="
mkdir -p /var/www/ridemesh/frontend
echo "   -> copy the contents of frontend/ here, then: systemctl reload nginx"

echo "== Start the app under PM2 =="
echo "   cd backend && npm install --production && pm2 start ecosystem.config.js"
echo "   pm2 save && pm2 startup   # persists across reboots"

echo ""
echo "Provisioning steps printed above are intentionally NOT all auto-executed --"
echo "review DB password, DNS, and cert steps before running them for real."
