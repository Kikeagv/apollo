# Especificación: rework de Panacea

**Estado:** lista para agente  
**Fecha:** 24 de agosto de 2026  
**Alcance:** shell, arquitectura de información y experiencia operativa de
Panacea

Esta especificación consolida la conversación de rework, `CONTEXT.md`, el
documento de producto y los ADRs 0009-0036. No reabre las decisiones anteriores
de identidad, RLS, Agenda, seguridad, Base UI ni Activación de clínica.

## Problem Statement

Panacea presenta hoy casi todas las capacidades autenticadas en una sola
columna de la ruta raíz. Calendario, Pacientes, Escalamientos, Alertas de
Entrega, Médicos, Servicios, Disponibilidad y políticas de WhatsApp compiten
por la misma superficie, aunque pertenecen a trabajos, permisos y frecuencias
distintos.

El Calendario, que el dominio define como la superficie central de la Operación
diaria de agenda, aparece mezclado dentro del formulario de Citas manuales. La
interfaz expone además la estructura técnica de Contacto, Paciente y Vínculo en
formularios separados, presenta soporte temporal y una acción sintética de
prueba al mismo nivel que la operación real, y no ofrece rutas enlazables ni un
contexto persistente de Clínica y rol.

Esta composición aumenta la carga cognitiva, dificulta encontrar trabajo
pendiente, hace ambiguo qué puede hacer cada rol y deja incompleta la ruta de
preparación de una Clínica. El rework debe mejorar la arquitectura de
información y la interacción sin debilitar la Agenda como autoridad, los
permisos de Usuario de clínica, el aislamiento por Clínica ni la auditoría.

## Solution

Panacea tendrá un shell operativo compartido con navegación principal lateral,
encabezado global y rutas independientes. La ruta inicial será Calendario. La
navegación tendrá cuatro destinos:

- Calendario.
- Pacientes.
- Pendientes.
- Configuración.

Configuración tendrá un índice y cuatro subsecciones: Equipo, Servicios,
Disponibilidad y Atención por WhatsApp. Pendientes será una bandeja unificada
de trabajo humano, no una nueva entidad de dominio. Calendario, Pacientes y
Pendientes usarán un patrón maestro-detalle, con panel lateral en escritorio y
drawer o pantalla completa en teléfono.

La experiencia conservará la base visual aceptada: modo claro, superficies
blancas y `slate`, `#06459f` como `primary`, Geist, shadcn/ui con Base UI,
radios moderados, movimiento funcional y accesibilidad WCAG 2.2 AA.

La configuración inicial de una Clínica será un recorrido reanudable de cinco
pasos: Datos básicos de la Clínica, Equipo y perfiles de Médicos, Servicios y
Ofertas de servicio, Horarios y Disponibilidad, y Revisión de capacidad. El
Médico propietario lo coordina y confirma explícitamente que la Clínica está
lista para Asclepio. La Activación de clínica de WhatsApp sigue siendo un
proceso externo separado.

## User Stories

### Shell y navegación

1. Como Médico propietario, quiero abrir Panacea directamente en Calendario, para empezar en la superficie central de la Operación diaria.
2. Como Médico no propietario, quiero ver un shell consistente con mi alcance, para no tener que aprender una navegación distinta.
3. Como Secretaria, quiero entrar directamente a Calendario, Pacientes y Pendientes, para concentrarme en la operación diaria sin ver configuración que no puedo administrar.
4. Como Usuario de clínica, quiero una navegación lateral persistente con texto visible, para entender el destino de cada opción sin depender de reconocer iconos.
5. Como Usuario de clínica, quiero poder colapsar la navegación a una rail de iconos en escritorio, para ganar espacio sin perder el estado activo.
6. Como Usuario de clínica en teléfono, quiero abrir la navegación como drawer, para usar las mismas rutas sin ocupar permanentemente la pantalla.
7. Como Usuario de clínica, quiero que cada destino tenga una URL propia, para enlazarlo, recargarlo y usar atrás y adelante del navegador sin perder contexto.
8. Como Usuario de clínica, quiero que la navegación muestre solo destinos autorizados para mi rol, para evitar opciones irrelevantes sin confundir visibilidad con seguridad.
9. Como Usuario de clínica, quiero ver el nombre de mi Clínica y mi rol en el encabezado, para saber siempre en qué contexto estoy trabajando.
10. Como Usuario de clínica, quiero consultar el estado de mi Sesión de clínica y cerrar sesión desde un menú de cuenta, para controlar mi acceso sin buscarlo dentro de una feature.
11. Como Usuario de clínica, quiero que una Sesión de soporte activa aparezca como aviso de seguridad persistente, para conocer un acceso administrativo excepcional sobre mi Clínica.
12. Como Usuario de clínica, quiero que el aviso de soporte desaparezca al vencer la sesión, para no conservar una alerta obsoleta.
13. Como equipo de pruebas, quiero conservar la acción clínica sintética en una superficie técnica protegida, para probar RLS sin mostrar tooling en el producto.

