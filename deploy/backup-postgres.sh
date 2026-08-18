#!/usr/bin/env bash
# Automated PostgreSQL backup for RideMesh.
# Install: crontab -e as a user with pg_dump access, e.g.:
#   0 */6 * * * /path/to/deploy/backup-postgres.sh >> /var/log/ridemesh-backup.log 2>&1
#
# Keeps 14 days of 6-hourly backups by default; adjust RETENTION_DAYS as needed.
# For real disaster recovery, also copy BACKUP_DIR off-box (S3, another VPS, etc.) --
# a backup that lives on the same disk as the database is not a backup.
set -euo pipefail

DB_NAME="${DB_NAME:-ridemesh}"
DB_USER="${DB_USER:-ridemesh_app}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ridemesh}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

FILE="$BACKUP_DIR/ridemesh-$TIMESTAMP.sql.gz"
pg_dump -U "$DB_USER" -h 127.0.0.1 "$DB_NAME" | gzip > "$FILE"
echo "$(date -Iseconds) Backup written: $FILE ($(du -h "$FILE" | cut -f1))"

# Prune backups older than RETENTION_DAYS
find "$BACKUP_DIR" -name 'ridemesh-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
echo "$(date -Iseconds) Pruned backups older than $RETENTION_DAYS days"

# --- Restore procedure (manual, documented here for when you actually need it) ---
# 1. Stop the app:            pm2 stop ridemesh-api
# 2. Drop/recreate the db:    dropdb ridemesh && createdb -O ridemesh_app ridemesh
# 3. Restore:                 gunzip -c /var/backups/ridemesh/ridemesh-<timestamp>.sql.gz | psql -U ridemesh_app -h 127.0.0.1 ridemesh
# 4. Restart the app:         pm2 start ridemesh-api
