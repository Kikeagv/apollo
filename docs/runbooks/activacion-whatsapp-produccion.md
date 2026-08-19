# Activación de WhatsApp real en Praxia (paso a paso, fundador + agente)

Runbook colaborativo: lo que hace el **fundador** (consolas Meta/Twilio) y lo que hace el **agente** (código). Basado en la documentación oficial verificada el 2026-08-19 ([Self Sign-up](https://www.twilio.com/docs/whatsapp/self-sign-up), [Tech Provider integration guide](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide), [Tech Provider FAQ](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/faq), [Meta phone numbers](https://developers.facebook.com/docs/whatsapp/cloud-api/phone-numbers/), [Meta messaging limits](https://developers.facebook.com/docs/whatsapp/messaging-limits/)).

No anotar tokens, OTPs, claves ni documentos personales en este archivo, Linear o commits; los secretos viven solo en Coolify.

## Estado al inicio (2026-08-19)

| Ítem                                                  | Estado                                       |
| ----------------------------------------------------- | -------------------------------------------- |
| Código app (adaptador Twilio + webhook + switch)      | ✓ Hecho (`58c41bd8`, deploy #14)             |
| Verificación de negocio de Meta (APO-4, K31 SOFTWARE) | En review (varios días/semanas según región) |
| Business Portfolio de Praxia                          | ✓ Existe                                     |
| 2FA en Meta/Twilio                                    | ✓                                            |
| Sender propio de Praxia                               | Pendiente (Fase 1)                           |
| Meta app Tech Provider                                | Pendiente (Fase 3)                           |
| Partner Solution de Twilio                            | Pendiente (Fase 4)                           |
| Embedded Signup en la app                             | Pendiente (Fase 5, código)                   |
| Plantillas aprobadas                                  | Pendiente (Fase 6)                           |
| Legal APO-5 / opt-in                                  | Pendiente (gate de producción)               |

## Fase 1 — Sender propio de Praxia por Self Sign-up (fundador, ~30 min)

Objetivo: registrar el primer número de WhatsApp de Praxia en la API. Desbloquea prueba real del piloto, creación de plantillas y es prerequisito del programa Tech Provider.

1. Elegir el número:
   - **SIM de Praxia** (no debe estar vinculado a ninguna app de WhatsApp): el OTP llega por SMS/llamada a ese SIM — hay que tenerlo a mano ese minuto. Costo: la línea (~$1-5/mes).
   - **Número de Twilio** (~$1-2/mes): el OTP se muestra en la consola de Twilio (con voz, llega por email vía Twimlet).
2. Verificar que el número **no está registrado en WhatsApp** (`https://wa.me/<número sin +>?text=hi` — si contesta, está registrado).
3. Twilio Console → **Messaging → Senders → WhatsApp Senders → Create new sender** ([consola](https://1console.twilio.com/us1/develop/sms/senders/whatsapp-senders)).
4. Elegir el número y **Continue with Facebook** (login con el Facebook de Praxia; tener admin del Business Portfolio). Mantener abiertos consola y popup en el mismo navegador; no compartir la URL del popup.
5. En el popup: crear/seleccionar **Business Portfolio** (el de Praxia) → crear/seleccionar **WABA** → perfil comercial:
   - WhatsApp Business display name: **Praxia** (o el nombre que verán los pacientes; ajustarse a las [guías de display name](https://www.facebook.com/business/help/757569725593362)).
   - Categoría: Salud / Médica (la que corresponda).
6. **Añadir el número** → método SMS o llamada → ingresar el OTP.
7. Confirmar el acceso de Twilio → el registro toma unos minutos → el sender queda visible en la consola (estado puede tardar en pasar a `ONLINE`).
8. Avisar al agente el **estado del sender** (ONLINE o en revisión).

> Nota: la aprobación del display name es posterior; si Meta la rechaza, el número queda limitado a 250 mensajes iniciados/24 h y puede desconectarse.

## Fase 2 — Secretos y activación del adaptador (agente, con OK del fundador)

Cuando el sender esté `ONLINE` y el fundador autorice:

1. Fundador agrega en Coolify (`praxia-app` → Environment Variables, solo producción):
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_WHATSAPP_FROM` (E.164 del sender, ej. `+503...`)
   - (`WHATSAPP_DELIVERY` queda en `simulated` hasta la prueba del Fase 8)
   - Nunca por chat/repo.
2. Agente verifica: guard de arranque (twilio sin secretos → falla), webhook responde 200 con firma válida, pruebas unitarias del adaptador.
3. Smoke técnico con el sender de Praxia: mensaje entrante/ saliente con contactos de prueba (sin datos clínicos ni pacientes reales).

## Fase 3 — Tech Provider, Parte 1: app de Meta y revisión (fundador, 1-2 semanas con esperas)

Requisito: sender de la Fase 1 registrado (elegibilidad del portfolio).

1. **Registrarse como Meta Developer** ([developers.facebook.com](https://developers.facebook.com/apps/)).
2. **Crear app nueva** (no reutilizar existente): nombre sin marcas de Meta, tipo **Business**, caso de uso **Other**, portfolio **Praxia**.
3. App settings → Basic: ícono (logo de Praxia, sin logos de Meta), **URL de política de privacidad** (necesita URL HTTPS pública — definir con legal/APO-5), categoría.
4. Añadir el producto **WhatsApp** (si no aparece el card, revisar región de la cuenta).
5. **Become a Tech Provider** (WhatsApp → Quickstart → Scale your Business): aceptar los Tech Provider Terms y asociados → **Independent Tech Provider**.
6. Revisar app settings (datos completos).
7. **Grabar 2 videos de pantalla** (sin audio):
   - `whatsapp_business_messaging`: enviar un mensaje de WhatsApp desde la app (o Twilio Console con el sender de la Fase 1) y mostrar el número destino recibiéndolo.
   - `whatsapp_business_management`: crear una plantilla de WhatsApp para el caso de uso.
8. **App Review → Permissions and Features**: solicitar acceso avanzado a `whatsapp_business_messaging` y `whatsapp_business_management`.
9. Responder **data handling questions** (Meta recomienda input legal/APO-5) + reviewer instructions (usar el texto sugerido por Twilio) + subir los videos → **Submit for Review**.
10. Tras aprobación: **Access Verification** (App Settings → Basic → Start verification; Meta tarda ~5 días hábiles).
11. Guardar: Meta App ID, App secret (secreto), estado de cada permiso.

## Fase 4 — Tech Provider, Parte 2: Partner Solution de Twilio (fundador)

Requisito: app aprobada por Meta (Fase 3.10).

1. Twilio Help Center → ticket con asunto **"Part 2: Connect your Meta app to the Twilio Partner Solution"** + **Meta App ID**.
2. Poner la app en **App Mode: Live** hasta que Twilio envíe la solicitud (1-2 días hábiles), luego volver a Development.
3. App Dashboard → **WhatsApp → Partner Solutions** → **Accept** la Partner Solution de Twilio.
4. Avisar en el mismo ticket; guardar el **Partner Solution ID** (no secreto; sí guardarlo bien).

> No usar Self Sign-up para números de clínicas cliente: Twilio no permite conectarlos después a la Partner Solution (habría que crear WABA nuevo y migrar).

## Fase 5 — Tech Provider, Parte 3: Embedded Signup en la app (agente, código)

Requisito: Partner Solution ID (Fase 4). Trabajo de código del agente:

1. **Facebook Login for Business** en la app Meta: crear Configuration (WhatsApp Embedded Signup, system-user token 60 días, asset WhatsApp accounts, permiso solo `whatsapp_business_management`) → **Configuration ID**.
2. Integrar el **popup de Embedded Signup** en Panacea (flujo superadmin): el doctor/clínica loguea con Facebook, crea/selecciona portfolio + WABA y verifica el número con OTP.
3. Registrar el sender por **Twilio Senders API** con credenciales de la **subcuenta** de la clínica (una clínica ↔ una subcuenta Twilio ↔ una WABA).
4. Guardar por clínica (cifrado, fuera del repo): subcuenta SID/token, WABA ID, sender ID, número E.164, estado (`PENDING`/`ONLINE`), display name.
5. Almacenar el estado del onboarding en la tabla de Clínica existente (`whatsapp_number_e164` ya existe) y exponerlo en el flujo superadmin.
6. Resolución por clínica en el webhook (el número receptor ya resuelve la clínica).

## Fase 6 — Plantillas de WhatsApp (fundador, con la app aprobada)

Las plantillas pertenecen al **WABA** — una aprobación sirve para todos los números del mismo WABA.

1. Twilio → **Content Template Builder** (o Content API): crear y enviar a aprobación:
   - Confirmación de cita (Utility).
   - Recordatorio de cita (Utility).
   - Cancelación / reprogramación (Utility).
   - (El texto final no debe incluir datos clínicos; usar placeholders `{{1}}` etc.)
2. Categorizar correctamente (Utility preferible para transaccionales; categorías no pedidas tienden a Marketing).
3. Avisar al agente los **Content SID** de las aprobadas para mapearlas en el código de salida (los textos actuales del adaptador son mínimos operativos).

## Fase 7 — Onboarding de cada clínica/doctor (mixto)

Ficha por clínica (recopilar fuera del repo):

1. Fundador pregunta al doctor: nombre y correo (invitación a Panacea), número E.164 dedicado (SIM libre de WhatsApp), razón social/NIT (contrato), display name propuesto.
2. Agente: alta de la clínica + invitación (hoy por SQL/runbook; más adelante por la ruta superadmin) → Panacea operativa.
3. Con el programa activo (Fase 5): el doctor entra al popup Embedded Signup (login Facebook, crea su WABA, recibe el OTP del número) — no sube documentos; hasta 2 números y 250 conversaciones/24 h sin verificación del negocio de la clínica (verificar para escalar).
4. Agente: registra el sender vía Senders API, espera `ONLINE`, configura webhook del subaccount → `https://app.usepraxia.com/api/webhooks/twilio/whatsapp`, prueba idempotencia y firma.

## Fase 8 — Pruebas end-to-end y flip de producción (mix, con OK del fundador)

1. Prueba con el sender de Praxia y contactos de prueba: mensaje entrante → Asclepio; recordatorio saliente por plantilla; cancelación; sin datos clínicos.
2. Fundador: cambia en Coolify `WHATSAPP_DELIVERY=twilio` (solo producción) y confirma.
3. Agente: verifica health, guard de arranque, webhook 200 con firma real, evento de recordatorio entregado; revisa los textos mínimos del adaptador.
4. Cerrar la puerta legal antes de pacientes reales: **APO-5** (contrato, consentimiento/opt-in registrable por contacto, DPA Twilio) — sin eso no hay mensajes a pacientes reales.

## Resumen quién-hace-qué

| Fase                            | Fundador (consolas)                              | Agente (código/ops)                                  |
| ------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| 1. Sender propio (Self Sign-up) | Todo el flujo + OTP                              | —                                                    |
| 2. Secretos y activación        | Agrega secrets en Coolify (no por chat)          | Guard, verificación, smoke técnico                   |
| 3. Meta app + App Review        | App, videos, permisos, data questions            | Guía/checklist; soporte en textos                    |
| 4. Partner Solution             | Ticket Twilio + aceptar                          | —                                                    |
| 5. Embedded Signup              | Configuration ID (parte de la app Meta)          | Integración popup + Senders API + estado por clínica |
| 6. Plantillas                   | Crear/aprobar en Content Template Builder        | Mapear Content SIDs en el código de salida           |
| 7. Clínica por clínica          | Pide ficha al doctor (correo, SIM, razón social) | Alta, invitación, sender, webhook                    |
| 8. E2E y flip                   | OK + `WHATSAPP_DELIVERY=twilio`                  | Pruebas, verificación, monitoreo                     |

## Timeline estimado (en paralelo donde se pueda)

- Fase 1: 1 día (desbloquea pruebas y plantillas).
- Fase 3: 1-2 semanas + esperas de Meta (App Review + Access Verification ~5 días hábiles).
- Fase 4: 1-2 días hábiles tras la aprobación.
- Fase 5: días de desarrollo (agente) tras el Partner Solution ID.
- Fase 6: plantillas en paralelo (espera de aprobación, días-semanas).
- Verificación de negocio (APO-4): ya en curso (semanas según región) — sin ella: máximo 2 números por portfolio y 250 conversaciones/24 h.