### Calendario y Citas

14. Como Usuario de clínica, quiero ver la semana completa de la Clínica al abrir Calendario, para entender la capacidad operativa antes de actuar.
15. Como Usuario de clínica, quiero cambiar a vista diaria, para trabajar con más detalle cuando la agenda del día lo requiera.
16. Como Usuario de clínica, quiero que el filtro de Médico sea el mismo en vista semanal y diaria, para no interpretar dos agendas diferentes.
17. Como Usuario de clínica, quiero ver Citas activas y Bloqueos posicionados en una cuadrícula temporal, para detectar ocupación, espacios y conflictos de un vistazo.
18. Como Usuario de clínica, quiero que una Cita muestre Paciente y Servicio, y que muestre Médico cuando no filtro un Médico, para identificarla sin abrir el detalle.
19. Como Usuario de clínica, quiero seleccionar una Cita y ver sus datos, Contactos, eventos y acciones en un panel, para resolverla sin abandonar el Calendario.
20. Como Usuario de clínica, quiero que una Cita cancelada deje de ocupar visualmente la Agenda, pero siga consultable desde la ficha del Paciente y sus eventos, para conservar historial sin ocultar capacidad liberada.
21. Como Médico o Secretaria autorizada, quiero iniciar Nueva Cita desde un botón visible, para crear una Cita aunque no haya seleccionado un horario.
22. Como Usuario de clínica, quiero activar Nueva Cita al hacer clic o usar el teclado sobre un espacio vacío, para que Médico, fecha y hora se preseleccionen y el alta sea rápida.
23. Como Usuario de clínica, quiero que Nueva Cita permita crear un Paciente con su Contacto inicial en una sola operación, para no abandonar el Calendario ni completar formularios técnicos separados.
24. Como Usuario de clínica, quiero reutilizar un Contacto existente cuando el teléfono ya está registrado, para evitar duplicados y conservar los Vínculos familiares.
25. Como Usuario de clínica, quiero seleccionar explícitamente un Contacto para una confirmación inicial de WhatsApp, para que la notificación no se envíe a una persona equivocada.
26. Como Usuario de clínica, quiero recibir una advertencia clara cuando una Cita manual está fuera del Horario vigente, para confirmar la excepción sin relajar Bloqueos, Citas ni Reservas.
27. Como Médico propietario o Médico con alcance de configuración, quiero crear un Bloqueo desde Calendario con el Médico y período preseleccionados, para registrar una ausencia puntual al descubrirla durante la operación.
28. Como Usuario de clínica, quiero que el detalle de una Cita muestre el precio, duración y buffer cotizados, para entender el período ocupado sin recalcularlo desde la Oferta actual.
29. Como Usuario de clínica, quiero que las acciones de cancelación respeten las reglas de Cita iniciada o pasada, para no realizar cambios inválidos.
30. Como Usuario de clínica, quiero ver una alternativa accesible a la cuadrícula temporal, para navegar por teclado y tecnologías asistivas sin depender de coordenadas visuales.

### Pacientes, Contactos y fichas administrativas

