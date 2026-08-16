# VPS para el piloto de Apolo

Investigado el 14 de agosto de 2026 con fuentes oficiales de los proveedores.
Este documento recomienda una infraestructura inicial para **Praxia/Apolo**;
no reemplaza la validación legal de transferencias internacionales y DPA ya
pendiente para el piloto.

## Decisión recomendada

Usar **DigitalOcean en `ATL1`** para el piloto, compuesto por:

- Un Droplet Basic de **2 vCPU, 4 GiB RAM y 80 GiB SSD** para la aplicación
  Next.js, el proxy inverso y `cloudflared`: **USD 24/mes**.
- PostgreSQL gestionado de DigitalOcean, inicialmente **1 vCPU y 2 GiB RAM**
  (con 30--60 GiB de disco según necesidad): desde **USD 30.45/mes** más
  almacenamiento. Subir a 4 GiB/2 vCPU si las métricas de conexiones,
  memoria o latencia lo piden.

El coste base de cómputo y base de datos es, por tanto, aproximadamente
**USD 54.45/mes más almacenamiento de PostgreSQL, copias/monitorización y el
plan Cloudflare ya decidido**. Los precios son antes de impuestos y deben
reconfirmarse en consola antes de contratar.

No es la VM más barata, sino la opción con mejor equilibrio para este proyecto:
concentra compute, red privada, firewall y PostgreSQL gestionado en una sola
plataforma, y permite cumplir de forma realista el requisito existente de
recuperación a un punto en el tiempo con RPO de minutos. La disponibilidad de
PostgreSQL gestionado incluye `ATL1`, y sus conexiones exigen TLS y permiten
restringir el origen confiable al Droplet. Las restauraciones permiten elegir
el último estado transaccional disponible o un momento concreto; se crean en
un clúster nuevo, lo cual encaja con un runbook de recuperación verificable.

