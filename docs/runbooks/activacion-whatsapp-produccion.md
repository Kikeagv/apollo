# Activación de WhatsApp en producción para Praxia

Runbook de operación para habilitar hasta cinco Clínicas beta con Kapso. Cada
Clínica conecta su propio número/WABA mediante setup link y `coexistence`.
Kapso es transporte, onboarding, webhooks y billing; el agente, la agenda, el
consentimiento, las conversaciones y la auditoría viven en Praxia.

Fuentes del proveedor: [customer guide](https://docs.kapso.ai/docs/platform/customer-guide),
[manage setup links](https://docs.kapso.ai/docs/platform/setup-links/manage),
[connect WhatsApp](https://docs.kapso.ai/docs/how-to/whatsapp/connect-whatsapp),
[webhook security](https://docs.kapso.ai/docs/platform/webhooks/security),
[pricing FAQ](https://docs.kapso.ai/docs/whatsapp/pricing-faq) y
[Meta message billing](https://docs.kapso.ai/docs/whatsapp/meta-message-billing).

## Estado inicial

| Ítem | Criterio |
| --- | --- |
| Proveedor WhatsApp | Kapso; adaptador simulado disponible para pruebas |
| Modelo por Clínica | Un número propio y un WABA propio |
| Conexión | `coexistence` con WhatsApp Business App |
| Aplicación Meta | Aplicación predeterminada de Kapso |
| Billing | `partner_managed`, créditos centrales, atribución por Clínica |
| Inbox/agente | Praxia conserva agente, agenda, handoff y fuente de verdad |
| Webhooks | JSON estructurado v2, endpoint compartido, sin buffering inicial |
| Clientes Twilio | Ninguno; no hay migración ni fallback automático |
| Datos reales | Bloqueados hasta gate legal y de privacidad |

## Roles y límites

### Superadmin de Praxia

- Crea la Clínica y su customer en Kapso.
- Ejecuta el preflight, genera/revoca/regenera el setup link y ve los estados.
- Puede reintentar provisioning, plantillas, webhooks y E2E.
- No ve OTP, QR, contraseñas ni credenciales Meta.
- Puede abrir el circuito de protección solo después de corregir la causa y
  dejar auditoría.

### Médico propietario de la Clínica

- Es la persona autorizada para Meta y puede generar/completar el setup link.
- Aporta el número propio, Business Portfolio/WABA, WhatsApp Business App y
  dispositivo para QR.
- Revisa display name, perfil, aviso y términos de su negocio.
- Confirma opt-ins y operación de la Clínica.

### Personal de clínica

- Puede operar Panacea y recibir handoffs según su rol.
- No puede cambiar billing, plantillas, conexión, webhooks ni propiedad Meta.

## Fase 0 — Preflight global

- [ ] Existe sitio HTTPS público de Praxia con contacto, privacidad y términos.
- [ ] El contrato Praxia–Clínica, DPA, retención y transferencias están
      aprobados para datos administrativos de citas.
- [ ] Está definido el contacto de soporte y la escalación ante incidentes.
- [ ] El endpoint de webhooks tiene HTTPS, validación de HMAC sobre raw body,
      comparación timing-safe, idempotencia durable y respuesta rápida 200.
- [ ] El worker/outbox, métricas, alertas, circuit breaker y backoff están
      desplegados.
- [ ] Los secretos de proyecto viven solo en el gestor autorizado y están
      separados por entorno.
- [ ] El catálogo de plantillas y locales exactos está versionado por Praxia.
- [ ] Se validó el pricing vigente de Kapso y Meta antes de comprar créditos;
      el plan recomendado para beta es Pro + números adicionales si el volumen
      permanece por debajo de 100.000 mensajes/mes, sujeto a precio vigente.

## Fase 1 — Alta de una Clínica

Repetir para cada Clínica, sin reutilizar enlaces, números o WABA.

1. Crear/confirmar la Clínica, owner, zona horaria y customer ID de Kapso.
2. Ejecutar el preflight de número propio, WhatsApp Business App, autoridad
   Meta, sitio, display name y capacidad QR.
3. Mostrar el aviso de `partner_managed` y la separación de cargos Meta/Kapso.
4. Generar un único setup link para `coexistence`; registrar actor, vencimiento
   de 30 días y estado `pending`.
5. Enviar el enlace al propietario por canal autenticado. El superadmin puede
   abrir el flujo manual y volver a generar el enlace si vence o falla.
6. El propietario completa Embedded Signup, selecciona su WABA/número y
   escanea el QR desde la WhatsApp Business App.
7. Esperar `whatsapp.phone_number.created`; no inferir conexión desde el
   redirect del navegador.
8. Ejecutar provisioning automático y marcar `ready` solo con todos los gates.

## Fase 2 — Provisioning y configuración

Para cada `phone_number_id` nuevo:

- [ ] Asociar de forma única customer, Clínica, WABA, display phone y estado.
- [ ] Crear webhooks de número para `received`, `sent`, `delivered`, `read`,
      `failed`, `conversation.created`, `conversation.ended` y
      `conversation.inactive`.
- [ ] Suscribirse a `whatsapp.phone_number.deleted` y detener envíos si ocurre.
- [ ] Sincronizar templates centralizados de confirmación, recordatorio,
      cancelación y reprogramación; esperar `APPROVED` en el locale exacto.
- [ ] Verificar partner billing, crédito, umbral de alerta y atribución.
- [ ] Actualizar la Conexión de WhatsApp y registrar el resultado append-only.

Un error deja la conexión en `provisioning`, `degraded` o `blocked`; nunca se
oculta en logs ni se marca `ready` parcialmente.

## Fase 3 — Smoke y aceptación

Usar contactos sintéticos y una cuenta interna con consentimiento de prueba.

- [ ] Entrante de texto nuevo → resolución BSUID/teléfono → agente → respuesta.
- [ ] Mensaje escrito desde Business App → `business_app` → almacenamiento y
      `human_takeover`; el agente queda pausado.
- [ ] `history_sync` se almacena sin generar respuestas.
- [ ] Audio, imagen, documento, ubicación e interactivo → evento almacenado y
      escalamiento, sin descarga/interpretación.
- [ ] Plantilla fuera de ventana de servicio → delivery statuses y correlación
      con la Entrega transaccional.
- [ ] Duplicado/replay/lote/firma inválida → idempotencia o rechazo correcto.
- [ ] Timeout/429/409 → backoff y sin duplicación.
- [ ] `phone_number_id` desconocido → rechazo y alerta, sin cruzar tenants.
- [ ] Opt-out explícito (“no me escriban más”) → bloqueo de envíos proactivos;
      un nuevo consentimiento explícito es necesario para reactivar.
- [ ] Datos clínicos en un mensaje → redirección a canal seguro y no envío.

## Fase 4 — Habilitación de tráfico real

La Clínica solo se habilita cuando:

- [ ] Conexión técnica `ready`.
- [ ] Gate legal/privacidad y contrato cerrados.
- [ ] Consentimiento por Contacto/categoría registrable y auditable.
- [ ] La Clínica acepta la operación `partner_managed` y tiene créditos.
- [ ] No existe bloqueo de Meta, display name pendiente que impida producción,
      pausa de calidad, webhook pausado ni deuda de billing.
- [ ] Superadmin aprobó la evidencia de smoke y autorizó el cambio.

El primer tráfico real debe ser administrativo y de baja escala. No incluir
diagnóstico, resultados, medicamentos, DUI, notas clínicas, documentos ni
transcripciones.

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
