# Praxia

Praxia es la plataforma para consultorios y clínicas pequeñas en El Salvador. Su primer alcance es agenda y atención administrativa por WhatsApp; no es un sistema de apoyo a decisiones clínicas.

## Language

**Praxia**:
La marca comercial que ven clínicas, médicos y pacientes.
_Avoid_: Apolo, Asclepio, Panacea

**Apolo**:
El nombre interno de la plataforma completa, su infraestructura y despliegue.
_Avoid_: Praxia cuando se habla de componentes internos

**Asclepio**:
El agente interno de agendamiento por WhatsApp. Ante un paciente se identifica como asistente de la clínica, no como Asclepio ni Praxia.
_Avoid_: bot de Praxia

**Panacea**:
El CRM y panel interno para operar agenda, pacientes y, en fases posteriores, expediente.
_Avoid_: Praxia cuando se habla del panel

**Clínica**:
La unidad cliente y de aislamiento de datos de Praxia; puede incluir uno o más médicos y usa un solo número de WhatsApp.
_Avoid_: tenant, cuenta

**Contacto**:
La persona identificada por un número de WhatsApp dentro de una clínica. Puede estar vinculada a uno o más pacientes.
_Avoid_: paciente cuando se habla del titular de un teléfono

**Paciente**:
La persona para quien se gestiona una cita dentro de una clínica. No tiene identidad compartida entre clínicas.
_Avoid_: contacto cuando se habla de la persona atendida

**Tutor**:
Un contacto vinculado a un paciente menor de edad con una relación de tutela legal registrada.
_Avoid_: padre, responsable, salvo al describir el parentesco concreto

**Lista de espera**:
La solicitud de un paciente para ocupar una fecha liberada. Es alcance de fase 1b, no un requisito para el piloto de fase 1.
_Avoid_: cola de citas de fase 1

**Activación de clínica**:
El proceso que deja a una clínica habilitada para intercambiar mensajes reales por WhatsApp. Requiere una subcuenta Twilio, su WABA y sender, plantillas aprobadas, base legal y revisión operativa.
_Avoid_: alta cuando se habla únicamente de crear un registro de clínica

**Identidad**:
La prueba de autenticación de una persona operadora. No concede por sí misma acceso a una clínica ni contiene un rol de negocio.
_Avoid_: usuario de clínica

**Usuario de clínica**:
La persona operadora autorizada dentro de una clínica, con un rol y una relación con un médico cuando aplica. Es el sujeto que fija el contexto de clínica para RLS.
_Avoid_: identidad cuando se habla de permisos sobre datos de una clínica

**Mensaje transaccional de cita**:
El mensaje proactivo que Asclepio envía sobre una cita concreta: confirmación, recordatorio o aviso de cancelación. No incluye campañas ni seguimiento comercial.
_Avoid_: mensaje proactivo cuando se habla de comunicación promocional

**Confirmación automática**:
La creación de una cita confirmada cuando el contacto acepta una opción y la Agenda la autoriza. No requiere aprobación manual en Panacea.
_Avoid_: cita pendiente de aprobación

**Ventana de autogestión**:
El período previo al inicio de una cita durante el cual Asclepio puede cancelar o reprogramar por solicitud del contacto. En fase 1 es de 12 horas; fuera de esa ventana ambas acciones se escalan a Panacea.
_Avoid_: modificación sin límite temporal

**Selección explícita de paciente**:
Antes de consultar, crear, cancelar o reprogramar una cita, Asclepio pide al Contacto que indique el Paciente destinatario, incluso si solo existe una vinculación previa.
_Avoid_: deducir el paciente desde la última cita

**Política de inasistencia por silencio**:
La configuración de una Clínica que decide el resultado cuando el Contacto no responde a la secuencia de recordatorios. El valor inicial conserva la cita y alerta en Panacea; puede activarse la cancelación automática inmediatamente después del recordatorio de 20 horas.
_Avoid_: cancelar siempre por no responder

**Cadencia de recordatorios**:
Tres mensajes transaccionales enviados, si no hay respuesta previa, 24 horas, 22 horas y 20 horas antes del inicio de la cita.
_Avoid_: interpretar los intervalos de dos horas como mensajes a 2 horas de la cita

**Protocolo de urgencia**:
La respuesta fija ante lenguaje que indique una urgencia médica: Asclepio indica llamar al 911, detiene el flujo de agenda y registra el evento. No intenta clasificar ni resolver la situación.
_Avoid_: escalamiento conversacional ordinario

