#!/usr/bin/env bash
# One-shot installer for Ubuntu 22.04/24.04 / Debian 12.  Usage: sudo bash install.sh panel.example.com you@mail.com
set -euo pipefail
DOMAIN="${1:?domain required}"; EMAIL="${2:?email required for LetsEncrypt}"
APP_DIR=/opt/vpn-panel; DATA_DIR=/var/lib/vpn-panel; ENV_DIR=/etc/vpn-panel
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> packages"
apt-get update -y
apt-get install -y curl ca-certificates nginx certbot python3-certbot-nginx sqlite3 ufw
if ! command -v node >/dev/null || [ "$(node -e 'console.log(+process.versions.node.split(".")[0] >= 22)')" != "true" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> user + dirs"
id vpnpanel >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin vpnpanel
mkdir -p "$APP_DIR" "$DATA_DIR" "$ENV_DIR"
rsync -a --delete --exclude 'data.db*' --exclude '.env' "$SRC_DIR/backend/" "$APP_DIR/backend/"
chown -R vpnpanel:vpnpanel "$DATA_DIR"; chmod 750 "$DATA_DIR"

if [ ! -f "$ENV_DIR/env" ]; then
  echo "==> generating secrets"
  sed -e "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$DOMAIN#" \
      -e "s#^JWT_SECRET=.*#JWT_SECRET=$(openssl rand -hex 32)#" \
      -e "s#^DATA_ENC_KEY=.*#DATA_ENC_KEY=$(openssl rand -hex 32)#" \
      "$APP_DIR/backend/.env.example" > "$ENV_DIR/env"
  chown root:vpnpanel "$ENV_DIR/env"; chmod 640 "$ENV_DIR/env"
fi

echo "==> systemd"
cp "$SRC_DIR/deploy/vpn-panel.service" /etc/systemd/system/vpn-panel.service
systemctl daemon-reload
systemctl enable --now vpn-panel

echo "==> nginx + HTTPS"
sed "s/panel.example.com/$DOMAIN/g" "$SRC_DIR/deploy/nginx-vpn-panel.conf" > /etc/nginx/sites-available/vpn-panel
# first boot without certs: temporary http-only server for the ACME challenge
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  cat > /etc/nginx/sites-enabled/vpn-panel <<NGX
server { listen 80; server_name $DOMAIN; location /.well-known/acme-challenge/ { root /var/www/html; } location / { return 404; } }
NGX
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w /var/www/html -d "$DOMAIN" -m "$EMAIL" --agree-tos -n
fi
ln -sf /etc/nginx/sites-available/vpn-panel /etc/nginx/sites-enabled/vpn-panel
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> firewall"
ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443/tcp; ufw --force enable

echo
echo "Done. Now create the admin account:"
echo "  cd $APP_DIR/backend && sudo -u vpnpanel ENV_FILE=$ENV_DIR/env node --disable-warning=ExperimentalWarning src/cli.js create-admin admin"
echo "Panel: https://$DOMAIN"
