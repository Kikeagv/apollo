# Recalcular el estado de preparación de la Clínica

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

El estado de una Clínica lista para Asclepio se recalculará después de cambios
que afecten su capacidad. Si deja de existir una ruta de atención válida, la
Clínica pasará a configuración pendiente y Asclepio dejará de ofrecer nuevas
Opciones de atención; al restaurar una ruta válida podrá volver a estar lista.
Este cambio no elimina ni cancela Citas existentes, y conserva historial y
configuración.

## Consecuencias

- La preparación no será un checkbox permanente ni dependerá solo de completar
  el wizard una vez.
- Configuración deberá mostrar qué requisito dejó de cumplirse y cómo
  resolverlo.
- La transición de preparación no debe confundirse con suspensión de
  suscripción ni con Activación de clínica de WhatsApp.
