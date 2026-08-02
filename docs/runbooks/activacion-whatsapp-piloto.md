# Activación de WhatsApp para una clínica piloto

Este runbook prepara el primer número real de una clínica para Praxia. No anotar tokens, OTPs, claves privadas ni documentos personales en este archivo, Linear o commits; conservarlos en el gestor de secretos autorizado.

## Criterio de finalización

La clínica tiene un sender de WhatsApp `ONLINE` en su subcuenta Twilio, plantillas aprobadas y una prueba end-to-end de webhook/callback validada. La activación productiva permanece deshabilitada hasta que también estén cerrados la base legal y el checklist operativo.

## 1. Preparar a Praxia

- [ ] Crear o confirmar el Meta Business Portfolio de Praxia y completar su verificación.
- [ ] Activar 2FA para las personas administradoras de Meta y Twilio.
- [ ] Crear la Meta app para el programa Tech Provider, aceptar la Partner Solution de Twilio y solicitar los permisos/revisión requeridos.
- [ ] Registrar solo los identificadores no secretos en la ficha operativa: Business Portfolio ID, Meta App ID y cuenta principal de Twilio.
- [ ] Configurar URLs HTTPS de producción para webhook y callback de estado. Aún no habilitar envíos reales.

## 2. Preparar a la clínica piloto

- [ ] Identificar al propietario que completará Embedded Signup y confirmar su acceso a Facebook/Meta.
- [ ] Crear o seleccionar el Business Portfolio de la clínica durante el flujo de Meta.
- [ ] Elegir un número dedicado de WhatsApp en E.164 que pueda recibir SMS o llamada de voz para OTP y no esté registrado en WhatsApp normal.
- [ ] Recopilar, fuera del repositorio, los datos legales y de configuración que requiere el onboarding de la clínica.

## 3. Crear y vincular la subcuenta de Twilio

- [ ] Crear una subcuenta Twilio exclusiva para la clínica.
- [ ] Ejecutar Embedded Signup con la clínica para crear/seleccionar WABA y verificar el número.
- [ ] Registrar el sender de la subcuenta por Senders API y esperar el estado `ONLINE`.
- [ ] Guardar en el registro de activación: subcuenta, WABA, sender, número E.164 y estado. Guardar el auth token cifrado mediante el mecanismo de secretos, nunca en texto plano.
- [ ] Confirmar la relación: una clínica ↔ una subcuenta Twilio ↔ una WABA.

## 4. Configurar mensajería y probar infraestructura

- [ ] Crear y enviar a aprobación las plantillas de confirmación, recordatorio y cancelación; no incluir datos clínicos en ellas.
- [ ] Configurar webhook entrante y callback de estado para el sender/subcuenta.
- [ ] Validar una firma `X-Twilio-Signature` con el token de la subcuenta y confirmar que una firma inválida es rechazada.
- [ ] Enviar un mensaje de prueba permitido, recibir el callback y verificar que se persiste idempotentemente.
- [ ] Registrar evidencia no sensible: fecha, sender, estado de plantilla, resultado de webhook y callback.

## 5. Puerta de producción

- [ ] Confirmar que [Cerrar la base legal para procesar datos reales](https://linear.app/k31-software/issue/APO-5/cerrar-la-base-legal-para-procesar-datos-reales) esté cerrado.
- [ ] Confirmar que el consentimiento/opt-in de WhatsApp se pueda registrar antes de iniciar mensajes salientes.
- [ ] Ejecutar la prueba end-to-end sobre el número real sin datos clínicos.
- [ ] Obtener revisión operativa explícita del fundador antes de cambiar a `production-enabled`.

## Evidencia mínima para cerrar la tarea

Registrar en el comentario de resolución de Linear únicamente: fecha de activación, identificadores no secretos, sender `ONLINE`, nombres/estados de plantillas, resultado de webhook/callback y ubicación del secreto en el gestor autorizado.
