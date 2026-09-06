# Puerto de WhatsApp y fuente de verdad de Praxia

**Estado:** aceptado
**Fecha:** 2026-09-05

## Contexto

Kapso será la capa de transporte y onboarding de WhatsApp, no el dueño de la
agenda ni del agente de Praxia. Sus webhooks tienen una semántica distinta a la
de Twilio: JSON estructurado v2, firma HMAC, idempotency key, eventos de
proyecto y de número, y pueden representar identidades sin teléfono mediante
BSUID.

El producto debe operar de forma multi-tenant, conservar una historia
administrativa verificable y seguir siendo sustituible en el futuro sin llevar
IDs de un proveedor al dominio.

## Decisión

- El dominio expone un puerto interno `WhatsAppProvider`; Kapso es el adaptador
  productivo y el adaptador simulado permanece para pruebas. No se implementa
  fallback automático a Twilio y se retiran de runtime sus variables, rutas y
  paquete porque no hay clientes Twilio que proteger.
- La lógica de citas, consentimiento, plantillas de negocio, ventanas de
  servicio, handoff, outbox, retención, alertas y auditoría permanece en
  Praxia. Kapso no ejecuta los workflows del agente ni se convierte en la
  fuente canónica de conversaciones, mensajes o estados de entrega.
- Praxia usa webhooks Kapso estructurados v2, sin buffering en la primera
  versión. Un endpoint compartido recibe los eventos de proyecto y de todos los
  números; después de verificar la firma resuelve la Clínica por customer y
  `phone_number_id`. Los secretos se separan por entorno y alcance.
- El endpoint valida HMAC-SHA256 sobre el cuerpo crudo con comparación
  timing-safe, registra `X-Idempotency-Key` en una tabla durable, responde 200
  rápidamente y procesa de forma asíncrona. Los reintentos, lotes y eventos
  fuera de orden no pueden duplicar efectos de negocio.
- `WhatsAppIdentity` es una entidad separada de Contacto. Se busca primero por
  BSUID y después por teléfono; el teléfono puede ser nulo. Se usa `recipient`
  para destinos BSUID y `to` únicamente cuando existe teléfono. Los cambios de
  identidad se conservan y los conflictos requieren resolución humana.
- El agente procesa mensajes entrantes nuevos de texto. Mensajes de la
  WhatsApp Business App (`business_app`) se almacenan y activan
  `human_takeover`; Asclepio queda pausado hasta reanudación explícita.
  `history_sync` se almacena pero nunca se procesa. Los eventos salientes nunca
  despiertan al agente.
- Audio, imágenes, documentos, ubicaciones e interactivos no se descargan ni
  interpretan en v1: se conserva el evento y se escala a una persona.
- La outbox persiste primero el evento de dominio. Un worker envía, conserva el
  ID del proveedor y registra `accepted`, `sent`, `delivered`, `read` o
  `failed`; reintenta fallos transitorios, trata 409/429, serializa por
  paciente y respeta el límite operativo de coexistencia de cinco mensajes por
  segundo por número. Un timeout ambiguo no se reenvía ciegamente.
- No se envía un mensaje proactivo sin Consentimiento de WhatsApp válido. Un
  mensaje entrante permite responder dentro de 24 horas, pero no concede
  recordatorios futuros. Un opt-out explícito suspende los envíos y solo un
  consentimiento nuevo los reactiva.
- Solo se envían datos administrativos mínimos de la cita. Diagnóstico,
  resultados, medicamentos, DUI, notas clínicas y documentos se mantienen
  fuera de WhatsApp.
- El rollout es: pruebas simuladas, sandbox de Kapso, una Clínica real con
  contactos sintéticos, aceptación operativa y luego más clínicas. Los datos
  reales quedan bloqueados hasta cerrar el gate legal y de privacidad.

## Consecuencias

- El núcleo de Praxia no depende de `phone_number_id`, customer ID ni IDs de
  Twilio; esos datos viven en la capa de conexión/adaptador.
- El modelo de Contacto debe tolerar identidades sin número y no puede asumir
  que todos los eventos tienen el mismo formato.
- La continuidad ante una caída de Kapso es explícita: backoff de outbox,
  estado degradado/fallido, alerta al superadmin y uso manual de la WhatsApp
  Business App; no hay cambio silencioso de proveedor.
- Una pausa por calidad de Meta, webhook, créditos o errores abre el circuito
  de la Clínica, detiene agente y outbox y exige reactivación manual.
- La migración futura a otro proveedor será un nuevo adaptador, no una
  reescritura del dominio, aunque no se promete conservar el historial interno
  del proveedor.

## Alternativas descartadas

- **Kapso como inbox y workflow principal:** se descarta para v1 porque la
  fuente de verdad de negocio debe seguir siendo Praxia.
- **Payload raw de Meta:** se pospone; v2 estructurado reduce la superficie de
  normalización inicial.
- **Buffering y batching desde el inicio:** se posponen hasta medir orden,
  latencia y carga reales.
- **Fallback automático a Twilio:** se descarta porque no existe una cuenta de
  clientes Twilio y cambiar de proveedor podría duplicar mensajes o romper el
  aislamiento.
- **Procesar multimedia en v1:** se descarta por riesgo de datos, alcance y
  cumplimiento; se evaluará como una decisión independiente.