31. Como Usuario de clínica, quiero abrir Pacientes en una lista de Pacientes, para trabajar desde la persona atendida y no desde el teléfono.
32. Como Usuario de clínica, quiero abrir el detalle de un Paciente en un panel, para revisar su información sin perder la lista.
33. Como Usuario de clínica, quiero crear un Paciente y su Contacto inicial desde el mismo flujo, para no aprender la estructura interna de tres registros.
34. Como Usuario de clínica, quiero elegir un Contacto existente cuando su teléfono ya está en la Clínica, para vincularlo sin duplicarlo.
35. Como Usuario de clínica, quiero crear una Ficha de Paciente incompleta solo mediante una acción secundaria explícita, para registrar excepciones sin hacer que parezcan listas para agendar.
36. Como Usuario de clínica, quiero que una Ficha de Paciente incompleta indique cómo agregar o reutilizar un Contacto, para resolverla antes de crear una Cita manual.
37. Como Usuario de clínica, quiero agregar Contactos adicionales desde la ficha del Paciente, para representar familias y Tutores sin convertir el primer Contacto en una relación principal permanente.
38. Como Usuario de clínica, quiero ver y administrar Vínculos Contacto-Paciente desde la ficha, para mantener relaciones explícitas y no inferirlas por teléfono o última Cita.
39. Como Usuario de clínica, quiero ver Tutelas pendientes de verificación en el contexto del Paciente, para resolver la revisión administrativa antes de la primera visita.
40. Como Usuario de clínica, quiero consultar Citas activas, canceladas y eventos desde la ficha administrativa, para tener continuidad operativa sin abrir un expediente clínico.
41. Como Usuario de clínica, quiero que la ficha no muestre motivo de consulta, notas clínicas ni conversaciones completas, para conservar el límite de Panacea como operación administrativa.
42. Como Usuario de clínica, quiero buscar Pacientes y Contactos sin confundirlos, para encontrar a la persona atendida o al titular del teléfono según la tarea.

### Pendientes

43. Como Usuario de clínica, quiero un destino único para el trabajo humano pendiente, para no recorrer tres secciones separadas.
44. Como Usuario de clínica, quiero abrir Pendientes con todos los casos no resueltos, para conocer el trabajo que requiere atención sin elegir primero una categoría.
45. Como Usuario de clínica, quiero filtrar Pendientes por Escalamientos de conversaciones, Escalamientos de Citas y Entregas fallidas, para concentrarme en un tipo de trabajo cuando sea necesario.
46. Como Usuario de clínica, quiero ver contadores por categoría, para identificar rápidamente dónde se acumula trabajo.
47. Como Usuario de clínica, quiero que los casos se ordenen por prioridad registrada y luego por antigüedad, para atender primero lo más urgente y antiguo.
48. Como Usuario de clínica, quiero abrir el detalle de un pendiente en un panel, para conservar la lista y entender el contexto antes de actuar.
49. Como Usuario de clínica, quiero que cada pendiente muestre una acción de resolución con el lenguaje de su tipo, para entender qué efecto tendrá el cierre.
50. Como Usuario de clínica, quiero cerrar un Escalamiento con su acción específica, para no confundirlo con una Entrega fallida.
51. Como Usuario de clínica, quiero marcar resuelta una Alerta de Entrega transaccional fallida, para dejar constancia de que fue atendida sin borrar sus intentos.
52. Como Usuario de clínica, quiero consultar Pendientes resueltos como historial separado, para auditar trabajo anterior sin saturar la cola actual.
53. Como Usuario de clínica, quiero que los errores de resolución permanezcan visibles en el detalle, para saber si la acción no se completó.

### Configuración

