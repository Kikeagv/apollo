# Contrato de cierre de la Activación de WhatsApp

**Estado:** aceptado
**Fecha:** 2026-09-16

## Contexto

La Activación de clínica reúne decisiones de producto, acceso, conexión,
preparación técnica y mensajería. Una sola etiqueta de “lista” puede ocultar
que una Identidad todavía no tiene acceso, que Kapso no confirmó un recurso,
que el readiness es antiguo o que el tráfico real sigue bloqueado.

APO-94 necesita un cierre auditable para APO-74 y sus descendientes. El cierre
debe distinguir cobertura local de evidencia confirmada por Kapso y del entorno
desplegado, y debe conservar los gates de consentimiento, privacidad, billing y
aprobación de producto.

## Decisión

- `coexistence` es la modalidad v1. `dedicated` se muestra como una ampliación
  que requiere aprobación explícita; no cuenta como cierre de v1 ni abre una
  ruta implícita en el código.
- Las decisiones `later` y `not-integrated` solo registran alcance diferido;
  no abren un flujo de Activación ni contactan a Kapso.
- El contrato expone por separado Identidad autenticada, acceso del Médico
  propietario, estado de Conexión, preparación técnica y capacidad de
  mensajería. “Solo sintética” no significa mensajería real habilitada.
- La matriz canónica vive en
  `src/domain/whatsapp-activation.ts` y se presenta en Apolo. Cada fila enlaza
  comportamiento, prueba local, fuentes de evidencia externa y pendiente.
- Las referencias de Kapso y del entorno desplegado se registran por Clínica,
  criterio, fuente y generación de provisión en
  `whatsapp_activation_evidence`. La tabla está protegida con RLS: el camino
  de superadmin puede leerla e insertar historial, pero no actualizar ni
  borrar registros desde el rol clínico. La referencia de generación no tiene
  una FK de retención al payload, para que la depuración de payloads no borre
  ni vuelva vigente evidencia histórica.
- La evidencia faltante mantiene el estado pendiente. Ninguna operación del
  contrato puede cambiar un gate de tráfico real ni habilitar Pacientes reales.

## Consecuencias

- El cierre puede ser `ready` aunque la capacidad de mensajería siga siendo
  `synthetic-only`; la habilitación real continúa dependiendo de su evaluación
  de tráfico y confirmación manual existentes.
- La matriz puede mostrar honestamente qué está cubierto por código local y
  qué todavía necesita una reproducción en Kapso o una validación desplegada.
- Una futura modalidad `dedicated` requiere una ampliación aprobada con sus
  propios criterios y evidencia; no se obtiene cambiando la etiqueta de una
  Clínica.

## Alternativas descartadas

- **Usar `technicalStatus` como cierre global:** se descarta porque mezcla
  conexión, acceso y capacidad de mensajería.
- **Reutilizar la tabla de gates de tráfico:** se descarta porque la evidencia
  de cierre y la autorización para tráfico son responsabilidades distintas.
- **Dar por válida la evidencia local como evidencia de proveedor:** se
  descarta porque los contratos simulados no prueban el transporte externo.
