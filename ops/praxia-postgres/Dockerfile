# Imagen de PostgreSQL 16 para Praxia con pgBackRest embebido.
#
# Uso en la VPS de producción:
#   docker build -t praxia-postgres:16 .
#
# La imagen se usa como imagen de la base de datos en Coolify (campo Image).
# Coolify no intenta descargarla si ya existe localmente con ese tag.
# En una reconstrucción de la VPS debe reconstruirse antes de levantar la base.
#
# Secretos: NO se hornean en la imagen. El contenedor monta el secrets.conf
# del host (root:root, 640) directamente en /etc/pgbackrest/secrets.conf
# mediante la opción Custom Docker Options de Coolify:
#   -v /data/praxia-pgbackrest/secrets.conf:/etc/pgbackrest/secrets.conf:ro
# pgBackRest carga automáticamente todos los *.conf de /etc/pgbackrest
# (la opción `include` no existe en 2.58); ahí van repo1-s3-key y
# repo1-s3-key-secret.
FROM postgres:16-alpine

RUN apk add --no-cache pgbackrest \
  && mkdir -p /var/spool/pgbackrest \
  && chown -R postgres:postgres /var/spool/pgbackrest

COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf

# La configuración de archivado va en el campo Custom PostgreSQL
# configuration de Coolify:
#   archive_mode = on
#   archive_command = 'pgbackrest --stanza=main archive-push %p'
#   archive_timeout = 60
