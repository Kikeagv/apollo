# Rutas independientes por destino de Panacea

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

Cada destino principal de Panacea tendrá una ruta independiente y enlazable:
Calendario, Pacientes, Pendientes y Configuración, con subrutas cuando una
superficie lo necesite. La separación conservará el shell compartido, pero
permitirá límites propios de carga, autorización, estado de URL, navegación del
navegador y pruebas sin mantener todas las features en `/`.

## Consecuencias

- `/` dejará de ser el contenedor de todas las superficies autenticadas y
  redirigirá o resolverá hacia Calendario.
- Los filtros y selecciones que deban sobrevivir a un enlace o recarga deberán
  expresarse en la URL o en un estado de ruta explícito.
- La lógica de dominio y las mutaciones tRPC existentes se conservarán; el
  cambio principal será de composición y navegación.
