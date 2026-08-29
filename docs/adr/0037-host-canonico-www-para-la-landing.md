# Host canónico `www` para la landing pública

**Estado:** Aceptada  
**Fecha:** 28 de agosto de 2026

La landing pública y sus rutas legales usarán `https://www.usepraxia.com` como host canónico; `https://usepraxia.com` redirigirá globalmente con `301` a la URL equivalente en `www`, conservando la ruta y los parámetros de consulta. Se elige para consolidar las señales de canonical, enlaces, sitemap y Open Graph en un solo host, manteniendo el apex como una entrada válida para visitantes.

## Considered Options

- Mantener ambos hosts con `200` y depender solo de `rel="canonical"`.
- Elegir el apex como host canónico.
- **Elegir `www` y redirigir el apex** — opción aceptada porque la home ya usa `www` como canonical y el cambio concentra explícitamente las señales públicas.

## Consequences

- Cloudflare debe redirigir el apex a `www` sin cadenas innecesarias, conservar el path y preservar los parámetros de consulta.
- Canonicals, `og:url`, sitemap, JSON-LD y enlaces internos deben usar `www`.
- La decisión no se considera implementada hasta verificar los redirects y las rutas legales en producción.
