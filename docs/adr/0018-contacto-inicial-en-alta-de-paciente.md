# Contacto inicial requerido en el alta habitual de Paciente

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

El flujo habitual de “Nuevo Paciente” requerirá registrar o reutilizar un
Contacto inicial antes de guardar la ficha. Panacea ofrecerá una acción
secundaria explícita para crear una Ficha de Paciente incompleta cuando la
Clínica necesite registrar a una persona sin teléfono; esa ficha no podrá
usarse para crear una Cita manual hasta que tenga un Contacto vinculado.

## Consecuencias

- La interfaz no presentará una ficha aparentemente lista para agendar cuando
  aún falta un Contacto.
- El modelo seguirá permitiendo Pacientes sin Vínculos para soportar casos
  administrativos excepcionales.
- La ficha incompleta deberá mostrar una indicación accionable para agregar o
  reutilizar un Contacto.
