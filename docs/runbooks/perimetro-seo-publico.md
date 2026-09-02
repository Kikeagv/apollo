# Runbook del perímetro SEO público (APO-70)

Este runbook conserva la separación entre la landing pública y la aplicación
autenticada. La landing se sirve desde el contenedor Nginx de `landing/`; la
aplicación se sirve desde Next.js en `app.usepraxia.com`.

## Fuentes de verdad versionadas

- `landing/robots.txt` es la política pública de rastreo. Permite el contenido
  de `www.usepraxia.com` para búsqueda, entrada de modelos y entrenamiento, y
  permite explícitamente `OAI-SearchBot`, `GPTBot` y `Google-Extended`.
- `landing/sitemap.xml` contiene únicamente `/`, `/demo`, `/privacidad` y
  `/terminos`, con sus URLs canónicas HTTPS en `www`.
- `landing/Dockerfile` copia ambos archivos a la raíz del contenedor y
  `landing/nginx.conf` los expone con sus rutas y tipos de contenido propios.
- `next.config.js` añade `X-Robots-Tag: noindex, follow` a las respuestas de la
  aplicación. Esta cabecera cubre el login, Panacea y las rutas privadas; no se
  sustituye por un bloqueo en el `robots.txt` de la landing.

## Configuración externa de Cloudflare

Aplicar y comprobar estos puntos en la zona `usepraxia.com` antes de publicar:

1. Mantener `www.usepraxia.com` y `usepraxia.com` proxied y con TLS Full
   (strict). Crear una redirección permanente `301` para cualquier solicitud al
   apex hacia `https://www.usepraxia.com` conservando path y query string. No
   añadir una segunda redirección entre `www` y el origen.
2. Desactivar la respuesta gestionada de `robots.txt`, o configurarla para
   devolver exactamente la política del origen. No puede aparecer un
   `Disallow: /` para `OAI-SearchBot`, `GPTBot` o `Google-Extended`, ni para el
   contenido público general.
3. Mantener los Content Signals públicos alineados con el archivo versionado:
   `search=yes, ai-input=yes, ai-train=yes`. Cloudflare no debe volver a
   publicar `ai-train=no`, bloquear `ai-input` ni agregar reglas contradictorias
   a la política aceptada en ADR-0038.
4. No aplicar Access, Turnstile, JavaScript Challenge ni un desafío de bots a
   `GET /robots.txt` o `GET /sitemap.xml`. Los controles de borde siguen
   aplicando a la aplicación según ADR-0003, sin convertirlos en una fuente
   alternativa de autorización para crawlers públicos.
5. En `app.usepraxia.com`, conservar `X-Robots-Tag: noindex, follow` en el
   origen y en la respuesta de Cloudflare. No crear una regla de caché o de
   transformación que elimine la cabecera. No anunciar el host de aplicación
   en el sitemap público.

## Smoke check de producción

Para validar el artefacto Nginx local antes de desplegarlo, ejecutar:

```sh
npm run test:landing
```

El comando construye la imagen de `landing/`, levanta un contenedor temporal,
comprueba las respuestas HTTP de las rutas públicas y elimina el contenedor al
terminar.

Ejecutar después del deploy y registrar el resultado en el ticket de
lanzamiento:

```sh
curl -fsS https://www.usepraxia.com/robots.txt
curl -fsS https://www.usepraxia.com/sitemap.xml
curl -fsSI 'https://usepraxia.com/demo?utm_source=smoke'
curl -fsSI https://app.usepraxia.com/
curl -fsSI https://app.usepraxia.com/calendario
```

Esperado:

- `robots.txt` y `sitemap.xml` responden `200`; el primero anuncia
  `https://www.usepraxia.com/sitemap.xml` y el segundo contiene cuatro `loc`.
- El apex responde un único `301` a la URL equivalente en `www` y conserva
  `/demo?utm_source=smoke`.
- La aplicación responde `X-Robots-Tag: noindex, follow` tanto en el login
  como en una ruta privada representativa.
- Ninguna de las respuestas públicas sustituye el host canónico por el apex o
  por `app.usepraxia.com`.

La validación en Search Console y la inspección de URLs son pasos de release;
no se convierten en pruebas deterministas porque dependen del rastreo externo.
