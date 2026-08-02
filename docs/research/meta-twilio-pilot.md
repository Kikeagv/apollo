# Meta + Twilio: activación del piloto de WhatsApp

Investigado el 30 de julio de 2026. Las fuentes citadas son documentación oficial
de Twilio; donde aplica, describen el flujo que Twilio integra con Meta/WhatsApp.

## Hallazgos

### Programa Tech Provider / ISV

- Praxia, como ISV que incorpora clínicas cliente, debe usar el programa Meta Tech
  Provider: crear y aprobar una Meta app, aceptar la *Partner Solution* de Twilio e
  integrar Embedded Signup. Twilio estima que los dos primeros pasos suelen tomar
  3–4 semanas. [Programa Tech Provider](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program)
- Antes de ello, el ISV necesita un Meta Business Portfolio, un sender propio
  registrado mediante Self Sign-up, 2FA y verificación del negocio. La integración
  también requiere permisos avanzados `whatsapp_business_messaging` y
  `whatsapp_business_management`, revisión de app y URLs HTTPS de producción.
  [Guía de integración](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide)

### Aislamiento por clínica, WABA y números

- La arquitectura que Twilio documenta es una subcuenta por cliente: cada WABA de
  cliente se conecta a una subcuenta distinta y una cuenta/subcuenta tiene relación
  uno-a-uno con una WABA. Los senders adicionales de la misma clínica reutilizan esa
  WABA. [Guía de integración](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide)
