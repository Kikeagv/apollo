# Pendientes de producción — Praxia

**Fecha base:** 18 de agosto de 2026
**Tipo:** documento vivo; marcar cada ítem como resuelto al cerrarse. No contiene secretos.

## Decisiones tomadas el 18 de agosto de 2026

- **APO-26** (`Desplegar el perímetro y recuperación verificable de Apolo`) está reclamado, asignado a Enrique y en In Progress.
- **Plan Cloudflare: Pro activo en live** (decisión de agosto de 2026). El plan se reevalúa al llegar a 5-10 clientes. Queda pendiente configurar con Pro disponible: la regla de rate limit de login (10/min), Super Bot Fight Mode y el Managed Ruleset completo + OWASP.
  - La regla WAF de login ya se puede configurar hoy (cierra el backstop contra intentos distribuidos); los límites por minuto/15 min a nivel de aplicación (APO-56) siguen como defensa en profundidad.
- **Base de datos:** PostgreSQL **16** en la VPS (contenedor gestionado por Coolify; Coolify 4.3.9 no ofrece la 15), sin puerto público. Backup doble: lógico diario (pg_dump) + físico con archivo WAL (pgBackRest) hacia R2. BD administrada queda descartada para el piloto; se revisa al escalar.
- **Nombres aprobados:** proyecto/BD `praxia`, bucket `praxia-production-backups`.
- **AC4 de APO-26 movido a ticket de aplicación** (restablecimiento de contraseña + Turnstile + límites por IP + correo Resend de Identidad). Ver `## Tickets creados`.

## Aprobaciones registradas

- Crear bucket y token R2 de alcance mínimo, añadir ruta de tunnel `app.usepraxia.com` y reglas WAF: **OK del fundador** (las reglas WAF quedan condicionadas al plan; ver decisión de Cloudflare Free/Pro).
- Aplicar update de Coolify (v4.3.7 → última) antes de crear recursos nuevos: **OK**.
- Nombres de proyecto, base y bucket: **OK**.

## Pendientes de infraestructura (APO-26)

| # | Pendiente | Estado | Referencia |
|---:|---|---|---|
| 1 | Crear bucket privado R2 `praxia-production-backups` | Hecho 2026-08-18 | APO-26 |
| 2 | Crear token API R2 de alcance mínimo (solo ese bucket) y guardarlo en Coolify | Hecho 2026-08-18 | APO-26 |
| 3 | Registrar R2 como S3 Storage en Coolify | Hecho 2026-08-18 (Connected) | APO-26 |
| 4 | Aplicar update de Coolify | Hecho 2026-08-18 (v4.3.9) | APO-26 |
| 5 | Crear proyecto `praxia` y PostgreSQL 16 sin puerto público | Hecho 2026-08-18 (BD `praxia` healthy) | APO-26 |
| 6 | Backups lógicos diarios → R2 (cron `0 11 * * *`, retención 30 S3 + 2 locales) | Hecho 2026-08-18 | APO-26 |
| 7 | pgBackRest + archivo continuo de WAL → R2 (PITR, RPO minutos) | Hecho 2026-08-18 (imagen `localhost:5000/praxia-postgres:16` en registro local, stanza `main`, full inicial, WAL en segundos, cron diario 11:30 UTC) | APO-26 |
| 8 | Drill: restaurar en postgres aislado con datos sintéticos y documentar RPO/RTO | Hecho 2026-08-18 (restore full ≈ 54 s + replay; PITR ≈ 33 s; evidencia en runbook) | APO-26 |
| 9 | Runbook de restauración `docs/runbooks/restauracion-backup.md` | Hecho 2026-08-18 | APO-26 |
| 10 | Dockerfile standalone + health check en el repo | Hecho 2026-08-18 (`fb475696`; health 200 verificado) | APO-26 |
| 11 | Recurso de aplicación en Coolify (repo público `Kikeagv/apollo`, main) | Hecho 2026-08-18 (`praxia-app`, build pack Dockerfile, env vars de producción, deploy Success `7106212f`, contenedor healthy) | APO-26 |
| 12 | Ruta de tunnel `app.usepraxia.com` → `localhost:80` | Hecho 2026-08-18 (ruta publicada en `praxia-ovh-prod`; DNS proxied) | APO-26 |
| 13 | Migraciones y variables de entorno de producción (secretos solo en Coolify) | Hecho 2026-08-18 (5 vars en Coolify; `DATABASE_URL` inyectada vía tinker sin pasar por chat; migraciones drizzle aplicadas al cluster `praxia`) | APO-26 |
| 14 | Cron loopback cada minuto → `/api/jobs/appointment-scheduler` con `SCHEDULER_SECRET` | Hecho 2026-08-18 (tarea `appointment-scheduler-loopback` en Coolify; primera ejecución success 23:40 UTC; 401 sin token / 200 con token verificados) | APO-26 |
| 15 | Verificar TLS Full (strict) y baseline WAF en el zone | Pendiente | APO-26 |
| 16 | Diseñar skip-rule para el callback de Twilio (se activa con APO-25) | Pendiente | APO-26 |
| 17 | Notificaciones de Coolify por correo (Resend) para deploys/backups fallidos | Pendiente | APO-26 |
| 18 | Health checks y monitoreo externo de `app.usepraxia.com` | Pendiente | APO-26 |
| 19 | Actualizar estado de infraestructura con los hechos verificados (Meta in review, OVH Canadá, Twilio $20, Coolify v4.3.7) | Hecho 2026-08-18 | `docs/infrastructure/estado-infraestructura-produccion-2026-08-17.md` |
| 20 | ADR 0007 de despliegue y recuperación | Hecho 2026-08-18 | `docs/adr/0007-despliegue-produccion-y-recuperacion.md` |

