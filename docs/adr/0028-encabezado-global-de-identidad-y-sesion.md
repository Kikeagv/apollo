# Encabezado global de Identidad y Sesión de clínica

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

El shell de Panacea tendrá un encabezado global separado de la navegación
principal. Mostrará la Clínica y el rol actuales, ofrecerá una indicación del
estado de la Sesión de clínica y reunirá en un menú de cuenta las acciones de
seguridad y cierre de sesión; no desplazará la operación clínica hacia la barra
lateral.

## Consecuencias

- La identidad del contexto permanecerá visible durante Calendario, Pacientes,
  Pendientes y Configuración.
- Las acciones de sesión no se duplicarán dentro de cada ruta.
- Cualquier futuro cambio de Clínica deberá respetar la frontera de sesión,
  membresía y RLS, no ser solo un cambio visual del encabezado.
