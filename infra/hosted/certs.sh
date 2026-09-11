#!/usr/bin/env sh
# Issue the three certificates through the shared nginx's certbot webroot.
# Run once from the server, with webyz.bootstrap.conf (or webyz.conf) already
# installed and reloaded so the ACME path answers on port 80.
#
#   ./certs.sh you@webyz.io
#
# Renewal is the existing daily cron in suneer's crontab: it renews every
# certificate in the shared certbot directory and reloads nginx, so nothing
# more is needed once these exist.
set -eu
EMAIL="${1:?usage: certs.sh <email for expiry notices>}"
NGINX="${NGINX_HOME:-$HOME/apps/nginx}"
issue() {
  docker run --rm \
    -v "$NGINX/certbot/conf:/etc/letsencrypt" \
    -v "$NGINX/certbot/www:/var/www/certbot" \
    certbot/certbot certonly --webroot -w /var/www/certbot \
    --non-interactive --agree-tos --email "$EMAIL" --keep-until-expiring "$@"
}
issue -d webyz.io -d www.webyz.io
issue -d app.webyz.io
issue -d api.webyz.io
echo "certificates issued; install nginx/webyz.conf and reload"
