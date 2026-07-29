#!/usr/bin/env bash
set -euo pipefail

# Titen backup script - call from cron or systemd timer
# Usage: ./backup.sh [db_path] [backup_dir]

DB_PATH="${1:-/var/lib/titen/titen.db}"
BACKUP_DIR="${2:-/var/lib/titen/backups}"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/titen_${TIMESTAMP}.db"

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

# Use SQLite's .backup command (safe for live databases with WAL)
sqlite3 "${DB_PATH}" ".backup '${BACKUP_FILE}'"

# Verify integrity
RESULT=$(sqlite3 "${BACKUP_FILE}" "PRAGMA integrity_check;")
if [ "$RESULT" != "ok" ]; then
  echo "ERROR: Backup integrity check failed" >&2
  rm -f "${BACKUP_FILE}"
  exit 1
fi

# Set permissions
chmod 600 "${BACKUP_FILE}"

# Checksum
sha256sum "${BACKUP_FILE}" > "${BACKUP_FILE}.sha256"
chmod 600 "${BACKUP_FILE}.sha256"

# Prune old backups
find "${BACKUP_DIR}" -name "titen_*.db" -mtime +${RETENTION_DAYS} -delete
find "${BACKUP_DIR}" -name "titen_*.sha256" -mtime +${RETENTION_DAYS} -delete

echo "Backup complete: ${BACKUP_FILE}"
