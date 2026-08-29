# Cuadrícula temporal para el Calendario de Panacea

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

El Calendario de Panacea representará la Agenda como una cuadrícula temporal:
los días serán columnas y las Citas y Bloqueos se posicionarán según su hora y
período ocupado. La vista semanal mostrará la Clínica completa y la diaria
ampliará un día; la creación seguirá usando una cuadrícula de cinco minutos,
pero las etiquetas visuales podrán usar intervalos más amplios para conservar
legibilidad.

## Consecuencias

- Los espacios libres, traslapes y Citas manuales fuera de Horario serán
  visibles en el contexto temporal donde ocurren.
- La duración y el buffer de una Oferta de servicio deberán reflejarse en el
  período ocupado mostrado, sin recalcular la Cita.
- La cuadrícula necesitará una alternativa accesible en texto o lista para
  navegación por teclado, lectores de pantalla y pantallas estrechas.
