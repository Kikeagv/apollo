# Matriz de cierre de Activación de WhatsApp (APO-94)

Esta matriz es el artefacto de revisión de APO-74 y sus descendientes. La
representación ejecutable está en
`src/domain/whatsapp-activation.ts`; Apolo la expone por Clínica y persiste
únicamente las referencias externas registradas por superadmin.

## Alcance y estados

El alcance productivo admite `coexistence` y `dedicated`. Dedicated opera
solo por API: no conserva WhatsApp Business App ni exige QR. `later` y
`not-integrated` quedan diferidos. El contrato separa:

| Dimensión                     | Valores relevantes                                                       | Qué no significa                                |
| ----------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| Identidad                     | autenticada / bloqueada                                                  | no concede acceso clínico                       |
| Acceso del Médico propietario | listo / pendiente / bloqueado                                            | no confirma la Conexión                         |
| Conexión de WhatsApp          | pendiente / provisionando / lista / degradada / bloqueada / desconectada | no habilita tráfico real                        |
| Preparación técnica           | pendiente / lista / degradada / bloqueada                                | no sustituye consentimiento o DPA               |
| Mensajería                    | bloqueada / solo sintética / habilitada / retirada                       | habilitada requiere gates y confirmación manual |

## Criterios

“Kapso” y “desplegado” son pendientes hasta que una referencia externa se
registre en el contrato. La prueba local indica la cobertura que debe seguir
ejecutándose en cada cambio.

