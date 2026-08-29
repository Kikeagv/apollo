# Investigación comparativa de componentes para Panacea

**Fecha de corte:** 26 de agosto de 2026  
**Estado:** insumo de diseño para el rework de Panacea  
**Fuentes:** páginas públicas, documentación, demos y repositorios oficiales de Beautiful UI, beUI, Rare UI, Transitions.dev y shadcn/ui.

## Resumen ejecutivo

La mejor dirección para Panacea no es escoger una de estas páginas como tema
visual completo. Las cinco referencias resuelven problemas distintos:

| Referencia | Papel recomendado en Panacea | Decisión |
| --- | --- | --- |
| [shadcn/ui](https://ui.shadcn.com/) | Sistema base de componentes, tokens y composición | Adoptar como fundamento |
| [beUI](https://beui.dev/) | Patrones de sidebar, drawer, command palette y motion controlado | Adaptar selectivamente |
| [Transitions.dev](https://transitions.dev/) | Biblioteca de recetas para estados y transiciones | Usar como guía de motion |
| [Beautiful UI](https://www.beautifului.dev/) | Estados de actividad, tareas y automatización | Llevar sólo a Pendientes y soporte |
| [Rare UI](https://www.rareui.com/) | Inspiración para una o dos interacciones especiales | No usar como lenguaje base |

La recomendación para Panacea es mantener la decisión existente de una interfaz
clara, operativa y accesible —superficies blancas y `slate`, `#06459f` como
`primary`, Geist, radios moderados y movimiento funcional— y construir encima
de un shell basado en `SidebarProvider`, `Sidebar`, `SidebarInset` y
`SidebarTrigger` de shadcn/ui. La barra lateral debe conservar etiquetas visibles
cuando está expandida; la rail de iconos es una optimización opcional de espacio,
no el único modo de entender la navegación.

El resultado debe sentirse como una herramienta diaria para una Clínica, no como
un catálogo de demos. Las partes más expresivas de las referencias se deben
reservar para comunicar estado, progreso, éxito, error o una acción reversible.

## Alcance y método

Se inspeccionaron las páginas en vivo, sus páginas de componentes, las
interacciones demostradas, el comportamiento responsive visible y, cuando
existía, el repositorio oficial. También se revisaron los ejemplos de código y
la documentación de accesibilidad expuesta por las propias fuentes.

Esta investigación no es una auditoría de rendimiento, seguridad ni de la
calidad interna de cada librería. Las cantidades de componentes, tokens y
dependencias pueden cambiar. Las observaciones visuales y de catálogo son una
fotografía del **26 de agosto de 2026**. Las recomendaciones para Panacea son
inferencias de diseño basadas en esas observaciones y en el alcance ya definido
para el producto.

## Comparación rápida

| Dimensión | Beautiful UI | beUI | Rare UI | Transitions.dev | shadcn/ui |
| --- | --- | --- | --- | --- | --- |
| Enfoque | Interfaces de IA y actividad de agentes | Componentes React animados | Componentes singulares y expresivos | Recetas de motion | Fundamento de design systems |
| Navegación | Rail lateral de catálogo | Sidebar composable y rail | Sidebars reactivas a interacción | Navegación de catálogo | Sidebar responsive y composable |
| Datos operativos | Task rows, tablas y tarjetas de contexto | Bloques y controles | Pocos patrones de operación | No es su objetivo principal | Data table, form, calendar, empty states |
| Formularios | Aprobación humana y prompt bar | Inputs y bloques | OTP, picker y controles especiales | Feedback de interacción | Field, input, select, dialog, questionnaire |
| Motion | Parte del estado de IA | Parte central de la librería | Muy expresivo | Producto principal | Prudente y configurable |
| Accesibilidad visible | Estados y controles de interacción | Reduced motion y semántica de diálogo en ejemplos | Reduced motion en ejemplos | Reduced motion como regla de las recetas | Semántica, teclado y tokens documentados |
| Riesgo al copiarla completa | Demasiado orientada a IA | Demasiado oscura/experimental | Demasiado ornamental | Motion sin sistema de producto | Bajo, si se define un sistema propio |

## 1. Beautiful UI

### Qué producto está resolviendo

[Beautiful UI](https://www.beautifului.dev/) se presenta como una colección de
componentes para interfaces “AI-native”. Su catálogo no empieza por un dashboard
genérico: empieza por lo que un agente está haciendo y por cómo una persona
puede observar, aprobar o corregir esa actividad.

### Patrones observados

La página de inicio usa una navegación lateral persistente con enlaces a cada
familia de componentes. Cada sección combina una demo viva, una descripción
breve y acciones para consultar o copiar el código. El catálogo incluye, entre
otros:

- `Loading State`, `Thinking`, `Streaming Text` y `Tool Chips` para actividad en
  progreso.
- `Approval Card` para decisiones human-in-the-loop.
- `Task Rows` para tareas en estado `running`, `failed` o `completed`.
- `Chat` y `Prompt Bar` con selector de modelo, fuentes, comandos y dictado.
- `Recommendation Card` con confianza y alternativas.
- `Context Cards` para fragmentos recuperados y sus fuentes.
- `Diff Table`, `Records Table` y `Filter Table` para trabajo estructurado.
- `Sidebar Nav`, `Search`, `Insight Cards`, `Code Block` y `Selection Actions`.

La composición es deliberadamente de showcase: mucho espacio vacío, demos
grandes y bordes sutiles. El sitio ofrece modo claro y oscuro, pero su apariencia
inicial es oscura y está orientada a mostrar estados de IA con contraste.

### Qué sí llevar a Panacea

El valor transferible no es el color ni el layout completo, sino el modelo de
estado:

1. Una fila pendiente debe comunicar claramente si está abierta, en proceso,
   falló o fue resuelta.
2. Una acción que necesita intervención humana debe explicar qué ocurrió, qué se
   espera de la persona y qué cambia al aprobar.
3. Un estado de carga debe explicar actividad y no bloquear silenciosamente la
   superficie.
4. Los estados de WhatsApp, entregas y escalamiento pueden usar una jerarquía
   parecida a `Task Rows`, `Tool Chips` y `Context Cards`, siempre con lenguaje
   propio del dominio.
5. `Selection Actions` puede inspirar acciones masivas en Pendientes, pero sólo
   después de definir permisos y confirmaciones.

### Qué no llevar

No conviene convertir toda la app en una conversación con un agente ni utilizar
un loader llamativo como sustituto de información operativa. El Calendario y la
ficha administrativa del Paciente necesitan densidad, lectura rápida y
predictibilidad, no una estética de “thinking trace”.

### Licencia y fuente

La [licencia publicada por Beautiful UI](https://www.beautifului.dev/license) es
MIT e incluye permiso para usar, copiar, modificar, publicar, distribuir y
vender, conservando el aviso de copyright. Aun con MIT, la integración debe
revisar dependencias y conservar atribuciones exigidas por dependencias de
terceros.

## 2. beUI

### Qué producto está resolviendo

[beUI](https://beui.dev/) es una librería de componentes React/Next.js de
copy-paste, construida con Motion y Tailwind. En la fecha de corte declara 110
componentes, Tailwind 4 y React 19. Su propuesta es que el componente viva
dentro de la aplicación del equipo, no detrás de un paquete opaco.

La [documentación del catálogo](https://beui.dev/components/motion) organiza
componentes de motion, bloques y agentes. El [repositorio oficial](https://github.com/starc007/ui-components)
explica que cada componente incluye preview, uso, fuente y una instalación
compatible con el registro de shadcn.

### Patrones especialmente relevantes

#### Sidebar composable

La demo de [Animated Sidebar](https://beui.dev/components/motion/animated-sidebar)
separa la composición de la navegación de los datos de la aplicación. Su modelo
incluye:

- un proveedor para estado controlado o no controlado;
- header, content, grupos, menú, footer y rail como piezas combinables;
- colapso de navegación completa a rail de iconos en escritorio;
- presentación como sheet gestionada en móvil;
- soporte para destinos anidados, badges, estado activo y cierre al seleccionar.

Este es un buen modelo mental para `PanaceaShell`: el shell decide el layout y
el estado de navegación; cada ruta conserva la responsabilidad de sus datos y
acciones.

#### Drawer lateral

El [Drawer de beUI](https://beui.dev/components/motion/drawer) documenta un
panel izquierdo o derecho con backdrop, cierre con `Escape`, bloqueo del scroll
del body, `aria-modal`, etiqueta accesible y una variante para
`prefers-reduced-motion`. El código publicado utiliza `AnimatePresence` y una
compuerta de presencia para controlar el estado durante la salida.

Esto encaja con el patrón maestro-detalle de Calendario, Pacientes y Pendientes:
la persona puede abrir el detalle sin perder la lista o la cuadrícula.

#### Command palette

La [Command Palette de beUI](https://beui.dev/components/blocks/command-palette)
usa `Cmd/Ctrl + K`, filtro difuso, fila activa animada, superficie de diálogo y
props para estado controlado. Puede ser una mejora posterior para buscar
Pacientes, abrir destinos o ejecutar acciones frecuentes.

### Qué sí llevar a Panacea

- La separación entre shell de navegación y contenido de ruta.
- El modelo responsive: sidebar completa en desktop, rail opcional y drawer en
  teléfono.
- El control explícito de `open`/`onOpenChange`, para que el estado sea testeable.
- Motion con propósito: revelar, seleccionar, confirmar y cerrar.
- La idea de que los componentes se puedan adaptar localmente al dominio y a
  las reglas de permisos.

### Qué revisar antes de reutilizar código

La documentación demuestra semántica de diálogo, `Escape`, scroll lock e
`inert`, pero no basta para asumir que todos los casos de focus trap y retorno
de foco cumplen el nivel de accesibilidad requerido por Panacea. Cada drawer y
sheet debe probarse con teclado, lector de pantalla, cierre por backdrop,
reapertura y salida con motion reducido.

Tampoco se debe importar el tono visual oscuro de beUI. El valor está en la
composición y el comportamiento, no en sus tokens de marketing.

### Licencia y fuente

El [repositorio oficial de beUI](https://github.com/starc007/ui-components) y su
[archivo de licencia](https://github.com/starc007/ui-components/blob/main/LICENSE)
publican licencia MIT. Deben revisarse por separado las licencias de cualquier
dependencia que se copie junto con un componente.

## 3. Rare UI

### Qué producto está resolviendo

[Rare UI Components](https://www.rareui.com/components) se enfoca en
componentes singulares, visualmente memorables y animados. En la fecha de corte
mostraba más de 14 componentes en familias de Display, AI kit, Navigation,
Inputs y Feedback. Cada componente se instala como fuente en el proyecto por
medio del CLI de shadcn.

Su homepage utiliza fondo negro, marco redondeado, tipografía grande y acentos
naranjas. Es una dirección útil para estudiar contraste, demostración y
personalidad, pero no corresponde copiarla como base de una herramienta clínica
operativa.

### Patrones relevantes

#### Duration Picker

El [Duration Picker](https://www.rareui.com/components/durationpicker) permite
editar horas y minutos por separado, confirmar el valor y volver a una pastilla
compacta. Su interacción tiene un ciclo claro:

1. vista resumida;
2. entrada explícita a edición;
3. validación y límites;
4. confirmación;
5. retorno a la vista compacta.

También documenta props controladas/no controladas, `onChange`, `onConfirm`,
`onEditingChange`, límites máximos, estados `disabled` y hooks mediante
`data-slot`, `data-editing` y `data-disabled`.

Para Panacea puede inspirar la edición de duración y buffer de una Oferta de
servicio. No conviene copiar el efecto gooey ni el shake como respuesta primaria
en formularios críticos; la validación debe ser textual, persistente y no
depender de movimiento.

#### Proximity Sidebar

La [Proximity Sidebar](https://www.rareui.com/components/proximitysidebar) es
una minimapa secundaria que responde a scroll y proximidad del puntero. Usa
marcas con jerarquía, `aria-label`, botones navegables, actualización de hash y
una alternativa sin scroll suave cuando se prefiere reducir motion.

Este patrón puede servir para un índice secundario dentro de Configuración o
para “en esta página”, pero no para la navegación principal de Panacea: los
destinos principales deben tener texto visible y estado activo inequívoco.

### Qué sí llevar

- Edición resumida que se expande sólo cuando hace falta.
- Estados de edición y confirmación explícitos.
- Controles que exponen hooks semánticos para personalización.
- Una dosis pequeña de personalidad en superficies de onboarding, no en la
  agenda diaria.

### Qué evitar

Gooey, 3D tilt, efectos de gravedad, partículas y transformaciones que muevan
demasiado el contenido no son adecuados para una agenda de alta frecuencia. En
Panacea la atención debe ir a Paciente, Servicio, hora, Médico, estado y acción.

### Licencia y atribución

El [repositorio oficial de Rare UI](https://github.com/swamimalode07/rare-ui)
publica el proyecto como MIT y señala que los componentes se instalan en el
código de la aplicación. La página del Duration Picker indica uso personal y
comercial gratuito, recomienda atribución y pide no revender el kit como propio.
La misma documentación reconoce que algunos componentes se inspiran o recrean
trabajos externos. Antes de copiar una pieza concreta se debe revisar su crédito
y sus dependencias; la atribución recomendada se conservará cuando corresponda.

## 4. Transitions.dev

### Qué producto está resolviendo

[Transitions.dev](https://transitions.dev/) es un catálogo de transiciones
interactivas listas para copiar. Su valor no está en sus componentes de negocio,
sino en describir el cambio entre estados: abrir/cerrar, revelar, confirmar,
filtrar, cargar, reordenar o hacer feedback de error.

El catálogo incluye recetas como `Panel reveal`, `Page side-by-side`, `Menu
dropdown`, `Tabs sliding`, `Notification badge`, `Error state shake`, `Success
check`, `Skeleton loader/reveal`, `Spinner to check`, `Accordion`, `Toast`,
`Toggle`, `Thinking states` y `Streaming text`.

### Patrones que sirven para Panacea

| Necesidad de Panacea | Receta que puede inspirar | Aplicación |
| --- | --- | --- |
| Abrir detalle sin perder contexto | `Panel reveal` | Revelar el panel de Cita, Paciente o Pendiente |
| Cambiar entre semana y día | `Tabs sliding` | Indicador activo corto y desplazamiento discreto |
| Abrir navegación o menú de cuenta | `Menu dropdown` | Entrada/salida con transform y opacity leve |
| Guardar configuración | `Spinner to check` / `Success check` | Confirmar que el guardado terminó |
| Validar un campo | `Error state shake` | Sólo como apoyo; siempre acompañar con mensaje |
| Cargar agenda o tabla | `Skeleton loader/reveal` | Reservar layout y evitar saltos |
| Contador de pendientes | `Notification badge` | Hacer visible trabajo abierto sin depender sólo del color |
| Cambiar de ruta | `Page side-by-side` | Transición muy corta y opcional |

### Aporte técnico y accesible

El [repositorio oficial](https://github.com/Jakubantalik/transitions.dev) describe
CSS portable, variables semánticas, clases con namespace `t-*` y guardas de
`prefers-reduced-motion`. La [página de Skill](https://transitions.dev/skill.html)
también propone comandos para revelar, revisar, aplicar y refinar transiciones.

Hay una diferencia de versionado que conviene dejar explícita: la web anuncia
27+ transiciones, mientras el README del repositorio resume un conjunto más
pequeño y menciona archivos de referencia distintos. No se debe fijar un número
de componentes en la especificación de Panacea; se deben seleccionar recetas
por necesidad y validarlas en la versión que finalmente se use.

No se identificó una licencia explícita en el repositorio oficial durante esta
revisión. Por eso se puede usar como referencia de comportamiento, pero cualquier
copiado directo de CSS o código debe pasar primero por revisión de licencia y
atribución. Esta observación no constituye asesoría legal.

### Qué evitar

No agregar motion porque exista una receta para él. En una clínica, el motion
debe explicar causa y efecto, mantener contexto y desaparecer cuando el usuario
prefiere reducirlo. Las recetas de 3D, tilt, disolución smoky o efectos de
marketing no son candidatas para el flujo operativo.

## 5. shadcn/ui

### Qué producto está resolviendo

[shadcn/ui](https://ui.shadcn.com/) se posiciona como la base para construir un
design system: código abierto, código propio y componentes que se pueden
personalizar. Su catálogo incluye primitives para `Calendar`, `Data Table`,
`Dialog`, `Drawer`, `Sheet`, `Sidebar`, `Field`, `Form`, `Command`, `Tabs`,
`Progress`, `Skeleton`, `Toast`, `Alert`, `Badge`, `Empty`, `Table` y muchos
otros estados de una aplicación operacional.

### Sidebar como base del shell

La documentación de [Sidebar](https://ui.shadcn.com/docs/components/base/sidebar)
define una composición que encaja directamente con Panacea:

`SidebarProvider` → `Sidebar` (`Header`, `Content`, `Group`, `Menu`, `Item`,
`Button`, `Action`, `Badge`, `Sub`) → `Footer`/`Rail`, junto con
`SidebarInset` y `SidebarTrigger`.

También documenta:

- modos `offcanvas`, `icon` y `none`;
- variantes `sidebar`, `floating` e `inset`;
- estado controlado con `open` y `onOpenChange`;
- atajo `Cmd/Ctrl + B`;
- presentación como Sheet en móvil;
- badges, skeletons, submenús y estado activo;
- header/footer sticky y contenido con scroll;
- variables CSS para ancho desktop y mobile.

La recomendación es usar esta composición como contrato de `PanaceaShell` y
adaptar los estilos al sistema visual existente. No hace falta inventar una
segunda arquitectura de navegación.

### Tokens semánticos y theming

La guía de [Theming](https://ui.shadcn.com/docs/theming) organiza colores por
roles semánticos: `background`, `foreground`, `card`, `popover`, `primary`,
`secondary`, `muted`, `accent`, `destructive`, `border` e `input`. Los
componentes consumen esos roles en lugar de acoplarse a un color de marca
específico.

Para Panacea esto permite conservar `#06459f` como `primary` y definir estados
de éxito, advertencia, error y selección sin pintar cada componente a mano. El
modo claro puede ser el único modo de producto, aunque la estructura de tokens
quede preparada para estados de contraste y pruebas.

### Data table y lista de Pacientes

La guía de [Data Table](https://ui.shadcn.com/docs/components/base/data-table)
demuestra filtro, visibilidad de columnas, selección de filas, ordenamiento,
acciones por fila y paginación. También advierte que una tabla universal suele
perder flexibilidad y recomienda una capa headless como TanStack Table para
comportamiento más complejo.

La lección para Pacientes es separar:

- columnas y definición de datos;
- comportamiento de filtrado, selección y ordenamiento;
- presentación de la tabla o lista responsive;
- panel de detalle del Paciente.

La tabla no debe forzar que Contacto sea la entidad primaria. El modelo de
interfaz seguirá siendo Paciente primero, con su Contacto inicial y vínculos
adicionales dentro de la ficha.

### Calendar y agenda

La [Calendar de shadcn](https://ui.shadcn.com/docs/components/base/calendar)
aporta navegación accesible de mes, `grid`, `gridcell`, `combobox` de mes/año,
estado de mes actual y etiquetas de seleccionado/hoy. Es adecuada para el
selector de fecha y filtros.

No debe sustituir la cuadrícula temporal semanal/diaria de Panacea. La agenda
necesita una superficie propia para Citas y Bloqueos, con una alternativa de
lista accesible para teclado y tecnologías asistivas.

### Blocks como referencia de composición

Los [Blocks de shadcn](https://ui.shadcn.com/blocks) muestran cómo combinar
sidebar, métricas, charts, tabs, tablas, selección de filas y acciones en una
aplicación completa. Son útiles para estudiar jerarquía y composición, pero no
se deben copiar como dashboard genérico: Panacea tiene Calendario como entrada,
no una portada de métricas.

## 6. Decisiones de diseño derivadas para Panacea

### 6.1 Sistema primero, animación después

El orden correcto es:

1. tokens semánticos y estados;
2. shell y rutas;
3. composición de cada superficie;
4. keyboard/focus/responsive;
5. motion como capa que explica cambios;
6. pulido visual.

Un componente animado que no tiene claro su estado final sólo hace más difícil
diagnosticar una interfaz confusa.

### 6.2 Navegación visible y reversible

La navegación principal debe mostrar texto: Calendario, Pacientes, Pendientes y
Configuración. Puede colapsarse a rail en escritorio y abrirse como drawer en
móvil. El estado activo debe ser visible por texto, fondo/borde y
`aria-current`; el color por sí solo no es suficiente.

La rail de iconos de BeUI y shadcn sirve para ganar espacio, pero no debe
convertirse en la única navegación persistente ni ocultar el destino al pasar el
puntero.

### 6.3 El contexto debe sobrevivir al detalle

Calendario, Pacientes y Pendientes deben compartir el patrón maestro-detalle:

- la superficie principal mantiene lista o cuadrícula;
- el detalle se revela en panel lateral en desktop;
- en teléfono se presenta como drawer o pantalla completa;
- la URL y el historial permiten abrir, recargar, compartir y volver atrás;
- cerrar el detalle devuelve exactamente al contexto anterior.

Esto combina el modelo de Sidebar/Drawer de shadcn y beUI con la receta de
`Panel reveal` de Transitions.dev, pero con una jerarquía visual propia.

### 6.4 Estados que explican trabajo

Pendientes debe tomar de Beautiful UI la claridad de `Task Rows`, no su estética
de agente. Cada caso debe responder rápidamente: qué está pendiente, desde
cuándo, qué prioridad tiene, quién puede actuar, qué acción resuelve y qué
ocurre después.

Los badges y colores deben tener texto, icono o estado explícito. Una entrega
fallida no puede distinguirse sólo por rojo; un escalamiento no puede parecer un
simple contador de notificaciones.

### 6.5 Paciente primero

El flujo de alta y la lista deben partir de Paciente. Contacto se crea como parte
del mismo flujo o se reutiliza si el teléfono ya existe; los Vínculos adicionales
se administran dentro de la ficha. Los patrones de `Records Table` de Beautiful
UI y `Data Table` de shadcn ayudan con la estructura, pero no deben reintroducir
la separación conceptual que el rework decidió eliminar.

### 6.6 Motion funcional y sobrio

El motion debe comunicar una relación causal:

| Evento | Movimiento propuesto | Regla |
| --- | --- | --- |
| Abrir detalle | Slide/fade corto desde el borde | No desplazar la lista más de lo necesario |
| Cambiar vista o subsección | Indicador activo y transición breve | Mantener posición de lectura |
| Guardar | Estado de progreso y check | El check no reemplaza mensaje de resultado |
| Error de campo | Focus + mensaje + shake muy leve opcional | Nunca depender sólo del shake |
| Cargar lista | Skeleton estable | Evitar saltos de layout |
| Actualizar contador | Badge pop-in discreto | Respetar reduced motion |
| Abrir/cerrar sidebar | Width/transform controlado | No animar cada elemento a destiempo |

Como regla de producto, no usar tilt, partículas, 3D, blur intenso, glow
permanente ni cambios de layout impredecibles en Calendario, Pacientes,
Pendientes o formularios de configuración.

## 7. Mapeo concreto de referencias a superficies

| Superficie | Base recomendada | Inspiración | Implementación de Panacea |
| --- | --- | --- | --- |
| Shell | shadcn Sidebar | BeUI Animated Sidebar | Sidebar visible, rail opcional, drawer en móvil, contexto de Clínica y rol |
| Cuenta/soporte | shadcn Dropdown/Sheet | BeUI Drawer | Menú de sesión y aviso persistente sin invadir el contenido |
| Calendario | shadcn Calendar + componentes propios | Transitions Panel reveal/Page side-by-side | Cuadrícula de semana/día, panel de Cita y alternativa accesible de lista |
| Pacientes | shadcn Table/Data Table/Field | Beautiful UI Records Table | Lista orientada a Paciente, filtros, búsqueda y ficha lateral |
| Pendientes | shadcn Table/Badge/Empty/Alert | Beautiful UI Task Rows/Selection Actions | Bandeja unificada por prioridad, antigüedad y categoría |
| Alta de Paciente | shadcn Field/Dialog/Combobox | Rare Duration Picker como patrón de edición | Paciente + Contacto inicial en un flujo, reutilización de teléfono sin duplicar |
| Onboarding | shadcn Card/Field/Progress/Accordion | Rare edición por etapas y Transitions Card resize | Cinco pasos reanudables, validación por paso y revisión de capacidad |
| Servicios | shadcn Table/Sheet/Field | Rare Duration Picker | Duración, buffer y precio editables con vista resumida y confirmación |
| Disponibilidad | shadcn Field/Switch/Calendar | BeUI controls | Horarios legibles, excepciones y validación visible |
| Confirmaciones | shadcn Alert Dialog/Toast | Transitions Success check/Spinner to check | Confirmaciones explícitas para acciones irreversibles o de envío |
| Búsqueda futura | shadcn Command | BeUI Command Palette | Atajo `Cmd/Ctrl + K` sólo cuando la navegación y búsqueda básica estén maduras |

## 8. Contrato de accesibilidad

La investigación deja estas reglas como requisitos, no como mejoras futuras:

- sidebar con labels visibles, foco de teclado, estado activo semántico y
  destino equivalente en móvil;
- drawer con nombre accesible, `role="dialog"`/`aria-modal` cuando corresponda,
  cierre con `Escape`, bloqueo correcto del scroll, focus trap y retorno de foco;
- `prefers-reduced-motion` debe reducir o eliminar transforms, spring, scroll
  suave y secuencias decorativas;
- agenda con alternativa de lista/tabla y no sólo interacción por coordenadas
  de ratón;
- campos con label, descripción, error asociado y focus visible;
- estados de éxito, advertencia y error comunicados por texto y no sólo por
  color o movimiento;
- tablas con encabezados, selección anunciable, acciones de fila y paginación
  navegable;
- tooltips nunca deben ser el único lugar donde exista información necesaria;
- al abrir/cerrar un panel, el contexto y el historial deben ser predecibles.

## 9. Qué no copiar de las referencias

1. **El dark mode como identidad de producto.** BeUI, Rare UI y Transitions.dev
   usan fondos muy oscuros porque presentan catálogos y demos. Panacea ya tiene
   una decisión de modo claro y un contexto clínico-operativo.
2. **El hero de marketing con whitespace extremo.** Es efectivo para vender una
   librería, pero desperdicia espacio en una agenda diaria.
3. **La navegación icon-only como default.** Reduce descubribilidad y no sirve
   como contrato para usuarios con distintos niveles de familiaridad.
4. **El dashboard genérico de métricas.** Los blocks de shadcn son excelentes
   referencias de composición, pero Calendario debe abrir como superficie central
   de la operación.
5. **La expresividad como sustituto de jerarquía.** Gooey, 3D, tilt, partículas,
   blur y glow pueden distraer de Paciente, Servicio, horario y acción.
6. **La separación técnica de Contacto y Paciente en la interfaz.** El modelo de
   datos puede conservar entidades y Vínculos; la experiencia debe presentarlo
   como una sola alta orientada al Paciente.
7. **Copiar snippets sin revisar semántica, focus, licencias y dependencias.**
   Que una demo se vea correcta no demuestra que sea segura, accesible o
   mantenible dentro del dominio de Panacea.

## 10. Secuencia recomendada de implementación

### Fase 1 — Sistema y shell

- fijar tokens semánticos de Panacea;
- construir `PanaceaShell` sobre la composición de Sidebar de shadcn;
- incluir rutas, estado activo, permisos de visibilidad y contexto de Clínica;
- resolver desktop, rail opcional y drawer móvil;
- añadir pruebas de teclado, responsive y navegación directa por URL.

### Fase 2 — Calendario y maestro-detalle

- construir la cuadrícula semanal/diaria propia;
- usar Calendar de shadcn sólo para selector y navegación de fecha;
- crear detalle de Cita en panel lateral;
- añadir alta contextual de Paciente + Contacto inicial;
- validar la alternativa accesible de agenda.

### Fase 3 — Pacientes y Pendientes

- implementar lista de Pacientes con filtros y búsqueda;
- crear ficha administrativa orientada a Paciente;
- modelar la bandeja unificada de Pendientes con prioridad, antigüedad,
  categoría y acciones autorizadas;
- llevar los patrones de Records Table/Task Rows sólo como jerarquía de
  información.

### Fase 4 — Configuración y onboarding

- implementar los cinco pasos reanudables;
- usar Field, Card, Progress, Alert y Accordion como primitives;
- añadir revisión de capacidad y estado de Clínica lista;
- reutilizar patrones de edición resumida para duración, buffer, precio y
  horarios.

### Fase 5 — Motion y pulido

- aplicar sólo las recetas de Transitions.dev que explican un cambio real;
- incorporar éxito, error, skeleton y badge con reduced motion;
- revisar focus, lectura por screen reader y estabilidad del layout;
- medir fricción en tareas reales antes de introducir Command Palette u otros
  atajos.

## 11. Conclusión

La combinación más sólida es:

**shadcn/ui para el contrato estructural + BeUI para estudiar composición
responsive + Transitions.dev para recetas de cambio de estado + Beautiful UI
para estados de trabajo pendiente + Rare UI sólo para interacciones puntuales.**

Con esto Panacea puede tener una interfaz pulida y moderna sin perder el carácter
de herramienta clínica: navegación lateral clara, Paciente como centro, detalle
sin perder contexto, onboarding progresivo y motion que ayuda a entender lo que
ocurrió.

## Inventario de fuentes oficiales

- [Beautiful UI — catálogo](https://www.beautifului.dev/)
- [Beautiful UI — licencia](https://www.beautifului.dev/license)
- [beUI — catálogo de motion](https://beui.dev/components/motion)
- [beUI — Animated Sidebar](https://beui.dev/components/motion/animated-sidebar)
- [beUI — Drawer](https://beui.dev/components/motion/drawer)
- [beUI — Command Palette](https://beui.dev/components/blocks/command-palette)
- [beUI — repositorio](https://github.com/starc007/ui-components)
- [Rare UI — catálogo](https://www.rareui.com/components)
- [Rare UI — Duration Picker](https://www.rareui.com/components/durationpicker)
- [Rare UI — Proximity Sidebar](https://www.rareui.com/components/proximitysidebar)
- [Rare UI — repositorio](https://github.com/swamimalode07/rare-ui)
- [Transitions.dev — catálogo](https://transitions.dev/)
- [Transitions.dev — Skill](https://transitions.dev/skill.html)
- [Transitions.dev — repositorio](https://github.com/Jakubantalik/transitions.dev)
- [shadcn/ui — inicio](https://ui.shadcn.com/)
- [shadcn/ui — componentes](https://ui.shadcn.com/docs/components)
- [shadcn/ui — Sidebar](https://ui.shadcn.com/docs/components/base/sidebar)
- [shadcn/ui — Calendar](https://ui.shadcn.com/docs/components/base/calendar)
- [shadcn/ui — Data Table](https://ui.shadcn.com/docs/components/base/data-table)
- [shadcn/ui — Theming](https://ui.shadcn.com/docs/theming)
- [shadcn/ui — Blocks](https://ui.shadcn.com/blocks)
