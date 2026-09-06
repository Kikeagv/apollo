# Investigación profunda: Kapso como alternativa a Twilio para WhatsApp

**Corte de investigación:** 5 de septiembre de 2026

**Audiencia:** producto, ingeniería, operaciones y asesoría legal de Praxia

**Alcance:** Kapso como proveedor de WhatsApp para el SaaS de clínicas de Praxia, comparado con Twilio como alternativa futura; no existe una migración de clientes o números productivos desde Twilio.
**Naturaleza:** investigación técnica y de producto; no es asesoría jurídica, ni una certificación de seguridad, ni una cotización comercial.

## Respuesta ejecutiva

Kapso sí puede ser una alternativa convincente a Twilio **para la capa de WhatsApp**, especialmente si Praxia quiere que cada clínica conecte su propio número, necesita onboarding multi-tenant, bandeja de atención humana y workflows conversacionales ya construidos. Kapso se posiciona como una plataforma “WhatsApp for developers” con API, webhooks, workflows, inbox, funciones serverless, CLI/MCP y herramientas de onboarding sobre Meta.[^kapso-home][^kapso-whatsapp][^kapso-platform]

Kapso **no es un reemplazo funcional de Twilio como CPaaS general**. Twilio cubre WhatsApp además de SMS/MMS/RCS, voz/PSTN, SIP, email, video, Verify, Conversations y otras superficies. La propia comparación de Kapso recomienda Twilio cuando el requisito es multi-canal; Kapso es más estrecho y profundo en WhatsApp.[^twilio-cpaas][^twilio-channels][^kapso-twilio]

Para Praxia, la decisión adoptada es un **piloto controlado de Kapso sobre un puerto de proveedor**, sin migración ni fallback automático a Twilio. La lógica de agenda, reservas, recordatorios, escalamiento, consentimiento e idempotencia permanece en Praxia; Kapso aporta onboarding, transporte, webhooks y billing. Cada Clínica aporta su número/WABA, usa `coexistence` y autoriza mediante setup link. La conexión se prueba primero con datos sintéticos y, antes de usar pacientes reales, pasa por el gate legal existente.

## Decisión adoptada por Praxia

Esta investigación ya no deja abiertas las decisiones de producto que se
discutieron durante el grill:

- no hay clientes, números ni historial vivo en Twilio; no existe una
  migración técnica que ejecutar;
- cada Clínica tiene un número y WABA propios, conserva su propiedad Meta y
  aporta una línea activa en WhatsApp Business App;
- el camino es `coexistence`, con el setup link de Kapso y la aplicación Meta
  predeterminada de Kapso;
- el billing es `partner_managed`, con créditos centrales, atribución por
  Clínica y separación visible entre cargos Meta y Kapso;
- el superadmin puede generar, revocar y regenerar el link desde el alta
  manual, pero el propietario completa Meta, el QR y la autorización;
- el agente, la agenda, el consentimiento, la outbox, el handoff y la fuente
  canónica siguen en Praxia; Kapso no es el inbox ni el workflow de negocio;
- se usarán webhooks v2 estructurados, un endpoint compartido y sin buffering
  inicial; la identidad de WhatsApp soportará BSUID sin exigir teléfono;
- la primera versión procesa solo texto entrante nuevo. Mensajes de la
  Business App activan takeover humano; `history_sync` y multimedia no
  disparan al agente;
- el rollout es simulado → sandbox Kapso → una Clínica real con contactos
  sintéticos → aceptación → demás Clínicas.

Los cuatro riesgos que dominan la decisión son:

- Los términos de Kapso visibles al corte dicen que el servicio no está diseñado para PHI ni datos de salud sujetos a HIPAA o leyes equivalentes salvo acuerdo escrito adicional. También describen procesamiento internacional y múltiples subprocesadores. Esto es crítico para una clínica, aunque Praxia se limite a datos administrativos.[^kapso-terms][^kapso-dpa][^kapso-subprocessors]
- Kapso no ofrece un SLA estándar público en sus términos: salvo acuerdo escrito, no garantiza disponibilidad, tiempos de respuesta ni entrega ininterrumpida. Twilio sí publica un SLA de API, aunque con exclusiones y niveles según contrato.[^kapso-terms][^twilio-sla]
- La disponibilidad concreta de cada número salvadoreño debe validarse durante el preflight de la Clínica, pero Praxia no necesita provisionar líneas: el propietario aporta una línea local ya activa en WhatsApp Business App y la conecta mediante `coexistence`. La ruta “Bring your own Twilio” queda fuera del diseño adoptado.[^kapso-connect][^kapso-setup][^kapso-changelog]
- La tarifa de plataforma de Kapso puede ser mucho menor, pero no elimina las tarifas variables de Meta. Además, la documentación de Kapso anuncia que desde el 1 de octubre de 2026 cambiará el cobro de mensajes de servicio, mientras la página oficial de precios de WhatsApp de Meta consultada al corte todavía describe esos mensajes como gratuitos. No conviene cerrar un TCO con ese supuesto sin revalidarlo justo antes de contratar y de activar producción.[^kapso-meta-billing][^kapso-october][^meta-pricing]

## 1. Qué es Kapso

### 1.1 Posicionamiento

Kapso no intenta ser otra abstracción genérica de SMS, voz y email. Su propuesta pública está construida alrededor de WhatsApp Business Platform: exponer una API parecida a la Cloud API de Meta, recibir eventos por webhook y añadir la capa operativa que normalmente tendría que desarrollar un equipo SaaS: conversaciones, contactos, logs, workflows, agentes, bandeja humana, onboarding de clientes y funciones.[^kapso-whatsapp][^kapso-api][^kapso-platform]

Kapso afirma ser Meta Business Solution Provider y publica que ahora opera como BSP. En este informe ese punto se trata como **afirmación del proveedor**, no como verificación independiente del estatus contractual de Kapso frente a Meta.[^kapso-managed-billing][^kapso-seed]

### 1.2 Superficies principales

