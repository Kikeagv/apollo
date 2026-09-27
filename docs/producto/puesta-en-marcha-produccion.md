# Puesta en marcha de Praxia en producción

**Corte:** 27 de septiembre de 2026.  
**Objetivo:** poder incorporar las primeras Clínicas y operar su atención administrativa por WhatsApp de forma comprobable.

## Resumen ejecutivo

Praxia ya permite entrar al panel de supervisión, crear una Clínica comercial e invitar a su propietario en producción. La infraestructura de WhatsApp con Kapso está desplegada, y el código admite números `dedicated` y `coexistence`. Todavía **no está validado el recorrido completo de una Clínica hasta recibir y entregar mensajes**. La primera Clínica de prueba, «Clinica Tests», no tiene una Conexión de WhatsApp registrada en Praxia y el tráfico real sigue bloqueado.

Como todavía no hay clientes activos, producción puede servir para el piloto controlado con cuentas y Contactos de prueba. El siguiente hito no es desplegar más funciones por volumen: es completar un recorrido real de alta, conexión y mensaje, sin introducir datos de Pacientes hasta cerrar los gates legales y de privacidad.

## Qué funciona hoy

| Área                     | Estado observado                                                                                                                                                                                                      | Alcance práctico                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acceso y alta comercial  | Verificado en producción. Se creó «Clinica Tests» y el propietario aceptó la invitación con su cuenta existente.                                                                                                      | Se puede probar el alta de una Clínica y el acceso inicial. Conviene repetir la invitación para confirmar que los enlaces nuevos usan la URL correcta.     |
| URL de la aplicación     | `https://app.usepraxia.com` responde; el despliegue `7f98d816` está healthy y `PUBLIC_SITE_URL` está configurado.                                                                                                     | El error anterior de invitaciones a `www.usepraxia.com` tiene una corrección desplegada, aún sin repetición completa del flujo.                            |
| Kapso y modalidad        | El customer de Kapso está asociado a «Clinica Tests». Su número de prueba aparece `CONNECTED` y `is_coexistence=false`, correspondiente a `dedicated`.                                                                | El proveedor conoce el número, pero Praxia aún no ha completado su preflight ni creado la Conexión operativa.                                              |
| Infraestructura WhatsApp | `GET /api/health` devuelve `status=ok`, `configured=true` y `provider=kapso`. Las migraciones productivas llegaron a la 116 tras un backup; los workers de provisión, entrada y salida tuvieron ejecuciones exitosas. | La infraestructura está disponible. Una ejecución exitosa del worker no acredita un mensaje de punta a punta.                                              |
| Webhooks                 | El webhook del número y un webhook de proyecto apuntan a `app.usepraxia.com`. Un evento sintético de Kapso llegó al webhook del número; una petición sin firma recibió 401.                                           | Falta probar los eventos reales de conexión, entrada y entrega. Sigue activo un webhook de proyecto duplicado que apunta a `www.usepraxia.com`.            |
| Privacidad en Kapso      | Se desactivó la opción de usar contenido futuro para mejora de modelo y producto.                                                                                                                                     | El plan Free aún indica retención indefinida del historial de WhatsApp; esto impide usar datos reales de Pacientes sin una solución de retención aprobada. |

## El bloqueo inmediato

Al ejecutar el preflight de «Clinica Tests» con `dedicated`, Praxia mostró **«Kapso no disponible»**. La clave y la red productivas sí consultan Kapso con HTTP 200. La causa es un segundo registro que Kapso devuelve sin customer ni número visible: el adaptador rechazaba por ello todo el catálogo de números.

La corrección está en el commit `ca1a8f4`, ya presente en `main`, pero **todavía no está desplegada**: la imagen productiva observada sigue en `7f98d816`. La prueba de regresión reprodujo el fallo antes del cambio y pasó después; también pasaron 38 pruebas del adaptador y onboarding, lint, tipos y una lectura real del catálogo de Kapso con el código corregido. El despliegue queda bajo control del propietario del proyecto, conforme a lo acordado.

El botón de smoke se intentó mientras no existía una Conexión con `phone_number_id`; mostró «El mensaje Kapso requiere id y phone_number_id». **No constituye un smoke exitoso ni una entrega a WhatsApp.** Debe repetirse tras registrar la Conexión. Si vuelve a fallar, habrá que corregir ese recorrido por separado.

