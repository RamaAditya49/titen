#!/usr/bin/env bash
set -euo pipefail

# Titen backup — call from cron or the bundled systemd timer.
# Usage: ./backup.sh [db_path] [backup_dir]
#
# The copy and its integrity check are done by "titen backup", which reuses the
# service's own database code. Bun is already required to run Titen, so this
# needs no sqlite3 CLI on the host. This script owns only filesystem work:
# permissions, checksums, and retention.

DB_PATH="${1:-/var/lib/titen/titen.db}"
BACKUP_DIR="${2:-/var/lib/titen/backups}"
RETENTION_DAYS="${TITEN_BACKUP_RETENTION_DAYS:-30}"
TITEN_ROOT="${TITEN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_FILE="${BACKUP_DIR}/titen_$(date +%Y%m%d_%H%M%S).db"

[ -f "${DB_PATH}" ] || { echo "ERROR: database not found: ${DB_PATH}" >&2; exit 1; }
command -v bun >/dev/null 2>&1 || { echo "ERROR: bun not found on PATH" >&2; exit 1; }

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

# A backup that cannot verify itself is removed rather than left looking usable.
if ! bun "${TITEN_ROOT}/src/runtime/bun/cli.ts" backup --db "${DB_PATH}" --out "${BACKUP_FILE}"; then
  rm -f "${BACKUP_FILE}"
  echo "ERROR: backup failed verification" >&2
  exit 1
fi

chmod 600 "${BACKUP_FILE}"
sha256sum "${BACKUP_FILE}" > "${BACKUP_FILE}.sha256"
chmod 600 "${BACKUP_FILE}.sha256"

# Prune both halves of a pair so a removed database never leaves an orphan sum.
find "${BACKUP_DIR}" -name 'titen_*.db' -mtime "+${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}" -name 'titen_*.db.sha256' -mtime "+${RETENTION_DAYS}" -delete

echo "Backup complete: ${BACKUP_FILE}"