54. Como Usuario de clínica, quiero abrir Configuración en un índice breve, para entender qué áreas requieren atención sin recibir otra página interminable.
55. Como Médico propietario, quiero ver el estado de Equipo, Servicios, Disponibilidad y Atención por WhatsApp, para priorizar la preparación de la Clínica.
56. Como Médico no propietario, quiero ver solo la configuración de mi propia capacidad, para no administrar Médicos ajenos.
57. Como Médico propietario, quiero administrar Médicos e invitaciones desde Equipo, para preparar el personal elegible.
58. Como Médico propietario o Médico autorizado, quiero administrar Servicios y Ofertas de servicio, para definir qué puede atender cada Médico y bajo qué duración, buffer y precio.
59. Como Médico propietario o Médico autorizado, quiero administrar Horarios, Bloqueos y Opciones de atención desde Disponibilidad, para configurar capacidad sin mezclarla con la operación diaria.
60. Como Médico propietario, quiero configurar políticas de inasistencia, avisos de Escalamiento y transcripción en Atención por WhatsApp, para separar reglas del canal de la bandeja de trabajo.
61. Como Médico propietario o Médico autorizado, quiero crear un Bloqueo desde Disponibilidad después de crearlo desde Calendario, para gestionar excepciones y reglas desde un mismo lugar.
62. Como Usuario de clínica, quiero que las subsecciones con carga, vacío y error propios no arrastren toda la aplicación, para recuperar una parte sin perder las demás.

### Configuración inicial de Clínica

63. Como Médico propietario, quiero un recorrido guiado de Configuración inicial, para llevar a la Clínica desde datos básicos hasta una primera ruta de atención.
64. Como Médico propietario, quiero que el recorrido sea reanudable, para continuar después de cerrar sesión o navegar a otra ruta.
65. Como Médico propietario, quiero ver el paso actual, los pasos completos y los pendientes, para saber qué falta sin adivinar.
66. Como Médico propietario, quiero completar Datos básicos de la Clínica, para confirmar el contexto y los datos necesarios antes de configurar capacidad.
67. Como Médico propietario, quiero invitar Médicos y ver el progreso de sus perfiles, para preparar un equipo elegible.
68. Como Médico invitado, quiero completar mi propio perfil dentro de mi alcance, para ser elegible sin recibir permisos de administración ajenos.
69. Como Médico propietario, quiero crear Servicios con al menos una Oferta activa, para hacer que la capacidad tenga una prestación concreta.
70. Como Médico propietario o Médico autorizado, quiero definir Horarios vigentes, para que la Agenda pueda calcular Opciones de atención.
71. Como Médico propietario, quiero revisar la capacidad calculada al final, para confirmar que existe al menos una ruta real y no solo formularios guardados.
72. Como Médico propietario, quiero declarar explícitamente la Clínica lista para Asclepio, para que la automatización no se habilite por accidente.
73. Como Médico propietario, quiero que la revisión indique qué Médico, Servicio y Horario forman la primera ruta válida, para entender el efecto de la confirmación.
74. Como Médico propietario, quiero que Médicos, Servicios u Horarios incompletos no bloqueen una primera ruta válida, para poder empezar con una Clínica pequeña y ampliar después.
75. Como Médico propietario, quiero que una Clínica sin ruta válida pase a configuración pendiente, para saber que Asclepio ya no debe ofrecer nuevas Opciones de atención.
76. Como Médico propietario, quiero que perder la preparación no cancele Citas existentes, para resolver configuración sin destruir compromisos confirmados.
77. Como Médico propietario, quiero que el estado vuelva a evaluarse al cambiar capacidad, para no mantener una habilitación obsoleta.
78. Como Médico propietario, quiero distinguir Configuración inicial de Activación de clínica, para no confundir datos operativos con aprobaciones de WhatsApp real.

### Calidad y seguridad

79. Como Usuario de clínica, quiero que todos los cambios sigan pasando por la autorización del servidor, para que ocultar una opción no sea la única barrera.
80. Como Usuario de clínica, quiero que las consultas y mutaciones respeten RLS por Clínica, para no ver datos de otra Clínica.
81. Como Usuario de clínica, quiero que las acciones destructivas o de reducción de capacidad expliquen conflictos y consecuencias, para resolver Citas y Reservas explícitamente.
82. Como Usuario de clínica, quiero ver estados de carga, vacío y error específicos, para diferenciar una Clínica sin datos de una consulta fallida.
83. Como Usuario de clínica, quiero navegar por teclado con foco visible y nombres accesibles, para operar sin ratón.
84. Como equipo de producto, quiero validar el shell y sus rutas con Playwright y axe-core, para detectar regresiones visibles y de accesibilidad.
85. Como equipo de desarrollo, quiero conservar pruebas de aplicación para casos de uso existentes, para que el rework visual no cambie reglas de Agenda, Contactos, Citas o permisos.