| Ticket(s)                         | Criterio                        | Comportamiento                                                        | Prueba local                                                                                                                                 | Evidencia externa  | Pendiente inicial       |
| --------------------------------- | ------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------- |
| APO-74 / APO-94                   | Alcance de modalidad            | coexistence y dedicated admitidos; dedicated solo API                 | `src/domain/whatsapp-activation.test.ts`                                                                                                     | decisión local     | confirmar alcance       |
| APO-75 / APO-94                   | Acceso al producto              | Identidad y propietario se validan aparte                             | `src/server/application/clinic-access.integration.test.ts`                                                                                   | desplegado         | acceso del propietario  |
| APO-74 / APO-82 / APO-83 / APO-85 | Propiedad y aislamiento         | customer, WABA, número y generación por Clínica con RLS               | `src/server/application/whatsapp-connections.integration.test.ts`                                                                            | Kapso + desplegado | asociación externa      |
| APO-77 / APO-85 / APO-86          | Preparación técnica             | número, webhooks, templates, billing y E2E vigentes                   | `src/domain/whatsapp-readiness.test.ts`                                                                                                      | Kapso + desplegado | gates técnicos          |
| APO-79 / APO-80 / APO-92 / APO-94 | Capacidad de mensajería         | bloqueada, sintética, habilitada o retirada                           | `src/server/application/whatsapp-operations.test.ts`                                                                                         | desplegado         | estado operativo        |
| APO-76 / APO-83 / APO-84          | Alta idempotente                | reintentos no duplican customer ni representación                     | `src/server/application/kapso-onboarding.test.ts`                                                                                            | Kapso + desplegado | reproducción externa    |
| APO-76 / APO-83 / APO-84          | Cuentas existentes              | confirma asociación propia sin desconectar terceros                   | `src/server/application/kapso-onboarding.test.ts`                                                                                            | Kapso + desplegado | caso existente          |
| APO-77 / APO-85 / APO-94          | Preparación pendiente           | conserva siguiente acción y no se etiqueta como lista                 | `src/server/application/whatsapp-readiness.test.ts`                                                                                          | desplegado         | reproducción desplegada |
| APO-77 / APO-91 / APO-92 / APO-94 | Salud obsoleta                  | generación/smoke antiguo mantiene el bloqueo                          | `src/domain/whatsapp-readiness.test.ts`                                                                                                      | Kapso + desplegado | invalidación externa    |
| APO-84 / APO-85 / APO-91 / APO-92 | Operaciones reintentables       | reintento idempotente no relaja gates                                 | `src/server/application/whatsapp-operations.test.ts`                                                                                         | Kapso + desplegado | reintento externo       |
| APO-80 / APO-91 / APO-92          | Smoke sintético                 | transporte externo trazable; nunca Pacientes reales                   | `src/server/application/whatsapp-operations.test.ts`                                                                                         | Kapso + desplegado | smoke externo           |
| APO-78 / APO-87 / APO-88 / APO-93 | Consentimiento y representación | adulto y Tutor se distinguen; gates legales siguen activos            | `src/server/application/whatsapp-consent.test.ts`                                                                                            | desplegado         | flujos adulto/Tutor     |
| APO-92                            | Offboarding                     | detiene envíos, retira recursos y permite reintentos                  | `src/server/application/whatsapp-operations.test.ts`                                                                                         | Kapso + desplegado | retirada externa        |
| APO-75 / APO-81                   | Conexión simulada               | pruebas aisladas por Clínica sin asociación productiva                | `src/server/application/whatsapp-connections.test.ts`                                                                                        | desplegado         | aislamiento simulado    |
| APO-78 / APO-87 / APO-88 / APO-93 | Inbound y takeover              | inbound durable conserva contexto y takeover humano                   | `src/server/application/whatsapp-inbound.test.ts`                                                                                            | Kapso + desplegado | inbound/takeover        |
| APO-79 / APO-89 / APO-90          | Outbound transaccional          | respeta ventana, identidad y estado de entrega                        | `src/server/application/whatsapp-outbound.test.ts`                                                                                           | Kapso + desplegado | entrega transaccional   |
| APO-95                            | Alta comercial recuperable      | separa reales/sintéticas y recupera invitaciones                      | `src/server/application/create-synthetic-clinic.test.ts`                                                                                     | desplegado         | alta comercial          |
| APO-96                            | Invitación del propietario      | aceptación y recuperación aisladas por Clínica                        | `src/server/application/clinic-access.integration.test.ts`                                                                                   | desplegado         | acceso propietario      |
| APO-97                            | Idempotencia administrativa     | reintentos conservan historial y estado                               | `src/server/application/whatsapp-operations.test.ts`                                                                                         | desplegado         | reintento seguro        |
| APO-98                            | Consola por Clínica             | contexto único al listar, crear y abrir ficha                         | `src/server/application/subscription-support.test.ts`                                                                                        | desplegado         | consola aislada         |
| APO-99                            | Catálogo de templates           | catálogo común se provisiona por WABA                                 | `src/server/application/whatsapp-readiness.test.ts`                                                                                          | Kapso + desplegado | templates por WABA      |
| APO-100                           | Funding y salud                 | capacidad y salud no sustituyen readiness                             | `src/server/application/whatsapp-readiness.test.ts`                                                                                          | Kapso + desplegado | señales separadas       |
| APO-101                           | Reconciliación de preparación   | solo actualiza la generación vigente                                  | `src/server/application/whatsapp-readiness.test.ts`                                                                                          | Kapso + desplegado | reconciliación          |
| APO-102                           | Versión de consentimiento       | cambio de versión exige nueva aceptación                              | `src/server/application/whatsapp-consent.test.ts`                                                                                            | desplegado         | consentimiento          |
| APO-103                           | Bienvenida y retorno            | activación y retorno son verificables                                 | `src/server/application/accept-clinic-owner-invitation.integration.test.ts`                                                                  | desplegado         | retorno verificable     |
| APO-104                           | Identidad inbound               | resuelve identidad sin defaults ambiguos                              | `src/server/application/whatsapp-inbound.test.ts`                                                                                            | Kapso + desplegado | identidad/takeover      |
| APO-105                           | Entrega de citas                | outbound conserva idempotencia y trazabilidad                         | `src/server/application/whatsapp-outbound.test.ts`                                                                                           | Kapso + desplegado | citas                   |
| APO-106                           | E2E y smoke de transporte       | roundtrip firmado por Contacto controlado; espera callback de entrega | `src/domain/whatsapp-smoke.test.ts`, `src/server/application/whatsapp-operations.test.ts`, `src/server/application/whatsapp-inbound.test.ts` | Kapso + desplegado | E2E real                |
| APO-107                           | Reactivación del circuito       | causa corregida y evidencia válida son obligatorias                   | `src/server/application/whatsapp-circuit-breaker.test.ts`                                                                                    | Kapso + desplegado | reactivación            |
| APO-108                           | Offboarding controlado          | retirada idempotente, detenida y recuperable                          | `src/server/application/whatsapp-operations.test.ts`                                                                                         | Kapso + desplegado | offboarding controlado  |
| APO-109                           | Panel de supervisión            | resumen, Plantillas y Sistema por Clínica                             | `src/server/application/whatsapp-activation.test.ts`                                                                                         | desplegado         | panel                   |
| APO-110                           | Piloto controlado               | criterios de entrada y cierre de APO-74 trazables                     | `src/server/application/whatsapp-operations.test.ts`                                                                                         | Kapso + desplegado | piloto                  |

## Regla de evidencia

Una referencia puede ser un run, ticket o URL operativa, pero no debe contener
tokens, credenciales, OTP, QR ni payloads crudos. Para declarar un criterio
cerrado deben existir todas sus fuentes externas requeridas. Si falta una, el
contrato conserva el pendiente y los gates de tráfico permanecen sin cambios.

