# Distribución del contenido público para crawlers de IA

**Estado:** Aceptada  
**Fecha:** 28 de agosto de 2026

El contenido público de `https://www.usepraxia.com` permitirá `OAI-SearchBot`, `GPTBot` y `Google-Extended`, además de declarar una política compatible con búsqueda, entrada para respuestas generativas y entrenamiento cuando el proveedor respete Content Signals. Se acepta la exposición del contenido público a reutilización por IA para aumentar la posibilidad de descubrimiento; las superficies autenticadas y privadas de `app.usepraxia.com` quedan fuera de este alcance.

## Considered Options

- Mantener bloqueados los crawlers de entrenamiento y limitarse a SEO tradicional.
- Permitir solo crawlers de búsqueda, sin entrenamiento ni uso generativo.
- **Permitir los tres crawlers en el contenido público** — opción aceptada por el valor esperado de aparecer en respuestas de IA y por la intención de distribuir la propuesta de Praxia a medida que aumente el uso de estos sistemas.

## Consequences

- Cloudflare debe dejar de servir los `Disallow` correspondientes y revisar el `Content-Signal: ai-train=no` actual para que no contradiga la decisión.
- La política se aplica al host público y no convierte el login, Panacea ni datos de Clínicas en contenido de marketing.
- La autorización no garantiza menciones ni recomendaciones: la relevancia, indexación y calidad del contenido siguen siendo necesarias.
- La decisión debe revisarse si aparece contenido privado, datos de clientes o una obligación contractual que limite su reutilización.
