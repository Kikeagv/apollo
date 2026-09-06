# Onboarding y propiedad de WhatsApp por Clínica

**Estado:** aceptado
**Fecha:** 2026-09-05

## Contexto

Praxia necesita conectar WhatsApp en varias clínicas sin compartir números,
WABA ni credenciales entre tenants. Todavía no existen clientes ni números
productivos en Twilio, por lo que el trabajo no es una migración de tráfico o
historial: es la definición del primer camino real de WhatsApp.

Kapso ofrece setup links y Embedded Signup sobre la aplicación Meta
predeterminada de Kapso. La clínica puede conservar su número y su aplicación
WhatsApp Business mediante `coexistence`, mientras Praxia conserva la lógica de
agenda y el agente. El modelo de billing disponible para este producto es
`partner_managed`, con créditos centralizados y atribución por Clínica.

## Decisión

- Cada Clínica tiene exactamente un número de WhatsApp y un WABA propios en
  esta fase. La Clínica es propietaria de sus activos Meta, número, plantillas,
  opt-ins y continuidad al salir de Praxia.
- La Clínica aporta una línea local que ya puede usar en la WhatsApp Business
  App. El onboarding se completa con `coexistence` y el QR de Meta; Praxia no
  compra números, no solicita OTP por el superadmin y no mueve el número a un
  proveedor anterior.
- Se usa la aplicación Meta predeterminada de Kapso. Praxia no crea todavía su
  propio Tech Provider, MPS ni aplicación Meta para clientes.
- Se usa `partner_managed`: el proyecto mantiene los créditos y concilia el
  consumo por Clínica, pero la interfaz debe separar y revelar las tarifas de
  Meta de las tarifas de plataforma de Kapso.
- El Médico propietario puede generar y completar el enlace desde la
  configuración de WhatsApp. El superadmin puede generar, revocar y regenerar
  el enlace durante el alta manual o desde la ficha de la Clínica. Ningún rol
  de Praxia recibe o almacena credenciales Meta, QR u OTP.
- Solo hay un enlace activo por customer de Kapso. Regenerar revoca el
  anterior; el enlace dura 30 días y se entrega por un canal autenticado.
- El evento de proyecto `whatsapp.phone_number.created` es la señal
  autoritativa para continuar el provisioning. La redirección de éxito solo
  mejora la UX; si se pierde, el backend puede consultar el estado del setup
  link para reconciliar.
- Al conectar, Praxia provisiona el webhook del número, sincroniza el catálogo
  central de plantillas y ejecuta una prueba de envío/recepción. La Conexión de
  WhatsApp solo pasa a `ready` cuando el número, plantillas críticas, billing,
  webhooks y prueba extremo a extremo están correctos y no hay bloqueo de
  Meta. Los estados parciales son visibles y reintentables.

## Consecuencias

- El superadmin puede completar casi todo el onboarding desde Praxia sin
  convertirse en custodio de las cuentas Meta de la Clínica.
- La disponibilidad real depende de que el propietario tenga acceso al
  Business Portfolio/WABA, una WhatsApp Business App activa y un dispositivo
  capaz de mostrar el QR.
- Un número no puede reutilizarse accidentalmente entre clínicas; el backend
  debe resolver siempre la conexión por Clínica y `phone_number_id`.
- La salida de una Clínica detiene envíos, exporta la configuración permitida
  y revoca el acceso con autorización de la Clínica, pero no elimina su WABA,
  número o plantillas.
- Hay riesgo comercial y operativo en los créditos centralizados; por eso se
  requiere umbral de alerta, circuito de bloqueo y reactivación manual.

## Alternativas descartadas

- **WABA o número compartido:** rompe el aislamiento, la propiedad y la
  atribución por Clínica.
- **Provisioning de números por Praxia/Kapso:** no es necesario para este
  producto y agrega portabilidad, disponibilidad local y dependencia de
  telephony.
- **`customer_managed`:** se descarta para la primera versión porque la
  experiencia centralizada y la conciliación por Clínica son requisitos
  confirmados.
- **Tech Provider propio o una aplicación Meta propia:** se pospone hasta que
  el volumen o la independencia de proveedor justifiquen el costo operativo.
- **Migración desde Twilio:** no aplica al estado actual; no hay clientes,
  números ni historial vivo que migrar.
