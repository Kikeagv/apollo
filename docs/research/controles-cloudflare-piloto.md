# Controles de Cloudflare para el piloto de Praxia

Investigado el 31 de julio de 2026 exclusivamente con documentación oficial de
Cloudflare. Alcance: Panacea (panel web), la API pública que usa el panel y el
receptor de callbacks de Twilio/WhatsApp. No sustituye el análisis legal, la
autenticación de la aplicación ni la validación del proveedor de mensajería.

## Decisión recomendada

Usar **Cloudflare Pro** delante de los hostnames públicos desde el primer
entorno de prueba integrado y conservar a Praxia como responsable de
autenticación y autorización. Pro es el mínimo sensato para este caso porque
incluye el conjunto amplio de WAF Managed Rules y Super Bot Fight Mode (SBFM),
que sí puede exceptuarse de forma acotada para un callback automatizado. El
plan Free ya da DDoS L3--L7, reglas personalizadas y una regla de rate limit,
pero Bot Fight Mode no se puede exceptuar: podría desafiar al webhook de
Twilio. Cloudflare documenta esa diferencia de forma explícita en su guía de
[interoperabilidad de controles](https://developers.cloudflare.com/waf/feature-interoperability/).

No contratar Bot Management, API Shield, Advanced DDoS ni Business/Enterprise
para el piloto por defecto. Son candidatos de reevaluación si se observa abuso
que los controles abajo no contengan, se requiere SLA/retención de eventos
mayor, o se necesita una puntuación de bots por solicitud. Bot Management y
sus puntuaciones son un complemento Enterprise; la protección DDoS estándar,
en cambio, está incluida y es no medida en todos los planes.

| Necesidad | Control inicial | Por qué |
| --- | --- | --- |
| Saturación/red | DDoS administrado L3/4 y HTTP L7, siempre activo | Cloudflare detecta y mitiga automáticamente ataques L3/4 y L7 en todos los planes; no hay un interruptor que Praxia deba implementar. [Disponibilidad de DDoS](https://developers.cloudflare.com/ddos-protection/) |
| Ataques web conocidos | Cloudflare Managed Ruleset en modo predeterminado, revisando eventos antes de ampliar reglas | Pro añade este ruleset y OWASP CRS; se actualizan con frecuencia para CVE y técnicas conocidas. No activar indiscriminadamente todas las firmas sin observar falsos positivos. [Managed Rules](https://developers.cloudflare.com/waf/managed-rules/) |
| Automatización hostil | SBFM para el panel y la API de navegador; acción inicial: bloquear `Definitely automated`, challenge administrado para `Likely automated`, permitir bots verificados | SBFM es configurable en Pro/Business/Enterprise y una regla `Skip` puede excluir una ruta precisa. No usar el Bot Fight Mode de Free en una zona que recibe callbacks. [Interoperabilidad](https://developers.cloudflare.com/waf/feature-interoperability/) |
| Fuerza bruta / abuso puntual | Reglas de rate limiting por ruta y por IP para login, recuperación y endpoints públicos de bajo volumen | Las reglas aplican una acción al llegar al límite y sirven, entre otros, para proteger login de fuerza bruta. [Rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/) |
| Formularios de navegador | Turnstile solo en puntos anónimos o de alto riesgo, validado en servidor | El widget no protege por sí solo: cada token debe validarse en `Siteverify`, dura cinco minutos y es de un uso. [Validación obligatoria](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) |
| IP/origen expuesto | Cloudflare Tunnel si el origen es una VM/infraestructura propia; de otro modo AOP mTLS más firewall de origen | Tunnel no abre puertos entrantes ni exige IP pública. AOP hace que el origen acepte solo pulls de Cloudflare y está disponible en todos los planes. [Tunnel](https://developers.cloudflare.com/tunnel/) · [AOP](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/) |

La etiqueta “Pro” no equivale a un compromiso de precio: revisar el plan y la
factura vigentes al contratar. La documentación de funcionalidades, no una
tabla de marketing, es la base de esta recomendación.

## Arquitectura y mínimo privilegio

```text
Navegador de Clínica ─┐
                       ├─ Cloudflare (DNS proxied, TLS Full strict, DDoS, WAF)
Twilio / WhatsApp ────┘       │
                              ├─ `app.praxia...` Panacea + API de navegador
                              └─ `api.praxia.../webhooks/twilio/whatsapp`
                                            │
                                      origen privado / Tunnel
                                            │
                           validación de firma Twilio + idempotencia
                                            │
                                worker/cola y servicios de Praxia
```

1. Poner en modo **proxied** (nube naranja) únicamente los hostnames HTTP que
   deben ser públicos y usar TLS de extremo a extremo en `Full (strict)`.
   Auditar los registros DNS-only para que ninguno revele la IP de origen. Esta
   es la primera recomendación de Cloudflare para evitar que se sobrecargue un
   origen directamente. [Protección del origen](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/)
2. Para un despliegue en VM/contenedor propio, preferir **Cloudflare Tunnel**:
   `cloudflared` abre conexiones salientes y el host no recibe HTTP/HTTPS
   entrante. Usar al menos dos réplicas antes de producción; Cloudflare indica
   que cada tunnel mantiene cuatro conexiones contra dos centros y admite
   réplicas para disponibilidad. [Funcionamiento de Tunnel](https://developers.cloudflare.com/tunnel/)
3. Si la plataforma de hosting no permite Tunnel, configurar AOP con un
   certificado de zona o por hostname propio y exigirlo en el proxy del origen;
   además limitar el firewall a IPs de Cloudflare. AOP no sirve con `Flexible`
   y el certificado global compartido solo prueba que la petición viene de la
   red Cloudflare, no de la cuenta de Praxia. [Niveles de AOP](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/)
4. No exponer PostgreSQL, Redis, el worker de colas, ni endpoints de
   administración con hostnames públicos. La API de navegador y el receptor de
   webhook son los únicos ingresos públicos necesarios.

## Configuración propuesta por superficie

### Panacea y API de navegador

- Mantener **Better Auth + roles de Praxia + RLS** como única fuente de la
  sesión y permiso clínico. Cloudflare Access es un proxy de identidad que
  revisa solicitudes antes del origen, pero añadirlo sobre todo Panacea
  duplicaría login/OTP, rompería el flujo de invitaciones y no conoce la
  autorización por Clínica. [Qué protege Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/)
- Activar Cloudflare Managed Ruleset con sus valores por defecto. Revisar los
  eventos durante staging y el piloto; ante un falso positivo, exceptuar la
  **regla individual** y la ruta afectada, nunca desactivar el ruleset completo.
  Cloudflare permite excepciones y overrides de regla/tag/ruleset; los
  overrides de tag/ruleset abarcan reglas futuras, por lo que son menos
  acotados. [Excepciones de Managed Rules](https://developers.cloudflare.com/waf/managed-rules/)
- SBFM: permitir bots verificados; bloquear tráfico “definitivamente
  automatizado”; comenzar con challenge administrado para “probablemente
  automatizado”. Medir falsos positivos antes de endurecer. Si se usa Tunnel,
  conservar `Definitely automated = Allow` para no romper sus conexiones,
  según la advertencia de Cloudflare, y concentrar el bloqueo de automatización
  en las rutas web normales con reglas personalizadas. [SBFM y Tunnel](https://developers.cloudflare.com/bots/get-started/super-bot-fight-mode/)
- Crear límites separados, inicialmente en modo de observación/ajuste cuando
  el plan lo permita, para `POST` de inicio de sesión, recuperación de
  contraseña y aceptación de invitación. Una configuración de arranque puede
  ser 10 intentos/minuto/IP en login y 5/15 min/IP en recuperación; confirmar
  con tráfico sintético y los eventos del piloto antes de tratar esos números
  como política. Usar **Managed Challenge** en acciones que corresponden a un
  navegador y respuestas coherentes (sin revelar si un correo existe). En
  Free/Pro/Business el challenge se comporta como throttling, no como bloqueo
  con duración elegida. [Parámetros de rate limit](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/)
- Añadir **Turnstile** al formulario de recuperación y, si aparece abuso, al
  login tras el límite de riesgo de la propia aplicación. Validar el token en
  backend antes de consultar credenciales. No usarlo en navegación autenticada
  normal: para Dr. Villeda y María añadiría fricción sin reemplazar la
  contraseña+OTP que ya se decidió.
- Mantener respuestas de API sin caché (`Cache-Control: no-store`) y no crear
  reglas `Cache Everything` para Panacea, API, autenticación ni respuestas con
  cookies. Es una regla de aplicación, complementaria al perímetro.

### Callback de Twilio / WhatsApp

El callback debe ser una ruta exacta, por ejemplo
`POST /webhooks/twilio/whatsapp`; no un prefijo amplio como `/api/*` ni un
hostname mezclado con soporte/admin. Su acceso público es necesario, pero
**público no significa confiable**.

- No poner **Cloudflare Access**, Turnstile, JavaScript Challenge ni Managed
  Challenge delante de esta ruta: Twilio no ejecuta un navegador humano. Si
  Access se usa en algún hostname de operaciones, crear una aplicación Access
  separada y un bypass exclusivamente para la ruta pública; Cloudflare advierte
  que Bypass elimina sus controles y logging, por lo que debe ser lo más
  estrecho posible. [Callbacks públicos en Access](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/)
- En Cloudflare Pro, crear primero una regla WAF `Skip` que coincida con **método
  POST + path exacto** y salte **solo SBFM**. SBFM es el producto bot que puede
  desafiar tráfico legítimo no navegable; las reglas Skip pueden saltar SBFM,
  rate limiting o WAF Managed Rules, pero no deben saltar más fases de las
  necesarias. [Opciones de Skip](https://developers.cloudflare.com/waf/custom-rules/skip/options/)
- No exceptuar por defecto Managed Rules ni rate limiting del webhook. Probar
  entrega y reintentos de Twilio en staging. Si una regla WAF concreta produce
  falso positivo, añadir una excepción de **ese rule ID + ruta exacta**, con
  fecha de revisión. Si el volumen normal requiere un límite, debe ser alto,
  aplicar **block/429** (nunca challenge) y diseñarse considerando ráfagas y
  reintentos; Cloudflare sigue manteniendo el DDoS administrado aun cuando se
  salte SBFM. En ausencia de datos reales de volumen, es más seguro no imponer
  todavía un rate limit de borde que descarte eventos legítimos.
- En el origen, antes de procesar o descargar media, validar siempre la firma
  de Twilio con el secreto de Praxia, comparar en tiempo constante y aplicar
  idempotencia con el identificador del mensaje. Cloudflare no sustituye esa
  autenticación de proveedor. Rechazar otros métodos, contenido/tamaño no
  esperados, y responder rápido para entregar el trabajo a una cola.
- No usar allowlists de IP o `User-Agent` como autenticación de Twilio sin un
  conjunto oficial versionado y comprobado. La firma es el control de
  autenticidad; la excepción de SBFM solo evita que el perímetro intente
  presentar un desafío a un proveedor automatizado.

### Cloudflare Access: dónde sí usarlo

No es parte del login de Clínica en fase 1. Puede proteger un hostname separado
de uso interno, como `ops.praxia...` (panel de soporte, health/observabilidad
humana o acceso a infraestructura) mediante Tunnel y una política Allow para
las identidades de Apolo. Access deniega por defecto y admite políticas por
identidad/dispositivo; para automatización ofrece Service Auth con token de
servicio o mTLS. [Políticas de Access](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)

No usar `Bypass` como una forma permanente de dar acceso a personal ni entregar
tokens de Access al navegador de una clínica. Si alguna integración interna
necesita acceder a `ops`, usar Service Auth, no una excepción `Everyone`.

## Observabilidad y respuesta

- Configurar notificaciones de DDoS por correo para el responsable de Praxia y
  una cuenta operativa. Cloudflare puede notificar ataques HTTP DDoS y detalla
  tipo, hora, tasa máxima, objetivo y regla que mitigó. [Alertas DDoS](https://developers.cloudflare.com/ddos-protection/reference/alerts/)
- Revisar Security Events al menos durante cada cambio de regla y diariamente
  en el piloto. Pro ofrece el dashboard completo, con retención de eventos de
  hasta 24 horas; Business amplía a tres días. Esto no reemplaza el log de
  auditoría de Praxia. [Disponibilidad de Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)
- Activar notificaciones de dominio proxied. Todos los planes permiten correo;
  webhooks de notificación requieren Pro o superior y PagerDuty Business o
  superior. [Cloudflare Notifications](https://developers.cloudflare.com/notifications/)
- No activar payload logging ni exportar/desencriptar cuerpos que puedan incluir
  conversaciones, DUI o datos de salud. La función de WAF puede guardar el
  texto que activó una regla y el contexto anterior/posterior; aunque es
  Enterprise y se cifra, no es necesario para este piloto. [Payload logging](https://developers.cloudflare.com/waf/managed-rules/payload-logging/)
- No basar auditoría clínica, retención legal ni detección de incidentes solo
  en Cloudflare. Logpush completo es Enterprise; Security Events puede estar
  muestreado. El backend debe emitir eventos propios sin PHI para acceso,
  autenticación, webhook inválido, rate limits, cambios de reglas y fallos de
  entrega. [Límites de Security Events](https://developers.cloudflare.com/waf/analytics/security-events/) · [Logpush](https://developers.cloudflare.com/logs/logpush/)

## Checklist de activación antes de tráfico real

1. Zona y hostnames públicos proxied; TLS `Full (strict)` y redirección a HTTPS.
2. Tunnel con dos réplicas **o** AOP requerido en el origen con firewall que no
   admita tráfico directo; comprobar que la IP del origen no responde desde
   Internet.
3. Managed Rules, SBFM y la regla `Skip` de SBFM exclusivamente para el
   callback aplicados primero en staging; probar login, recuperación, invitación
   y un callback firmado válido/inválido/repetido.
4. Límites de login/recuperación calibrados con pruebas y alertas; endpoint de
   webhook sin challenge/captcha y con firma e idempotencia verificadas en
   backend.
5. Turnstile validado en servidor donde se active; secreto solo en el gestor de
   secretos, nunca en frontend, Linear ni logs.
6. Notificaciones DDoS y revisión de Security Events verificadas; runbook de
   incidente indica cómo pausar una regla, conservar metadatos mínimos y
   restaurarla después de la prueba.

## Cuándo ampliar

- **Business:** si se justifica SLA, más retención y alertas de Security Events
  o se necesitan más reglas/regex. No comprarlo solo por DDoS: el estándar ya
  cubre L3--L7 en Pro.
- **Enterprise + Bot Management/API Shield/Advanced DDoS:** si aparecen
  ataques automatizados sofisticados que exigen puntuación por request,
  descubrimiento/validación avanzada de API, límites por sesión/fingerprint o
  requisitos contractuales de soporte y logs. Es una nueva decisión de
  seguridad, no una dependencia del piloto.
- **Cloudflare Access para Panacea:** solo si el producto cambia a una aplicación
  estrictamente interna y se acepta deliberadamente sustituir/coordinar la
  experiencia de identidad. Mientras clínicas externas usen Better Auth,
  Cloudflare debe reforzar el borde y el origen, no reemplazar esa capa.
