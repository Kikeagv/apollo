# Entregas transaccionales durables

Praxia persistirá cada Entrega transaccional en un outbox antes de llamar a WhatsApp o correo. El worker entrega al menos una vez con una clave idempotente estable, una concesión de diez minutos y cuatro reintentos; así una caída entre Postgres y un proveedor no pierde recordatorios ni PDFs ni requiere cambiar el flujo de Agenda al activar un adaptador real.

## Consequences

La Entrega conserva su contenido administrativo preparado y el historial de intentos, callbacks y alertas por al menos doce meses. Una respuesta del Contacto suprime recordatorios futuros pendientes; al agotar los intentos se crea una Alerta de Entrega transaccional fallida en Panacea.
