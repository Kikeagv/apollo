# Despliegue de producción y recuperación verificable

**Estado:** Aceptada
**Fecha:** 18 de agosto de 2026
**Tickets:** [APO-26](https://linear.app/k31-software/issue/APO-26), [APO-56](https://linear.app/k31-software/issue/APO-56)

## Contexto

El piloto de Praxia se despliega en una única VPS de OVH (VPS-2 2027: 4 vCPU,
8 GB, 75 GB, Ubuntu 24.04, Beauharnois) con Coolify. La zona `usepraxia.com`
está en Cloudflare plan Free y el tráfico público entra solo por el túnel
`praxia-ovh-prod`; el firewall de la VPS bloquea el ingreso directo a Docker.
Fase 1 funciona con adaptadores simulados de WhatsApp y correo; los límites de
acceso por IP que dependen de ventanas de 1 minuto o más no se pueden expresar
en el plan Free.

## Decisión

1. **Topología del producto.** `app.usepraxia.com` → Cloudflare (TLS Full
   strict, WAF Free Managed Ruleset, reglas custom) → túnel `praxia-ovh-prod` →
   Traefik de Coolify (`localhost:80`) → contenedor Next.js standalone. La
   consola de Coolify permanece solo detrás de Cloudflare Access. No se crean
   subdominios de login; el acceso es `app.usepraxia.com/login`.
2. **Base de datos.** PostgreSQL 15 como contenedor gestionado por Coolify en
   la VPS, solo en la red Docker interna, sin puerto público. No se contrata
   base administrada en el piloto; se revisa cuando el RTO exigido, el volumen
   o el número de Clínicas lo justifiquen.
3. **Backups en dos capas hacia R2** (independiente de OVH):
   - Lógico: pg_dump diario desde Coolify al bucket `praxia-production-backups`.
     Retención: diarios 30 días, semanales 12 semanas.
   - Físico: pgBackRest con archivo continuo de WAL al mismo bucket, para
     restauración a un punto en el tiempo con RPO de minutos.
   - El snapshot diario de OVH es red de seguridad de la VM, no sustituye estos
     backups. Se ensaya una restauración mensual en un servidor limpio con
     datos sintéticos y se registra la evidencia en APO-26.
4. **Worker de entregas transaccionales.** El scheduler corre por HTTP en
   `POST /api/jobs/appointment-scheduler`, protegido con `SCHEDULER_SECRET`.
   En producción lo dispara un cron del sistema en la VPS cada minuto, solo
   contra loopback; el endpoint nunca se expone públicamente.
5. **Perímetro Cloudflare.** Se opera en Free durante el piloto: TLS Full
   strict, Free Managed Ruleset y reglas custom. Se sube a Pro en el go-live
   para activar el rate limit de login (10/min/IP), Super Bot Fight Mode y el
   Managed Ruleset completo + OWASP. La recuperación (5/IP/15 min) y la
   validación de Turnstile se implementan en la aplicación (APO-56); no son
   expresables como regla de Cloudflare en ningún plan razonable.
6. **Callback de Twilio.** Cuando APO-25 active el adaptador productivo, la
   ruta exacta del webhook tendrá una skip-rule que la exime de Access,
   Turnstile y challenges; la firma `X-Twilio-Signature` y la idempotencia se
   validan siempre en el origen.

## Consecuencias

- **Riesgo aceptado:** una sola VPS = sin alta disponibilidad. La continuidad
  se apoya en R2 externo y en el drill mensual de restauración, no en
  redundancia.
- **RPO** de minutos (archivo de WAL); **RTO** = tiempo del restore medido en
  el drill y documentado en el runbook.
- **Identidad productiva:** los OTP y el restablecimiento de contraseña
  requieren el adaptador de correo Resend y los límites de APO-56; hasta
  entonces el correo de Identidad es simulado y los OTP quedan en logs.
- Los secretos (R2, Resend, Turnstile, Twilio, `BETTER_AUTH_SECRET`,
  `SCHEDULER_SECRET`) viven solo en Coolify; nunca en el repositorio.
- El detalle operativo y la lista viva de pendientes están en
  `docs/infrastructure/pendientes-produccion.md`.