| Superficie | Qué ofrece Kapso | Relevancia para Praxia |
| --- | --- | --- |
| API de WhatsApp | Texto, media, plantillas, interactivos, reacciones y Flows; endpoint con forma cercana a Meta Cloud API. | Permite conservar gran parte del modelo de mensajería de WhatsApp sin mantener el acceso directo a Meta en cada flujo. |
| Webhooks | Eventos entrantes, enviados, entregados, leídos, fallidos, conversaciones, conexiones y handoff; payload estructurado Kapso o forwarding raw de Meta. | Puede reemplazar el webhook form-urlencoded de Twilio, pero exige un adaptador nuevo y validación HMAC-SHA256. |
| Platform | Clientes, setup links, conexión de cuentas/números propios, scopes por customer/number y APIs de operación. | Es la pieza más relevante para el SaaS multi-clínica. |
| Workflows | Grafos dirigidos con envío, espera, decisiones, funciones, webhooks, llamadas a otros workflows, agentes y handoff humano. | Puede reducir código de orquestación, pero no debe sustituir la autoridad de la agenda de Praxia. |
| Inbox | Aplicación standalone o iframe embebible, filtros, asignación, estados, notas y tiempo real por WebSocket. | Puede complementar o sustituir parte de la bandeja de escalamientos de Praxia. |
| Funciones | Funciones JavaScript serverless, secretos, endpoints y logs de invocación. | Útil para integraciones pequeñas; no conviene poner ahí reglas críticas de citas sin una estrategia de pruebas y observabilidad propia. |
| Herramientas de desarrollo | SDK TypeScript, CLI, MCP y edición local de workflows en JSON/TypeScript. | Facilita prototipos y operación desde repositorio; el alcance público de SDKs oficiales es más reducido que el ecosistema de Twilio. |

Fuera de WhatsApp, no encontré en la documentación pública revisada una matriz equivalente de SMS general, RCS, MMS, PSTN Voice, email, video, SIP o Verify. Eso no demuestra que no exista ninguna función adicional, pero sí que no debe presupuestarse como sustitución de esos productos sin una confirmación comercial y técnica específica.[^kapso-sdk][^twilio-cpaas][^twilio-verify]

## 2. Kapso frente a Twilio

| Criterio | Kapso | Twilio | Consecuencia de decisión |
| --- | --- | --- | --- |
| Enfoque | WhatsApp-first; automatización y operación alrededor del canal. | CPaaS amplio con canales y productos adicionales. | Kapso encaja mejor si WhatsApp es el producto; Twilio si el roadmap es omnicanal. |
| Modelo de canal | API de WhatsApp sobre Meta, con capacidades propias de Kapso. | WhatsApp a través de Twilio, además de SMS, voz, email, video, SIP, Verify, Flex y otros. | El proveedor de WhatsApp no reemplaza automáticamente la red y APIs restantes de Twilio. |
| API saliente | REST/SDK con `X-API-Key`; endpoint de WhatsApp cercano a Meta Cloud API. | REST/SDK de Twilio, recursos, SIDs, callbacks y, en algunos productos, TwiML. | El dominio debe depender de un puerto propio, no de objetos Twilio. |
| Webhook entrante | JSON, firma HMAC-SHA256, idempotency key, reintentos, buffering y batching configurables. | POST tradicional, con validación `X-Twilio-Signature` sobre URL, parámetros y Auth Token. | No es un cambio de URL: cambia parsing, firma, eventos y semántica de entrega.[^kapso-webhooks][^kapso-security][^twilio-webhook-security] |
| Multi-tenant | Platform crea clientes y hosted setup links; cada cliente puede conectar su propia cuenta/número. | Para un ISV, Tech Provider, Embedded Signup, subcuenta por cliente y relación WABA/subcuenta documentada. | Ambos pueden soportar SaaS; el modelo de credenciales y onboarding es distinto.[^kapso-setup][^twilio-tech-provider] |
| Operación humana | Inbox propio, standalone o iframe, con handoff. | Hay que construir la operación o usar productos como Flex/Conversations, con costos y modelado adicionales. | Kapso gana tiempo de construcción para un equipo pequeño. |
| Automatización | Workflows, agentes, waits, decisiones, funciones y herramientas. | Twilio ofrece building blocks; la orquestación de negocio suele quedar más a cargo del integrador. | Kapso es más opinionado y productivo para bots de WhatsApp. |
| Números | Customer-owned numbers, coexistencia, número propio/SIM y provisioning administrado; cobertura local debe confirmarse. | Números, portabilidad y telephony más amplios, sujetos a país/producto. | El número local de El Salvador es una validación previa, no una suposición. |
| Costos de WhatsApp | Plan mensual por capacidad + Meta + posibles overages, números y billing/FX. | $0.005 por mensaje entrante o saliente en la página específica de WhatsApp + Meta; números/add-ons y productos adicionales aparte. | Kapso puede abaratar el margen de plataforma, sobre todo a volumen, pero Meta permanece. |
| Escala publicada | Límites de API por plan: 100, 500 o 1.000 requests/min para Free, Pro y Platform; Meta conserva sus propios límites.[^kapso-rate-limits] | Límites y capacidad dependen del producto, cuenta, sender, carrier y reglas de Meta. | Medir la carga real de Praxia; no confundir rate limit de proveedor con capacidad de WhatsApp. |
| SLA | Sin SLA estándar en los términos visibles; requiere acuerdo escrito. | SLA de API publicado de 99,95%, con 99,99% para ciertos clientes/ediciones y exclusiones. | Para recordatorios críticos, exigir compromiso contractual o conservar fallback. |
| Compliance | DPA, controles de seguridad declarados y lista de subprocesadores; restricciones expresas sobre PHI/datos regulados salvo acuerdo. | Trust Center, certificaciones y productos elegibles; también exige revisar DPA y matriz de responsabilidades. | Ningún logo de compliance sustituye el análisis de los datos concretos de Praxia. |
| Portabilidad | WABA del cliente puede seguir siendo suyo; no encontré guía oficial de migración completa desde Twilio. Números provistos por Kapso se licencian, no se venden. | Tiene procesos de números y programa Tech Provider, pero migrar código, historial y lógica tampoco es automático. | El activo que debe preservarse es el WABA/número del cliente, no solo el adaptador. |

La conclusión de la tabla es simple: **Kapso es un posible sustituto de Twilio en la capa WhatsApp, no un sustituto de Twilio como plataforma de comunicaciones completa**.

## 3. Encaje con la arquitectura actual de Praxia

### 3.1 Qué puede permanecer igual

La documentación de Praxia ya separa el núcleo de dominio de la entrega real: agenda como autoridad, reservas, cancelaciones, recordatorios, escalamientos, reintentos, concesión de trabajos e idempotencia. Esa separación es exactamente la costura que permite evaluar otro proveedor sin reescribir el producto.[^praxia-producto]

El repositorio contiene piezas y documentación del camino previsto de Twilio,
pero no existe un adaptador Twilio productivo con clientes que preservar. Esas
piezas no deben definir el dominio: el trabajo productivo será un puerto
`WhatsAppProvider`, un adaptador Kapso y un adaptador simulado. El caso de uso
no necesita saber si la entrega salió por Kapso o por un proveedor futuro.

Debe conservarse en el dominio:

- la idempotencia de mensajes y de trabajos de entrega;
- el almacenamiento de eventos y estados de entrega;
- el vínculo clínico entre número, conversación y clínica;
- la regla de que la agenda es la única autoridad;
- el silencio del asistente después del handoff humano;
- la alerta operativa cuando una entrega falla definitivamente;
- la política de no enviar contenido clínico ni datos innecesarios al proveedor.

