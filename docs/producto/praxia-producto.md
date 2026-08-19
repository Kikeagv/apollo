# Praxia: planteamiento y features del producto

> Documento de producto consolidado. Nomenclatura pública: la marca visible es
> **Praxia**; los nombres internos de implementación (panel, asistente,
> herramienta de operación) y el vocabulario técnico viven en `CONTEXT.md`.
> Estado: piloto en producción con datos sintéticos (agosto de 2026).

---

## 1. Planteamiento

### 1.1 El problema

Las clínicas y consultorios pequeños de El Salvador operan con herramientas
genéricas y comunicación dispersa:

- La agenda vive en hojas, agendas de papel o calendarios personales; nadie
  tiene una vista confiable del día de la clínica.
- Los pacientes coordinan por WhatsApp y llamadas: confirmar, recordar,
  reprogramar y cancelar consume horas de la secretaría.
- No existe una regla operativa compartida (quién atiende, qué dura, en qué
  horario), así que cada médico improvisa y la clínica pierde capacidad.
- Los datos de pacientes circulan sin control ni trazabilidad, a pesar de que
  El Salvador ya exige protección de datos personales.

### 1.2 La propuesta

> **Praxia es la plataforma para consultorios y clínicas pequeñas en El
> Salvador: agenda y atención administrativa por WhatsApp. La clínica, más
> clara.**

Para la clínica, un panel para operar el día: agenda semanal y diaria con
filtro por médico, pacientes, citas, escalamientos y configuración de
capacidad. Para el paciente, un asistente por WhatsApp de la clínica que
reserva, reprograma y cancela citas con contexto, sin instalar nada. Entre
ambos, comunicación transaccional responsable: confirmaciones, recordatorios
y avisos con entrega garantizada, nunca campañas ni spam.

Praxia no es un sistema de apoyo a decisiones clínicas ni un expediente
electrónico: se enfoca en la operación administrativa que hoy se come el
tiempo de la clínica.

### 1.3 Para quién

- Clínicas y consultorios privados pequeños y medianos de El Salvador, de uno
  o varios médicos, con personal administrativo. Piloto objetivo: 5 clínicas.
- Roles dentro de la clínica: médico propietario (administra), médico no
  propietario (atiende y configura su capacidad), secretaria (opera el día a
  día).

### 1.4 Modelo de negocio

- SaaS por clínica con suscripción mensual.
- Alta inicial gestionada por el proveedor (onboarding manual durante el
  piloto), con invitación por correo para el médico propietario.
- Pago por transferencia registrado en la herramienta interna de operación;
  soporte con sesiones auditadas y vencimiento.
- Un solo número de WhatsApp por clínica (el WABA compartido del proveedor en
  el piloto; WABA propio por clínica en fases posteriores).

### 1.5 Principios de producto

1. **La agenda es la única autoridad.** La disponibilidad se calcula con
   horarios, ofertas por médico, bloqueos y citas; ningún flujo (ni el
   asistente ni el panel) la calcula por fuera.
2. **WhatsApp con contexto.** Cada mensaje pertenece a una cita o a una
   solicitud del paciente; el asistente se presenta como asistente de la
   clínica y guarda silencio cuando el caso pasa a una persona.
3. **La persona humana está en el bucle.** Escalamientos, alertas de entrega
   fallida, verificaciones de tutela y urgencias terminan siempre en una
   persona de la clínica. Ante lenguaje de urgencia médica: indicación fija de
   llamar al 911 y corte del flujo.
4. **Privacidad por diseño.** Datos aislados por clínica (RLS), auditorías de
   12 meses, retención limitada de entregas, avisos de privacidad publicados y
   tratamiento de datos sensibles reforzado conforme a la ley salvadoreña.
5. **Los menores se tratan con tutela.** La reserva de un menor exige registrar
   al tutor y deja la verificación pendiente para la clínica.
6. **Cero fallos silenciosos.** Las entregas de mensajes reintentan, expiran y,
   si fallan, generan una alerta operativa; los backups se prueban con
   restauración real.

### 1.6 Diferenciadores

- Enfocado en la clínica pequeña salvadoreña, no en hospitales ni en software
  pesado de expediente.
- El paciente se autogestiona por WhatsApp: reservar, reprogramar y cancelar
  sin llamadas ni portales.
