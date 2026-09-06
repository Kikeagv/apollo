# Activación de WhatsApp para una Clínica piloto

Este runbook prepara una Clínica real para el primer piloto de Praxia usando
Kapso como capa de mensajería. La Clínica conserva su número, Business
Portfolio, WABA y WhatsApp Business App; Praxia conserva la lógica de negocio y
el agente. No anotar tokens, OTP, QR, claves privadas ni documentos personales
en este archivo, Linear o commits.

Referencias operativas: [crear y configurar setup links](https://docs.kapso.ai/docs/platform/setup-links/create-and-configure),
[conectar WhatsApp](https://docs.kapso.ai/docs/how-to/whatsapp/connect-whatsapp),
[webhooks](https://docs.kapso.ai/docs/platform/webhooks/overview),
[seguridad de webhooks](https://docs.kapso.ai/docs/platform/webhooks/security),
[BSUID](https://docs.kapso.ai/docs/whatsapp/business-scoped-user-ids) y
[ciclo de vida de plantillas](https://docs.kapso.ai/docs/whatsapp/templates/lifecycle).

## Criterio de finalización

La Conexión de WhatsApp de la Clínica está en `ready` cuando:

- Kapso emitió `whatsapp.phone_number.created` y Praxia lo asoció a la Clínica.
- El número está conectado en modo `coexistence` y la WhatsApp Business App
  sigue funcionando.
- El webhook compartido de Praxia está creado para el número y valida firma e
  idempotencia.
- Las cuatro plantillas críticas (`appointment_confirmation`,
  `appointment_reminder`, `appointment_cancellation` y
  `appointment_reschedule`) están aprobadas en el locale exacto del WABA.
- Billing `partner_managed`, créditos y atribución por Clínica están
  verificados.
- Una prueba sintética cubrió recepción, respuesta, delivery status, takeover
  desde la aplicación y un fallo controlado.

La activación técnica no habilita pacientes reales hasta cerrar consentimiento,
privacidad, contrato, retención y el gate legal correspondiente.

## 1. Preflight de la Clínica

- [ ] Existe la Clínica en Praxia y tiene Médico propietario invitado/activo.
- [ ] El propietario es una persona autorizada para administrar el Business
      Portfolio y WABA de la Clínica.
- [ ] La Clínica tiene una línea local propia, activa en la WhatsApp Business
      App (no WhatsApp personal), con la app actualizada.
- [ ] El propietario tiene el teléfono cerca y puede escanear el QR; no se
      planifica el camino SMS/llamada para `coexistence`.
- [ ] El nombre legal/comercial, dirección, categoría, sitio HTTPS público,
      aviso de privacidad y términos están listos y son consistentes.
- [ ] No se conocen bloqueos de Meta, calidad, display name o verificación que
      impidan producción.
- [ ] El equipo entiende que Praxia/Kapso no recibirán credenciales Meta y que
      la aplicación seguirá siendo utilizable durante la coexistencia.

## 2. Preparar Praxia y Kapso

- [ ] Registrar la Clínica y su customer ID de Kapso en la ficha de conexión;
      guardar solo IDs no secretos.
- [ ] Confirmar que el endpoint HTTPS compartido de webhooks está fuera de
      desafíos de login y responde rápidamente con 200.
- [ ] Configurar los webhooks de proyecto para
      `whatsapp.phone_number.created` y `whatsapp.phone_number.deleted`.
- [ ] Mantener desactivado el buffering en el webhook del número para el
      piloto; procesar de forma asíncrona después de validar firma y
      `X-Idempotency-Key`.
- [ ] Confirmar que el puerto `WhatsAppProvider` está apuntando a Kapso y que
      no existe un sender global compartido.
- [ ] Preparar el catálogo central de las cuatro plantillas Utility sin datos
      clínicos. La Clínica no edita el contenido en v1.
- [ ] Mostrar antes del enlace la divulgación de `partner_managed`: créditos
      centrales, cargos de Meta separados y atribución por Clínica.

## 3. Generar el setup link

El enlace puede generarlo el Médico propietario desde la configuración de
WhatsApp o el superadmin durante el alta manual de la Clínica.

- [ ] Ejecutar el preflight antes de crear el enlace.
- [ ] Crear el setup link para el customer correcto con `coexistence` y
      `partner_managed`.
- [ ] Confirmar que solo existe un enlace activo; si se regenera, revocar el
      anterior y registrar actor, fecha, motivo y vencimiento de 30 días.
- [ ] Entregar el enlace por una sesión autenticada o al correo autorizado; no
      pegarlo en tickets públicos, commits ni chats de soporte.
- [ ] Registrar estado `pending`, no `ready`, hasta recibir el evento de
      número creado y completar las pruebas.

## 4. Completar la conexión como propietario de la Clínica

1. Abrir el setup link e iniciar sesión en Meta con una persona administradora
   autorizada.
2. Crear o seleccionar el Business Portfolio y WABA de la Clínica.
3. Seleccionar el número que ya está activo en la WhatsApp Business App.
4. Elegir `coexistence`, mantener el teléfono disponible y completar el QR que
   muestra Meta. No cerrar la aplicación durante la sincronización.
5. Revisar el display name y el perfil comercial. No elegir la ruta “display
   name only”, que crea un número limitado administrado por Meta.
6. Completar el flujo y volver a Praxia. La redirección es informativa; el
   backend espera el evento de Kapso.

El propietario no debe enviar a Praxia contraseñas, tokens, QR ni OTP. Si el QR
expira o la conexión falla, el superadmin puede revocar y regenerar el enlace.

## 5. Provisionamiento automático posterior

Al recibir `whatsapp.phone_number.created`, el worker de Praxia debe:

- [ ] Crear/confirmar los webhooks del número para `received`, `sent`,
      `delivered`, `read`, `failed`, `conversation.created`, `ended` e
      `inactive`.
- [ ] Guardar `phone_number_id`, WABA/business account, display phone, tipo y
      estado de conexión en la Clínica correcta.
- [ ] Sincronizar las cuatro plantillas y esperar el resultado de aprobación;
      no asumir que un locale español de un WABA sirve para otro.
- [ ] Verificar que `partner_managed` quedó conectado y que existe crédito
      suficiente.
- [ ] Ejecutar un smoke de envío/recepción y dejar la conexión en `ready` solo
      si todos los criterios pasan.

Si un paso falla, dejar `provisioning` o `degraded`, mostrar la causa al
superadmin, crear una alerta y permitir reintento idempotente. No marcar
`ready` por una redirección exitosa.

## 6. Prueba sintética extremo a extremo

- [ ] Usar un contacto de prueba con Consentimiento de WhatsApp registrado;
      no usar pacientes reales.
- [ ] Enviar texto desde el contacto hacia la Clínica y verificar que Praxia
      resuelve BSUID primero y teléfono después.
- [ ] Confirmar que el agente procesa solo texto entrante nuevo.
- [ ] Escribir desde la WhatsApp Business App y verificar que el evento
      `business_app` se almacena y activa `human_takeover`; el agente queda en
      silencio.
- [ ] Sincronizar historial y verificar que `history_sync` se conserva pero no
      dispara respuestas.
- [ ] Enviar una confirmación/recordatorio por plantilla y comprobar estados
      `accepted`, `sent`, `delivered`, `read` o `failed` sin duplicados.
- [ ] Enviar un audio, imagen o documento de prueba y confirmar que no se
      descarga ni interpreta; debe escalar a humano.
- [ ] Repetir un webhook con la misma idempotency key y comprobar que no crea
      una segunda respuesta o cita.
- [ ] Simular 429/timeout y verificar backoff, alerta y circuito de protección.

## 7. Puerta de datos reales

- [ ] Consentimiento/opt-in registrable por Contacto y por categoría de
      comunicación.
- [ ] Opt-out explícito (“no me escriban más”) suspende envíos proactivos;
      `NO`/`CANCELAR` no se interpreta automáticamente fuera de contexto.
- [ ] Solo se envía información administrativa de la cita; no datos clínicos.
- [ ] Gate legal, contrato, DPA, transferencias, retención y borrado aprobados.
- [ ] Circuit breaker, alertas de créditos/calidad/webhook y contacto de
      soporte del superadmin probados.
- [ ] Autorización explícita del responsable de producto para habilitar la
      Clínica en tráfico real.

## Evidencia mínima

Registrar en la tarea operativa únicamente fecha, Clínica, IDs no secretos,
estado de conexión, nombres/locales/estados de plantillas, resultado sintético,
actor de generación del enlace y ubicación del secreto de proyecto. Nunca
registrar tokens, OTP, QR, contraseñas o documentos.
