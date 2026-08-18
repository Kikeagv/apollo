# Alternativas a Hetzner para el VPS de producción

Investigación actualizada el 17 de agosto de 2026. Alcance: un único VPS para
Coolify, aplicación Next.js, scheduler y PostgreSQL durante el piloto. Los
precios son mensuales, antes de impuestos cuando el proveedor los publica así.
No incluyen dominio, Cloudflare, Twilio, Resend ni el backup externo en R2.

## Conclusión

La alternativa con mejor relación **costo, ubicación en EE. UU. y riesgo
operativo** es **OVHcloud VPS-2 en Vint Hill, Virginia: USD 8.50/mes**. Incluye
4 vCore, 8 GB de RAM, 75 GB NVMe, tráfico ilimitado, 1 Gbps, anti-DDoS y copias
diarias. Es suficiente para el piloto y cuesta menos que las opciones
comparables de DigitalOcean, Linode o Vultr.

No elegiría Contabo para el único VPS de producción aunque sea el más barato:
su disponibilidad contractual es de 95%, demasiado baja para alojar la
aplicación y PostgreSQL de las clínicas. Hetzner sigue siendo una elección
válida y de muy buena relación recursos/precio; cambiarlo a OVH solo tiene
sentido si el ahorro mensual y el backup diario incluido compensan preferir
su plataforma.

La decisión propuesta es:

```text
Primera elección alternativa: OVHcloud VPS-2, Vint Hill (US East)
Segunda elección: Hetzner Cloud, Ashburn (US East)
No elegir para producción única: Contabo
```

Antes de contratar, crear una VM de prueba en OVH y medir durante 48 horas
desde una conexión real de la clínica. Si login y carga no muestran una
diferencia material respecto de Hetzner Ashburn, elegir OVH por costo. Si
Hetzner presenta menor latencia o el equipo ya lo domina, mantener Hetzner:
la diferencia no justifica una migración compleja.

## Comparativo

| Proveedor y plan | Recursos | Precio publicado | Región útil para El Salvador | Lectura |
| --- | --- | ---: | --- | --- |
| **OVHcloud VPS-2** | 4 vCore, 8 GB, 75 GB NVMe, 1 Gbps | **USD 8.50** | Vint Hill, Virginia | **Mejor alternativa.** Recursos suficientes, SLA 99.9%, anti-DDoS y backup diario. |
| **Hetzner Cloud** | Elegir 4 vCPU / 8 GB AMD en Ashburn | Ver consola de región US | Ashburn, Virginia | Muy buena referencia de costo. Mantenerla si la prueba de latencia es igual o mejor. |
| **Netcup VPS 1000 G12** | 4 vCore, 8 GB DDR5 ECC, 256 GB NVMe | EUR 10.37 con IVA alemán incluido | Manassas, Virginia | Mucho disco por euro. Confirmar sin IVA, ubicación disponible y soporte antes de elegirla. |
| **IONOS VPS L+** | 6 vCore, 8 GB, 240 GB NVMe | USD 21 normal; USD 6 solo los primeros 3 meses con anualidad | Estados Unidos | Más capacidad y soporte, pero el precio promocional no es el costo sostenido. |
| **Contabo Cloud VPS 10** | 3 vCPU, 8 GB, 75 GB NVMe, 32 TB | EUR 4.50 | New York, St. Louis o Seattle | Menor precio absoluto, pero 95% de disponibilidad contractual y solo 3 vCPU. No recomendado para este único host. |
| **DigitalOcean Basic** | 4 vCPU, 8 GiB, 160 GB SSD, 5 TB | USD 48 | Atlanta, Nueva York, Richmond y otras | Buena plataforma, pero casi seis veces OVH. No aporta valor proporcional al piloto con Coolify. |
| **Akamai/Linode shared 8 GB** | 4 vCPU, 8 GB, 160 GB, 5 TB | USD 48 | Norteamérica | Tampoco es competitivo a este tamaño. |
| **Vultr Cloud Compute** | Plan `vc2-4c-8gb` | Verificar en consola | Miami, Ciudad de México, Atlanta y New Jersey | Buena opción si una prueba de red demuestra ventaja en Miami o México; no se incluye un precio sin confirmación directa en la consola. |

Fuentes oficiales: [OVHcloud VPS](https://us.ovhcloud.com/vps/),
[regiones OVHcloud](https://www.ovhcloud.com/en/datacenter/),
[Hetzner Cloud](https://www.hetzner.com/cloud/),
[ubicaciones Hetzner](https://docs.hetzner.com/cloud/general/locations/),
[Netcup VPS](https://www.netcup.com/en/server/vps),
[IONOS VPS](https://www.ionos.com/servers/vps),
[precios Contabo](https://contabo.com/en/pricing/),
[ubicaciones Contabo](https://contabo.com/en/locations/),
[términos Contabo](https://contabo.com/en/legal/terms-and-conditions/),
[precios DigitalOcean](https://www.digitalocean.com/pricing/droplets),
[precios Akamai](https://www.akamai.com/cloud/pricing/north-america) y
[plan Vultr](https://docs.vultr.com/products/compute/instances/cloud-compute/management/resize-instance).

## Qué significa el backup incluido

El backup diario de OVH sirve para recuperar la VM, pero no equivale a
recuperación de PostgreSQL a un minuto concreto. El diseño sigue siendo:

```text
PostgreSQL en el VPS
  ├─ backup lógico de Coolify para restauraciones simples
  └─ backup físico + archivo continuo de WAL hacia Cloudflare R2
```

R2 queda fuera del proveedor de cómputo. Así se puede reconstruir un VPS nuevo
si se pierde la máquina, y el RPO de minutos depende del archivado de WAL, no
del snapshot diario.

## Costo base recomendado

| Concepto | Costo mensual aproximado |
| --- | ---: |
| OVHcloud VPS-2 | USD 8.50 + impuestos |
| Cloudflare R2 para un piloto pequeño | normalmente USD 0 dentro de sus cuotas gratuitas; confirmar el uso real |
| Cloudflare, dominio, Twilio y Resend | se presupuestan por separado porque no cambian según el VPS |

No se debe reducir la VM por debajo de 4 vCPU y 8 GB para ahorrar unos dólares:
Coolify, Next.js y PostgreSQL comparten memoria y disco. La forma correcta de
reducir el riesgo no es comprar una VM más grande, sino mantener R2 externo,
alertar fallos del backup y ensayar una restauración mensual.