## Pendientes de aplicación (nuevos)

| # | Pendiente | Estado | Referencia |
|---:|---|---|---|
| 21 | Restablecimiento de contraseña, Turnstile en servidor, límite 5/IP/15 min, bloqueo tras 5 contraseñas y correo real de Identidad por Resend | Hecho y desplegado 2026-08-18 (commit `019621a`, deploy Success con healthcheck; migración 0044 aplicada al cluster `praxia`; smoke 200/400 con Turnstile real validando en servidor). Secretos en Coolify: `IDENTITY_EMAIL_DELIVERY=resend`, `RESEND_API_KEY`, `TURNSTILE_VERIFICATION=cloudflare`, `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Widget Turnstile `praxia-app` (`app.usepraxia.com`) en Cloudflare; clave Resend `praxia-app-identity` (solo envío, solo `usepraxia.com`). Pendiente: configurar la regla WAF de rate limit de login (Pro activo) y smoke interactivo del desafío | APO-56 |

## Pendientes externos y de fase

| # | Pendiente | Estado | Referencia |
|---:|---|---|---|
| 22 | Verificación de negocio de Meta (K31 SOFTWARE) — enviada, en review (~2 días hábiles) | En curso | APO-4 |
| 23 | Base legal para procesar datos reales | Bloquea go-live | APO-5 |
| 24 | Validar transcripción de notas de voz antes del piloto | Pendiente | APO-11 |
| 25 | Twilio/WhatsApp: configurar webhooks y callbacks solo cuando la app esté lista; verificar firmas | Después de APO-57/APO-25 | APO-25 |
| 26 | Meta fase 2 (Tech Provider, Partner Solution, Embedded Signup) | Fase 2 | — |
| 27 | Decidir `www.usepraxia.com`: servir landing o redirigir al apex | Sin decidir (no tocar en silencio) | — |
| 28 | Rutina mensual de actualizaciones y revisión trimestral de accesos | Pendiente | — |
| 29 | Rotar secretos que pasaron por transcript de sesiones de agente (token R2 de backups, `BETTER_AUTH_SECRET`, `SCHEDULER_SECRET`) | Pendiente | APO-26 |

## Referencias

- `docs/infrastructure/estado-infraestructura-produccion-2026-08-17.md` — estado operativo y arquitectura.
- `docs/research/alternativas-hetzner-vps-coolify.md` — decisión de VPS y modelo de backups.
- `docs/adr/0003-perimetro-cloudflare-para-el-piloto.md` — perímetro Cloudflare del piloto.
- `docs/adr/0007-despliegue-produccion-y-recuperacion.md` — arquitectura de despliegue y recuperación.
- `docs/runbooks/activacion-whatsapp-piloto.md` — runbook de activación de WhatsApp (fase 1 manual).