- Reglas de agenda reales: oferta de servicio por médico (precio, duración,
  buffer), horario vigente recurrente, bloqueos puntuales y protección de
  capacidad confirmada.
- Entrega transaccional durable: confirmaciones y recordatorios con reintentos
  e idempotencia, y alerta humana si el proveedor falla.
- Privacidad y trazabilidad desde el piloto: aislamiento por clínica,
  auditoría de identidad y de configuración, incidentes notificados en 72 h.

---

## 2. Features del producto

Leyenda de estado: **[Producción]** desplegado y verificado ·
**[Simulado]** flujo completo pero con adaptador simulado (WhatsApp de prueba)
· **[Gate]** código listo, requiere aprobación externa (Meta/Twilio/legal).

### 2.1 Identidad y acceso

| Feature | Estado |
|---|---|
| Cuentas por clínica con invitación de un solo uso (vence en 72 h), enviada por correo (Resend) | Producción |
| Activación con creación de contraseña; el médico propietario se crea con su clínica | Producción |
| OTP por correo al iniciar desde un navegador nuevo; dispositivo confiable 30 días, revocable | Producción |
| Recuperación de contraseña con validación anti-bot (Turnstile); revoca sesiones y dispositivos | Producción |
| Bloqueo temporal de 15 minutos tras 5 contraseñas incorrectas, con aviso por correo | Producción |
| Sesión de clínica con cierre a los 30 minutos de inactividad | Producción |
| Roles y permisos: propietario, médico, secretaria (RLS por clínica) | Producción |
| Auditoría de identidad y de configuración clínica (actor, instante, resultado; 12 meses) | Producción |
| Recuperación manual del propietario por soporte, con verificación por dos canales | Producción |

### 2.2 Agenda y citas

| Feature | Estado |
|---|---|
| Calendario semanal y diario de toda la clínica, con filtro por médico y detalle lateral | Producción |
| Catálogo de servicios con descripción pública por clínica | Producción |
| Oferta de servicio por médico: precio en USD, duración y buffer (múltiplos de 5 minutos) | Producción |
| Horario vigente recurrente por médico, con franjas y vigencias; jornadas que cruzan medianoche | Producción |
| Bloqueo puntual (ausencias, feriados) con etiqueta privada no expuesta a pacientes | Producción |
| Cita manual con validación de capacidad; cuadrícula de 5 minutos; prohibida en el pasado | Producción |
| Cita manual fuera de horario con advertencia y confirmación explícita, marcada en el calendario | Producción |
| Registro de contacto, paciente y vínculo desde el flujo de cita o la ficha | Producción |
| Confirmación inicial opcional por WhatsApp (una sola, solo al Contacto elegido) | Producción/Simulado |
| Cancelación con aviso opcional; libera capacidad y conserva eventos append-only | Producción/Simulado |
| Política de inasistencia por silencio: conservar y alertar, o cancelar tras el recordatorio de 20 h | Producción |
| Protección de capacidad: bloqueos, horarios y desactivaciones no completan si afectan citas o reservas | Producción |
| Desactivación de médico u oferta conserva historial y exige resolver citas futuras | Producción |

### 2.3 Contactos, pacientes y tutores

| Feature | Estado |
|---|---|
| Contacto identificado por número E.164 único dentro de la clínica; ficha administrativa | Producción |
| Paciente con ficha mínima (nombre, fecha de nacimiento) y vínculo explícito con uno o más contactos | Producción |
| Vínculo de tutor con tutela legal registrada; visible al vincular menores | Producción |
| Registro asistido de paciente por WhatsApp: DUI propio (adulto) o DUI del tutor (menor) | Simulado |
| Verificación pendiente de tutela que la clínica debe resolver en el panel | Producción |
| Historial de citas consultable desde la ficha del paciente, incluidas canceladas | Producción |

### 2.4 Comunicación por WhatsApp (asistente y transaccional)