## Implementation Decisions

### Shell y arquitectura de información

- El alcance es Panacea. Apolo mantiene su consola independiente y no comparte la navegación clínica.
- El shell es una composición server-first compartida por las rutas clínicas. La navegación lateral tiene etiquetas, estado activo, grupos y soporte de teclado; puede colapsarse en escritorio y se transforma en drawer en teléfono.
- El encabezado global muestra Clínica, rol, estado de Sesión de clínica y menú de cuenta. Una Sesión de soporte activa se presenta como aviso persistente de seguridad fuera de los destinos principales.
- La sesión mantiene una sola Clínica. No se agregará un selector de Clínicas.
- La ruta raíz autenticada resuelve hacia Calendario. Los destinos de primer nivel son Calendario, Pacientes, Pendientes y Configuración.
- Configuración abre un índice, no una colección de formularios. Sus subsecciones son Equipo, Servicios, Disponibilidad y Atención por WhatsApp.
- La visibilidad de destinos se filtra por rol: Secretaria ve Calendario, Pacientes y Pendientes; Médico no propietario ve además su configuración de capacidad; Médico propietario ve toda Configuración. La autorización permanece en servidor, tRPC, transacciones con contexto y RLS.
- Cada destino tiene URL propia y los filtros, fechas, categoría y selección enlazable se expresan en el estado de ruta apropiado. No se conservará el monolito de estado de la ruta raíz.
- Se conserva el sistema visual aprobado por el ADR 0008. El rework cambia composición, jerarquía, estados y arquitectura de información, no la identidad visual ni la base de componentes.

### Seams y límites de implementación

- El seam principal de UI es `PanaceaShell`, que compone navegación, encabezado, aviso de soporte, contenido de ruta y capas de drawer o modal.
- Los destinos se implementan como composiciones independientes que reutilizan los casos de uso y procedimientos tRPC existentes. No se crea un estado global de negocio para reemplazar la Agenda o RLS.
- El único seam de dominio nuevo de alcance transversal es la consulta y comando de preparación de Clínica. Este seam agrega el progreso, la primera ruta válida, los bloqueos y la confirmación explícita sin duplicar la lógica de Agenda, Servicios u Horarios.
- Pendientes recibe un read model o agregador de aplicación que normaliza Escalamientos y Alertas de Entrega para la interfaz. No se crea una entidad Pendiente ni se unifican los estados internos; cada resolución delega al caso de uso específico.
- Pacientes reutiliza la separación Contacto, Paciente y Vínculo. La experiencia es Paciente primero, pero la persistencia mantiene el modelo muchos-a-muchos y la selección explícita de destinatarios.

### Calendario

- Calendario abre en vista semanal de toda la Clínica y permite vista diaria. El filtro de Médico es compartido por ambas vistas.
- La representación principal es una cuadrícula temporal con días como columnas y Citas y Bloqueos posicionados por su período ocupado. La precisión de creación es de cinco minutos; las marcas de tiempo visibles pueden espaciarse más para legibilidad.
- El panel lateral de detalle muestra Cita o Bloqueo seleccionado, eventos y acciones disponibles. La vista accesible alternativa ofrece la misma información en una lista semántica.
- Nueva Cita se abre desde un botón visible o desde un espacio vacío. Si existe una selección temporal, prellena Médico, fecha y hora, pero la Agenda vuelve a validar capacidad al confirmar.
- Nueva Cita integra el flujo Paciente primero, permite reutilizar un Contacto por teléfono y permite seleccionar explícitamente el Contacto para una confirmación inicial.
- Crear Bloqueo está disponible como acción contextual para roles autorizados y también desde Configuración → Disponibilidad. Ambas entradas usan las mismas reglas de conflicto y reducción de capacidad.
- El Calendario muestra solo Citas activas. Citas canceladas permanecen en Pacientes y sus eventos.

### Pacientes

