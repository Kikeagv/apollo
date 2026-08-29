# Flujo Paciente primero para fichas administrativas

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

Panacea presentará la creación administrativa desde el Paciente: el formulario
permitirá registrar su Contacto inicial en el mismo flujo y guardará Paciente,
Contacto y Vínculo de forma atómica. Si el teléfono ya corresponde a un
Contacto de la Clínica, la interfaz ofrecerá reutilizarlo y crear el Vínculo en
lugar de duplicar el Contacto; los Contactos adicionales y Tutores se
administrarán desde la ficha del Paciente. El modelo de datos seguirá
manteniendo Contacto, Paciente y Vínculo como conceptos separados.

## Consecuencias

- El caso común no expone al operador la secuencia técnica de tres registros.
- Un Contacto podrá seguir vinculado a varios Pacientes, por ejemplo varios
  hijos de una misma familia.
- La operación de alta y la reutilización de teléfonos deberán conservar la
  atomicidad, el aislamiento por Clínica y las validaciones actuales.