**Escalamiento humano**:
La transferencia de una conversación a Panacea ante petición directa de una persona, frustración explícita o dos fallos consecutivos de comprensión. Asclepio guarda silencio hasta que un Usuario de clínica cierre el caso.
_Avoid_: protocolo de urgencia

**Registro asistido de paciente**:
El alta que Asclepio puede realizar durante una reserva. Pide el DUI propio para un adulto; si el Paciente es menor, pide el DUI del Tutor, crea el vínculo de tutela y deja su verificación pendiente para la Clínica.
_Avoid_: crear un menor desvinculado de un tutor

**Reserva temporal**:
El bloqueo de un espacio que la Agenda crea únicamente después de que el Contacto lo elige. Dura 10 minutos y Asclepio la confirma automáticamente al recibir aceptación; si vence, el espacio se libera.
_Avoid_: disponibilidad calculada o retenida por Asclepio

**Autor de la cita**:
El Contacto que creó una cita. Es el único Contacto autorizado para cancelarla o reprogramarla dentro de la Ventana de autogestión; los demás Tutores pueden recibir recordatorios, pero no alterarla.
_Avoid_: cualquier tutor como modificador de la cita

**Notificación de escalamiento**:
La tarea que Panacea crea siempre al escalar una conversación a una persona. Cada Clínica puede activar adicionalmente un aviso por WhatsApp a su secretaria configurada.
_Avoid_: escalamiento sin registro en Panacea

**Transcripción de nota de voz**:
La conversión privada y temporal de un audio de WhatsApp en texto para que Asclepio aplique el mismo flujo que a un mensaje escrito. Fase 1 usa `gpt-transcribe` mediante un adaptador activable por Clínica; si falla, se crea un Escalamiento humano.
_Avoid_: almacenar o registrar el audio o la transcripción fuera de la conversación autorizada

**Verificación de inicio por correo**:
La comprobación adicional posterior a la contraseña mediante un OTP enviado al correo de la Identidad al detectar un dispositivo o navegador nuevo. El dispositivo permanece confiable 30 días y puede revocarse. Es la política de acceso del piloto; no equivale a MFA fuerte basado en un segundo factor independiente.
_Avoid_: llamar MFA fuerte al OTP enviado al mismo buzón de recuperación

**Sesión de clínica**:
El acceso autenticado de un Usuario de clínica a Panacea. Se cierra después de 30 minutos sin actividad; al reanudar se exige contraseña y el OTP solo corresponde si el dispositivo no sigue confiable.
_Avoid_: sesión permanente en equipos compartidos

**Administración de usuarios de clínica**:
La autorización para invitar o suspender Usuarios de clínica. Durante el piloto la ejerce exclusivamente el médico propietario; Apolo realiza el alta inicial de la Clínica y conserva la auditoría.
_Avoid_: registro abierto o autoasignación de permisos

**Restablecimiento de contraseña**:
El proceso de recuperar la contraseña de una Identidad. Al completarse, revoca todas sus Sesiones de clínica y dispositivos confiables.
_Avoid_: recuperación que conserva sesiones antiguas

**Recuperación manual del médico propietario**:
La recuperación de acceso cuando el médico propietario perdió el correo registrado. Se gestiona únicamente por soporte de Apolo con el titular, verifica su identidad por dos canales previamente registrados, deja auditoría y revoca sus accesos anteriores.
_Avoid_: recuperación iniciada por la secretaria

**Bloqueo temporal de identidad**:
La restricción de inicio de sesión tras cinco contraseñas incorrectas. Dura 15 minutos y envía un aviso por correo; no permite acceder a datos de la Clínica.
_Avoid_: bloqueo permanente por error de contraseña

**Auditoría de identidad**:
El registro de inicios de sesión, invitaciones, suspensiones, cambios de rol, restablecimientos, revocaciones y recuperaciones manuales. Conserva actor, momento, Clínica y resultado durante al menos 12 meses, sin contraseñas, OTP ni contenido de Pacientes.
_Avoid_: auditoría que almacena secretos o conversaciones

**Recuperación de plataforma**:
La restauración verificable de datos y operación de Apolo. En el piloto usa recuperación a un punto en el tiempo con RPO de minutos y se prueba mensualmente en un servidor limpio.
_Avoid_: confiar en una copia nocturna sin prueba de restauración

**Invitación de usuario de clínica**:
El enlace de un solo uso con el que el médico propietario incorpora a un Usuario de clínica. Vence a las 72 horas; si vence, se emite una nueva invitación.
_Avoid_: enlace reutilizable o de duración indefinida