## Lo que falta para incorporar al primer cliente

1. **Desplegar la corrección del preflight y volver a ejecutarlo.** Confirmar que Praxia encuentra el customer y el número `dedicated` existentes sin crear duplicados. Verificar el nombre y la autoridad del propietario antes de marcar declaraciones del formulario; el campo observado mostraba «Superadmin» y requiere revisión.
2. **Completar la Conexión de WhatsApp en Praxia.** Registrar la asociación customer–Clínica–WABA–`phone_number_id`, recibir la señal autoritativa de Kapso y comprobar el estado desde el panel. Una redirección o el estado `CONNECTED` en Kapso no bastan.
3. **Dejar una sola ruta de webhooks válida.** Comprobar que los webhooks del número y proyecto apuntan a `app.usepraxia.com`, desactivar el duplicado de proyecto en `www.usepraxia.com` y validar un evento firmado real. El worker no debe volver a crear el endpoint equivocado.
4. **Cerrar la preparación técnica.** Confirmar las cuatro plantillas Utility aprobadas en el locale exacto, billing `partner_managed`, crédito, capacidad y salud de Meta/Kapso; reconciliar la generación vigente. Las cuatro plantillas `PENDING` y billing fallido observados antes correspondían a una Clínica sintética local, por lo que hay que medir estos puntos de nuevo en producción.
5. **Ejecutar el smoke de transporte.** Crear un Contacto controlado sin vínculo a Paciente, iniciar el run, enviar el código desde el número autorizado para pruebas y verificar una respuesta saliente con callback `delivered` o `read`. La aceptación de la API o el test del webhook, por sí solos, no cierran esta prueba.
6. **Cerrar los gates de uso real.** Registrar consentimiento y su versión, contrato, privacidad, retención, DPA, transferencias internacionales, billing y aprobación de producto. Resolver la retención de Kapso antes de intercambiar información de Pacientes. La habilitación de tráfico real debe ser una acción explícita posterior a la evidencia técnica y legal.
7. **Repetir el alta con un cliente real.** Crear su Clínica, enviar y aceptar una invitación nueva, completar configuración inicial y Agenda, elegir su modalidad de WhatsApp y conectar activos Meta propios. No se ha verificado aún un recorrido completo de Agenda y asistencia con una Clínica comercial en producción.

## Antes de abrir a varias Clínicas

Kapso mostraba capacidad de **1/1 números**. Hace falta capacidad adicional para una segunda Clínica y demostrar que customer, WABA, número, plantillas, Contactos, entregas, workers y circuit breaker permanecen aislados. También faltan ensayos productivos controlados de invitación fallida o vencida, rechazo de plantilla, caída del proveedor, eventos duplicados o perdidos, reintentos y retirada de la Conexión. Estas pruebas deben usar datos sintéticos y dejar el tráfico real bloqueado mientras se ejecutan.

## Criterio para declarar el servicio listo

Una Clínica estará lista para usar WhatsApp con clientes reales cuando su propietario pueda entrar y configurar la Clínica, su número y WABA propios estén asociados en Praxia, los webhooks y plantillas funcionen, billing esté confirmado, un mensaje de prueba complete entrada y entrega con callback, y los gates de consentimiento, contrato, privacidad y retención estén aprobados. El panel debe mostrar esa evidencia y permitir habilitar el tráfico explícitamente. Para afirmar que el producto es **multi-Clínica**, se debe repetir el recorrido con una segunda Clínica y verificar aislamiento.

**Estado al corte:** alta comercial y acceso inicial probados; WhatsApp productivo aún no listo; tráfico real bloqueado. No se consideran terminados [APO-74](https://linear.app/k31-software/issue/APO-74/prd-activacion-multi-clinica-de-whatsapp-con-kapso) ni [APO-110](https://linear.app/k31-software/issue/APO-110/piloto-controlado-y-preparacion-del-cierre-de-apo-74). La [matriz de evidencia](matriz-cierre-activacion-whatsapp.md) contiene el contrato detallado; su corte anterior al alta de «Clinica Tests» es histórico.
