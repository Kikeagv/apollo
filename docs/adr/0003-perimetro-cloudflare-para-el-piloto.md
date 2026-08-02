# Perímetro Cloudflare para el piloto

El piloto expone Panacea, la API de navegador y el callback de WhatsApp detrás
de Cloudflare Pro. Cloudflare aporta mitigación DDoS administrada, WAF
administrado, controles de bots y límites de tasa; no reemplaza Better Auth,
RLS ni la validación de firmas de proveedores.

El origen se oculta mediante Cloudflare Tunnel con réplicas, o mediante
Authenticated Origin Pulls y firewall si Tunnel no es viable. Los hostnames
públicos usan TLS Full (strict); bases de datos, workers y administración no se
exponen públicamente.

El callback exacto de Twilio queda libre de Access, Turnstile y desafíos. Una
regla de alcance mínimo puede omitir solo Super Bot Fight Mode para esa ruta;
el origen siempre valida la firma de Twilio y la idempotencia. Panacea y sus
flujos de autenticación sí usan las reglas de WAF, límites y controles de bots
aplicables.

Los límites iniciales son 10 intentos de inicio de sesión por minuto por IP y
5 solicitudes de recuperación por IP cada 15 minutos. Se revisan con los
eventos del piloto y no revelan la existencia de un correo.

Turnstile se usa únicamente en recuperación de contraseña y se valida en el
servidor. No se usa en el login cotidiano, navegación autenticada ni callback
de WhatsApp.

Las alertas de DDoS, WAF y límites llegan inicialmente a soporte de Apolo. La
Clínica solo se notifica cuando exista una afectación operativa confirmada.

No se contratan Bot Management, API Shield, Advanced DDoS ni Business/Enterprise
para el piloto salvo una necesidad demostrada. La fuente y el checklist
operativo están en `docs/research/controles-cloudflare-piloto.md`.
