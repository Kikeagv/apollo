# Imagen de PostgreSQL 16 para Praxia con pgBackRest embebido.
#
# Uso en la VPS de producción:
#   docker build -t praxia-postgres:16 .
#
# La imagen se usa como imagen de la base de datos en Coolify (campo Image).
# Coolify no intenta descargarla si ya existe localmente con ese tag.
# En una reconstrucción de la VPS debe reconstruirse antes de levantar la base.
#
# Secretos: NO se hornean en la imagen. El contenedor monta
# /data/praxia-pgbackrest (host, root:root, 700) en /etc/pgbackrest-conf:ro
# mediante la opción Custom Docker Options de Coolify:
#   -v /data/praxia-pgbackrest:/etc/pgbackrest-conf:ro
# y el archivo secrets.conf (host, 600) aporta repo1-s3-key y
# repo1-s3-key-secret vía la directiva `include` de pgBackRest.
FROM postgres:16-alpine

RUN apk add --no-cache pgbackrest \
  && mkdir -p /var/spool/pgbackrest /etc/pgbackrest-conf \
  && chown -R postgres:postgres /var/spool/pgbackrest

COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf

# La configuración de archivado va en el campo Custom PostgreSQL
# configuration de Coolify:
#   archive_mode = on
#   archive_command = 'pgbackrest --stanza=main archive-push %p'
#   archive_timeout = 60
