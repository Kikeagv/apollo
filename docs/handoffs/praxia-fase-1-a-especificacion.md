# Handoff — Praxia fase 1 → especificación

## Objetivo de la próxima sesión

Convertir las decisiones cerradas en una especificación de implementación de
fase 1 de Praxia. La salida debe ser el insumo para dividir el trabajo en
verticales de construcción; no implementar todavía.

## Punto de partida canónico

- Mapa Wayfinder: [Mapa Wayfinder: Praxia fase 1](https://linear.app/k31-software/issue/APO-1/mapa-wayfinder-praxia-fase-1).
- Vocabulario: `CONTEXT.md`.
- Decisiones de arquitectura: `docs/adr/`.
- Documento de producto original: el adjunto de la conversación *Praxia —
  Documento maestro*, versión 4.0 (30 de julio de 2026).

No dupliques las decisiones: sigue los enlaces del mapa para el detalle de
cada una. La especificación debe consolidar esas fuentes y señalar cualquier
contradicción, no volver a debatir decisiones ya cerradas.

## Alcance que debe especificarse

- Onboarding de Clínica con médicos, servicios, horarios y bloqueos.
- Panacea: agenda diaria/semanal, citas manuales, contactos/Pacientes y
  Escalamientos. La dirección visual elegida es calendario central con tablero
  lateral; el prototipo está en el commit `c32344f` de la rama
  `codex/prototype-panacea-operacion-diaria`.
- Asclepio: información pública, reserva automática, reprogramación y
  cancelación con reglas de Agenda, recordatorios, Escalamientos y protocolo
  de urgencia.
- Contactos, Pacientes, Tutores y menores dentro de los límites definidos en
  `CONTEXT.md`.
- Identidad local con Better Auth + Resend, roles propios de Praxia y RLS.
- Adaptadores intercambiables de WhatsApp y de transcripción de nota de voz.
- Superadmin mínimo necesario antes del primer cobro.

## Restricciones no negociables

- La Agenda es la única autoridad de disponibilidad y cambios de cita; Asclepio
  no calcula espacios ni accede directamente a Postgres.
- Todo acceso clínico se resuelve en una transacción con contexto de Clínica y
  RLS.
- Desarrollo y pruebas con adaptadores simulados y datos sintéticos hasta tener
  aprobaciones externas y base legal.
- El agente no es apoyo a decisiones clínicas; urgencia médica da instrucción
  fija para llamar al 911 y corta el flujo.
- Lista de espera es fase 1b; expediente, DTE, pagos, portal, multi-sede y
  demás están fuera de fase 1.

## Seguridad y borde

- ADR de identidad: `docs/adr/0002-identidad-local-con-better-auth.md`.
- ADR de Cloudflare: `docs/adr/0003-perimetro-cloudflare-para-el-piloto.md`.
- Cloudflare Pro, WAF y protección DDoS delante de hostnames públicos; el
  webhook de Twilio no recibe challenges y valida firma + idempotencia en el
  origen.
- El informe de controles y el de transcripción están en `docs/research/`.

## Trabajo externo que continúa en paralelo

- [Completar aprobaciones de Meta y Twilio para el piloto](https://linear.app/k31-software/issue/APO-4/completar-aprobaciones-de-meta-y-twilio-para-el-piloto).
- [Cerrar la base legal para procesar datos reales](https://linear.app/k31-software/issue/APO-5/cerrar-la-base-legal-para-procesar-datos-reales).
- [Validar la transcripción de notas de voz antes del piloto](https://linear.app/k31-software/issue/APO-11/validar-la-transcripcion-de-notas-de-voz-antes-del-piloto).

Estas tareas bloquean datos reales y go-live, no la especificación ni la
construcción contra simuladores.

## Estado del repositorio

El repositorio aún no contiene una aplicación productiva; contiene documentos
de decisión, investigación y un prototipo desechable archivado en su propia
rama. La sesión de especificación debe evitar asumir rutas, framework o código
ya creado si no aparecen en el repositorio.

## Entregable esperado

Una especificación trazable y construible que incluya: límites de alcance,
actores y permisos, modelo de datos relevante, contratos de herramientas y
adaptadores, flujos y estados de citas, requisitos de Panacea, no funcionales
(RLS, auditoría, recuperación, borde), estrategia de pruebas y criterios de
aceptación. Debe identificar dependencias externas como gates, no como huecos
de implementación.

## Siguientes skills sugeridas

1. `/to-spec` para sintetizar el mapa en la especificación.
2. `/to-tickets` para convertir la especificación en slices verticales con
   bloqueos nativos en Linear.
3. `/implement` por ticket, usando `/tdd` y `/code-review`.

Si `/to-spec` no está disponible en la nueva sesión, detenerse y pedir la
alternativa de especificación antes de sustituirlo por una skill distinta.
