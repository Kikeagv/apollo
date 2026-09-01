# Praxia

Praxia es la plataforma para consultorios y clínicas pequeñas en El Salvador. Su primer alcance es agenda y atención administrativa por WhatsApp; no es un sistema de apoyo a decisiones clínicas.

## Language

**Regla de nomenclatura pública**:
Para cualquier cliente, Clínica, Médico o Paciente, la única marca visible del producto es Praxia. Apolo, Asclepio y Panacea son nombres internos y nunca deben aparecer en copy, interfaces, documentos ni comunicaciones externas; al agente se le describe como "asistente de la clínica por WhatsApp".
_Avoid_: mostrar nombres internos al cliente o presentar Asclepio y Panacea como marcas públicas

**Praxia**:
La única marca pública del producto, utilizada en las superficies y comunicaciones que ven clínicas, médicos y pacientes.
_Avoid_: Apolo, Asclepio o Panacea en cualquier material visible para clientes

**Lead cualificado**:
La persona que representa a una Clínica y que inicia una conversación comercial con intención verificable de evaluar Praxia. No es un Paciente, un visitante meramente informativo ni una persona que solo accede a Panacea.
_Avoid_: Paciente, Usuario de clínica, usuario del panel, prospecto

**Solicitud de demo**:
La petición de una persona representante de una Clínica para conocer y evaluar Praxia con el equipo comercial. No es una Cita de la Agenda ni una Reserva temporal de atención.
_Avoid_: Cita, reserva de paciente, agendamiento clínico

**Apolo**:
El nombre interno de la plataforma completa y de su contexto técnico.
_Avoid_: usarlo ante clientes o como marca pública; para el producto visible usar Praxia

**Asclepio**:
El nombre interno del agente de agendamiento por WhatsApp. Nunca se muestra a clientes, clínicas, médicos ni pacientes; públicamente se describe como "asistente de la clínica por WhatsApp".
_Avoid_: mostrar Asclepio, llamarlo bot de Praxia o presentarlo como una marca

**Asistente de la clínica por WhatsApp**:
La descripción pública del agente de agendamiento de Praxia ante clínicas y pacientes. Puede reservar, reprogramar y cancelar Citas de forma autónoma dentro de las reglas de la Clínica; cuando una solicitud requiere decisión humana, la entrega al equipo y deja de intervenir.
_Avoid_: agente de Praxia, Asclepio ante clientes o pacientes, bot de Praxia

**Atención administrativa por WhatsApp**:
La interacción por WhatsApp para consultar disponibilidad y gestionar Citas de una Clínica, incluyendo reservas, reprogramaciones y cancelaciones dentro de sus reglas. No incluye diagnóstico, orientación médica ni decisiones clínicas.
_Avoid_: consulta médica, atención clínica automatizada, diagnóstico por WhatsApp

**Panacea**:
El nombre interno del CRM y panel para operar agenda, pacientes y, en fases posteriores, expediente.
_Avoid_: usarlo ante clientes o como nombre visible del panel; públicamente usar Praxia o panel de Praxia

**Calendario de Panacea**:
La superficie central de la Operación diaria de agenda. Abre en vista semanal de toda la Clínica, permite cambiar a vista diaria y aplica el mismo filtro de Médico a ambas vistas; al filtrar muestra las Citas y Bloqueos de ese Médico. Muestra solo Citas activas para que una cancelación libere visualmente el espacio; la Cita cancelada permanece consultable desde la ficha del Paciente y sus eventos. Cada Cita muestra el nombre del Paciente y Servicio, y también el Médico cuando no hay filtro; los datos de Contacto aparecen solo en el detalle. Su tablero lateral mínimo presenta el detalle de la Cita seleccionada, sus eventos y las acciones de cancelación y ficha; no incluye Escalamientos ni conversaciones.
_Avoid_: una agenda separada por rol o filtros distintos entre las vistas semanal y diaria

**Clínica**:
La unidad cliente y de aislamiento de datos de Praxia; puede incluir uno o más médicos y usa un solo número de WhatsApp. Es la fuente de zona horaria para sus Horarios, Bloqueos, Citas y Agenda; durante el piloto usa `America/El_Salvador`.
_Avoid_: tenant, cuenta