### 3.2 Qué cambia técnicamente

#### Salida

Twilio usa un cliente autenticado con Account SID/Auth Token y `messages.create`, con `from` y `to` en formato `whatsapp:<E.164>`. Kapso documenta un POST a un endpoint como:

```text
POST https://api.kapso.ai/meta/whatsapp/{PHONE_NUMBER_ID}/messages
X-API-Key: ...
```

La identidad principal pasa a ser el `phone_number_id` de Meta/Kapso, no solo un número E.164. Para un SaaS, la configuración por clínica debería poder guardar, como mínimo, proveedor, Kapso project/customer, `phone_number_id`, WABA/Business Account, estado de conexión, templates y referencia segura a credenciales.[^kapso-api][^kapso-send][^kapso-platform]

#### Entrada

El webhook actual de Praxia lee `application/x-www-form-urlencoded`, valida `X-Twilio-Signature`, toma `MessageSid` como idempotency key y mapea `From`/`To`. Kapso entrega JSON, firma HMAC-SHA256 en `X-Webhook-Signature`, `X-Idempotency-Key`, versión de payload y eventos que pueden llegar por lote o con buffering.[^kapso-webhooks][^kapso-security][^kapso-advanced]

El nuevo endpoint debe:

1. conservar el cuerpo crudo hasta validar la firma;
2. responder en menos de diez segundos y delegar el trabajo pesado a la cola/outbox;
3. persistir la idempotency key antes de procesar el evento;
4. aceptar reintentos y lotes sin duplicar reservas, cancelaciones o respuestas;
5. resolver la clínica por `phone_number_id`/customer autorizado, sin suponer que siempre habrá un teléfono en formato E.164;
6. considerar BSUID/identidades nuevas de WhatsApp y no depender exclusivamente del número telefónico;
7. probar eventos recibidos, entregados, leídos y fallidos, no solo el mensaje entrante.

Kapso documenta reintentos inmediatos y posteriores aproximadamente a 10, 40 y 90 segundos, además de pausa automática ante una tasa persistente de fallos. Esto es útil, pero no equivale a “exactly once” ni a una retención indefinida de eventos; la aplicación debe seguir siendo idempotente y tener una ruta de recuperación.[^kapso-advanced]

#### Plantillas

La migración no elimina las reglas de Meta. El paciente debe haber dado opt-in; dentro de la ventana de servicio se puede responder con texto libre según las reglas vigentes; fuera de ella se necesita una plantilla aprobada. Meta puede rechazar, pausar o limitar plantillas y cuentas por calidad/spam.[^meta-policy][^meta-service][^twilio-quickstart]

El adaptador actual de Praxia envía textos simples para confirmación, cancelación y recordatorio. Para tráfico productivo real, tanto con Twilio como con Kapso, conviene modelar explícitamente `templateName`, idioma, variables y estado de aprobación. No se debe depender de que un texto libre enviado por un worker siempre sea aceptado fuera de la ventana de 24 horas.

### 3.3 Inbox y handoff

Kapso tiene un inbox standalone y un iframe embebible con filtros, asignación, estados y conexión en tiempo real. Praxia ya tiene su propia bandeja de pendientes y escalamientos. Hay tres opciones:

- conservar la bandeja de Praxia y usar Kapso solo como transporte/webhook;
- incrustar Kapso como herramienta operativa, manteniendo en Praxia la decisión de negocio y el audit trail;
- adoptar el inbox de Kapso para conversaciones y sincronizar a Praxia los eventos que requieren decisión sobre una cita.

Para el piloto recomiendo la primera opción. Reduce acoplamiento y evita que la operación de la clínica dependa de dos fuentes de verdad. La segunda puede ser una prueba posterior si el inbox de Kapso aporta una ventaja clara sobre la bandeja propia.[^kapso-inbox][^kapso-embedded][^praxia-producto]

## 4. Onboarding multi-clínica y números

### 4.1 Por qué Kapso Platform es la pieza importante

Kapso documenta un flujo en el que Praxia crea un customer, genera un setup link y permite que la clínica conecte su cuenta/número mediante Meta Embedded Signup sin compartir credenciales con Praxia. Puede configurarse billing administrado por el cliente o por el partner.[^kapso-platform][^kapso-setup][^kapso-customer]

Eso se alinea con el diseño adoptado de Praxia: cada Clínica es propietaria de
su relación de WhatsApp, número, WABA, opt-ins y continuidad. Kapso ofrece la
ruta técnica, pero no elimina la necesidad de definir propiedad, consentimiento
y gates legales en el dominio de Praxia.

Para la primera prueba se adopta `partner_managed`: Praxia/Kapso centralizan
los créditos y Praxia atribuye el consumo por Clínica, mientras la interfaz
separa explícitamente cargos de Meta y de plataforma. Esto implica créditos,
conciliación, FX, riesgo de cobranza y dependencia operativa de Kapso; por eso
el onboarding verifica billing antes de `ready`, muestra umbrales y abre un
circuit breaker si el crédito o la conexión fallan. Completar el setup no prueba
por sí solo que billing haya quedado conectado.[^kapso-setup][^kapso-managed-billing]

### 4.2 Coexistencia, número propio y número provisto

Kapso documenta tres rutas relevantes:

- **Coexistencia:** la clínica mantiene WhatsApp Business App y sincroniza el canal con Kapso; es adecuada para negocios pequeños, pero tiene límites de velocidad más modestos.
- **Número propio/SIM dedicado:** se retira el número de la app o proveedor anterior y se completa la verificación para Cloud API; ofrece una ruta de mayor escala, con más fricción de migración.
- **Número administrado/provisionado:** el proveedor aporta el número según disponibilidad y país; los términos de Kapso aclaran que esos números se licencian, no se venden, y que la portabilidad no está garantizada.

La documentación de setup menciona rutas de provisioning administrado, pero el
diseño de Praxia no las usa. La Clínica aporta y conserva su número local, lo
mantiene en WhatsApp Business App y completa `coexistence` mediante QR. Para El
Salvador aún se debe validar cada línea y los bloqueos de Meta durante el
preflight; no se compra una línea, no se usa “Bring your own Twilio” y no se
elige “display name only”.[^kapso-connect][^kapso-setup][^kapso-changelog][^kapso-terms]

### 4.3 Transición desde el diseño previsto de Twilio

No existe una migración de tráfico, números, WABA, historial, opt-ins ni
plantillas desde Twilio: no hay clientes ni números Twilio productivos. La
transición consiste en sustituir el diseño previsto antes de activarlo:

1. retirar del runtime las variables, rutas, paquetes y supuestos Twilio;
2. conservar el dominio detrás de `WhatsAppProvider` y un adaptador simulado;
3. crear el customer Kapso y setup link por Clínica;
4. conectar el número/WABA propio del propietario con `coexistence`;
5. provisionar webhooks, templates, billing y E2E de forma idempotente;
6. ejecutar la Clínica canario con contactos sintéticos;
7. habilitar tráfico real únicamente después de los gates legales y de
   consentimiento.

La futura salida de Kapso debe ser otro adaptador y un procedimiento de
offboarding. No debe confundirse con un fallback automático: cambiar de
proveedor durante una incidencia podría duplicar mensajes o perder el vínculo
de identidad.

## 5. Costos y TCO

### 5.1 Precio publicado de Kapso

La página comercial de Kapso publica los siguientes planes. Los importes son del proveedor y deben confirmarse en una cotización/orden de servicio, especialmente porque las páginas de pricing y FAQ muestran métricas con nombres distintos para algunas capacidades.[^kapso-twilio][^kapso-pricing-faq][^kapso-pricing-es]

| Plan | Precio de plataforma publicado | Mensajes incluidos/mes | Números incluidos | Otros límites destacados |
| --- | ---: | ---: | ---: | --- |
| Free | $0 | 2.000 | 1 | Sandbox; almacenamiento reducido; API, workflows y agentes disponibles con límites de rate. |
| Pro | $25/mes | 100.000 | 3 | 100 GB de media; números adicionales publicados a $10; integración/funciones con métricas que deben reconciliarse. |
| Platform | $299/mes | 1.000.000 | 50 | 1 TB de media; números adicionales publicados a $5; onboarding y APIs de plataforma. |
| Enterprise | Cotización | Personalizado | Personalizado | Soporte, contrato y requisitos empresariales por acordar. |

Para la beta objetivo de cinco Clínicas, el plan Free no alcanza porque limita
el proyecto a un solo número. Si el volumen permanece por debajo de 100.000
mensajes mensuales, la hipótesis operativa es **Pro + dos números adicionales**
(cinco números en total); debe validarse el precio vigente de números extra y
los cargos de Meta antes de comprar créditos. Si el volumen o los límites de
Platform crecen, reevaluar Platform. No se debe comprar el plan basándose solo
en la tabla publicada.

La FAQ define como mensajes contables los entrantes y salientes de texto, media, plantillas, interactivos y reacciones; los read receipts quedan excluidos. Por tanto, “100.000 mensajes” no significa necesariamente 100.000 conversaciones ni 100.000 mensajes salientes: una conversación de ida y vuelta consume varias unidades.[^kapso-pricing-faq]

La página en español publica overage de $0.002 por mensaje adicional en Pro y $0.001 en Platform. La FAQ también habla de “integration calls” de 1.000/10.000, mientras la página comercial habla de 1.000.000/10.000.000 “function calls”. Trataría esto como una inconsistencia documental que debe quedar resuelta en la orden de servicio, no como una suposición de presupuesto.[^kapso-pricing-es][^kapso-pricing-faq][^kapso-twilio]

Kapso afirma que las tarifas de Meta se trasladan separadamente y sin markup sobre la tarifa Meta. El billing administrado puede usar créditos Kapso; la documentación también menciona margen FX para cuentas no-USD. La IA se promociona sin markup Kapso, pero eso no debe interpretarse como “IA gratis”: deben confirmarse el costo base del modelo, el procesamiento de pagos, los proveedores usados y el tratamiento de datos.[^kapso-meta-billing][^kapso-managed-billing][^kapso-subprocessors]

### 5.2 Precio de Twilio para WhatsApp

La página específica de Twilio publica **$0.005 por mensaje entrante o saliente**, más la tarifa de Meta para mensajes de plantilla. También documenta un cargo para mensajes fallidos y, si se usa Conversations, un cargo de usuario activo mensual, almacenamiento y las tarifas de canal correspondientes.[^twilio-whatsapp-pricing][^twilio-conversations]

La tarifa de Twilio no equivale al costo completo de Twilio CPaaS: pueden agregarse número, Messaging/Conversations, add-ons, otros canales y soporte. Twilio publica asimismo una tarifa de número que parte de $1.15/mes en algunos casos, pero el importe real depende del país y del tipo de número.[^twilio-messaging-pricing]

### 5.3 Ejemplos de comparación

Kapso compara públicamente su tarifa de plataforma con un cálculo de Twilio basado en $0.005 por mensaje:

| Volumen mensual | Twilio: cálculo de $0.005 | Kapso publicado | Ahorro porcentual promocionado por Kapso |
| ---: | ---: | ---: | ---: |
| 50.000 | $250 | Pro $25 | 90% |
| 100.000 | $500 | Pro $25 | 95% |
| 500.000 | $2.500 | Platform $299 | 88% |
| 1.000.000 | $5.000 | Platform $299 | 94% |

Estos ejemplos son útiles para entender la tesis comercial, pero **no son un TCO auditado ni una comparación completamente homogénea**: excluyen o tratan por separado Meta, números, add-ons, Conversations, FX, overages, soporte y cualquier diferencia en cómo se cuentan los mensajes. La cifra de Kapso debe etiquetarse como “publicada por Kapso”.[^kapso-twilio][^twilio-whatsapp-pricing][^meta-pricing]

Dos puntos de equilibrio orientativos, calculados únicamente contra el cargo de plataforma de WhatsApp de $0.005 de Twilio y sin Meta, números ni extras:

- Kapso Pro ($25) cruza el costo unitario de Twilio a partir de aproximadamente **5.000 mensajes totales/mes**.
- Kapso Platform ($299) cruza ese costo a partir de aproximadamente **59.800 mensajes totales/mes**, aunque la capacidad, el número de clínicas y la cantidad de números pueden hacer que se elija un plan antes o después.

Ejemplo de sensibilidad con los overages publicados: 150.000 mensajes en Pro serían $25 + 50.000 × $0.002 = **$125** de plataforma; 2.000.000 en Platform serían $299 + 1.000.000 × $0.001 = **$1.299**. Son cálculos orientativos, no una cotización y no incluyen Meta.

### 5.4 Meta y el cambio de octubre de 2026

Meta define sus cargos por mensaje entregado, categoría y país del destinatario. Las categorías actuales son marketing, utility, authentication y service. Al corte, la página oficial de Meta describe como gratuitos los mensajes de servicio y los utility enviados en respuesta a un usuario, dentro de las reglas correspondientes.[^meta-pricing][^meta-service][^meta-utility]

La guía de Kapso sobre octubre de 2026 anuncia que desde el 1 de octubre los service messages pasarán a cobrarse por mensaje, y que las estimaciones dependerán de la tarifa utility vigente. Es una afirmación/documentación de Kapso sobre un cambio futuro que entra en tensión con la página pública de Meta consultada el 29 de agosto. Las rate cards pueden actualizarse antes de la fecha; hay que verificar el panel/cuenta Meta y la documentación oficial vigente al contratar.[^kapso-october][^kapso-country-pricing][^meta-pricing]

