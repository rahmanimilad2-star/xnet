#!/usr/bin/env bash
# Consistent online backup of the SQLite DB. Cron example: 0 3 * * * /opt/vpn-panel/deploy/backup.sh
set -euo pipefail
mkdir -p /var/backups/vpn-panel
sqlite3 /var/lib/vpn-panel/data.db ".backup '/var/backups/vpn-panel/data-$(date +%F).db'"
find /var/backups/vpn-panel -name 'data-*.db' -mtime +14 -delete
