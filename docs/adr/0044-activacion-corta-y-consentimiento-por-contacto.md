# Activación corta de WhatsApp y consentimiento por Contacto

**Estado:** aceptado
**Fecha:** 2026-09-29
**Reemplaza parcialmente:** ADR 0036, ADR 0040, ADR 0041, ADR 0042 y ADR 0043.

## Contexto

El cierre de WhatsApp llegó a mezclar el alta comercial, el enlace de
configuración, readiness, aprobación de producto, gates legales, un smoke de
decenas de escenarios y pruebas de regresión. La matriz del smoke espera pasos
que el runner real de Kapso no ejecuta; por eso una ejecución puede figurar
fallida aunque Kapso confirme el preflight del webhook. El preflight de
`whatsapp.phone_number.created` tampoco demuestra que un Contacto recibió y
respondió un mensaje.

Los E2E de onboarding con el adaptador simulado verifican la interfaz y el
flujo de Praxia, no el transporte real. El estado `webhook-preflight` del panel
verifica el webhook de proyecto, no una conversación de extremo a extremo. La
prueba operativa con Kapso debe medir los dos roundtrips del flujo y reportar
por separado la evidencia de cada uno.

La Clínica necesita distinguir las dos comprobaciones que demuestran el
transporte que usará: una respuesta de texto antes de aprobar plantillas y el
inicio de una conversación mediante plantilla después de aprobarla. Los demás
escenarios del smoke son cobertura de regresión del producto y deben seguir en
las pruebas automatizadas, sin convertirse en trabajo manual de cada Clínica.

El consentimiento actual se registra por canal y también por Paciente. Esa
duplicación separa las condiciones de activación del Contacto y complica
mensajes administrativos para Contactos vinculados a varios Pacientes.

## Decisión

### Activación de la Clínica

El recorrido visible tiene cuatro pasos:

1. Registrar los datos de la Clínica.
2. Enviar el Enlace de configuración al propietario.
3. Probar que un Contacto controlado puede enviar un mensaje y recibir la
   respuesta de la Clínica antes de que haya plantillas aprobadas.
4. Después de aprobar una plantilla, iniciar con ella una conversación de
   prueba y confirmar su entrega.

El Contacto controlado puede estar vinculado a Pacientes marcados
explícitamente como prueba. Si está vinculado a algún Paciente real, no puede
usarse para comprobar el transporte.

La aprobación de la prueba del paso 4 habilita el tráfico real automáticamente.
No hay confirmación manual ni gates separados de activación después de esa
prueba. Cada envío proactivo a un Contacto sigue sujeto al consentimiento
definido abajo, y el circuito de protección puede detener envíos ante un
bloqueo operativo del proveedor.

El smoke operativo por Clínica comprueba los pasos 3 y 4. No marca como fallidos
los escenarios que no se ejecutaron: estos se mantienen como pruebas
automatizadas de regresión. Un preflight de webhook se reporta como preflight y
no sustituye ninguno de los dos recorridos de transporte. El E2E/preflight de
readiness es un diagnóstico opcional: no se ejecuta durante el onboarding ni
bloquea la preparación técnica o el tráfico real.

### Consentimiento por Contacto

- El permiso cubre mensajes administrativos de citas —confirmaciones,
  recordatorios, cancelaciones y reprogramaciones— y no cubre marketing ni
  contenido clínico.
- En el primer contacto por WhatsApp, Praxia presenta los términos.
  `CONTINUAR` los acepta una sola vez y concede ese permiso al Contacto para
  todos sus Pacientes actuales y futuros; el texto presentado indica
  expresamente el alcance de mensajes administrativos de citas.
- Una aceptación de canal anterior que no se haya revocado se migra a ese
  alcance, aunque use una versión previa de los términos.
- Al crear manualmente un Paciente desde la Clínica, el Contacto usado en el
  alta recibe el permiso automáticamente, sin una confirmación adicional. La
  regla también aplica a menores antes de verificar la tutela. El alta manual
  reactiva el permiso si ese Contacto se había dado de baja.
- En el alta por WhatsApp, `CONTINUAR` concede el permiso y `registrar` crea la
  ficha del Paciente; registrar no concede un permiso independiente.
- El permiso no se hereda entre Contactos: cada Contacto añadido a un Paciente
  necesita el suyo.
- Una aceptación inicial sigue vigente aunque después cambie la versión o
  redacción de los términos. El historial conserva origen, actor y fecha.
- Un opt-out explícito suspende los envíos proactivos. Un alta manual posterior
  de Paciente es una nueva concesión automática para el Contacto usado.

## Consecuencias

- Superadmin y propietario recorren cuatro pasos visibles; la prueba de
  plantilla aprobada es el cierre de la activación productiva.
- La vista de smoke debe separar preflight, pasos ejecutados, pasos fallidos y
  pasos no ejecutados. Solo los dos roundtrips requeridos deciden la activación
  por Clínica.
- La preparación técnica verifica número, webhooks, plantillas y billing. El
  E2E/preflight opcional no bloquea el recorrido; las pruebas reales de los
  pasos 3 y 4 acreditan el transporte.
- Las pruebas de firma, reintento, deduplicación, consentimiento, tutela,
  billing, circuit breaker y eventos del proveedor siguen protegiendo el
  producto en CI; no se repiten como una lista manual por Clínica.
- El permiso por Contacto cubre varios Pacientes y no se copia a un segundo
  Contacto. La creación de Paciente y la aceptación por WhatsApp deben guardar
  evidencia auditable.
- Los estados de conexión y los incidentes del proveedor siguen visibles y
  reintentables. La aprobación del smoke no elimina el circuit breaker ni
  cambia la propiedad de los activos Meta.

## Alternativas descartadas

- **Exigir una lista de decenas de escenarios por Clínica:** mezcla regresiones
  automatizadas con comprobaciones reales del transporte y presenta pasos no
  ejecutados como fallos.
- **Exigir una aprobación manual después de la plantilla de prueba:** agrega
  un paso que el propietario no considera necesario después de probar el
  inicio y la entrega de una conversación real.
- **Pedir consentimiento para cada Paciente:** duplica una aceptación del
  Contacto que debe cubrir a sus Pacientes actuales y futuros.
- **Hacer que un Contacto herede consentimiento de otro Contacto:** confunde
  quién aceptó recibir mensajes.