## Equivalencia controlada de APO-106

El endpoint de prueba de webhook de proyecto de Kapso acredita solo el
preflight; nunca completa el smoke. Para observar el recorrido que ese endpoint
no simula, Apolo inicia un run de cinco minutos para un Contacto existente de la
Clínica que no tenga vínculo a Paciente. El Contacto envía el código del run por
el webhook firmado; el worker lo reconoce sin invocar consentimiento, Agenda ni
asistente y encola una respuesta administrativa por el outbox normal de Kapso.
El estado `accepted` acredita únicamente la respuesta aceptada. Solo un callback
Kapso `delivered` o `read` completa el transporte. Un fallo o timeout conserva
un resultado no exitoso y los gates de tráfico no cambian. La misma secuencia
usa IDs y fechas sanitizados; el teléfono completo no se persiste.

## Corte de verificación de APO-110 — 27 de septiembre de 2026

Este corte es histórico y precede el alta productiva de «Clinica Tests». El
estado operativo vigente y los pasos para incorporar los primeros clientes
están en [Puesta en marcha de Praxia en producción](puesta-en-marcha-produccion.md).

**Resultado: infraestructura del piloto desplegada; piloto comercial pendiente.**
El commit `46c539ad` está en `main` y en producción. Antes de migrar se completó
un backup de PostgreSQL con pgBackRest. La base productiva avanzó de la
migración 59 a la 116, incluida `0121_apo74_dedicated_whatsapp`; el despliegue
de Coolify terminó con la aplicación healthy. Las credenciales Kapso se
configuraron en runtime y `GET /api/health` confirmó `provider=kapso`.

| Criterio | Evidencia observada | Pendiente para cierre |
| --- | --- | --- |
| Modalidad y primera Clínica | El número `Clinica Tests` está `CONNECTED` en Kapso con `is_coexistence=false`, por lo que corresponde a `dedicated`. Código, UI y restricciones de base productiva admiten esa modalidad. La Clínica vinculada existe solo en desarrollo y es sintética; producción aún no tiene Clínicas comerciales. | Registrar una Clínica comercial y su propietario en producción, asociar su número y recorrer el onboarding real. |
| Webhooks y despliegue | Webhooks de proyecto y número reconciliados a `https://app.usepraxia.com/api/webhooks/kapso`. Kapso marcó como `delivered` un evento sintético `whatsapp.message.received` enviado al webhook del número. El endpoint rechazó una petición sin firma con HTTP 401. | Probar el evento real de conexión de la Clínica y conservar la referencia de su generación. |
| Workers | Los jobs `whatsapp-provisioning`, `whatsapp-inbound` y `whatsapp-outbound` corren cada minuto en Coolify; los tres registraron una primera ejecución `success`. | Observarlos con eventos reales de la Clínica comercial, incluidos reintentos y aislamiento. |
| Acceso al piloto | La base productiva tiene una identidad superadmin y cero Clínicas. Se abrió el flujo de recuperación de contraseña para que el titular recupere el acceso. | Iniciar sesión y registrar la Clínica comercial por la interfaz; no modificar credenciales desde operaciones. |
| Plantillas y billing | En el estado local de la Clínica sintética, cuatro plantillas siguen `PENDING` y la verificación de billing figura `failed`. | Conseguir las cuatro plantillas Utility `APPROVED` en el locale exacto y confirmar billing, crédito y atribución por Clínica. |
| Tratamiento de datos en Kapso | La opción de usar contenido futuro para mejora del modelo y producto se desactivó explícitamente en el proyecto. El plan Free indica que conserva el historial de WhatsApp sin límite de tiempo. | Definir una política de retención adecuada antes de tráfico con datos clínicos reales. |
| Smoke real | La entrega del evento de prueba acredita el webhook, no una respuesta outbound. No hay Contacto controlado ni run de smoke en producción. El `e2e_status=passed` local tenía alcance `webhook-preflight`. | Ejecutar APO-106 con un Contacto controlado y verificar el callback de entrega `delivered` o `read`. |
| Segunda Clínica | Kapso mostraba capacidad de 1/1 números en este corte. | Obtener capacidad para un segundo número y demostrar aislamiento externo y desplegado. |

El tráfico real sigue bloqueado por los gates de preparación y consentimiento.
No se declara APO-74 ni APO-110 terminados. La prueba del webhook de Kapso no
equivale al smoke de ida y vuelta.

Verificación del commit desplegado: 733 pruebas unitarias, 832 pruebas de
integración, 14 casos E2E de Panacea, `npm run check` y `npm run build`
pasaron. Las dos pruebas de recuperación de migraciones que fallaban se
ajustaron a un reparo hacia adelante, compatible con el orden real del ledger.