- La lista principal es de Pacientes; Contactos se consulta dentro de la ficha y mediante búsqueda o vista secundaria, sin convertirlo en la unidad primaria de navegación.
- Crear Paciente registra en una operación atómica el Paciente, un Contacto inicial nuevo o reutilizado y el Vínculo. Si el teléfono existe, se ofrece reutilizar el Contacto antes de crear otro.
- Una Ficha de Paciente incompleta solo se crea mediante una acción secundaria explícita. No puede usarse para una Cita manual hasta tener un Contacto vinculado.
- La ficha administrativa incluye nombre, fecha de nacimiento, Contactos, Vínculos, Tutores, tutelas pendientes, Citas y eventos. Excluye motivo de consulta, notas clínicas y conversaciones completas.
- El primer Contacto no se convierte en Contacto principal de dominio. Las notificaciones de Cita continúan usando selección explícita del destinatario.
- Los Contactos adicionales, Tutores y vínculos se gestionan desde la ficha, conservando la cardinalidad existente y las reglas de verificación de tutela.

### Pendientes

- La vista inicial muestra todos los casos abiertos, ordenados por prioridad registrada y después por antigüedad.
- Los filtros distinguen Escalamientos de conversaciones, Escalamientos relacionados con Citas y Entregas transaccionales fallidas. Los contadores se calculan dentro del contexto de Clínica y rol.
- El detalle maestro-detalle conserva la lista y expone la información necesaria para resolver. Los casos resueltos quedan en historial separado.
- La interfaz comparte la affordance de resolución, pero usa acciones específicas: cerrar Escalamiento, resolver escalamiento de Cita o marcar resuelta una Alerta de Entrega.
- Ninguna acción elimina el registro ni descarta silenciosamente intentos, eventos o auditoría.

### Configuración inicial y preparación

- La Configuración inicial tiene cinco pasos guardables y reanudables: Datos básicos de la Clínica; Equipo y perfiles de Médicos; Servicios y Ofertas de servicio; Horarios y Disponibilidad; Revisión de capacidad.
- El Médico propietario coordina el recorrido, puede ver progreso general e invita o supervisa Médicos. Cada Médico completa su propio perfil dentro de su alcance. La Secretaria no administra la Configuración inicial.
- Una Clínica está lista para Asclepio cuando la Agenda calcula al menos una ruta válida formada por un Médico con perfil completo y elegible, un Servicio con Oferta activa para ese Médico y un Horario vigente que produce una Opción de atención futura.
- La revisión final muestra requisitos, bloqueos, la ruta válida y la configuración parcial restante. El propietario debe confirmar explícitamente “Declarar lista para Asclepio”.
- La preparación no se representa como un checkbox permanente. Las mutaciones que reducen capacidad disparan una reevaluación. Si no queda una ruta válida, la Clínica pasa a configuración pendiente y Asclepio deja de ofrecer nuevas Opciones de atención; las Citas existentes se conservan.
- La transición a configuración pendiente debe generar una indicación accionable y, cuando corresponda, una auditoría. Restaurar una ruta vuelve a habilitar la elegibilidad de capacidad, pero la confirmación explícita sigue siendo el punto de control de la automatización.
- La Activación de clínica de WhatsApp, WABA, sender, plantillas, base legal y revisión externa quedan fuera de este wizard y no se simulan como un simple paso visual.

### Acceso, estados y tooling

- El aviso de Sesión de soporte muestra motivo, vencimiento y accesos auditados mientras la sesión está vigente.
- La Comprobación clínica sintética sale de la experiencia de producto y permanece solo para pruebas técnicas protegidas.
- Se diferencian loading, vacío y error en cada destino. Los errores importantes son inline y ofrecen reintento cuando sea seguro.
- Las acciones de reducción de capacidad, cancelación y declaración de lista explican el impacto y requieren confirmación cuando corresponda.
- Las mutaciones conservan `FormData`, validación existente y contratos tRPC salvo los nuevos contratos de preparación y agregación de Pendientes.
- No se agrega React Hook Form, un nuevo gestor global de estado ni una migración completa de ORM. Los cambios de persistencia se limitan a estado o auditoría de preparación que no pueda derivarse de forma segura.