No usé una tarifa Meta exacta para El Salvador en este informe porque el precio depende de la agrupación de mercado, categoría, fecha y volumen, y las fuentes consultadas no daban una cifra local estable y verificable. La cotización debe modelar por separado al menos: mensajes entrantes, respuestas dentro de 24 horas, recordatorios utility fuera de esa ventana, país del destinatario, porcentaje entregado y volumen mensual.

## 6. Seguridad, datos y cumplimiento

### 6.1 Riesgo específico para Praxia

Los términos de Kapso visibles al corte indican que, salvo acuerdo escrito adicional, los servicios no están diseñados para PHI ni para datos de salud sujetos a HIPAA o leyes equivalentes. También restringen otros datos regulados y no presentan una certificación automática de HIPAA, PCI DSS o FedRAMP.[^kapso-terms]

Eso no significa que Kapso sea inviable para Praxia. Significa que el diseño debe mantener una frontera estricta: el proveedor de mensajería recibe solo lo necesario para la operación administrativa y no debe convertirse en almacenamiento de diagnóstico, tratamiento, expediente, audio clínico o transcripción clínica. Aun así, una conversación de reserva puede revelar que una persona es paciente de una clínica, y el contexto de una clínica puede volver sensible una combinación aparentemente administrativa.

El análisis legal local ya identificó para El Salvador datos de contacto, DUI, fecha de nacimiento, vínculo tutor-menor, citas, conversaciones, audio y transcripciones como superficies que requieren base jurídica, aviso, minimización, seguridad, retención, transferencias y un reparto claro entre clínica y Praxia.[^legal-praxia]

### 6.2 DPA, ubicación y subprocesadores

El DPA de Kapso describe tratamiento internacional en Estados Unidos, Chile y otros países, además de salvaguardas contractuales como SCCs cuando aplican. Su lista de subprocesadores incluye infraestructura, observabilidad, soporte, email, herramientas de agentes/IA, Meta/WhatsApp y Stripe, entre otros.[^kapso-dpa][^kapso-subprocessors]

Para el piloto habría que obtener una matriz versionada con proveedor, país, función, categorías de datos, retención, transferencia, control de cambios y mecanismo de objeción. La lista pública es útil para empezar la revisión, pero no sustituye el anexo Clínica–Praxia ni la validación de asesoría salvadoreña sobre transferencias internacionales.

### 6.3 IA, logs y retención

Los términos y la privacidad de Kapso describen uso de Customer Content para operar, asegurar, soportar y mejorar el servicio, con configuraciones diferentes según plan. La mejora/model training se puede desactivar en ciertos contextos por un administrador, pero la configuración efectiva debe quedar comprobada y documentada antes de cargar datos reales.[^kapso-terms][^kapso-privacy]

Recomiendo, como condición de onboarding:

- desactivar mejora de modelos y session replay donde sea posible;
- no enviar nombres completos, DUI, fecha de nacimiento, diagnóstico, tratamiento o documentos al workflow/agente salvo necesidad aprobada;
- no escribir contenido de mensajes en logs de aplicación, errores, tickets ni métricas;
- cifrar secretos por clínica y no exponer API keys al navegador;
- definir retención y borrado de mensajes, media, transcripciones, webhooks, auditoría y backups;
- probar exportación y borrado de una clínica antes de habilitarla;
- conservar en Praxia únicamente la evidencia de negocio necesaria, no replicar indiscriminadamente todo el inbox del proveedor.

### 6.4 SLA y continuidad

El estado público de Kapso mostraba degradación parcial durante el corte de investigación. Eso no prueba una peor disponibilidad histórica que Twilio, pero sí recuerda que un proveedor pequeño necesita un acuerdo explícito de soporte, incidentes, RTO/RPO, exportación y créditos de servicio si la entrega de recordatorios es crítica.[^kapso-status]

Los términos de Kapso excluyen por defecto garantías de disponibilidad o entrega. Twilio publica un SLA de API de 99,95% y una opción superior para ciertos contratos, pero también excluye carriers, terceros, mantenimiento y otros eventos. Ningún SLA reemplaza la outbox de Praxia ni la alerta humana de entrega fallida.[^kapso-terms][^twilio-sla][^praxia-producto]

## 7. Recomendación técnica para Praxia

### 7.1 Decisión recomendada

Adoptar Kapso como **capa de onboarding y transporte WhatsApp** mediante un
piloto de una Clínica. No hay migración desde Twilio, no se conserva un
fallback automático y no se mueven datos clínicos reales hasta cerrar el gate
legal y contractual.

La elección de producto sería:

- Kapso Platform si se van a conectar varias clínicas con números propios y se necesita onboarding de customers;
- `partner_managed` Meta billing, con créditos centralizados, atribución por Clínica y circuito de protección;
- número propio de la Clínica en `coexistence`, conservando su WhatsApp Business App;
- aplicación Meta predeterminada de Kapso, sin Tech Provider/MPS propio en v1;
- inbox, agente y fuente canónica de Praxia durante el piloto, con Kapso como transporte y onboarding.

### 7.2 Cambios de código esperados

No haría que el dominio importe el SDK de Kapso. Crearía un puerto interno,
por ejemplo `WhatsAppProvider`, con implementaciones `simulated` y `kapso` en
esta fase. El puerto debe representar conceptos de negocio y de WhatsApp, no
IDs de Kapso o Twilio:

- enviar respuesta de sesión;
- enviar plantilla transaccional con variables;
- enviar media solo cuando la política de producto/legal lo permita;
- consultar o registrar estado de entrega;
- identificar el número de la clínica;
- verificar y procesar evento entrante idempotente;
- emitir handoff y fallo operativo.

Cambios concretos:

1. **Configuración por clínica:** reemplazar cualquier sender global por una configuración segura de provider/customer/phone number/WABA y referencias a secretos.
2. **Adaptador saliente:** implementar el POST Kapso/Meta, mapear el `message.id`, registrar el costo/estado cuando llegue el webhook y seleccionar templates aprobados fuera de la ventana.
3. **Webhook Kapso:** crear la ruta JSON compartida, verificar raw body con HMAC-SHA256 y procesar `X-Idempotency-Key`; no reutilizar el parser Twilio previsto.
4. **Multi-tenant:** resolver clínica desde `phone_number_id` y customer autorizado; rechazar cualquier número no registrado o credencial cruzada.
5. **Batching y orden:** desactivar buffering al principio o fijarlo a una política conocida mientras se valida el ordenamiento por conversación; aceptar duplicados y reintentos idempotentemente.
6. **Estados:** guardar entregado/leído/fallido y códigos de error como eventos append-only; no marcar un recordatorio como exitoso solo porque la API aceptó el request.
7. **Plantillas:** añadir catálogo, idioma, variables, aprobación, versión y fallback humano.
8. **Observabilidad:** métricas separadas por proveedor, clínica, template, país, código de error, latencia y costo Meta; alerta si Kapso pausa un webhook o aumenta la tasa de fallos.