**Contacto**:
La persona identificada por un número de WhatsApp normalizado a E.164 y único dentro de una clínica. En Panacea su ficha administrativa mínima conserva nombre y teléfono, y puede estar vinculada a uno o más pacientes; el número es un atributo, no su clave primaria.
_Avoid_: paciente cuando se habla del titular de un teléfono

**Paciente**:
La persona para quien se gestiona una cita dentro de una clínica. En Panacea su ficha administrativa mínima conserva nombre y fecha de nacimiento. No tiene identidad compartida entre clínicas.
_Avoid_: contacto cuando se habla de la persona atendida

**Ficha de Paciente incompleta**:
La ficha administrativa de un Paciente que todavía no tiene ningún Contacto vinculado. Puede conservarse para completarla después, pero no cumple el requisito para crear una Cita manual hasta que se le vincule un Contacto.
_Avoid_: paciente inválido, paciente sin identidad

**Vínculo Contacto–Paciente**:
La relación explícita dentro de una Clínica entre un Contacto y un Paciente. Permite que un Contacto esté vinculado a más de un Paciente y que un Paciente tenga varios Contactos; el vínculo de Tutor es su variante con tutela legal registrada.
_Avoid_: inferir el Paciente desde el Contacto o la última Cita

**Tutor**:
Un contacto vinculado a un paciente menor de edad con una relación de tutela legal registrada.
_Avoid_: padre, responsable, salvo al describir el parentesco concreto

**Lista de espera**:
La solicitud de un paciente para ocupar una fecha liberada. Es alcance de fase 1b, no un requisito para el piloto de fase 1.
_Avoid_: cola de citas de fase 1

**Activación de clínica**:
El proceso que deja a una clínica habilitada para intercambiar mensajes reales por WhatsApp. Requiere una subcuenta Twilio, su WABA y sender, plantillas aprobadas, base legal y revisión operativa.
_Avoid_: alta cuando se habla únicamente de crear un registro de clínica

**Configuración inicial de Clínica**:
El recorrido guiado que completa la información y capacidad mínima de una Clínica para que la Agenda pueda operar y Asclepio pueda habilitarse. No incluye la Activación de clínica ni sustituye las aprobaciones externas de WhatsApp.
_Avoid_: Activación de clínica, onboarding de WhatsApp

**Clínica lista para Asclepio**:
El estado de una Clínica que tiene al menos una ruta de atención válida calculada por la Agenda y puede ofrecer nuevas Opciones de atención mediante Asclepio. No implica que todo su equipo esté configurado ni que WhatsApp real ya esté activado.
_Avoid_: clínica activa, clínica activada

**Clínica con configuración pendiente**:
El estado de una Clínica que no tiene ninguna ruta de atención válida disponible para Asclepio. Conserva sus datos y Citas existentes, pero no ofrece nuevas Opciones de atención hasta completar la configuración necesaria.
_Avoid_: clínica suspendida, clínica desactivada

**Identidad**:
La prueba de autenticación de una persona operadora. No concede por sí misma acceso a una clínica ni contiene un rol de negocio.
_Avoid_: usuario de clínica

**Usuario de clínica**:
La persona operadora autorizada dentro de una clínica, con un rol y una relación con un médico cuando aplica. Es el sujeto que fija el contexto de clínica para RLS.
_Avoid_: identidad cuando se habla de permisos sobre datos de una clínica

**Médico**:
El perfil clínico de un Usuario de clínica que atiende Citas y al que se le asignan Servicios, Horarios vigentes y Bloqueos. Expone nombre y una especialidad principal en texto libre al público. El médico propietario inicial se crea con su Clínica y queda vinculado a su Usuario de clínica; las secretarias no tienen perfil de Médico.
_Avoid_: usar usuario de clínica para referirse a la disponibilidad o capacidad de atención

**Médico propietario**:
El Médico que posee el rol `owner` en una Clínica. Durante el piloto administra los Usuarios de clínica y toda la configuración de Médicos, Servicios, Horarios vigentes y Bloqueos de su Clínica, incluidos los de otros Médicos.
_Avoid_: limitarlo a la configuración de su propio perfil o agenda

