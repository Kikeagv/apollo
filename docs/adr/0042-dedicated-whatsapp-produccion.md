# ADR 0042: Admisión de WhatsApp Dedicated

Fecha: 2026-09-27

Estado: aceptado. Amplía el alcance descrito en los ADR 0039 y 0041.

## Decisión

Praxia admite conexiones Kapso `coexistence` y `dedicated` en producción.
El preflight exige autoridad Meta, propiedad del número, identidad del
Médico propietario y ausencia de asociaciones cruzadas para ambas modalidades.
Solo coexistence exige WhatsApp Business App activa y un dispositivo para QR.
Dedicated usa únicamente la API: el número no seguirá disponible en WhatsApp
Business App. El enlace de Kapso limita `allowed_connection_types` a la
modalidad elegida y usa el número propio de la Clínica.

La modalidad de una Conexión existente no puede cambiarse durante un
reintento o reconexión. Readiness, plantillas, billing, webhooks, smoke
de transporte, consentimiento y habilitación manual siguen siendo requisitos
antes del tráfico real. La ausencia de eventos de WhatsApp Business App en
Dedicated no representa fallo de takeover; el equipo debe probar el historial
y la respuesta humana por la ruta API.

## Motivo

El número de prueba disponible en Kapso está registrado como Dedicated. La
implementación que solo admitía coexistence impedía verificar el circuito
real de APO-74 y APO-110. Esta decisión evita reconvertir la modalidad del
número durante el piloto y mantiene las mismas barreras de tráfico.