### 7.3 Pruebas de aceptación del piloto

El piloto no está listo para datos reales hasta demostrar, con cuentas y números de prueba:

- conexión y desconexión de una clínica sin exponer credenciales;
- webhook válido, firma inválida, replay, duplicado, lote y timeout;
- recepción de texto, media rechazada y handoff humano;
- respuesta dentro de la ventana de servicio y template fuera de ella;
- confirmación, cancelación y recordatorio con reintento controlado;
- fallo definitivo que crea una alerta en la bandeja de Praxia;
- remapeo seguro de `phone_number_id` a clínica;
- exportación de configuración, templates, opt-ins y correlaciones;
- cálculo de costo a partir de estados entregados, no solo de sends;
- uso manual de la WhatsApp Business App y apertura del circuit breaker ante
  una caída de Kapso/Meta, sin fallback automático;
- revisión del número salvadoreño, QR, coexistencia y capacidad real antes del
  primer tráfico.

## 8. Cuándo elegir cada opción

### Elegir Kapso como alternativa

Kapso es una buena elección si se cumplen la mayoría de estas condiciones:

- WhatsApp es el canal principal y no se necesita reemplazar SMS, voz, email, Verify, SIP o video;
- el valor de reducir desarrollo de onboarding, workflows e inbox supera el costo de introducir otro proveedor;
- cada clínica puede conservar la propiedad/control de su WABA y número;
- el volumen de mensajes hace atractivo un plan mensual frente al $0.005 por mensaje de Twilio;
- la aplicación puede mantener los datos enviados a Kapso en un subconjunto administrativo mínimo;
- se acepta revisar subprocesadores, procesamiento internacional y ausencia de SLA estándar;
- existe una solución confirmada para números de El Salvador;
- la orden de servicio fija soporte, exportación, retención, incidentes, overages y condiciones de salida.

### Mantener Twilio

No es la decisión actual de Praxia, pero Twilio seguiría siendo preferible en
un futuro si:

- el roadmap requiere una sola plataforma para WhatsApp, SMS, voz/PSTN, email, Verify, video o SIP;
- ya existe una integración fuerte con Twilio y el volumen de WhatsApp no compensa el costo de migración;
- el negocio exige SLA, soporte empresarial, auditoría o cobertura de producto más madura;
- se necesita una ruta clara de números/telephony local y Kapso solo la puede resolver mediante Twilio;
- una revisión legal exige garantías que Kapso no puede dar por escrito;
- se prefiere controlar directamente una mayor parte del stack, aunque eso implique construir inbox y workflows.

### Usar una arquitectura híbrida

La arquitectura híbrida queda como una alternativa futura para otros canales o
telephony. No forma parte del piloto actual: Praxia no compra líneas Twilio,
no enruta números de Clínicas por Twilio y no usa fallback automático.

## 9. Preguntas que deben quedar respondidas antes de contratar

1. ¿La línea propia de cada Clínica salvadoreña es elegible para `coexistence`, y qué bloqueos de Meta, display name o calidad deben resolverse antes del piloto?
2. ¿El WABA y el número permanecen en propiedad/control de la Clínica? ¿Qué exportación se entrega al terminar?
3. ¿Cuál es la tarifa efectiva de overage, almacenamiento, integración, número adicional, FX, soporte y créditos en la orden de servicio `partner_managed`?
4. ¿Qué SLA, RTO, RPO, soporte, compensación y retención de eventos se pueden contratar?
5. ¿Qué significa exactamente “integration calls” frente a “function calls” y qué límite aplica a cada plan?
6. ¿Puede firmarse un acuerdo que permita el tratamiento de datos administrativos de clínicas y delimite expresamente salud, menores, audio y transcripciones?
7. ¿Qué subprocesadores y regiones aplican al proyecto, al inbox, a las funciones, a la IA y al billing?
8. ¿Cómo se desactiva el model improvement y qué evidencia se entrega de que la configuración quedó aplicada?
9. ¿Cuál es la tarifa Meta vigente para los destinatarios salvadoreños y cómo cambiará después del 1 de octubre de 2026?
10. ¿Los webhooks batched/buffered tienen límites, retención o recuperación adicionales no visibles en la documentación?
11. ¿Qué exportación y borrado coordinado existen para Praxia, Kapso y backups al salir una Clínica?

Las preguntas sobre migración desde Twilio y soporte BSUID ya están resueltas para
el diseño interno: no hay migración aplicable, y Praxia modelará BSUID como
identidad primaria cuando esté disponible, con teléfono opcional.

## Conclusión

Kapso tiene una tesis clara y técnicamente atractiva: convertir WhatsApp en una plataforma de desarrollo y operación más completa que una API de transporte. Para una SaaS vertical como Praxia, sus ventajas más fuertes son el onboarding de clientes, la propiedad de números, los workflows y el inbox; sus ventajas económicas son plausibles a partir de los precios publicados, pero requieren normalizar unidades y separar las tarifas Meta.

La conclusión adoptada es **“sí, Kapso como capa de WhatsApp para Praxia; no, como reemplazo general de Twilio ni como dueño del agente”**. No hay migración de clientes que ejecutar. El trabajo de ingeniería se concentra en el adaptador Kapso, setup links, webhooks v2, BSUID, consentimiento, plantillas, outbox, circuit breaker y gates legales. La decisión comercial final aún depende de validar número salvadoreño, SLA, datos, subprocesadores, plantillas y costos Meta antes de activar producción.

## Registro de fuentes y notas de método

Se priorizaron páginas oficiales de Kapso, su documentación, términos/DPA/subprocesadores; documentación oficial de Twilio; páginas oficiales de Meta/WhatsApp; y documentos existentes del repositorio. Las páginas de pricing, terms y status son dinámicas: el corte de esta investigación es el 5 de septiembre de 2026. Las afirmaciones comerciales de Kapso —usuarios, ahorros, condición de BSP/partner y disponibilidad— se presentan como afirmaciones del proveedor salvo que se indique otra cosa.

