# Investigación profunda: cómo mejorar el SEO de la landing de Praxia

**Fecha de auditoría:** 28 de agosto de 2026  
**Propiedad auditada:** [www.usepraxia.com](https://www.usepraxia.com/)  
**Alcance:** landing pública, páginas legales, host de la aplicación y configuración observable en producción.  
**Objetivo:** aumentar la capacidad de descubrimiento, comprensión, indexación y conversión orgánica sin recurrir a tácticas que puedan degradar la calidad o incumplir las políticas de Google.

## Resumen ejecutivo

La landing tiene una base técnica razonable: es HTML estático servido por Nginx, entrega el contenido principal en el HTML inicial, usa HTTPS, tiene `lang="es"`, un solo H1, títulos y descripción, enlaces HTML rastreables y una jerarquía de encabezados legible. No necesita una reescritura completa para empezar a mejorar.

Las mayores oportunidades son de consolidación técnica, intención de búsqueda y evidencia de producto:

1. **Consolidar el dominio:** `https://www.usepraxia.com/` debe ser la única versión canónica. Hoy el apex y `www` responden con `200` por HTTPS, por lo que Google puede tener que elegir entre dos hosts equivalentes.
2. **Publicar y registrar un sitemap:** `/sitemap.xml` devuelve `404`. Crear uno con las tres URLs públicas canónicas y anunciarlo en el `robots.txt` gestionado por Cloudflare.
3. **Separar lo público de la aplicación:** el login de `app.usepraxia.com` responde `200` y no declara `noindex`. La decisión es mantener la landing indexable y marcar todo el host de aplicación como `noindex,follow` mediante cabecera HTTP mientras no haya páginas públicas que deban posicionar.
4. **Arreglar la imagen crítica del hero:** la ilustración principal es un PNG de aproximadamente 1,30 MB aplicado como `background-image`; las imágenes de fondo CSS no se indexan como imágenes por Google y penalizan el peor caso móvil observado en laboratorio. Convertirla a AVIF/WebP y cargar una versión responsive; si comunica información, usar `<picture>/<img>` con texto alternativo.
5. **Hacer explícita la categoría y el problema:** el H1 actual, “La operación de tu clínica, más clara”, es distintivo pero no dice de forma directa “software para clínicas”, “agenda de citas” o “WhatsApp”. Mantener el tono de marca, pero introducir esos conceptos de manera natural en el title, H1, subtítulos, copy y páginas de apoyo.
6. **Añadir prueba y profundidad útil:** el mensaje actual es claro, aunque todavía abstracto. Hay que explicar para quién es Praxia, qué ocurre con una reserva/reprogramación/cancelación, qué controla el equipo y qué evidencia existe, sin inventar resultados ni perseguir un número artificial de palabras.
7. **Medir antes de concluir:** la propiedad de dominio ya está disponible en Search Console, pero el panel todavía está procesando datos. No hay datos de CrUX ni una cuota válida de PageSpeed Insights. Las métricas de rendimiento de este informe son sintéticas; la decisión debe cerrarse con datos de campo, indexación y conversiones.

La secuencia recomendada es: **dominio y rastreo → imagen/rendimiento → mensaje e intención → confianza y contenido → datos estructurados y medición**.

## Método, contexto y límites

### Qué se revisó

- Código de `landing/`: HTML, CSS, activos, Dockerfile y Nginx.
- HTML y cabeceras de producción de la landing, `/privacidad`, `/terminos`, `/robots.txt` y `/sitemap.xml`.
- `https://app.usepraxia.com/` para detectar superficies de aplicación potencialmente indexables.
- Documentación primaria de Google Search Central, Google Search Console, Chrome/web.dev, Schema.org y W3C.
- Acceso a la propiedad de dominio `sc-domain:usepraxia.com` en Google Search Console; la validación DNS está hecha y el panel aún muestra datos en procesamiento.
- Búsquedas exploratorias en español para identificar vocabulario de categoría; no se obtuvieron volúmenes ni datos de demanda.
- Pruebas móviles y de escritorio con navegador automatizado, incluyendo una condición móvil sintética de red/CPU limitada.

### Lo que no se puede afirmar con esta auditoría

- Todavía no se puede afirmar la posición, cobertura o indexación real de Praxia: la propiedad está accesible, pero Search Console aún no muestra datos. La búsqueda `site:usepraxia.com` es una señal incompleta, no una prueba de desindexación.
- No se puede presentar el LCP de laboratorio como un Core Web Vital de usuarios reales. No se obtuvieron datos CrUX/RUM y la API de PageSpeed Insights respondió `429` por cuota agotada.
- No se pueden recomendar volúmenes, dificultad o un forecast de tráfico: aún no hay datos de consultas en Search Console y no se usó Google Ads Keyword Planner ni otra fuente de demanda.
- Ninguna recomendación de title, schema o contenido garantiza rankings. Google indica que la relevancia, la utilidad y la calidad de la página pueden pesar más que una optimización aislada.
- El cambio a `www` no es una preferencia universal de Google: sigue la decisión ya documentada del proyecto de usar `www.usepraxia.com` como host canónico.

## Estado actual auditado

### Fortalezas existentes

- La landing es estática y el copy principal está en el HTML inicial; no depende de una aplicación JavaScript para generar desde cero el significado de la página.
- Existe un único H1 y una jerarquía de H2/H3 coherente con el recorrido de la página.
- `lang="es"`, viewport responsive, title (`Praxia | La operación de tu clínica, más clara`), meta description, canonical y Open Graph ya están presentes en la página principal.
- La navegación, los enlaces legales y el acceso al login usan elementos `<a href>`, el patrón que Google puede rastrear.
- Las páginas legales tienen title, description, H1, H2 y canonical propios.
- HTTPS está activo y la landing devuelve `200`.
- La página no presenta problemas automáticos de accesibilidad en la comprobación puntual de Axe realizada en un viewport móvil; eso no sustituye una auditoría completa.

### Brechas observadas

| Área | Evidencia observada | Implicación | Prioridad |
|---|---|---|---|
| Hosts | `https://usepraxia.com/` y `https://www.usepraxia.com/` responden `200`; solo se redirige HTTP a HTTPS | Dos hosts pueden competir como versiones equivalentes | P0 |
| Canonical legal | La home apunta a `www`, pero `/privacidad` y `/terminos` apuntan a `https://usepraxia.com/...` | Señales de host inconsistentes | P0 |
| Sitemap | `https://www.usepraxia.com/sitemap.xml` devuelve `404` | Se pierde un canal de descubrimiento y monitorización | P0 |
| Robots | `/robots.txt` existe, pero lo sirve una política gestionada por Cloudflare y no incluye `Sitemap:` | El sitemap no queda anunciado en el punto de entrada de rastreo | P0 |
| Aplicación | `app.usepraxia.com/` entrega un login público con title genérico y sin `noindex` | El host de producto puede entrar en el índice con señales pobres | P0/P1 |
| Hero | `clinic-campus.png` pesa aproximadamente 1.298.058 bytes y se usa como fondo CSS | Es el principal coste de transferencia; Google no indexa fondos CSS como imágenes y fue el recurso LCP en el laboratorio lento | P1 |
| Rendimiento móvil | En laboratorio sintético con 150 ms de latencia, 200 KB/s y CPU 4×, LCP del fondo alrededor de 7,36 s; CLS 0 | El caso lento está dominado por la imagen crítica | P1 |
| Intención | Title/H1 privilegian el posicionamiento de marca sobre la categoría | Menor claridad para búsquedas no brand | P1 |
| Contenido | El copy es breve, elegante y genérico; faltan roles, casos concretos, prueba y objeciones | Menos capacidad de responder consultas comparativas o de alta intención | P1 |
| Datos estructurados | No existe JSON-LD en la landing | Se desaprovecha la desambiguación de sitio/organización | P2 |
| Social metadata | No hay `og:site_name`, `og:image:alt` ni Twitter Card explícita | Previsualizaciones menos controladas; no es un factor de ranking directo | P2 |
| CTA | Los CTA principales son `mailto:` | Difícil atribuir conversiones y medir intención de demo | P1 para analítica/CRO |

## Evidencia y principios que deben guiar la decisión

### SEO no es un checklist de garantías

La [guía de inicio SEO de Google](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) presenta el SEO como ayuda para que los buscadores entiendan el contenido y para que las personas decidan si visitarlo; no promete una posición por aplicar una lista de etiquetas. La misma guía insiste en contenido útil, enlaces rastreables, titles descriptivos, snippets y recursos accesibles.

Por eso, la recomendación no es “meter más keywords”, sino alinear tres cosas:

```text
consulta del comprador → promesa entendible → evidencia verificable en la página
```

Google también dice que no existe una longitud mágica de contenido, que las meta keywords no sirven y que el keyword stuffing infringe sus políticas. La página debe crecer cuando una sección resuelve una duda real, no para alcanzar un contador de palabras.

### Rastreo, indexación y canonicalización

- Un `robots.txt` controla principalmente el rastreo; no es una forma fiable de sacar una URL del índice. Para excluir una página se debe usar `noindex` o autenticación, permitiendo que Google pueda leer esa señal. Referencia: [Robots.txt de Google](https://developers.google.com/search/docs/crawling-indexing/robots/intro).
- Un sitemap es una señal o una lista de URLs que se quiere descubrir, no una garantía de indexación. Google recomienda URLs absolutas, canónicas e indexables. Referencias: [crear un sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) y [Sitemaps report](https://support.google.com/webmasters/answer/7451001?hl=en).
- Para duplicados, las redirecciones y `rel="canonical"` son señales fuertes; un sitemap es una señal más débil. Las señales deben ser coherentes entre canonical, enlaces internos, sitemap y redirects. Referencia: [consolidar URLs duplicadas](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).
- Google puede elegir una canonical distinta a la declarada. Por eso no basta con añadir una etiqueta: hay que resolver el host duplicado y enlazar internamente siempre a `www`.

### HTML, JavaScript, móvil e imágenes

- Google procesa una página en fases de rastreo, renderizado e indexación. La [guía de JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) reconoce SSR/prerender como opciones útiles y recomienda que el contenido y los enlaces importantes existan desde el HTML inicial.
- Google usa la versión móvil para indexar y posicionar con mobile-first indexing. La [guía para sitios móviles](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing) pide conservar contenido, metadata, datos estructurados y alt text equivalentes entre variantes y evitar que el contenido principal aparezca solo después de una interacción.
- Google [no indexa imágenes CSS](https://developers.google.com/search/docs/appearance/google-images) como imágenes de la página. Las imágenes relevantes deben usar `<img>` o `<picture>`, `srcset`, nombres descriptivos, alt text pertinente y formatos/tamaños adecuados.
- La experiencia de página no es una puntuación única ni reemplaza la relevancia, pero Google sí usa Core Web Vitals entre sus señales. Los umbrales actuales de campo al percentil 75 son LCP ≤ 2,5 s, INP ≤ 200 ms y CLS ≤ 0,1; fuente: [definición de los umbrales de Core Web Vitals](https://web.dev/articles/defining-core-web-vitals-thresholds).

### Datos estructurados y resultados enriquecidos

Google recomienda JSON-LD y exige que los datos representen contenido visible, exacto y no engañoso. El markup puede hacer una página elegible para ciertas apariencias, pero no garantiza un rich result ni una mejora de ranking: [introducción a datos estructurados](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data) y [políticas de datos estructurados](https://developers.google.com/search/docs/appearance/structured-data/sd-policies).

Para Praxia, el punto de partida seguro es `WebSite` + `Organization` en la home. `SoftwareApplication` debe esperar hasta que la página exponga una oferta/precio que pueda marcarse de forma veraz; la documentación de [Software App](https://developers.google.com/search/docs/appearance/structured-data/software-app) exige `name` y `offers.price` para su resultado enriquecido. No añadir `LocalBusiness` salvo que exista un negocio local elegible, con ubicación real y atención a clientes en esa ubicación.

El nombre de sitio se puede reforzar con `WebSite` en la home, pero Google lo automatiza y no garantiza una presentación concreta: [site names](https://developers.google.com/search/docs/appearance/site-names).

### IA generativa, contenido y falsas promesas de “AEO”

La [guía oficial de optimización para funciones de IA](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) dice que las bases del SEO siguen aplicando: una página debe poder rastrearse, indexarse y ser elegible para snippets. No hace falta `llms.txt`, un formato de fragmentación artificial ni “hacks” de AEO/GEO. El contenido generado con IA no está prohibido por sí mismo, pero producir muchas páginas sin valor añadido puede caer en [scaled content abuse](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content) y las [políticas de spam](https://developers.google.com/search/docs/essentials/spam-policies).

Tampoco conviene invertir en FAQ schema esperando tráfico enriquecido: Google anunció que el resultado FAQ dejó de aparecer en Search a partir del 7 de mayo de 2026, según sus [actualizaciones oficiales](https://developers.google.com/search/updates). Una sección de preguntas sigue siendo buena para usuarios y conversiones, pero debe escribirse por utilidad, no por el rich result.

## Backlog priorizado

### P0 — resolver antes de evaluar el crecimiento orgánico

#### 1. Unificar `www` como host canónico

**Acciones**

- Configurar en Cloudflare/Nginx un `301` permanente de `https://usepraxia.com/*` a `https://www.usepraxia.com/*` conservando path y query cuando corresponda.
- Mantener una sola redirección: HTTP → HTTPS → `www` si el proveedor no permite hacerlo en un salto.
- Cambiar los canonicals de `landing/privacidad.html` y `landing/terminos.html` a `https://www.usepraxia.com/privacidad` y `https://www.usepraxia.com/terminos`.
- Usar `www` en `og:url`, sitemap, JSON-LD, enlaces internos y cualquier referencia pública.
- Confirmar que no existan variantes con slash, mayúsculas o parámetros que se sirvan como páginas equivalentes sin una regla clara.

**Criterio de aceptación**

```text
http://usepraxia.com/       → 301/308 → https://www.usepraxia.com/
https://usepraxia.com/      → 301    → https://www.usepraxia.com/
https://www.usepraxia.com/  → 200, canonical a sí misma
```

Aplicar la misma lógica a `/privacidad` y `/terminos`, y comprobar que no haya cadenas de redirección.

#### 2. Crear el sitemap y conectarlo con el robots efectivo

Publicar en la raíz un sitemap con las URLs públicas, canónicas e indexables:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.usepraxia.com/</loc></url>
  <url><loc>https://www.usepraxia.com/privacidad</loc></url>
  <url><loc>https://www.usepraxia.com/terminos</loc></url>
</urlset>
```

No añadir `lastmod` hasta tener una fecha de modificación real y mantenible. Si se añade, debe actualizarse solo cuando cambie materialmente el contenido. La página actual es pequeña y Google señala que un sitemap no es obligatorio para sitios pequeños bien enlazados; aun así, aquí aporta una lista explícita, un canal de descubrimiento y monitorización en Search Console.

El `robots.txt` observado es gestionado por Cloudflare, no por un archivo presente en `landing/`. Configurar la regla en el proveedor que realmente responde `/robots.txt` y añadir:

```text
Sitemap: https://www.usepraxia.com/sitemap.xml
```

Conservar `Allow: /` para Googlebot. La política observada bloquea `Google-Extended`, `GPTBot` y otros crawlers de entrenamiento, y además declara `ai-train=no`. La decisión del proyecto queda registrada en [ADR-0038](../adr/0038-distribucion-publica-para-crawlers-de-ia.md): permitir esos crawlers y alinear los Content Signals para el contenido público de `www`, manteniendo fuera login y superficies privadas. La documentación de [Google-Extended](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) aclara que no controla la inclusión ni el ranking en Google Search; controla el uso para Gemini. La documentación de [OpenAI sobre crawlers](https://developers.openai.com/api/docs/bots) separa `OAI-SearchBot` para búsqueda de `GPTBot` para entrenamiento.

#### 3. Evitar que el host de aplicación compita con la landing

Añadir `noindex,follow` a la superficie pública de login y a las rutas privadas de `app.usepraxia.com`, idealmente desde el layout o middleware que cubra todas las rutas correspondientes. No bloquear esas rutas en robots antes de que Google pueda leer el `noindex`.

Ejemplo conceptual para una respuesta HTML de login:

```html
<meta name="robots" content="noindex,follow">
```

Si la aplicación tiene páginas públicas de ayuda, documentación o onboarding que sí deben posicionar, excluirlas de la regla y darles title, description, canonical, enlaces internos y contenido propio. No incluir login, paneles ni URLs privadas en el sitemap.

### P1 — mayor impacto probable en comprensión, demanda y conversión

#### 4. Optimizar el hero como recurso crítico

El PNG `landing/public/clinic-campus.png` pesa aproximadamente 1,30 MB y representa cerca del 96,5 % de la transferencia observada de la home. En la prueba móvil sintética bajo red lenta, el LCP quedó alrededor de 7,36 s y el elemento LCP fue precisamente el fondo del hero.

**Implementación recomendada**

- Generar versiones AVIF y WebP desde el PNG original, con calidad visual revisada.
- Crear al menos una variante móvil y una desktop, con dimensiones cercanas al tamaño de renderizado real.
- Si la ilustración explica el producto, reemplazar el fondo por `<picture>`/`<img>` con `width`, `height`, `decoding="async"` y alt descriptivo; cargar la fuente apropiadamente como recurso prioritario.
- Si es puramente decorativa, mantenerla como fondo o usar alt vacío, pero no asumir que aporta SEO de imágenes. En ese caso el SEO depende del copy y del `og:image`.
- No reutilizar automáticamente `clinica-praxia.webp`: el archivo existente debe corresponder visualmente al hero antes de sustituirlo.
- Comprimir también la imagen social en una proporción adecuada para compartir; no usar necesariamente el hero de 2:1 como tarjeta social.

La prioridad está justificada por el rendimiento, no por una promesa de ranking. Medir después LCP, bytes transferidos y conversión en dispositivos reales.

#### 5. Reescribir el mensaje para capturar intención no brand

El texto actual puede conservar su personalidad, pero la propuesta debe ser evidente para alguien que todavía no conoce Praxia.

**Propuesta para validar con producto y clientes**

```text
Title:
Praxia | Software para clínicas con agenda y citas por WhatsApp

H1:
Agenda y atención de tu clínica, en un solo flujo

Meta description:
Praxia ayuda a clínicas a organizar agenda, equipo y citas por WhatsApp. Reserva, reprograma y cancela con las reglas de tu clínica. Agenda una demo.

Promesa de apoyo:
Automatiza las solicitudes repetitivas y conserva el criterio de tu equipo sobre disponibilidad, excepciones y atención al paciente.
```

Estas son propuestas, no copy aprobado. Solo deben publicarse si describen exactamente el producto disponible. Si Praxia no es una agenda médica completa, no llamarla “software médico” sin matiz. Si todavía no existe una demo operativa, sustituir “Agenda una demo” por el CTA real.

**Distribución natural de términos**

- Hero: `software para clínicas`, `agenda`, `citas`, `WhatsApp`.
- Sección de producto: qué sucede con una reserva, reprogramación o cancelación.
- Sección de operación: disponibilidad, bloqueos, capacidad y coordinación del equipo.
- Sección de confianza: privacidad, control humano, límites de automatización y soporte.
- CTA: acción concreta y medible, por ejemplo solicitar demo o iniciar conversación.

No repetir la misma frase en cada bloque, no ocultar texto y no crear páginas por ciudad sin una oferta, equipo o contenido verdaderamente local.

#### 6. Convertir el copy abstracto en evidencia útil

La home debe responder rápido estas preguntas:

| Pregunta del comprador | Sección que falta o debe profundizarse | Evidencia recomendada |
|---|---|---|
| ¿Para quién es? | Consultorios y clínicas privadas generales en El Salvador; médico propietario como decisor y equipo administrativo como operador | Perfil explícito; no prometer compatibilidad por especialidad ni tamaño que no exista |
| ¿Qué automatiza? | Flujo de reserva, reprogramación y cancelación | Ejemplo paso a paso o captura con datos ficticios |
| ¿Qué controla el equipo? | Reglas, disponibilidad, excepciones y supervisión | Explicación concreta de límites y permisos |
| ¿Qué se necesita para empezar? | Onboarding, integraciones, datos y soporte | Checklist veraz, tiempos reales y dependencias |
| ¿Por qué confiar? | Privacidad, seguridad y operación | Enlaces legales, prácticas reales y responsables identificables |
| ¿Qué resultado puedo esperar? | Beneficios y prueba | Testimonios autorizados, cifras con periodo y metodología |

Agregar una sección de preguntas frecuentes visible si resuelve objeciones. No añadir FAQ schema esperando una mejora enriquecida: desde mayo de 2026 ese resultado ya no aparece en Google Search.

El objetivo no es hacer la página larga por sí misma, sino cubrir la decisión con información original. Google no establece una cantidad ideal de palabras.

#### 7. Definir una arquitectura mínima de páginas

Mientras la oferta siga concentrada en una sola landing, la home debe ser la página de categoría. Si existen recursos para mantener páginas completas, considerar solo páginas con intención y contenido diferenciados, por ejemplo:

- `/software-para-clinicas`: categoría, roles, capacidades y límites del producto.
- `/agenda-y-citas-por-whatsapp`: flujo de atención, reservas, reprogramaciones y cancelaciones.
- `/privacidad-y-seguridad`: explicación de prácticas reales, separada del aviso legal.

No crear las tres automáticamente. Cada una debe tener una pregunta distinta, ejemplos propios, enlaces desde la home y una CTA coherente. Enlazar desde la landing con anchors descriptivos, no “haz clic aquí”.

#### 8. Hacer el CTA medible y accesible

Los tres CTA de la landing son `mailto:contact@enriqueagv.com?...`. El correo puede seguir siendo un canal válido, pero dificulta atribuir conversiones y está siendo transformado por Cloudflare Email Protection en la respuesta HTML.

Evaluar un endpoint HTTPS o una ruta `/demo` con:

- formulario corto y protección anti-spam;
- estado de éxito/error accesible;
- evento de analítica para envío iniciado, enviado y fallido;
- consentimiento y política de privacidad coherentes;
- alternativa de contacto visible si el formulario falla.

Esto es principalmente CRO y analítica, no un factor de ranking directo. La prioridad es saber qué consultas y páginas producen conversaciones reales.

#### 9. Corregir la revelación progresiva del contenido

La página deja algunos bloques con `opacity: 0` hasta que JavaScript añade `.is-visible`. El texto sigue en el HTML y el hero aparece, por lo que no es un bloqueo total; aun así, una landing debe degradar bien sin JavaScript y no hacer que contenido importante parezca ausente.

Patrón recomendado:

```css
/* Por defecto, el contenido es visible. */
[data-reveal] {
  opacity: 1;
  transform: none;
}

/* Solo se oculta si JS confirmó que puede animarlo. */
.js [data-reveal] {
  opacity: 0;
  transform: translateY(1rem);
}

.js [data-reveal].is-visible {
  opacity: 1;
  transform: none;
}
```

Añadir la clase `.js` muy temprano y respetar `prefers-reduced-motion`. El H1, la propuesta, los beneficios y el CTA deben ser visibles sin esperar una interacción.

### P2 — mejoras de claridad, apariencia y escala

#### 10. Añadir JSON-LD mínimo y veraz

En la home se puede implementar un único bloque `application/ld+json` con `WebSite` y `Organization`:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://www.usepraxia.com/#website",
      "name": "Praxia",
      "url": "https://www.usepraxia.com/"
    },
    {
      "@type": "Organization",
      "@id": "https://www.usepraxia.com/#organization",
      "name": "Praxia",
      "legalName": "K31 SOFTWARE",
      "url": "https://www.usepraxia.com/",
      "logo": "https://www.usepraxia.com/public/logos/Logo.svg",
      "email": "contact@enriqueagv.com"
    }
  ]
}
</script>
```

Verificar que `K31 SOFTWARE`, el email y el logo sean los datos públicos correctos antes de publicarlos. Añadir `sameAs`, teléfono, dirección o perfiles solo si existen y son oficiales. No marcar una `LocalBusiness` ficticia ni agregar una oferta de software sin precio real.

Validar con [Schema Markup Validator](https://validator.schema.org/), Rich Results Test cuando aplique y [URL Inspection](https://support.google.com/webmasters/answer/9012289?hl=en). La validación sintáctica no garantiza que Google muestre un resultado enriquecido.

#### 11. Completar metadata social

Añadir, con URLs canónicas de `www`:

```html
<meta property="og:site_name" content="Praxia">
<meta property="og:image:alt" content="Praxia organiza la operación de una clínica y sus citas por WhatsApp">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Praxia | Software para clínicas con agenda y citas por WhatsApp">
<meta name="twitter:description" content="Organiza agenda, equipo y citas por WhatsApp con el criterio de tu clínica.">
<meta name="twitter:image" content="https://www.usepraxia.com/public/og/praxia-clinicas-1200x630.jpg">
```

Crear la imagen social solo cuando exista el activo correcto y optimizado. Estas etiquetas mejoran la presentación al compartir; no deben confundirse con una garantía de posicionamiento.

#### 12. Titles, descriptions y legal pages

Cada URL indexable debe tener un title único, descriptivo y conciso. El snippet puede usar la meta description o texto de la página según la consulta, así que la description debe vender el valor con precisión y no ser una lista de keywords. Referencias: [title links](https://developers.google.com/search/docs/appearance/title-link) y [snippets](https://developers.google.com/search/docs/appearance/snippet).

Aplicar el mismo estándar a `/privacidad` y `/terminos`, pero sin intentar posicionarlas por términos comerciales. El objetivo de esas páginas es claridad legal y coherencia de entidad.

## Hipótesis de keywords y mensajes

La siguiente matriz deriva del lenguaje visible en SERPs y de la propuesta actual; son hipótesis cualitativas, no datos de volumen. Deben validarse con Search Console después de publicar cambios.

| Intención | Lenguaje a validar | Página/sección | Qué debe demostrar Praxia |
|---|---|---|---|
| Marca | `Praxia` | Home | Entidad, propuesta, login/demo y enlaces oficiales |
| Categoría | `software para clínicas`, `gestión de clínicas`, `operación de clínicas` | Home y futura página de categoría | Qué problema resuelve y para qué tipo de clínica |
| Agenda | `agenda médica online`, `agenda de citas para clínicas` | Producto/workflow y futura página específica | Capacidad, disponibilidad, reglas y límites reales |
| WhatsApp | `citas por WhatsApp`, `agendar por WhatsApp`, `reprogramar citas por WhatsApp` | Workflow | Qué puede hacer el asistente y cuándo interviene el equipo |
| Operación | `agenda + equipo + capacidad`, `gestión de citas` | Control | Cómo se refleja la capacidad real y se manejan excepciones |
| Confianza | `privacidad de datos de pacientes`, `seguridad para clínicas` | Confianza y página de privacidad/seguridad | Prácticas comprobables; evitar certificaciones no obtenidas |

Decisión de alcance: la comunicación inicial tratará a Praxia como una solución general para consultorios y clínicas en El Salvador. No se publicarán páginas ni claims por especialidad hasta que exista soporte real del producto y evidencia suficiente para esa vertical.

Dirección aprobada para el hero: H1 orientado a categoría —“Software para clínicas que organiza tu agenda y la atención por WhatsApp”— y subtexto centrado en confirmar, reprogramar y cancelar citas según la capacidad real, conservando el control del equipo.

CTA aprobado: usar “Solicitar una demo” como llamada principal y dirigirla a `/demo`. “Agendar una demo” queda descartado por implicar un calendario automático que no forma parte del flujo inicial.

Evidencia visual aprobada: incorporar capturas del panel real con datos sintéticos para demostrar el producto. La landing no usará logos de clientes, testimonios ni métricas de resultados sin autorización y contexto verificable; la fotografía/ilustración existente queda como recurso decorativo.

Set inicial de capturas: agenda y disponibilidad; configuración de atención por WhatsApp; y pendientes que requieren intervención humana. Estas superficies deben presentarse con nombres públicos de producto y no con el nombre interno de la aplicación.

Metadatos aprobados para la home: title `Software para clínicas en El Salvador | Praxia`; description `Organiza la agenda de tu clínica y gestiona la atención administrativa de citas por WhatsApp. Solicita una demo de Praxia.`

Datos estructurados aprobados: JSON-LD limitado inicialmente a `Organization`, `WebSite` y `WebPage`, sin `SoftwareApplication`, `Offer`, precios, valoraciones ni testimonios hasta que sean públicos y verificables.

Dirección visual aprobada para el hero: conservar la ilustración y composición de referencia, actualizar únicamente el copy, el CTA y la implementación técnica de accesibilidad/rendimiento. La ilustración del hero y la imagen social de Open Graph serán activos independientes.

Criterio responsive aprobado: en móvil la ilustración puede recortarse o pasar debajo del contenido, siempre que el H1, el subtexto y “Solicitar una demo” permanezcan legibles y visibles con prioridad.

Contenido aprobado para la home: añadir una FAQ visible de 4–6 preguntas sobre automatización, control del equipo, límites del asistente, público objetivo, atención por WhatsApp y el proceso posterior a la demo. Será contenido útil de la página, no una promesa de resultado enriquecido mediante `FAQPage`.

Arquitectura de navegación aprobada: `Producto`, `Cómo funciona` y `Para clínicas` apuntarán a secciones internas rastreables; `Iniciar sesión` llevará a `app.usepraxia.com`; “Solicitar una demo” llevará a `/demo`; y el footer enlazará privacidad y términos.

Preguntas de investigación a resolver con clientes y Search Console:

- ¿Los compradores dicen “agenda médica”, “agenda de citas”, “gestión de clínicas” u otra variante?
- ¿Buscan una herramienta de WhatsApp, una agenda o una operación completa?
- ¿Qué especialidades, si alguna, tendrán una oferta real de Praxia cuando existan flujos y evidencia específicos?
- ¿Qué objeción detiene la demo: migración, privacidad, integraciones, precio o control humano?
- ¿Qué CTA convierte mejor: demo, conversación de WhatsApp o correo?

## Plan de implementación

### Días 0–7: higiene técnica

1. Configurar redirect apex → `www` y verificar 200/3xx por path.
2. Corregir canonicals y `og:url` de legales.
3. Publicar `sitemap.xml` y añadirlo al robots real de Cloudflare.
4. Añadir `X-Robots-Tag: noindex, follow` a todo `app.usepraxia.com`; no depender de `robots.txt` para esta exclusión.
5. Con la propiedad de dominio ya verificada, inspeccionar home, legales y app después del despliegue; enviar el sitemap cuando `/sitemap.xml` deje de devolver `404`.

### Semanas 1–2: rendimiento y claridad

1. Generar AVIF/WebP responsive del hero y comprobar la imagen LCP en móvil.
2. Revisar el title, H1, description y primeros 200–300 px de contenido con producto/ventas.
3. Hacer visible sin JavaScript el copy esencial y el CTA.
4. Definir un CTA HTTPS medible y su consentimiento.

### Semanas 2–6: contenido que ayuda a decidir

1. Añadir workflow concreto de reserva, reprogramación y cancelación.
2. Explicar roles, control humano, configuración, soporte y límites.
3. Incorporar prueba autorizada: clientes, casos, capturas o métricas con contexto.
4. Publicar una sola página de apoyo si responde una intención distinta y tiene contenido sustancial.
5. Añadir enlaces internos descriptivos desde home y legales donde corresponda.

### Después de estabilizar la base

1. Implementar `WebSite` + `Organization` y validar.
2. Completar metadata social y comprobar previews.
3. Revisar cada mes queries nuevas, páginas con impresiones sin clicks y consultas con conversiones.
4. Iterar por cohortes de país, dispositivo e intención, no solo por una posición media global.

## Medición y criterios de éxito

### Configuración

- Search Console: propiedad de dominio y, si ayuda a depurar, URL-prefix de `https://www.usepraxia.com/`.
- URL Inspection: canonical declarada y elegida, indexación, renderizado, recursos bloqueados y datos estructurados.
- Sitemap report: URLs descubiertas, indexadas y errores.
- Analytics/CRM: fuente orgánica, landing, query/landing cuando sea posible, CTA visto, CTA iniciado, lead cualificado y demo realizada. Se conservará el Cloudflare Insights ya activo; no se añadirá otro tracker de terceros sin una decisión legal y de producto específica.
- Rendimiento: CrUX/PageSpeed Insights para campo cuando haya tráfico; RUM propio si el volumen de CrUX es insuficiente.

### KPIs y metas operativas

No fijar objetivos de ranking antes de tener una línea base. Medir:

| KPI | Línea base a crear | Señal de mejora |
|---|---|---|
| URLs públicas válidas | 3 URLs canónicas actuales | Sitemap sin errores y cobertura estable |
| Impresiones no brand | Primer periodo completo en Search Console | Crecimiento por consultas de categoría |
| CTR orgánico | Por query, página, país y dispositivo | Mejoras tras title/snippet, sin perder relevancia |
| Conversión de CTA | Eventos y leads cualificados | Más conversaciones orgánicas por sesión |
| LCP/INP/CLS | Campo por p75; laboratorio como diagnóstico | LCP/INP/CLS dentro de umbrales, sin regresiones |
| Canonical | URL declarada vs elegida | Coincidencia en home y legales |
| App/auth | Impresiones y cobertura | Sin URLs de login/panel indexadas |

### Criterios técnicos de aceptación

- `curl -I` confirma redirect permanente de apex a `www` y no hay cadenas innecesarias.
- `/robots.txt` responde `200`, permite rastrear la landing y contiene el sitemap correcto.
- `/sitemap.xml` responde `200` con XML válido y solo URLs canónicas indexables.
- URL Inspection confirma que la home puede rastrearse, renderizarse e indexarse y que la canonical elegida coincide.
- La app no está indexada salvo que exista una ruta pública intencional.
- El hero tiene una transferencia significativamente menor que 1,30 MB y un LCP de campo que se aproxima al umbral objetivo.
- Los títulos, H1, description, schema y CTA coinciden con la oferta real y no contienen claims no demostrados.
- El formulario/CTA registra éxito, error y consentimiento sin filtrar datos sensibles.

## Decisiones que no recomiendo

- No crear `llms.txt` como supuesto atajo de SEO; la guía de Google no lo requiere para sus funciones de IA.
- No llenar la landing de variantes exact-match ni ocultar texto.
- No crear páginas casi idénticas por ciudad, especialidad o keyword sin una operación y contenido propios.
- No añadir `FAQPage`, `LocalBusiness` o `SoftwareApplication` solo para obtener un resultado enriquecido.
- No marcar como testimonios o resultados métricas que no tengan autorización, periodo y contexto.
- No usar `robots.txt` para intentar desindexar login o páginas privadas.
- No usar la puntuación de Lighthouse como objetivo aislado: es una señal de laboratorio; el usuario final, Search Console y las conversiones son el criterio.
- No abrir un Google Business Profile para una entidad sin una ubicación/operación local elegible. Una marca de software remota no debe inventar una presencia local.

## Registro de fuentes primarias

| Tema | Fuente | Uso en este informe |
|---|---|---|
| Fundamentos SEO | [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) | Calidad útil, titles, descriptions, links, no magic word count |
| Inicio técnico | [Get started with Search](https://developers.google.com/search/docs/fundamentals/get-started) | Recursos accesibles, robots, sitemap y URL Inspection |
| Titles | [Title links](https://developers.google.com/search/docs/appearance/title-link) | Title único, descriptivo y conciso; Google puede reescribirlo |
| Snippets | [Snippets](https://developers.google.com/search/docs/appearance/snippet) | Description como señal de snippet, sin longitud rígida |
| Enlaces | [Crawlable links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable) | `<a href>` y anchors descriptivos |
| Robots | [Robots.txt introduction](https://developers.google.com/search/docs/crawling-indexing/robots/intro) | Diferencia entre crawl y exclusión del índice |
| Sitemaps | [Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) | URLs absolutas/canónicas, `Sitemap:` y límites de la señal |
| Sitemaps en Search Console | [Sitemaps report](https://support.google.com/webmasters/answer/7451001?hl=en) | Envío, monitorización y nota sobre sitios pequeños |
| Canonical | [Consolidate duplicate URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) | Fuerza relativa de redirect, canonical y sitemap |
| JavaScript | [JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) | HTML inicial, renderizado y canonical |
| Mobile-first | [Mobile sites and mobile-first indexing](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing) | Paridad móvil de contenido, metadata, schema y alt |
| Imágenes | [Google Images best practices](https://developers.google.com/search/docs/appearance/google-images) | CSS background no indexable; `<img>`, responsive, alt y compresión |
| Page experience | [Page experience](https://developers.google.com/search/docs/appearance/page-experience) | CWV como señal, sin score único ni garantía de ranking |
| Core Web Vitals | [Defining Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds) | Umbrales p75 de LCP, INP y CLS |
| Structured data | [Introduction to structured data](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data) | JSON-LD recomendado y rich result no garantizado |
| Políticas de schema | [Structured data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) | Exactitud, visibilidad y riesgo de abuso |
| Organización | [Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/organization) | `Organization`, logo y desambiguación de entidad |
| Aplicación | [SoftwareApplication structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app) | Condición de `name`/`offers.price`; no marcar prematuramente |
| Site name | [Site names](https://developers.google.com/search/docs/appearance/site-names) | `WebSite`, name, URL y límites de automatización |
| IA en Search | [AI features and your website](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) | SEO base, no `llms.txt`/hacks y elegibilidad |
| Contenido generado | [Generative AI content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content) | Riesgo de contenido escalado sin valor |
| Spam | [Spam policies](https://developers.google.com/search/docs/essentials/spam-policies) | Keyword stuffing, doorway pages y scaled content abuse |
| FAQ | [Google Search updates](https://developers.google.com/search/updates) | Retirada del FAQ rich result desde mayo de 2026 |
| Google-Extended | [Common Google crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) | Separación entre Gemini y ranking de Search |
| Inspección | [URL Inspection tool](https://support.google.com/webmasters/answer/9012289?hl=en) | Verificación de indexación, canonical, render y schema |
| Analítica | [Search Console and Google Analytics](https://developers.google.com/search/docs/monitor-debug/google-analytics-search-console) | Search Console para Search; Analytics para comportamiento/conversión |

## Conclusión

El mayor retorno inicial no vendrá de añadir schema o perseguir una keyword exacta. Vendrá de que Google y el comprador reciban las mismas señales: **un solo dominio, una landing rápida, una promesa explícita sobre clínicas/agenda/WhatsApp, ejemplos verificables y una ruta clara hacia la demo**.

Una vez corregidos host, sitemap, app y hero, Search Console podrá mostrar qué lenguaje usa realmente el mercado. Esa evidencia debe decidir la siguiente iteración de title, H1, páginas de apoyo y CTA; no una plantilla de SEO ni un volumen de palabras arbitrario.