**Médico no propietario**:
El Usuario de clínica con perfil de Médico y sin rol de propietario. Puede editar únicamente su propio perfil, Ofertas de servicio, Horarios vigentes y Bloqueos; no administra otros Usuarios de clínica ni la configuración de otros Médicos.
_Avoid_: otorgarle los privilegios administrativos del Médico propietario

**Secretaria**:
El Usuario de clínica sin perfil de Médico. Puede consultar la Agenda, gestionar fichas administrativas y crear o cancelar Citas para cualquier Médico de su Clínica. No configura Médicos, Servicios, Ofertas de servicio, Horarios vigentes ni Bloqueos.
_Avoid_: modelarla como Médico o concederle administración clínica

**Operación diaria de agenda**:
Las consultas del calendario y la gestión de fichas administrativas y Citas para cualquier Médico de una Clínica. Está autorizada para todo Usuario de clínica activo; es distinta de configurar la capacidad de atención.
_Avoid_: extender las restricciones de configuración de un Médico no propietario a la operación de Citas

**Operación de clínica**:
La coordinación administrativa de una Clínica que reúne la agenda, la capacidad de atención, el equipo y la atención administrativa por WhatsApp. No incluye decisiones clínicas ni orientación médica.
_Avoid_: operación diaria de agenda cuando se refiere al producto completo, gestión de atención clínica

**Servicio**:
La prestación administrativa que una Clínica pone en su catálogo, con nombre único normalizado dentro de la Clínica y descripción pública común a todos los Médicos que la ofrecen. En fase 1 esa descripción no admite variantes por Médico. Su alta requiere al menos una Oferta de servicio activa; no existe un Servicio público sin un Médico que pueda atenderlo. No determina por sí sola la disponibilidad, duración, buffer ni precio de una atención.
_Avoid_: tratarlo como una Cita o asumir que todos los Médicos lo ofrecen en las mismas condiciones

**Oferta de servicio**:
La única configuración activa para una pareja Médico–Servicio. Habilita a ese Médico a atender el Servicio y define el precio en USD, duración y buffer posterior aplicables; la Agenda la usa junto con la agenda del Médico para calcular una opción de atención. La duración es positiva y tanto esta como el buffer se expresan en múltiplos de cinco minutos; el buffer puede ser cero. Los cambios aplican inmediatamente a opciones nuevas, no a Citas ya confirmadas. El precio se conserva como importe monetario exacto. El buffer extiende el período bloqueado del Médico después del término de la atención.
_Avoid_: copiar Servicios por Médico o consultar disponibilidad solo por Servicio

**Horario vigente**:
La regla recurrente de atención de un Médico para días de la semana y una o más franjas horarias del mismo día local, acotada por una fecha de inicio y, cuando corresponde, una fecha de término. Una jornada que cruza medianoche se expresa con dos franjas. Un cambio permanente cierra la vigencia previa y crea una nueva; Horarios traslapados del mismo Médico se unen y nunca generan capacidad paralela. Las opciones de atención inician en una cuadrícula fija de cinco minutos.
_Avoid_: modificar retrospectivamente la disponibilidad o usarlo para una ausencia puntual

**Bloqueo**:
La excepción puntual o acotada que resta disponibilidad a la agenda de un Médico, por ejemplo una capacitación, vacaciones o un feriado. Puede incluir una etiqueta privada visible solo en Panacea; no se expone a pacientes ni por WhatsApp. No reemplaza ni modifica su Horario vigente. Una acción masiva de Panacea puede crear el mismo Bloqueo individual para varios Médicos, sin convertirlo en un cierre global de Clínica. No puede cubrir una Cita confirmada ni una Reserva temporal activa: el operador debe resolver la Cita o esperar el vencimiento de la Reserva antes de crear el Bloqueo.
_Avoid_: editar el Horario vigente para registrar una ausencia

