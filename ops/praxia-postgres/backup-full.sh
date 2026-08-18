#!/usr/bin/env sh
# Backup full diario de la base de Praxia hacia Cloudflare R2 con pgBackRest.
# Corre por cron en la VPS (root): 30 11 * * *  (05:30 hora de El Salvador).
set -eu

CONTAINER=$(docker ps --filter ancestor=localhost:5000/praxia-postgres:16 --format '{{.Names}}' | head -n 1)
if [ -z "$CONTAINER" ]; then
  echo "ERROR: contenedor localhost:5000/praxia-postgres:16 no encontrado" >&2
  exit 1
fi

docker exec -u postgres "$CONTAINER" pgbackrest --stanza=main backup --type=full
