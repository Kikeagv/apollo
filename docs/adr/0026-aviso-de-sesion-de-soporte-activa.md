# Aviso persistente de sesión de soporte activa

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

Cuando una Clínica tenga una Sesión de soporte vigente, Panacea mostrará un
aviso persistente de seguridad dentro del shell, con el motivo, vencimiento y
accesos auditados disponibles en su detalle. El aviso desaparecerá al vencer
la sesión y no será un destino de la navegación principal, porque representa
un estado temporal de acceso de Apolo y no una capacidad clínica.

## Consecuencias

- La persona operadora podrá saber cuándo existe acceso administrativo
  excepcional sobre la Clínica.
- El aviso tendrá prioridad visual suficiente sin desplazar Calendario,
  Pacientes o Pendientes como destinos principales.
- El componente deberá mantener el lenguaje de auditoría y no revelar más
  datos de soporte de los autorizados.
