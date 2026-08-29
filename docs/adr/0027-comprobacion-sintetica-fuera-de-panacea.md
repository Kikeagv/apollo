# Comprobación sintética fuera de la experiencia de Panacea

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

La acción clínica sintética se conservará únicamente para pruebas E2E y
verificaciones técnicas protegidas; no aparecerá en el shell ni en las rutas
normales de Panacea. La capacidad existente no se tratará como una feature de
la Clínica ni como una acción disponible para Médicos o Secretarias.

## Consecuencias

- La interfaz clínica no mezclará controles de aislamiento con operación real.
- Las pruebas podrán seguir verificando la sesión autenticada y el aislamiento
  por Clínica mediante una superficie técnica separada.
- Cualquier ruta técnica deberá quedar fuera de la navegación de producto y
  protegida por sus propias condiciones de entorno o acceso.
