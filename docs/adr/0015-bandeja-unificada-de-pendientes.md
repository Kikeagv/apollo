# Bandeja unificada de Pendientes

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

Pendientes será una única superficie de trabajo para revisar Escalamientos de
conversaciones, Escalamientos relacionados con Citas y Alertas de Entrega
transaccional fallida. La bandeja ofrecerá categorías y contadores para
priorizar el trabajo, pero cada tipo conservará su propio modelo, historial y
acción de resolución; Pendientes es una agrupación de interfaz, no una nueva
entidad de dominio.

## Consecuencias

- El personal tendrá un destino único para encontrar trabajo que requiere
  atención humana.
- La consulta podrá filtrar por categoría, estado y antigüedad sin duplicar
  los casos en varias rutas raíz.
- Las acciones de resolución deberán explicar el impacto específico del tipo
  de pendiente y conservar su auditoría existente.
