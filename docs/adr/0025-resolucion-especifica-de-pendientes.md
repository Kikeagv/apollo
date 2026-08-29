# Resolución específica dentro de Pendientes

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

Pendientes presentará una affordance coherente de resolución, pero cada caso
ejecutará su operación de dominio: cerrar un Escalamiento, resolver una
solicitud de autogestión de Cita o marcar resuelta una Alerta de Entrega
transaccional fallida. Ningún caso se descartará o eliminará genéricamente; la
acción conservará actor, instante, resultado e historial según el tipo.

## Consecuencias

- La lista puede compartir estados visuales y navegación sin falsear que los
  pendientes son la misma entidad.
- Los detalles y confirmaciones podrán variar por categoría cuando el impacto
  lo requiera.
- El historial resuelto seguirá siendo consultable sin reabrir o mutar el
  registro original de forma silenciosa.
