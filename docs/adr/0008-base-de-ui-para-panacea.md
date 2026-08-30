# Base de UI para Panacea

**Estado:** Aceptada
**Fecha:** 23 de agosto de 2026

Panacea adoptará shadcn/ui como base de componentes para preparar un rediseño
visual completo posterior. La adopción será incremental y se enfocará en
estandarizar controles, consistencia y accesibilidad; no se reescribirá toda la
UI de una vez.

La decisión aplica únicamente al panel React/Next de Panacea. La landing
pública seguirá siendo un sitio independiente en HTML y CSS.

La primera fase incluirá la configuración de la base, primitives compartidos y
la migración visual de todas las superficies React bajo `src/app`, además de
validación visual, de accesibilidad y E2E. La migración conservará la estructura
y los flujos actuales, sin introducir todavía un shell, Sidebar o nueva
arquitectura de información.

Los primitives de shadcn/ui usarán Base UI, la opción predeterminada actual de
shadcn/ui. Esto mantiene el proyecto alineado con la dirección oficial y evita
una divergencia deliberada; no implica migrar los controles existentes de forma
masiva.

La nueva base visual de Panacea será clara, con superficies blancas y el color
`#06459f` como color de marca. Esto forma parte de la primera fase y reemplaza
la idea inicial de conservar visualmente el tema oscuro actual.

`#06459f` ocupará el token `primary` para acciones principales, enlaces, foco y
estados seleccionados; no se tratará como un color decorativo aislado.

Panacea conservará Geist como tipografía de la aplicación durante esta fase.
La tipografía de la landing pública no se convierte en una dependencia del
panel.

La base usará el estilo Luma de shadcn/ui, con ajustes para el uso operativo:
superficies blancas, radios moderados, sombras discretas y densidad más
compacta en la Agenda y los registros. Los espacios más respirables de Luma se
reservarán para onboarding, estados vacíos y superficies de orientación.

La primera fase será únicamente de modo claro. Los tokens se mantendrán
semánticos para permitir un modo oscuro posterior sin acoplar los componentes a
colores concretos.

La primera fase no construirá todavía un shell completo con Sidebar o
navegación principal. Esa estructura se decidirá después de cerrar la
arquitectura de información de la Agenda, los registros, los escalamientos y
la configuración por rol.

Los formularios conservarán `FormData`, las mutaciones tRPC y la validación
existente. shadcn/ui aportará los controles y estados visuales, pero no se
introducirá React Hook Form ni otra capa de gestión de formularios en esta
fase.

Los campos reutilizables exigirán un `label` visible, descripción cuando sea
necesaria, error asociado y estados accesibles mediante `aria-invalid` y
`aria-describedby`. La accesibilidad del campo será parte de la base, no una
tarea posterior del rediseño.

Los errores y validaciones de mutaciones se mostrarán inline junto al formulario
y los éxitos relevantes permanecerán visibles en su sección. Los toasts se
reservarán para eventos secundarios y nunca serán el único aviso de un fallo
operativo importante.

Lucide será la biblioteca de iconos de Panacea. Los iconos acompañarán texto
visible o tendrán un nombre accesible cuando representen una acción.

La escala neutral base será `slate`, con fondo principal blanco (`#ffffff`),
superficies secundarias claras, bordes y texto derivados de la escala. El color
`#06459f` seguirá siendo el `primary` y no se sustituirá por un tono de
`slate`.

El radio base será `0.5rem` (8 px). Las superficies de onboarding, estados
vacíos o diálogos destacados podrán usar radios derivados mayores sin convertir
los controles operativos en elementos excesivamente redondeados.

Los primitives generados por shadcn/ui vivirán en `src/components/ui` y las
utilidades compartidas en `src/lib`. Los componentes de negocio de Panacea
permanecerán inicialmente junto a sus rutas en `src/app`; solo se extraerán
cuando tengan una responsabilidad de dominio clara y reutilizable.

Se conservará el alias existente `~/*`. `components.json` apuntará los aliases
de componentes, utilidades y hooks a sus rutas bajo `src`, sin introducir un
alias paralelo `@/*`.

Los componentes generados serán código propio versionado en el repositorio. El
CLI se usará de forma manual para generar o actualizar componentes, cada diff
se revisará y shadcn/ui no será una dependencia del runtime, de CI ni de
producción.

La accesibilidad será criterio de aceptación de la primera fase: se probarán
login y la sección administrativa de forma automatizada, además de verificar
navegación por teclado, foco visible, labels, diálogos y estados de error.

La primera rebanada tendrá revisión visual automatizada acotada a login y la
sección administrativa, incluyendo fondo, color `primary`, radios, estados
disabled/error y comportamiento responsive.

Panacea se diseñará desktop-first, con soporte correcto para tablet y
responsive básico en teléfono durante esta fase. La optimización móvil
completa queda para una etapa posterior del rediseño.

El soporte objetivo será para navegadores evergreen actuales: Chromium/Chrome
como baseline automatizado, Safari y Firefox como smoke checks, sin soporte
para Internet Explorer ni navegadores antiguos.

