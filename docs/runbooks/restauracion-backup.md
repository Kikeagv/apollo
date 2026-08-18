# Runbook: restauración de la base de datos de Praxia

**Alcance:** restaurar la base de producción `praxia` (PostgreSQL 16 en la VPS OVH,
gestionada por Coolify) desde el repositorio pgBackRest en Cloudflare R2
(bucket `praxia-production-backups`), incluida la recuperación a un punto en el
tiempo (PITR).

**Ejecución:** en la VPS (`ssh -i ~/.ssh/praxia-ovh ubuntu@148.113.180.102`).
Todos los comandos van con `sudo`. No contiene secretos.

**Estado:** probado el 2026-08-18. Tiempos medidos: restore full ≈ 1 min,
replay de WAL ≈ 2 s, PITR ≈ 35 s.

## Contexto operativo

- El contenedor de producción se llama `qyqiwapy2ksbyfnd4kn3dcqp` y usa la
  imagen `localhost:5000/praxia-postgres:16` (servida por el registro Docker
  local `praxia-registry` de la VPS, puerto 127.0.0.1:5000).
- Config de pgBackRest dentro de la imagen: stanza `main`, repo1 en R2,
  `log-path=/var/spool/pgbackrest`. Los secretos S3 se montan desde el host en
  `/etc/pgbackrest/conf.d/secrets.conf` (Coolify → Persistent Storage → Files,
  tipo *Host file mount*).
- El archivo de WAL está activo en producción (`archive_mode=on`,
  `archive_timeout=60`), por lo que el RPO es ≤ 1 minuto y el R2 recibe cada
  segmento al cerrarse o cada minuto, lo que ocurra primero.
- Backups full diarios: cron del host `/etc/cron.d/praxia-pgbackrest` →
  `/opt/praxia-db/backup-full.sh` (11:30 UTC). Retención en repo: 30 fulls.

## Verificación rápida del repo (previa a cualquier restauración)

```sh
sudo docker exec -u postgres qyqiwapy2ksbyfnd4kn3dcqp pgbackrest info --stanza=main
```

`status: ok` y un `full backup` reciente confirman que hay algo que restaurar.

## 1. Restauración completa (último estado)

1. Crear contenedor temporal con la misma imagen y un volumen de datos vacío:

   ```sh
   sudo docker volume create praxia-restore-drill
   sudo docker run -d --name praxia-restore-drill \
     -v praxia-restore-drill:/var/lib/postgresql/data \
     -v /data/praxia-pgbackrest/secrets.conf:/etc/pgbackrest/conf.d/secrets.conf:ro \
     --entrypoint sleep localhost:5000/praxia-postgres:16 infinity
   ```

2. Restaurar el último backup (R2 → volumen temporal):

   ```sh
   sudo docker exec -u postgres praxia-restore-drill \
     pgbackrest --stanza=main --pg1-path=/var/lib/postgresql/data restore
   ```

   Deja `recovery.signal` y `restore_command` preparados para el replay.

3. Arrancar PostgreSQL (replay de WAL hasta el último segmento archivado):

   ```sh
   sudo docker exec -u postgres praxia-restore-drill \
     pg_ctl -D /var/lib/postgresql/data -l /tmp/pg.log -w start
   ```

4. Verificar: el log debe mostrar `archive recovery complete` y la base debe
   responder con los datos esperados:

   ```sh
   sudo docker exec -u postgres praxia-restore-drill \
     psql -U postgres -d praxia -c '\dt'
   ```

## 2. Restauración a un punto en el tiempo (PITR)

Mismos pasos, cambiando el paso 2:

```sh
sudo docker exec -u postgres praxia-restore-drill \
  pgbackrest --stanza=main --pg1-path=/var/lib/postgresql/data \
  --type=time --target='2026-08-18 22:52:30+00' restore
```

- `--target` en UTC, formato `YYYY-MM-DD HH:MM:SS+00`, dentro del rango de WAL
  retenido (mínimo desde el último full).
- El log de arranque debe mostrar `recovery stopping before commit of …` con la
  hora del objetivo.
- Tras verificar, Postgres queda en pausa de recuperación; para usar el clúster
  promoverlo es opcional en el drill (se destruye al final).

## 3. Limpieza del drill

```sh
sudo docker exec -u postgres praxia-restore-drill \
  pg_ctl -D /var/lib/postgresql/data stop -m fast
sudo docker rm -f praxia-restore-drill
sudo docker volume rm praxia-restore-drill
```

## Prueba realizada el 2026-08-18 (evidencia)

- Stanza `main` creada y primer full (`20260818-225033F`, 29.4 MB de BD,
  5.8 MB en repo) verificado en R2 (`repo-ls`: `archive/` y `backup/`).
- WAL: `pg_switch_wal()` tras un INSERT → segmento nuevo en
  `archive/main/16-1` en segundos.
- Restore full en contenedor aislado: ≈ 54 s; replay WAL completo y la tabla
  creada *después* del backup (`wal_probe`) apareció con su fila.
- PITR a `22:52:30+00` (antes del INSERT de las 22:53:03): ≈ 33 s de restore;
  la tabla posterior al objetivo **no existe**, y el log confirma
  `recovery stopping before commit of transaction 743`.

## Reconstrucción de la VPS (para el día que toque)

1. Reinstalar Docker y Coolify.
2. Reconstruir y volver a publicar la imagen en el registro local (antes de
   que Coolify intente arrancar la BD):

   ```sh
   # desde el repo: ops/praxia-postgres/
   docker build -t localhost:5000/praxia-postgres:16 .
   docker push localhost:5000/praxia-postgres:16
   ```

3. Recrear `/data/praxia-pgbackrest/secrets.conf` (root:70, 640, dir 750) con
   las credenciales S3 de R2.
4. Recuperar el registro local: `praxia-registry` (registry:2, data en
   `/data/docker-registry`, bound a 127.0.0.1:5000, restart always).
5. En Coolify: el recurso `praxia` usa imagen `localhost:5000/praxia-postgres:16`,
   el file mount del secreto y la config de archivado (campos ya persistidos).
6. Restaurar con este runbook o re-crear el clúster si el volumen se perdió.