| Fuente | Publicador | Uso en el informe | Fecha/nota |
| --- | --- | --- | --- |
| [Kapso home](https://kapso.com/) | Kapso | Posicionamiento WhatsApp-first y superficies del producto. | Consultada 29-08-2026; página dinámica. |
| [WhatsApp API for developers](https://kapso.com/whatsapp-api-for-developers) | Kapso | API, webhooks, workflows, inbox, agents y Flows. | Sin fecha visible; consultada 29-08-2026. |
| [Kapso Platform](https://kapso.com/platform) | Kapso | Customer onboarding, customer-owned numbers y Platform APIs. | Sin fecha visible; consultada 29-08-2026. |
| [Kapso API introduction](https://docs.kapso.ai/api/introduction) | Kapso Docs | APIs, autenticación, endpoints Meta-like y rate limits generales. | Sin fecha visible; consultada 29-08-2026. |
| [Rate limits](https://docs.kapso.ai/api/rate-limits) | Kapso Docs | Límites por plan y límites de ejecución de workflows. | Sin fecha visible; consultada 29-08-2026. |
| [Send message API](https://docs.kapso.ai/docs/getting-started/send-message-api) | Kapso Docs | Endpoint de envío y API key. | Sin fecha visible; consultada 29-08-2026. |
| [Twilio alternative for WhatsApp](https://kapso.com/twilio-alternative-for-whatsapp) | Kapso | Planes publicados y comparación comercial contra Twilio. | Sin fecha visible; consultada 29-08-2026. |
| [Alternativa a Twilio para WhatsApp](https://kapso.com/es/alternativa-twilio-whatsapp) | Kapso | Overages publicados en español. | Sin fecha visible; consultada 29-08-2026. |
| [Pricing FAQ](https://docs.kapso.ai/docs/whatsapp/pricing-faq) | Kapso Docs | Mensajes contables, límites por plan y separación de Meta. | Sin fecha visible; consultada 29-08-2026. |
| [Meta message billing](https://docs.kapso.ai/docs/whatsapp/meta-message-billing) | Kapso Docs | Billing gestionado y paso de tarifas Meta. | Sin fecha visible; consultada 29-08-2026. |
| [Launching Kapso-managed billing](https://kapso.com/blog/launching-kapso-managed-billing) | Kapso | Modelo BSP/partner-managed y billing centralizado. | Publicado 23-07-2026. |
| [Webhooks overview](https://docs.kapso.ai/docs/platform/webhooks/overview) | Kapso Docs | Eventos, JSON, retries, headers y variantes raw/structured. | Sin fecha visible; consultada 29-08-2026. |
| [Webhook security](https://docs.kapso.ai/docs/platform/webhooks/security) | Kapso Docs | HMAC-SHA256, raw body, idempotency y timing-safe compare. | Sin fecha visible; consultada 29-08-2026. |
| [Advanced webhook features](https://docs.kapso.ai/docs/platform/webhooks/advanced) | Kapso Docs | Buffering, batching, orden, reintentos y auto-pause. | Sin fecha visible; consultada 29-08-2026. |
| [Create and configure setup links](https://docs.kapso.ai/docs/platform/setup-links/create-and-configure) | Kapso Docs | Embedded Signup, billing modes y coexistence/dedicated. | Sin fecha visible; consultada 29-08-2026. |
| [Manage setup links](https://docs.kapso.ai/docs/platform/setup-links/manage) | Kapso Docs | Revocación, regeneración, expiración y estado operativo de enlaces. | Sin fecha visible; consultada 05-09-2026. |
| [Connect WhatsApp](https://docs.kapso.ai/docs/how-to/whatsapp/connect-whatsapp) | Kapso Docs | Instant setup, Business App coexistence y SIM propio. | Sin fecha visible; consultada 29-08-2026. |
| [Detect connection](https://docs.kapso.ai/docs/platform/setup-links/detect-connection) | Kapso Docs | Detección de conexión y rutas de coexistencia. | Sin fecha visible; consultada 05-09-2026. |
| [Connect phone number API](https://docs.kapso.ai/api/platform/v1/phone-numbers/connect-phone-number) | Kapso Docs | Conexión mediante credenciales Meta y número/WABA. | Sin fecha visible; consultada 29-08-2026. |
| [Business-scoped user IDs](https://docs.kapso.ai/docs/whatsapp/business-scoped-user-ids) | Kapso Docs | BSUID, identidad sin teléfono, `recipient`, `to` y cambios de identidad. | Sin fecha visible; consultada 05-09-2026. |
| [Create project webhook](https://docs.kapso.ai/api/platform/v1/webhooks/create-project-webhook) | Kapso Docs | Eventos de ciclo de vida del proyecto y número creado/eliminado. | Sin fecha visible; consultada 05-09-2026. |
| [Create number webhook](https://docs.kapso.ai/api/platform/v1/webhooks/create-webhook) | Kapso Docs | Eventos de mensajes y conversaciones por número. | Sin fecha visible; consultada 05-09-2026. |
| [Template lifecycle](https://docs.kapso.ai/docs/whatsapp/templates/lifecycle) | Kapso Docs | Estados de revisión y aprobación de plantillas. | Sin fecha visible; consultada 05-09-2026. |
| [Changelog](https://docs.kapso.ai/changelog) | Kapso Docs | Bring your own Twilio, reconnect y cambios de identidad BSUID. | Consultada 29-08-2026. |
| [Workflows introduction](https://docs.kapso.ai/docs/workflows/introduction) | Kapso Docs | Graphs, waits, decisions, agents y handoff. | Sin fecha visible; consultada 29-08-2026. |
| [Inbox overview](https://docs.kapso.ai/docs/platform/inbox/overview) | Kapso Docs | Inbox standalone, filtros, asignación y WebSocket. | Sin fecha visible; consultada 29-08-2026. |
| [Terms of Service](https://kapso.com/terms) | Kapso | Restricciones de datos, números, SLA, propiedad y responsabilidad. | Versión visible al corte anuncia efectividad 01-09-2026; confirmar al contratar. |
| [DPA](https://kapso.com/dpa) | Kapso | Roles, transferencias, seguridad, retención y AI improvement. | Versión visible al corte anuncia efectividad 01-09-2026; confirmar al contratar. |
| [Subprocessors](https://kapso.com/subprocessors) | Kapso | Países y proveedores de infraestructura/IA/observabilidad. | Consultada 29-08-2026; lista dinámica. |
| [Privacy Policy](https://kapso.com/privacy) | Kapso | Contenido, retención, session replay e IA. | Versión visible al corte anuncia efectividad 01-09-2026; confirmar al contratar. |
| [Kapso Status](https://status.kapso.ai/) | Kapso | Snapshot de disponibilidad observado al corte. | Consultada 29-08-2026; no es SLA. |
| [How Meta charges](https://kapso.com/guides/whatsapp-pricing/how-pricing-works/what-meta-charges-for) | Kapso | Cobro por mensaje entregado y categorías Meta. | Sin fecha visible; consultada 29-08-2026. |
| [October 1, 2026 exposure](https://kapso.com/guides/whatsapp-pricing/october-1-2026/estimating-your-exposure) | Kapso | Aviso de cambio futuro de service messages. | Sin fecha visible; revalidar antes de activar. |
| [WhatsApp Business Platform pricing](https://whatsappbusiness.com/products/platform-pricing/) | Meta/WhatsApp | Regla oficial de categorías, país y cobro actual. | Consultada 29-08-2026; dinámica. |
| [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/) | Meta/WhatsApp | Opt-in, calidad, spam y reglas del canal. | Consultada 29-08-2026. |
| [Twilio CPaaS](https://www.twilio.com/en-us/cpaas) | Twilio | Amplitud de canales y productos. | Consultada 29-08-2026. |
| [Twilio WhatsApp pricing](https://www.twilio.com/en-us/whatsapp/pricing?locale=en) | Twilio | $0.005/mensaje, Meta y cargos de canal. | Consultada 29-08-2026; contrastar con página general si cambia la nomenclatura. |
| [Twilio Messaging pricing](https://www.twilio.com/en-us/pricing/messaging) | Twilio | Precio general, números y posicionamiento de canales. | Consultada 29-08-2026. |
| [Twilio Conversations pricing](https://www.twilio.com/en-us/messaging/pricing/conversations-api) | Twilio | MAU, almacenamiento y costos adicionales. | Consultada 29-08-2026. |
| [Twilio WhatsApp docs](https://www.twilio.com/docs/whatsapp) | Twilio | Sandbox, sender y producción. | Consultada 29-08-2026. |
| [Twilio Tech Provider integration](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide) | Twilio | Embedded Signup, ISV y multi-tenant. | Consultada 29-08-2026. |
| [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security) | Twilio | Firma, URL, parámetros y Auth Token. | Consultada 29-08-2026. |
| [Twilio API SLA](https://www.twilio.com/en-us/legal/service-level-agreement/twilio-apis) | Twilio | Disponibilidad contractual publicada y exclusiones. | Actualizado 09-04-2026; consultado 29-08-2026. |
| [Praxia product brief](/Users/mark28pro/development/apollo/docs/producto/praxia-producto.md) | Repositorio local | Contexto del producto, WhatsApp, agenda y privacidad. | Investigación local existente. |
| [Meta/Twilio pilot research](/Users/mark28pro/development/apollo/docs/research/meta-twilio-pilot.md) | Repositorio local | Gates de Tech Provider, WABA, plantillas y webhooks actuales. | Investigación local existente. |
| [Legal requirements for El Salvador](/Users/mark28pro/development/apollo/docs/research/requisitos-legales-piloto-el-salvador.md) | Repositorio local | Datos sensibles, menores, transferencias y gate de datos reales. | Investigación local existente; no es asesoría legal. |

[^kapso-home]: https://kapso.com/
[^kapso-whatsapp]: https://kapso.com/whatsapp-api-for-developers
[^kapso-platform]: https://kapso.com/platform
[^twilio-cpaas]: https://www.twilio.com/en-us/cpaas
[^twilio-channels]: https://www.twilio.com/en-us/messaging/channels
[^kapso-twilio]: https://kapso.com/twilio-alternative-for-whatsapp
[^kapso-terms]: https://kapso.com/terms
[^kapso-dpa]: https://kapso.com/dpa
[^kapso-subprocessors]: https://kapso.com/subprocessors
[^twilio-sla]: https://www.twilio.com/en-us/legal/service-level-agreement/twilio-apis
[^kapso-meta-billing]: https://kapso.com/guides/whatsapp-pricing/how-pricing-works/what-meta-charges-for
[^kapso-october]: https://kapso.com/guides/whatsapp-pricing/october-1-2026/estimating-your-exposure
[^meta-pricing]: https://whatsappbusiness.com/products/platform-pricing/
[^kapso-managed-billing]: https://kapso.com/blog/launching-kapso-managed-billing
[^kapso-seed]: https://kapso.com/blog/kapso-seed-round-1-4-million
[^kapso-api]: https://docs.kapso.ai/api/introduction
[^kapso-rate-limits]: https://docs.kapso.ai/api/rate-limits
[^kapso-sdk]: https://docs.kapso.ai/docs/whatsapp/typescript-sdk/introduction
[^twilio-verify]: https://www.twilio.com/en-us/user-authentication-identity/verify
[^kapso-webhooks]: https://docs.kapso.ai/docs/platform/webhooks/overview
[^kapso-security]: https://docs.kapso.ai/docs/platform/webhooks/security
[^twilio-webhook-security]: https://www.twilio.com/docs/usage/webhooks/webhooks-security
[^kapso-setup]: https://docs.kapso.ai/docs/platform/setup-links/create-and-configure
[^twilio-tech-provider]: https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide
[^kapso-connect]: https://docs.kapso.ai/docs/how-to/whatsapp/connect-whatsapp
[^kapso-changelog]: https://docs.kapso.ai/changelog
[^kapso-send]: https://docs.kapso.ai/docs/getting-started/send-message-api
[^kapso-advanced]: https://docs.kapso.ai/docs/platform/webhooks/advanced
[^meta-policy]: https://whatsappbusiness.com/policy/
[^meta-service]: https://whatsappbusiness.com/products/conversation-categories/service/
[^twilio-quickstart]: https://www.twilio.com/docs/whatsapp/quickstart
[^kapso-inbox]: https://docs.kapso.ai/docs/platform/inbox/overview
[^kapso-embedded]: https://docs.kapso.ai/docs/platform/inbox/embedded
[^praxia-producto]: /Users/mark28pro/development/apollo/docs/producto/praxia-producto.md
[^kapso-customer]: https://docs.kapso.ai/docs/platform/customer-guide
[^kapso-connect-number]: https://docs.kapso.ai/api/platform/v1/phone-numbers/connect-phone-number
[^kapso-pricing-faq]: https://docs.kapso.ai/docs/whatsapp/pricing-faq
[^kapso-pricing-es]: https://kapso.com/es/alternativa-twilio-whatsapp
[^twilio-whatsapp-pricing]: https://www.twilio.com/en-us/whatsapp/pricing?locale=en
[^twilio-conversations]: https://www.twilio.com/en-us/messaging/pricing/conversations-api
[^twilio-messaging-pricing]: https://www.twilio.com/en-us/pricing/messaging
[^meta-utility]: https://whatsappbusiness.com/products/conversation-categories/utility/
[^kapso-country-pricing]: https://kapso.com/guides/whatsapp-pricing/how-pricing-works/pricing-by-country
[^legal-praxia]: /Users/mark28pro/development/apollo/docs/research/requisitos-legales-piloto-el-salvador.md
[^kapso-privacy]: https://kapso.com/privacy
[^kapso-status]: https://status.kapso.ai/