## Testing Decisions

- Las pruebas validan comportamiento observable, autorización y efectos de dominio. No fijan markup presentacional de cada primitive ni clases Tailwind.
- La preparación de Clínica tendrá pruebas de aplicación para pasos incompletos, una primera ruta válida, ausencia de ruta, confirmación del propietario, rechazo de otros roles y reevaluación tras cambios de capacidad.
- Pacientes tendrá pruebas para el alta Paciente primero, creación atómica, reutilización de Contacto por teléfono, Ficha de Paciente incompleta, múltiples Vínculos, Tutor y selección explícita de destinatario.
- Pendientes tendrá pruebas para agregación por categoría, orden, conteos, alcance por Clínica, resolución específica e historial sin eliminación.
- Calendario conservará y ampliará las pruebas existentes de vista temporal, filtro de Médico, creación desde selección, fuera de Horario, Bloqueos, cancelación y detalle de eventos.
- Las pruebas de rol y RLS usarán la cobertura existente de `clinic-access`, registros administrativos, Catálogo, Disponibilidad y Citas como precedente. Se verificará tanto la ausencia del destino en navegación como el rechazo del servidor.
- Playwright cubrirá login con OTP, shell, navegación por rutas, drawer responsive, teclado, foco, aviso de soporte, wizard y una primera ruta operativa con fixtures sintéticos.
- axe-core se ejecutará sobre login, shell, Calendario, Pacientes, Pendientes, Configuración y dialogs o drawers activos. La revisión manual cubrirá foco, orden de tabulación, cuadrícula accesible, contraste y reduced motion.
- Cada ola de implementación deberá pasar `npm run check`, las pruebas de aplicación pertinentes y los flujos Playwright del alcance antes de iniciar la siguiente.

## Out of Scope

- Rework de la consola `/apolo`, pagos, suscripciones o soporte interno como producto independiente.
- Selector de múltiples Clínicas dentro de una Sesión de clínica.
- Expediente clínico, notas clínicas, motivo de consulta o apoyo a decisiones clínicas.
- Campañas, seguimiento comercial o conversaciones completas de WhatsApp dentro de la ficha de Paciente.
- Activación real de Twilio, WABA, sender, plantillas, base legal o aprobaciones externas.
- Cambiar la Agenda como autoridad, las reglas de disponibilidad, la política de RLS, la autenticación Better Auth, la retención de auditoría o las integraciones intercambiables.
- Crear una entidad de dominio Pendiente o fusionar Escalamientos con Entregas transaccionales.
- Hacer que Contacto y Paciente sean la misma entidad o eliminar el Vínculo explícito.
- Exigir que todos los Médicos invitados estén configurados antes de habilitar una primera ruta válida.
- Mostrar la Comprobación clínica sintética en el panel de producción.
- Convertir el wizard en un bloqueo absoluto que impida entrar a Panacea.
- Rediseñar la identidad visual aprobada, cambiar la tipografía o introducir una segunda biblioteca de componentes.
- Tiempo real, colaboración multiusuario o sincronización live como requisito del shell.

## Further Notes

- La implementación debe avanzar en rebanadas verticales: shell y rutas; Calendario; Pacientes; Pendientes; Configuración; wizard y preparación; QA final.
- La migración puede convivir temporalmente por ruta, pero no debe dejar la ruta activa con el shell nuevo y la página monolítica antigua mezclados en la misma superficie.
- La primera demostración útil debe permitir iniciar sesión, abrir Calendario, crear una Cita desde un espacio, abrir la ficha del Paciente y volver a Pendientes sin perder contexto.
- La segunda demostración debe mostrar al propietario completando una primera ruta válida y declarando la Clínica lista para Asclepio; al retirar la última ruta, debe aparecer configuración pendiente sin cancelar Citas.
- La especificación respeta los términos de `CONTEXT.md`: Clínica, Usuario de clínica, Médico, Médico propietario, Médico no propietario, Secretaria, Contacto, Paciente, Vínculo Contacto-Paciente, Cita, Agenda, Oferta de servicio, Horario vigente, Bloqueo, Escalamiento y Activación de clínica.