El movimiento será funcional y discreto: transiciones específicas de corta
duración, feedback estático además de cualquier animación y respeto de
`prefers-reduced-motion`. No se usarán animaciones ornamentales, infinitas ni
entradas repetidas en cada carga del panel.

Las superficies seguirán una jerarquía explícita: blanco como base, `slate-50`
para agrupaciones secundarias, bordes para estructura y sombras suaves solo
para elementos elevados como diálogos, popovers y superficies flotantes. No se
convertirá cada sección en una tarjeta.

La aplicación usará únicamente Geist como familia tipográfica. Los datos
numéricos dinámicos usarán numerales tabulares (`tabular-nums`); Geist Mono se
reservará para una futura superficie técnica si aparece una necesidad concreta.

La escala tipográfica base usará 16 px para texto normal, 14 px para controles
densos y mensajes de error, y 12 px únicamente para metadatos secundarios.

Los colores semánticos estarán permitidos únicamente para estados reales:
éxito, advertencia y error o acción destructiva. No se usarán como acentos
decorativos adicionales al azul de marca.

La paleta semántica seguirá las escalas de Tailwind `emerald` para éxito,
`amber` para advertencias y `rose` para errores o acciones destructivas, con
variantes coordinadas de texto, superficie, borde y foco.

Las acciones destructivas o irreversibles usarán `AlertDialog`, explicarán su
impacto antes de confirmar y ofrecerán una salida clara sin depender de un
toast. El botón destructivo usará la variante semántica `rose`.

Todos los controles interactivos conservarán un estado `focus-visible` claro,
con anillo basado en `#06459f` y contraste suficiente sobre superficies blancas
y `slate-50`. No se eliminará el outline sin un reemplazo equivalente.

La familia de botones se limitará a `primary`, `secondary` o `outline`, `ghost`,
`destructive` y `link`. No se crearán variantes específicas por pantalla sin
una necesidad de interacción documentada.

Los controles interactivos tendrán áreas mínimas de 40 px en desktop y 44 px en
contextos táctiles. Los botones podrán usar feedback de presión sutil, pero no
se usará movimiento como única señal de estado.

Las cargas cortas mostrarán estado contextual en el control, las consultas de
secciones usarán skeletons con la forma del contenido final y las acciones
largas mantendrán un mensaje inline persistente. No se usarán spinners aislados
ni reemplazos completos de pantalla durante una mutación.

Las secciones consultables diferenciarán explícitamente entre estado vacío y
error. Un error mostrará contexto, impacto y una acción de reintento cuando sea
seguro hacerlo; no se mostrará un mensaje genérico sin recuperación posible.

Los controles solo con icono se reservarán para acciones familiares y compactas,
con nombre accesible y tooltip cuando el significado no sea obvio. Los iconos
decorativos se ocultarán a tecnologías asistivas y las acciones operativas
críticas conservarán una etiqueta visible.

Panacea declarará español de El Salvador (`es-SV`) como idioma de la aplicación,
en coherencia con sus textos y usuarios objetivo. La internacionalización a
otros idiomas queda fuera de esta fase.

Las horas se mostrarán en formato de 12 horas con indicadores locales `a. m.` y
`p. m.`. Toda fecha y hora de la Agenda se interpretará en la zona horaria de la
Clínica, actualmente `America/El_Salvador`.

Las fechas se presentarán en español con formatos legibles para personas, por
ejemplo `4 de marzo de 2026` en detalle y `mié., 4 mar.` en encabezados
compactos. Los formatos numéricos ambiguos se reservarán para valores técnicos
no visibles.

La interfaz usará tratamiento formal y consistente para el personal de la
Clínica. No se mezclará el tratamiento de usted con tuteo ni con cambios
casuales de registro dentro de un mismo flujo.

La primera fase tendrá como mínimo conformidad WCAG 2.2 AA para contraste,
controles, foco y navegación por teclado. Se buscará AAA en texto principal
cuando no comprometa la jerarquía visual.

La apariencia se expresará mediante variables CSS semánticas (`cssVariables:
true`). Los componentes consumirán tokens como `background`, `foreground`,
`primary`, `border`, `ring`, `success`, `warning` y `destructive`; no
repetirán colores hexadecimales directamente.

La configuración conservará React Server Components (`rsc: true`). Las páginas
y composiciones seguirán server-first y los controles interactivos de shadcn/ui
se aislarán en Client Components sin convertir todo el layout o `page.tsx` en
cliente.

La primera rebanada de validación estará compuesta por el inicio de sesión y
`AdministrativeRecordsSection`, porque cubre controles, listas, estados de
carga, éxito, error y vacío dentro de un flujo real de Panacea. Después se
aplicará la misma base al resto de las rutas y secciones React existentes,
incluidas `/activar-invitacion` y `/apolo`.

Los selects de la primera rebanada usarán `NativeSelect` para conservar la
semántica, el teclado, el autofill y el manejo actual con `FormData`. Los
selects personalizados quedarán para casos que requieran búsqueda,
multiselección o comportamiento de menú más rico.

