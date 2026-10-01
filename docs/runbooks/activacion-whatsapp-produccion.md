# Activación de WhatsApp en producción para Praxia

Runbook operativo para el alta y la activación de Clínicas con Kapso. El
recorrido de cada Clínica tiene cuatro pasos; la entrega confirmada de una
conversación iniciada con plantilla aprobada habilita automáticamente el
tráfico real, de acuerdo con [ADR 0044](../adr/0044-activacion-corta-y-consentimiento-por-contacto.md).
Kapso es transporte, onboarding, webhooks y billing; el agente, la agenda, el
consentimiento, las conversaciones y la auditoría viven en Praxia.

Este runbook describe el proceso aprobado en ADR 0044. El despliegue debe
conservar la evidencia del roundtrip y del callback de entrega por Clínica.

Fuentes del proveedor: [customer guide](https://docs.kapso.ai/docs/platform/customer-guide),
[manage setup links](https://docs.kapso.ai/docs/platform/setup-links/manage),
[connect WhatsApp](https://docs.kapso.ai/docs/how-to/whatsapp/connect-whatsapp),
[webhook security](https://docs.kapso.ai/docs/platform/webhooks/security),
[pricing FAQ](https://docs.kapso.ai/docs/whatsapp/pricing-faq) y
[Meta message billing](https://docs.kapso.ai/docs/whatsapp/meta-message-billing).

## Modelo de operación

| Ítem | Criterio |
| --- | --- |
| Proveedor WhatsApp | Kapso; adaptador simulado disponible para pruebas |
| Modelo por Clínica | Un número propio y un WABA propio |
| Conexión | `coexistence` o `dedicated`, según modalidad de la Clínica |
| Aplicación Meta | Aplicación predeterminada de Kapso |
| Billing | `partner_managed`, créditos centrales, atribución por Clínica |
| Inbox/agente | Praxia conserva agente, agenda, handoff y fuente de verdad |
| Webhooks | JSON estructurado v2, endpoint compartido, sin buffering inicial |
| Clientes Twilio | Ninguno; no hay migración ni fallback automático |
| Datos reales | Se habilitan al completar la prueba de plantilla del paso 4; cada envío proactivo conserva su control de consentimiento por Contacto |

## Roles y límites

### Superadmin de Praxia

- Crea la Clínica y su customer en Kapso.
- Registra los datos de la Clínica, envía/revoca/regenera el setup link y ve los estados.
- Puede reintentar provisioning, plantillas y webhooks. El E2E/preflight es un
  diagnóstico opcional y no forma parte de la activación por Clínica.
- No ve OTP, QR, contraseñas ni credenciales Meta.
- Puede abrir el circuito de protección después de corregir la causa y dejar
  auditoría.

### Médico propietario de la Clínica

- Es la persona autorizada para Meta y completa el setup link.
- Aporta el número propio, Business Portfolio/WABA, WhatsApp Business App y
  dispositivo para QR.
- Revisa display name y perfil comercial.

### Personal de clínica

- Puede operar Panacea y recibir handoffs según su rol.
- No puede cambiar billing, plantillas, conexión, webhooks ni propiedad Meta.

## Activación de una Clínica

Repetir estos cuatro pasos por Clínica, sin reutilizar enlaces, números o WABA:

1. **Registrar los datos de la Clínica.** Crear la Clínica, su propietario,
   zona horaria y la asociación de Kapso.
2. **Enviar el enlace de enrolamiento.** Entregar al propietario un setup link
   activo por un canal autenticado. El propietario conecta su WABA y número;
   completa Embedded Signup y QR cuando la modalidad lo requiere.
3. **Probar recepción y respuesta.** Antes de aprobar plantillas, enviar texto
   desde un Contacto controlado y confirmar que Praxia lo recibe y que la
   respuesta de la Clínica llega al Contacto.
4. **Probar inicio con plantilla.** Después de que Meta apruebe la plantilla,
   iniciar con ella una conversación al Contacto controlado y confirmar el
   callback `delivered` o `read`. Al completar esta prueba, Praxia habilita el
   tráfico real sin una aprobación manual adicional.

El paso 3 prueba el intercambio dentro de la ventana abierta por el mensaje del
Contacto. El paso 4 prueba el inicio proactivo con plantilla fuera de esa
ventana. La aceptación de un endpoint de webhook o un estado `accepted` de API
no sustituye la confirmación de entrega.

Para ambas pruebas, usa un número controlado y un Contacto vinculado solo a
Pacientes marcados como prueba. Puedes crear esa ficha ficticia desde la
Clínica; un vínculo adicional a cualquier Paciente real impide usar el
Contacto en estos recorridos.

### Trabajo automático de la plataforma

Al recibir `whatsapp.phone_number.created`, Praxia asocia el customer, la
Clínica, WABA y `phone_number_id`, provisiona webhooks, sincroniza el catálogo
de plantillas, consulta billing y registra el resultado. Los fallos conservan
su causa y permiten reintento; la redirección del navegador no marca por sí
sola una conexión como lista.

### Cobertura automatizada

Por Clínica se ejecutan los dos recorridos de transporte de los pasos 3 y 4.
Firma inválida, duplicados, reintentos, batching, takeover, consentimiento,
tutela, templates bloqueadas, billing y circuit breaker siguen como pruebas
automatizadas del producto. Un paso que el runner no ejecuta se informa como
“no ejecutado”; no se contabiliza como fallo de un roundtrip distinto. El
preflight del webhook de proyecto de Kapso acredita solo ese preflight.

### Consentimiento para mensajes

- El consentimiento cubre mensajes administrativos de citas: confirmaciones,
  recordatorios, cancelaciones y reprogramaciones. No cubre marketing ni
  contenido clínico.
- En WhatsApp, `CONTINUAR` acepta los términos y concede al Contacto el permiso
  para todos sus Pacientes actuales y futuros. `registrar` crea la ficha del
  Paciente y no solicita una segunda aceptación.
- En el alta manual de un Paciente desde la Clínica, el Contacto usado recibe
  automáticamente el permiso, con origen, actor y fecha auditables. Aplica
  también a menores antes de verificar la tutela y reactiva el permiso si el
  Contacto se había dado de baja.
- El permiso no se hereda entre Contactos. Cada Contacto añadido necesita su
  propia aceptación. Las aceptaciones de canal previas que no fueron revocadas
  se migran al mismo alcance y no vencen cuando cambian los términos.

El Contacto puede detener mensajes proactivos con un opt-out. La creación
manual posterior de un Paciente concede de nuevo el permiso al Contacto usado.
Ningún mensaje debe incluir diagnóstico, resultados, medicamentos, DUI, notas
clínicas ni documentos.

## Circuit breaker y continuidad

Abrir el circuito de una Clínica ante pausa de WABA/webhook, baja calidad,
crédito agotado, error de Meta/Kapso o incumplimiento legal. Al abrirlo:

1. detener el agente y los envíos nuevos de la outbox para esa Clínica;
2. conservar eventos y entregas para conciliación;
3. notificar al superadmin y crear alerta operativa;
4. permitir uso manual de la WhatsApp Business App;
5. reactivar solo manualmente después de corregir y probar.

Una caída de Kapso no cambia automáticamente a otro proveedor. La outbox usa
backoff y la clínica queda `degraded`/`failed` según el diagnóstico.

## Offboarding

- Detener envíos y marcar la conexión `disconnected`.
- Exportar configuración, templates, opt-ins, correlaciones y evidencia que
  corresponda al período de retención.
- Revocar la autorización/acceso con el consentimiento de la Clínica.
- Desactivar webhooks y setup links de Praxia.
- No borrar automáticamente el WABA, número, plantillas ni activos Meta de la
  Clínica.
- Coordinar borrado en Praxia, Kapso y backups según la matriz legal; no dejar
  una copia indefinida en logs o archivos de soporte.

## Evidencia y auditoría

Para cada Clínica conservar actor, fecha, estado, customer/phone/WABA IDs no
secretos, versión de templates, resultado de E2E, billing, incidentes,
reintentos y decisiones de circuito. Los secretos permanecen fuera del repo y
no se copian a Linear, chats ni comentarios de código.