Fuentes: [precio del Droplet](https://www.digitalocean.com/pricing/droplets),
[precio de PostgreSQL gestionado](https://www.digitalocean.com/pricing/managed-databases),
[regiones de PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/details/availability/),
[TLS y orígenes confiables](https://docs.digitalocean.com/products/databases/postgresql/how-to/secure/) y
[restauración puntual](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/).

## Por qué esta forma y no un único VPS

Apolo es un monolito Next.js/Drizzle/PostgreSQL que conserva auditoría y
entregas transaccionales durante al menos 12 meses. `CONTEXT.md` exige una
recuperación verificable a un punto en el tiempo con **RPO de minutos** y prueba
mensual en un servidor limpio. El ADR de Cloudflare, además, determina que la
base de datos y los workers no se publiquen a Internet.

Un VPS único con PostgreSQL local puede hacerse, pero exige implementar y
vigilar archivado continuo de WAL, copias externas cifradas, una segunda
ubicación, alertas y pruebas de restauración. Una copia diaria del proveedor
no satisface por sí sola ese RPO. Separar la base gestionada reduce esa carga
y limita el alcance de una caída o compromiso de la VM de aplicación.

La configuración de arranque debe ser:

```text
Clínicas / Twilio
        |
Cloudflare Pro (WAF, rate limits, TLS)
        |
Cloudflare Tunnel
        |
Droplet en red privada ───────── PostgreSQL gestionado (TLS + trusted source)
        |
worker del scheduler cada minuto, sin endpoint público adicional
```

El worker puede iniciar en el mismo Droplet durante el piloto, mediante un
servicio/timer supervisado. Cuando tenga carga o requisitos de disponibilidad
propios, se separa a una segunda VM sin migrar la base de datos.

## Alternativas comparadas

| Opción | Ventaja | Limitación para Apolo | Veredicto |
| --- | --- | --- | --- |
| **DigitalOcean + PostgreSQL gestionado** | Menor complejidad operativa; PostgreSQL, TLS, allowlist y restauración puntual en la misma plataforma. El Droplet recomendado cuesta USD 24/mes y la base de 2 GiB parte de USD 30.45/mes. | No es la alternativa de VM más barata; la latencia exacta desde cada ISP de El Salvador se debe medir. | **Elegida para el piloto.** |
| **Vultr + PostgreSQL gestionado** | Más ubicaciones americanas y PostgreSQL gestionado con PITR: 2 días en Startup, 14 en Business y 30 en Premium. Es una buena alternativa si una prueba muestra ventaja material de latencia desde El Salvador. | El plan y la región de la base deben verificarse por API/consola antes de contratar; el precio varía por región. | Segunda opción, condicionada a la prueba de latencia. |
| **OVH VPS-1** | Muy bajo coste: desde USD 4.54/mes por 2 vCores, 4 GiB y 40 GiB NVMe; incluye backup diario. | El backup anunciado es diario, no PITR. Operar PostgreSQL seguro con WAL externo, restauración y pruebas recaería en Apolo. | Útil para staging o entorno no sensible; no para datos reales del piloto. |
| **Hetzner Cloud** | Excelente coste de VM; un CPX22 europeo figura desde EUR 19.49/mes tras el ajuste de junio de 2026. Tiene nube en Ashburn, pero no PostgreSQL gestionado. | Reintroduce operación propia de PostgreSQL/PITR o suma otro proveedor y otra transferencia internacional. | No elegir como plataforma principal del piloto. |

Fuentes: [Vultr PostgreSQL gestionado y PITR](https://docs.vultr.com/public/doc-assets/pdfs/collection_item/products-managed-database-postgresql.pdf),
[planes de Vultr por región](https://docs.vultr.com/how-to-provision-cloud-infrastructure-on-vultr-using-terraform),
[OVH VPS](https://www.ovhcloud.com/en/vps/) y
[precios y ubicaciones de Hetzner Cloud](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/).

## Condiciones antes de datos reales

1. Hacer una prueba de 48 horas desde conexiones reales de la Clínica piloto
   hacia `ATL1` y, si se considera, Vultr Miami. Medir p50/p95 de carga y login;
   elegir región por esos datos, no por distancia geográfica estimada.
2. Revisar e incorporar el DPA del proveedor elegido, fijar región, documentar
   subencargados y anexarlo al inventario de transferencias. DigitalOcean tiene
   [DPA vigente](https://www.digitalocean.com/legal/data-processing-agreement)
   y [lista de subencargados](https://www.digitalocean.com/trust/subprocessors);
   esto no sustituye la revisión legal salvadoreña.
3. Crear la base y el Droplet en la misma región y VPC; usar la conexión
   privada de la base desde el Droplet, exigir TLS y restringir sus orígenes
   confiables al mínimo necesario.
4. Desplegar por imagen inmutable/contenedor, con secretos fuera de la imagen;
   habilitar actualizaciones de seguridad, acceso SSH con llave y MFA de la
   cuenta de proveedor.
5. Configurar el Tunnel de Cloudflare, sin puertos HTTP/HTTPS entrantes, y
   conservar únicamente el callback de Twilio como ruta pública permitida por
   el perímetro ya definido.
6. Ensayar cada mes una restauración puntual en un clúster temporal, aplicar
   migraciones cuando corresponda y registrar RPO/RTO obtenidos. No declarar
   cumplimiento del requisito hasta tener ese resultado.

## Escalamiento

Mantener el Droplet de 4 GiB mientras las métricas muestren memoria disponible,
latencia estable y sin acumulación del scheduler. Subir primero el tamaño de
PostgreSQL o añadir `PgBouncer` si el problema son conexiones; aumentar la VM
a 8 GiB/4 vCPU o separar worker solo cuando la aplicación/worker sean el cuello
de botella. No introducir Kubernetes durante el piloto: añade operación sin
resolver una necesidad actual del monolito.