**Cita manual**:
La Cita que un Médico o Secretaria crea desde Panacea. Requiere seleccionar un Paciente con al menos un Contacto vinculado; Panacea permite registrar manualmente el Contacto, el Paciente y su Vínculo tanto desde el flujo de nueva Cita como desde su ficha administrativa. La Agenda vuelve a validar la capacidad al confirmarla: ante un conflicto concurrente no la crea ni cambia su horario automáticamente. Inicia en una cuadrícula de cinco minutos y no inicia en el pasado. Al crearla, el operador puede enviar una confirmación inicial a un único Contacto vinculado que selecciona explícitamente, mediante un control desactivado por defecto; ese control no modifica los recordatorios futuros. No se edita ni reprograma: se cancela y se crea una Cita nueva. Su evento de creación identifica al Usuario de clínica que la registró, pero no tiene Autor de la cita y Asclepio no permite su autogestión hasta que un flujo posterior le asigne explícitamente un autor.
_Avoid_: atribuir su creación al Contacto vinculado al Paciente

**Cita manual fuera de horario**:
La Cita manual para un período que no cabe por completo en el Horario vigente. Panacea muestra una advertencia y exige confirmación explícita antes de crearla, sin pedir una justificación obligatoria, y conserva una marca visible en el Calendario de Panacea y el detalle de la Cita. La excepción omite únicamente el Horario vigente y sigue rechazando traslapes con Bloqueos, Citas y Reservas temporales, incluida la duración y el buffer de la Oferta de servicio. Asclepio nunca puede crearla y solo confirma Opciones de atención calculadas por la Agenda.
_Avoid_: tratar la advertencia como una Opción de atención o permitir a Asclepio ignorar el Horario vigente

**Cita**:
La atención confirmada de un Paciente con un Médico en un período concreto. Su origen es manual o una Reserva de Contacto confirmada, y determina si puede tener Autor de la cita. Al crearse desde una Oferta de servicio activa, conserva una instantánea del precio, duración y buffer cotizados; cambios posteriores a la Oferta no alteran esa Cita. Antes de su inicio puede pasar a estado cancelada, liberar la disponibilidad y no eliminarse; una Cita iniciada o pasada no se cancela. Su cancelación puede solicitar un aviso opcional a un único Contacto vinculado seleccionado explícitamente, pero el evento y la liberación de disponibilidad ocurren siempre.
_Avoid_: recalcular una Cita confirmada desde la Oferta de servicio actual

**Evento de Cita**:
El registro append-only de una transición de Cita o del resultado de una notificación solicitada. Conserva como mínimo el tipo de evento, el actor y el instante; la cancelación puede incluir una razón opcional. Una falla de envío no revierte una Cita creada o cancelada válidamente.
_Avoid_: sobrescribir o borrar el historial al cancelar una Cita

**Opción de atención**:
El inicio elegible que la Agenda calcula para una Oferta de servicio de un Médico activo que ya aceptó su invitación. Solo existe si la duración de la atención y su buffer posterior completos caben dentro de los Horarios vigentes, y no se traslapan con Bloqueos, Citas ni Reservas temporales. Un Médico sin esa capacidad permanece visible en Panacea, pero no aparece disponible a pacientes ni a Asclepio.
_Avoid_: slot materializado o espacio que solo alcanza para la atención sin su buffer

**Desactivación de configuración clínica**:
El cierre explícito de un Médico o una Oferta de servicio para impedir nuevas opciones de atención. Conserva el historial y exige reprogramar o cancelar las Citas futuras afectadas, y esperar el vencimiento de las Reservas temporales activas, antes de completarse; nunca las cambia o elimina silenciosamente.
_Avoid_: borrar un Médico o Servicio con Citas existentes

**Cambio que reduce capacidad**:
La creación de un Bloqueo, el cierre o acortamiento de un Horario vigente, o la Desactivación de configuración clínica. Panacea no lo completa si afecta una Cita confirmada o una Reserva temporal activa y muestra los conflictos para resolverlos explícitamente.
_Avoid_: aceptar cambios de configuración que invaliden una opción o Cita existente

**Mensaje transaccional de cita**:
El mensaje proactivo por WhatsApp que Asclepio envía al Contacto sobre una Cita concreta: confirmación, recordatorio o aviso de cancelación. No incluye campañas ni seguimiento comercial.
_Avoid_: mensaje proactivo cuando se habla de comunicación promocional

**Entrega transaccional**:
El intento persistente de entregar un Mensaje transaccional de cita o el PDF nocturno de agenda. Garantiza entrega al menos una vez mediante una clave idempotente estable; el adaptador debe reconocer reintentos de la misma entrega sin duplicar el efecto para el destinatario.
_Avoid_: exactamente una vez cuando se habla de una llamada que cruza la base de datos y un proveedor externo

