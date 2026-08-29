# Patrón maestro–detalle para superficies operativas

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

Calendario, Pacientes y Pendientes usarán un patrón maestro–detalle en
escritorio: la agenda, lista o bandeja conservará el contexto principal y el
elemento seleccionado se abrirá en un panel lateral. En teléfono, el detalle se
convertirá en drawer o pantalla completa. La selección deberá seguir siendo
enlazable para no sacrificar navegación directa ni recarga.

## Consecuencias

- El personal podrá revisar y resolver trabajo sin abandonar la lista de
  origen.
- Las fichas compartirán jerarquía, acciones y comportamiento responsive sin
  convertirse en una única pantalla monolítica.
- El panel deberá distinguir claramente datos de consulta, acciones
  disponibles y eventos o historial.
