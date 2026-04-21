#!/usr/bin/env bash
# Restore the latest pg_dump from GCS into the running Postgres pod.
# Usage: ./scripts/restore.sh [backup_filename]
#
# If no filename is given, the most recently uploaded backup is picked.

set -euo pipefail

BUCKET="${BUCKET:-gs://tfg-cloudpipeline-pg-backups}"
NAMESPACE="${NAMESPACE:-data}"
POD="${POD:-postgres-0}"

log() { echo "[restore] $*"; }

FILE="${1:-}"
if [[ -z "$FILE" ]]; then
  log "listing backups in $BUCKET"
  FILE="$(gcloud storage ls "$BUCKET/" | sort | tail -n1)"
  FILE="${FILE##*/}"
  if [[ -z "$FILE" ]]; then
    log "ERROR: no backups found in $BUCKET"
    exit 1
  fi
fi
log "restoring $FILE"

TMP="/tmp/$FILE"
gcloud storage cp "$BUCKET/$FILE" "$TMP"

log "copying dump into $NAMESPACE/$POD"
kubectl -n "$NAMESPACE" cp "$TMP" "$POD:/tmp/$FILE"
rm -f "$TMP"

log "running pg_restore (--clean --if-exists)"
kubectl -n "$NAMESPACE" exec "$POD" -- \
  sh -c "pg_restore --clean --if-exists --no-owner --no-privileges \
    -U \$POSTGRES_USER -d \$POSTGRES_DB /tmp/$FILE && rm /tmp/$FILE"

log "done"
