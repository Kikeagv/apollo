# Operación de WhatsApp con capacidad limitada

**Estado:** aceptado  
**Fecha:** 2026-09-27

## Contexto

Meta puede permitir mensajería con capacidad `LIMITED` mientras la Clínica
completa revisiones que elevan su límite. Kapso muestra esta capacidad separada
de la conexión del número, el estado de la WABA y los webhooks. Tratar todo
resultado general `degraded` como un bloqueo impide preparar plantillas y usar
la capacidad que Meta ya permite.

## Decisión

- La verificación del negocio y la aprobación del nombre visible no son
  requisitos de Praxia para empezar a usar WhatsApp si Meta confirma
  `messaging_health=LIMITED` y `can_send_message=LIMITED`.
- Praxia considera esa respuesta `limited` solo si acceso, conexión y webhooks
  pasan, no hay entidades bloqueadas, y no hay un error ni `retry_after`.
  Cualquier otra degradación conserva su bloqueo actual.
- En modo `limited`, Praxia puede sincronizar y enviar plantillas a revisión.
  Una plantilla solo sirve para operaciones cuando Meta la aprueba. Meta aplica
  el límite vigente de la cuenta; la verificación posterior puede elevarlo.
- `limited` conserva un estado visible propio y no equivale a salud plena.
  Tampoco activa tráfico real por sí mismo: los gates de consentimiento,
  contrato, privacidad, retención, transferencia, billing, smoke y aprobación
  manual mantienen su autoridad según el ADR 0041.

## Consecuencias

- La Clínica puede iniciar el uso permitido por Meta antes de completar la
  verificación del negocio, sin presentar la limitación como una avería.
- Si Meta cambia la capacidad a `BLOCKED`, el readiness deja de aceptar la
  conexión; una `LIMITED` con errores de conexión, acceso o webhooks tampoco se
  acepta.
- Las plantillas permanecen pendientes hasta la aprobación de Meta, y los
  límites efectivos siguen dependiendo de Meta.
