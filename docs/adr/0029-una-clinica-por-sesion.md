# Una Clínica por Sesión de clínica

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

Cada Sesión de clínica de Panacea operará una única Clínica y no mostrará un
selector de Clínicas en el shell. El contexto se resolverá desde la membresía
activa de la Identidad y cualquier evolución hacia múltiples Clínicas deberá
introducir un flujo explícito de selección, renovación de sesión y
revalidación de RLS antes de cambiar esta decisión.

## Consecuencias

- El encabezado puede mostrar el nombre de la Clínica como contexto fijo, no
  como control de cambio inmediato.
- Las rutas y consultas no necesitan soportar alternancia de Clínica dentro de
  una misma sesión.
- La experiencia evita que un cambio de selección visual se confunda con una
  autorización real.
