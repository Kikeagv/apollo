# ADR 0042: Admisión de WhatsApp Dedicated

Fecha: 2026-09-27

Estado: aceptado; reemplazado en parte por ADR 0044. Amplía el alcance
descrito en los ADR 0039 y 0041.

ADR 0044 reemplaza la habilitación manual y los gates adicionales de tráfico
de este ADR. Las reglas específicas de `dedicated`, el uso exclusivo de API y
la interpretación del takeover siguen vigentes.

## Decisión

Praxia admite conexiones Kapso `coexistence` y `dedicated` en producción.
El preflight exige autoridad Meta, propiedad del número, identidad del
Médico propietario y ausencia de asociaciones cruzadas para ambas modalidades.
Solo coexistence exige WhatsApp Business App activa y un dispositivo para QR.
Dedicated usa únicamente la API: el número no seguirá disponible en WhatsApp
Business App. El enlace de Kapso limita `allowed_connection_types` a la
modalidad elegida y usa el número propio de la Clínica.

La modalidad de una Conexión existente no puede cambiarse durante un
reintento o reconexión. La Clínica completa el roundtrip entrante y después
prueba la entrega de una plantilla aprobada para habilitar tráfico real, según
ADR 0044. Cada envío proactivo sigue sujeto al consentimiento del Contacto y
al circuit breaker. La ausencia de eventos de WhatsApp Business App en
Dedicated no representa fallo de takeover; el equipo debe probar el historial
y la respuesta humana por la ruta API.

## Motivo

El número de prueba disponible en Kapso está registrado como Dedicated. La
implementación que solo admitía coexistence impedía verificar el circuito
real de APO-74 y APO-110. Esta decisión evita reconvertir la modalidad del
número durante el piloto y mantiene las mismas barreras de tráfico.