El inventario inicial de `src/components/ui` se limitará a `Button`, `Input`,
`Label`, `Field`, `NativeSelect`, `Card`, `Alert`, `Skeleton`, `Separator` y
`AlertDialog`, más la utilidad `cn`. Cada componente deberá tener un consumidor
real en la rebanada de validación, en otra superficie migrada o en la política
de interacción ya acordada.

Los campos de la primera rebanada usarán la composición oficial `Field` de
shadcn/ui para centralizar label, descripción, error y atributos ARIA. Las
extensiones propias solo se añadirán cuando exista una necesidad concreta.

La migración reemplazará primitives visuales sin eliminar la semántica HTML de
formularios, fieldsets, listas, tablas, secciones y encabezados. shadcn/ui no se
usará como una envoltura universal ni convertirá cada bloque en una tarjeta.

La migración se hará componente por componente, conservando la lógica y el
markup de cada superficie y permitiendo `className` contextual en los
primitives. No se hará un reemplazo mecánico global de clases.

La validación de la UI migrada se hará sobre flujos reales con Playwright,
incluyendo interacción, teclado, accesibilidad y regresión visual en el inicio
de sesión y la superficie administrativa. Vitest se reservará para utilidades y
lógica pura. No se crearán snapshots unitarios de cada primitive generado por
shadcn/ui, porque su markup presentacional sería una señal frágil.

La migración se desplegará en olas: primero la base de shadcn/ui y sus tokens;
después autenticación, recuperación y activación; luego las secciones
administrativas y formularios; finalmente `/apolo` y las superficies restantes.
Cada ola deberá conservar la funcionalidad existente y pasar su verificación
antes de iniciar la siguiente. La última etapa será el QA visual, de
accesibilidad y de regresión.

Las versiones de shadcn/ui y Base UI utilizadas por la migración quedarán
fijadas en el `package-lock`. El código generado se actualizará únicamente como
parte de un cambio explícito, revisado y verificado; no se permitirán
actualizaciones automáticas de primitives durante el trabajo.

La regresión visual inicial usará screenshots dirigidos y revisión humana de
criterios clave: jerarquía, tokens, espaciado, estados, foco, errores y
comportamiento responsive. No se exigirá todavía un umbral rígido por píxel,
porque fuentes, navegador y renderizado pueden producir diferencias menores.
Los umbrales automáticos podrán añadirse cuando la base visual esté estable.

Cada ola tendrá como puerta de salida el paso de `npm run check`, las pruebas
Playwright dirigidas de su alcance y la revisión visual y de accesibilidad
correspondiente. Una ola no se considerará terminada si solo compila, pero no
verifica sus flujos visibles.

El primer entregable incluirá únicamente la configuración de shadcn/ui, los
tokens, los primitives iniciales, el inicio de sesión y
`AdministrativeRecordsSection`. Se usará como piloto para validar Base UI,
Luma, colores, formularios, estados y el proceso de QA antes de extender la
migración.

Durante las olas se aceptará convivencia temporal por ruta. Las superficies aún
no migradas podrán conservar su apariencia actual, pero cada superficie
migrada deberá verse coherente de extremo a extremo, sin mezclar la base nueva
con estilos antiguos dentro de la misma ruta.

El inventario de primitives será progresivo. Solo se agregarán componentes de
shadcn/ui con un consumidor real en la ola activa o con una necesidad ya
identificada para una ola próxima; no se instalará el catálogo completo por
anticipado.

En las superficies migradas no se agregarán colores directos ni nuevas clases
de paleta. Estas superficies usarán tokens semánticos y variantes compartidas;
los estilos antiguos podrán permanecer únicamente en rutas pendientes de
migración.

La accesibilidad automatizada de las rutas piloto integrará `axe-core` con
Playwright para detectar problemas repetibles en labels, roles, contraste y
atributos ARIA. Esta verificación complementará, y no sustituirá, la revisión
manual de teclado, foco y flujo de diálogos.

Se conservarán los nombres, APIs y variantes oficiales de shadcn/ui. Los
wrappers propios solo se crearán cuando resuelvan una necesidad concreta del
dominio de Panacea; no se renombrarán ni envolverán los componentes por
preferencia estética.

Cada wrapper propio deberá incluir una justificación breve, identificar su
consumidor y explicar por qué el primitive oficial no es suficiente. Esta
excepción quedará documentada junto con el cambio que la introduce.

La lista inicial de primitives corresponde a la primera rebanada de validación
y no limita las olas posteriores. La rebanada APO-62 agrega `Avatar` para
identificar Médicos en Equipo y `Progress` para comunicar el estado de las
áreas de Configuración; ambos son primitives compartidos con consumidores
reales y conservan la semántica y accesibilidad de sus elementos nativos.

## Consecuencias

- Los componentes de UI serán código del repositorio y podrán adaptarse al
  lenguaje visual de Panacea.
- Se introducirán tokens semánticos y componentes compartidos antes del
  rediseño visual.
- La lógica de negocio, autenticación, tRPC y aislamiento por Clínica no cambia
  por esta decisión.
- Los primitives de shadcn/ui usarán Base UI y quedarán versionados como código
  propio del repositorio.
