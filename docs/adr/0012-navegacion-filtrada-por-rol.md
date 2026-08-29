# Navegación de Panacea filtrada por rol

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

Panacea usará el mismo shell para todos los Usuarios de clínica, pero filtrará
los destinos visibles según el rol: la Secretaria verá Calendario, Pacientes y
Pendientes; el Médico no propietario verá además la Configuración de su propia
capacidad; y el Médico propietario tendrá la Configuración completa. Esta
visibilidad mejora el enfoque sin sustituir las comprobaciones de autorización
ni las restricciones de RLS en el servidor.

## Consecuencias

- No habrá menús paralelos ni una pantalla llena de acciones deshabilitadas por
  rol.
- Los estados vacíos y las instrucciones de Configuración deberán respetar el
  alcance del Médico no propietario.
- Una URL no visible seguirá siendo rechazada por la autorización del servidor;
  ocultar un destino no se considerará un control de seguridad.
