# Confirmación explícita de Clínica lista para la atención administrativa por WhatsApp de Praxia

**Estado:** Aceptada; reemplazada en parte por ADR 0044
**Fecha:** 24 de agosto de 2026

ADR 0044 reemplaza la confirmación manual separada para activar WhatsApp. La
revisión de configuración inicial y el estado de Clínica lista para Asclepio
siguen siendo conceptos distintos de la conexión de WhatsApp.

Completar los pasos de Configuración inicial no habilitará la atención
administrativa por WhatsApp de Praxia de forma silenciosa. En la Revisión final,
el Médico propietario verá los requisitos cumplidos, la primera ruta de
atención válida y cualquier pendiente, y deberá confirmar explícitamente
“Declarar lista para Praxia”; la Activación de clínica de WhatsApp seguirá
siendo un proceso separado.

## Consecuencias

- La habilitación de la atención administrativa por WhatsApp tendrá una
  intención humana y un punto auditable.
- La revisión deberá mostrar el impacto de declarar la Clínica lista y permitir
  volver a Configuración sin perder el progreso.
- Completar el wizard y activar WhatsApp serán estados distintos y visibles.