| Feature | Estado |
|---|---|
| Información pública de la clínica: servicios, horarios y opciones de atención | Simulado |
| Reserva con selección explícita del paciente (nunca se infiere) | Simulado |
| Reserva temporal de 10 minutos y confirmación automática al aceptar | Simulado |
| Reprogramación y cancelación por el paciente dentro de la ventana de 12 horas previas | Simulado |
| Fuera de ventana: solicitud escalada a una persona de la clínica | Producción/Simulado |
| Recordatorios a 24, 22 y 20 horas; una respuesta del paciente suprime los pendientes | Producción/Simulado |
| Protocolo de urgencia: instrucción de llamar al 911 y corte del flujo, con registro | Producción |
| Escalamiento humano: la conversación pasa al panel y el asistente guarda silencio | Producción |
| Aviso adicional de escalamiento a la secretaria configurada (opcional por clínica) | Producción |
| Entrega transaccional durable: reintentos a 1, 5, 15 y 60 minutos, concesión por worker, idempotencia | Producción |
| Alerta operativa en el panel cuando una entrega falla definitivamente | Producción |
| Notas de voz transcritas para aplicar el mismo flujo (activable por clínica) | Simulado + Gate legal |
| Envío por WhatsApp real (Twilio) con firma y webhook verificado | Gate (código listo) |

### 2.5 Operación diaria del panel

| Feature | Estado |
|---|---|
| Bandejas de escalamiento: conversaciones y citas autogestionadas que requieren decisión humana | Producción |
| Alertas de entrega transaccional fallida, resolubles en el panel | Producción |
| Registros administrativos: contactos, pacientes, vínculos y citas canceladas | Producción |
| Configuración del propietario: doctores, invitaciones, política de inasistencia, avisos, transcripción | Producción |
| Perfil de médico (nombre público y especialidad) con verificación antes de operar | Producción |
| Sesiones de soporte de Praxia visibles y auditadas con vencimiento | Producción |

### 2.6 Operación interna del proveedor

| Feature | Estado |
|---|---|
| Alta de clínica e invitación inicial (runbook documentado) | Producción |
| Suscripciones (activa/suspendida) y registro de pagos por transferencia | Producción |
| Monitoreo: health check externo, cron de entregas cada minuto, alertas de deploy/backup por correo | Producción |
| Backups de doble capa (copia diaria + recuperación a punto en el tiempo) con restauración probada | Producción |
| Verificación de identidad del negocio ante Meta y aprobaciones Twilio | Gate externo |

### 2.7 Sitio público

| Feature | Estado |
|---|---|
| Landing con propuesta, áreas de trabajo y contacto; claro y oscuro | Producción |
| Páginas de aviso de privacidad y términos de uso (pendientes de validación legal) | Producción |
| Marca única: solo "Praxia" visible al usuario | Producción |

---

## 3. Estado actual y hoja de ruta

### Hoy (piloto, agosto de 2026)

- Aplicación y sitio público en producción; una clínica beta operando con
  datos sintéticos.
- WhatsApp en modo simulado en producción; la integración real por Twilio está
  escrita, probada y apagada detrás de un interruptor.
- Onboarding manual de clínica documentado y validado (runbook en el repo).

### Gates externos que bloquean datos reales

- Verificación de negocio de Meta y aprobación del programa Tech Provider.
- Base legal (aviso/consentimiento validados, contrato con la clínica,
  retención, incidentes) conforme a la ley salvadoreña.
- Validación de la transcripción de notas de voz.

### Siguiente (fase 2)

- Activar WhatsApp real para el piloto (secretos en el proveedor, plantillas
  aprobadas, smoke con contactos de prueba).
- Onboarding de las 5 clínicas objetivo con sus números dedicados.
- Alta de clínicas por Embedded Signup dentro de la aplicación (el médico solo
  aporta número, correo y datos de la clínica; el OTP al SIM es su único paso
  presencial).
- Lista de espera (fase 1b).

### Fuera del alcance de fase 1

Expediente clínico electrónico, facturación/DTE, pagos de pacientes, portal
del paciente, multi-sede y soporte a decisiones clínicas.

---

## 4. Criterios de éxito del piloto

- La clínica opera su semana completa desde el panel: citas, capacidad y
  escalamientos, sin depender de conversaciones dispersas.
- Los pacientes se autogestionan por WhatsApp (reservar, reprogramar, cancelar)
  y reciben confirmaciones y recordatorios confiables.
- Cero fallos de entrega silenciosos: todo intento agotado genera una alerta
  visible y resoluble.
- Privacidad verificable: aislamiento por clínica, auditorías activas, avisos
  publicados y trazabilidad de incidentes.
- Onboarding de una clínica nueva en menos de una sesión, con un solo paso
  presencial del médico (OTP del número).