- Por tanto, la unidad de activación de Praxia debe guardar por clínica: subcuenta
  Twilio, WABA, sender `XE`, número E.164, estado del sender y configuración de
  webhook. Las subcuentas separan números y uso; tienen credenciales propias.
  [API de subcuentas](https://static0.twilio.com/docs/iam/api/subaccounts)
- El número se elige o asigna antes de lanzar Embedded Signup. Un número externo
  debe poder recibir SMS o llamada de voz para el OTP y no estar ya registrado en
  WhatsApp; el sender se registra como `whatsapp:<E.164>`.
  [Registro de senders para ISVs](https://www.twilio.com/docs/whatsapp/isv/register-senders)

### Embedded Signup frente a alta manual

- El primer sender de un cliente ISV se registra con Embedded Signup: la clínica
  crea o selecciona su Business Portfolio, crea una WABA y verifica el número propio
  mediante OTP cuando corresponde. Después Praxia crea la subcuenta y llama al
  Senders API con los datos de la WABA. [Registro del primer sender](https://www.twilio.com/docs/whatsapp/isv/register-senders)
- Self Sign-up de la consola sirve para el sender propio del ISV o para clientes
  directos; no sustituye la integración Tech Provider para clientes del ISV. Para
  pocos senders adicionales Twilio recomienda Embedded Signup; Senders API se
  recomienda para registro masivo. La sesión de Embedded Signup vence tras 60 minutos
  inactiva y no conserva el avance. [Self Sign-up](https://www.twilio.com/docs/whatsapp/self-sign-up)

### Webhooks y callbacks

- Todo webhook entrante debe validarse con `X-Twilio-Signature`, la URL completa y
  exacta que Twilio invocó, todos los parámetros y el Auth Token de la cuenta.
  Twilio recomienda usar su SDK, no implementar HMAC manualmente, porque puede añadir
  parámetros a los eventos. [Seguridad de webhooks](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
- El webhook de mensaje contiene `AccountSid`, asociado a la cuenta del mensaje.
  Praxia debe resolver de forma segura la clínica/subcuenta permitida desde ese SID
  o, preferiblemente, el número `To`, y usar el token de esa subcuenta para validar
  la firma. Esta última selección es una inferencia de arquitectura: Twilio exige las
  credenciales de la subcuenta para sus operaciones, pero no publica una receta
  específica para un único endpoint multi-subcuenta. [Parámetros de webhook](https://www.twilio.com/docs/messaging/guides/webhook-request) · [Subcuentas](https://static0.twilio.com/docs/iam/api/subaccounts)
- Configurar callback de estado por sender, Messaging Service o mensaje. Twilio hace
  `POST` con el SID, estado y, si aplica, código de error. Persistir esos callbacks
  idempotentemente y correlacionarlos al mensaje de Praxia. [Estado de mensajes WhatsApp](https://www.twilio.com/docs/whatsapp/api)
- El cambio de aprobación de una plantilla puede recibirse como el evento
  `com.twilio.messaging.template.approval.updated`; el estado también se consulta
  mediante Content API. [Evento de aprobación](https://www.twilio.com/docs/events/event-types/messaging/template-approval) · [Content API](https://www.twilio.com/docs/content/create-and-send-your-first-content-api-template)

### Plantillas y ventana de conversación

- Meta normalmente aprueba o rechaza plantillas en minutos, pero la revisión humana
  puede tardar hasta 48 horas. Solo las aprobadas se pueden enviar; los estados
  `Pending`, `Rejected`, `Paused` y `Disabled` deben bloquear o condicionar el envío.
  [Estados de plantilla](https://www.twilio.com/docs/whatsapp/tutorial/message-template-approvals-statuses)
- Fuera de la ventana de servicio de 24 horas iniciada por el paciente, los envíos
  requieren una plantilla aprobada. La clínica también debe obtener el opt-in del
  paciente antes de mensajería saliente. [Buenas prácticas](https://www.twilio.com/docs/whatsapp/best-practices-and-faqs)

### Pruebas y límites

- El Sandbox permite probar mensajes, webhooks y callbacks sin WABA ni sender
  registrado, pero es exclusivamente de prueba: solo pueden recibir usuarios que se
  unieron al Sandbox, no sirve para carga, permite un mensaje cada tres segundos y la
  sesión del usuario caduca tras tres días. [Sandbox de WhatsApp](https://www.twilio.com/docs/whatsapp/sandbox?save_locale=en-us)
- El Sandbox usa solamente sus plantillas preaprobadas y no permite plantillas
  personalizadas. La aplicación debe tener adaptadores simulados para pruebas de
  dominio y una suite de integración Sandbox separada; ninguna de ambas valida la
  activación productiva. [Sandbox de WhatsApp](https://www.twilio.com/docs/whatsapp/sandbox?save_locale=en-us)
- En producción, los límites y el escalamiento dependen de la calidad del sender y
  de la verificación/escala del Business Portfolio. Confirmar el límite vigente antes
  del lanzamiento, pues WhatsApp los cambia y los comparte a nivel de Business
  Portfolio en algunos casos. [Límites y calidad de sender](https://help.twilio.com/hc/en-us/articles/360024008153-WhatsApp-Sender-Message-Limits-and-Quality-Rating)

## Prerrequisitos para activar la primera clínica

1. Praxia ha completado Tech Provider, tiene app aprobada, Partner Solution enlazada
   y URLs HTTPS de producción configuradas.
2. La clínica dispone de acceso a su Meta Business Portfolio; durante Embedded Signup
   crea/selecciona la WABA y acredita el número. Si aporta su número, puede recibir el
   OTP por SMS o voz.
3. Praxia crea la subcuenta, registra el sender y espera su estado `ONLINE` antes de
   aceptar tráfico real. [Guía de integración](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide)
4. Los webhooks y callbacks validan firmas; los secretos de la subcuenta se almacenan
   cifrados y nunca se exponen al navegador.
5. Las plantillas de recordatorio/confirmación están aprobadas, la clínica tiene el
   contrato y aviso de privacidad aceptados, y el flujo dispone de evidencia de opt-in
   del paciente antes de iniciar conversaciones salientes.

## Implications for APO-3

- Decidir y documentar una **máquina de estados de activación de clínica**: `draft` →
  `tech-provider-ready` → `embedded-signup-pending` → `sender-registering` →
  `sender-online` → `templates-approved` → `production-enabled`; los estados finales
  deben quedar bloqueados hasta contrato/privacidad y revisión operativa.
- Definir un puerto `WhatsAppProvider` y un registro cifrado de credenciales por
  clínica. El adaptador simulado y Sandbox permiten desarrollar agenda y Asclepio sin
  aprobación externa; el adaptador Twilio es el único que puede habilitar producción.
- Hacer explícita la relación **clínica 1:1 subcuenta Twilio 1:1 WABA** y el mapeo de
  sender/número a clínica. Es una decisión de aislamiento, facturación y verificación
  de webhooks, no solo de onboarding.
- Implementar procesamiento idempotente de mensajes entrantes y callbacks, con
  verificación de firma basada en el secreto de la subcuenta correcta y pruebas con
  firmas válidas/inválidas.
- Preparar desde el inicio las plantillas de confirmación, recordatorio y cancelación;
  no prometer recordatorios productivos hasta que sus estados estén aprobados. Agregar
  evidencia de opt-in al modelo de contacto.
- La salida del piloto necesita un checklist humano: verificación Meta/Tech Provider,
  acceso de la clínica a Business Portfolio y OTP, sender `ONLINE`, URLs HTTPS,
  plantillas aprobadas, contrato/privacidad y prueba end-to-end sobre el número de la
  clínica.