**Entrega transaccional fallida**:
La Entrega transaccional que no fue aceptada tras el intento inicial y cuatro reintentos a 1, 5, 15 y 60 minutos. Conserva su historial y crea una alerta operativa en Panacea para resolución humana.
_Avoid_: descartar silenciosamente un fallo del proveedor

**Supresión de recordatorios por respuesta**:
La cancelación de las Entregas transaccionales pendientes de recordatorios futuros cuando un Contacto responde sobre la Cita. No revoca una entrega ya en envío ni borra su callback; esas condiciones de carrera se conservan en el historial.
_Avoid_: reintentar un recordatorio que una respuesta ya volvió innecesario

**Alerta de Entrega transaccional fallida**:
La tarea de Operación diaria de agenda creada cuando una Entrega transaccional falla definitivamente. Es visible y resoluble para todo Usuario de clínica activo en Panacea; no genera un aviso adicional por WhatsApp.
_Avoid_: modelarla como configuración clínica o como Escalamiento humano

**Contenido de Entrega transaccional**:
La instantánea administrativa preparada para una Entrega transaccional: fecha y hora de la Cita, Clínica y destinatario. Permanece estable durante reintentos y no conserva motivo de consulta, especialidad ni otro dato clínico.
_Avoid_: reconstruir el mensaje pendiente desde una Cita modificada

**Clave de idempotencia de Entrega transaccional**:
El identificador estable de una Entrega transaccional. Para un recordatorio combina Cita, hito y Contacto; para el PDF nocturno combina Médico y fecha local de agenda. El adaptador la usa para reconocer un reintento sin repetir el efecto.
_Avoid_: usar un identificador nuevo en cada intento

**Retención de Entrega transaccional**:
El período mínimo de 12 meses durante el cual se conserva el historial de una Entrega transaccional, sus intentos, callbacks, alertas y contenido administrativo preparado. Al vencer se elimina también esa instantánea de contenido.
_Avoid_: conservar indefinidamente un contenido administrativo de Cita

**Concesión de Entrega transaccional**:
La posesión temporal de una Entrega transaccional por un worker para enviarla. Vence a los 10 minutos; entonces otro worker puede reintentar la misma Entrega usando su Clave de idempotencia.
_Avoid_: un bloqueo permanente tras la caída de un worker

**Worker de Entregas transaccionales**:
El proceso que se ejecuta cada minuto para reclamar y entregar Entregas transaccionales pendientes, incluidas las concesiones vencidas. Las guardas de cadencia siguen impidiendo recordatorios o cancelaciones tardías.
_Avoid_: un único envío puntual como única oportunidad de entrega

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
El Contacto que creó una Cita mediante una aceptación de Reserva temporal. Es el único Contacto autorizado para cancelarla o reprogramarla dentro de la Ventana de autogestión; los demás Tutores pueden recibir recordatorios, pero no alterarla. Una Cita manual no tiene Autor de la cita hasta que un flujo posterior le asigne uno explícitamente.
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

**Auditoría de configuración clínica**:
El registro de cambios a Médicos, Servicios, Ofertas de servicio, Horarios vigentes y Bloqueos. Conserva actor, Clínica, instante, entidad, tipo de cambio y los valores relevantes antes y después durante al menos 12 meses, sin datos de Pacientes.
_Avoid_: limitar la auditoría a Identidad cuando se modifica la capacidad de atención

**Recuperación de plataforma**:
La restauración verificable de datos y operación de Apolo. En el piloto usa recuperación a un punto en el tiempo con RPO de minutos y se prueba mensualmente en un servidor limpio.
_Avoid_: confiar en una copia nocturna sin prueba de restauración

**Invitación de usuario de clínica**:
El enlace de un solo uso con el que el médico propietario incorpora a un Usuario de clínica. Vence a las 72 horas; si vence, se emite una nueva invitación. Una invitación a Médico activa su perfil clínico al aceptarse; hasta entonces no es elegible en la Agenda.
_Avoid_: enlace reutilizable o de duración indefinida
