# Auth0 frente a Better Auth para Panacea (fase 1)

Investigado el 31 de julio de 2026 con documentación oficial de Auth0, Better
Auth y Resend. Alcance: autenticación de operadores del panel Next.js en el
monolito de Apolo. En ambos caminos los correos se entregan mediante Resend.
Una **clínica** sigue siendo una frontera de Praxia: identidad no posee
`clinica_id`, roles de negocio ni RLS.

## Recomendación

Elegir **Better Auth autoalojado + PostgreSQL propio + Resend** para el piloto de
fase 1. No activar su plugin `organization` para representar clínicas: duplicaría
`membresias_clinica`, autorización y RLS. En su lugar, Praxia controla una tabla
de invitaciones y una de membresías; Better Auth prueba la identidad solamente.

Auth0 es preferible si, antes del piloto, se exige SSO/SAML/SCIM, múltiples
aplicaciones o API pública OIDC, login social, antiabuso adaptativo gestionado,
BAA/HIPAA, SLA contractual o el equipo no puede operar controles de identidad.
No elegirlo solo por “time to market”: el requisito de acceso solo por invitación
y la autorización clínica siguen necesitando trabajo propio.

## Comparación

| Área | Auth0 + Resend | Better Auth + Resend | Decisión para Praxia |
| --- | --- | --- | --- |
| Next.js | El SDK `@auth0/nextjs-auth0` monta rutas `/auth/*` desde un proxy y redirige a Universal Login. [Quickstart](https://auth0.com/docs/quickstart/webapp/nextjs) | Un handler `/api/auth/[...all]`, cliente React y API de servidor. [Next.js](https://better-auth.com/docs/integrations/next) | Ambos se integran rápido. Better Auth elimina tenant, callback URL y UI alojada externos. |
| Password, verificación y reset | Database Connection lo ofrece; la API admite `resend` como proveedor. El email integrado de Auth0 es solo de prueba y no apto para producción. [Proveedor](https://auth0.com/docs/api/management/v2/emails/post-provider) [Límites](https://support.auth0.com/center/s/article/Emails-to-Gmail-from-Auth0-never-arrive) | Funciones de email/password, verificación y reset listas, pero Praxia provee callbacks que envían con Resend. Puede requerir verificación y revocar sesiones al reset. [Email](https://better-auth.com/docs/concepts/email) [Opciones](https://better-auth.com/docs/reference/options) | Resend es subencargado y requisito de producción en ambos; Auth0 ahorra plantilla/link, Better Auth da control y trazabilidad local. |
| Invitación sin registro público | La guía oficial implementa invitación mediante usuario creado por API, `app_metadata.needsInvitation`, ticket de cambio de password, plantilla/página y Action post-login. [Invitaciones](https://auth0.com/docs/customize/email/send-email-invitations-for-application-signup) | `disableSignUp` bloquea registro ordinario. La ruta propia valida un token de invitación de Praxia, crea identidad y activa membresía. El plugin Organization tiene invitaciones, pero no debe modelar clínicas. [Opciones](https://better-auth.com/docs/reference/options) [Organization](https://better-auth.com/docs/beta/plugins/organization) | Better Auth deja la invitación como una transacción coherente de Praxia; Auth0 añade estado/automatizaciones externas. |
| Sesiones y revocación | SDK mantiene sesión cifrada de app; Auth0 centraliza login y tokens. Revocación de refresh token es eventualmente consistente. [SDK](https://auth0.com/docs/quickstart/webapp/nextjs) [Revocar tokens](https://auth0.com/docs/secure/tokens/refresh-tokens/revoke-refresh-tokens) | Sesiones DB por defecto de 7 días, revocables por dispositivo o todas. No habilitar `cookieCache` para operadores: puede demorar revocación. [Sesiones](https://better-auth.com/docs/concepts/session-management) | Better Auth con validación DB da suspensión inmediata; toda acción protegida valida sesión y membresía, no solo cookie. |
| Defensa y MFA | Free incluye brute-force y throttling; MFA Pro comienza en Essentials. Protección mejorada aparece en Professional. [Attack protection](https://auth0.com/docs/secure/attack-protection) [Precios](https://auth0.com/pricing) | `scrypt`, CSRF/cookies seguros y rate limit incorporado; TOTP vía plugin. Praxia configura límites, proxy confiable, alertas y recuperación. [Seguridad](https://better-auth.com/docs/reference/security) [2FA](https://better-auth.com/docs/plugins/2fa) | Auth0 gestiona mejor el abuso desde día uno. Better Auth requiere MFA TOTP para superadmin y controles explícitos antes de datos reales. |
| Auditoría | Logs Free: un día; log streaming desde Essentials. [Precios](https://auth0.com/pricing) | La librería OSS no aporta SIEM. Better Auth Infrastructure es servicio aparte; Starter retiene 1 día y Pro 7 días. [Infraestructura](https://better-auth.com/docs/infrastructure/introduction) [Precios](https://better-auth.com/pricing) | Mantener `auth_event` y `audit_event` propios; ningún proveedor sustituye auditoría de negocio. |
| Datos y salida | Auth0 almacena perfil; elegir región al crear tenant y exportar usuarios por API. No usar metadata para PII sensible. [Datos](https://auth0.com/docs/secure/data-privacy-and-compliance/data-processing) [Exportar](https://auth0.com/docs/manage-users/user-migration/bulk-user-exports) | Usuarios, hashes y sesiones en PostgreSQL de Praxia; framework MIT. [Licencia](https://github.com/better-auth/better-auth) | Better Auth reduce un subencargado y facilita salida; Resend/hosting siguen sujetos a revisión legal. |
| Entornos | Auth0 recomienda tenant separado para desarrollo, staging y producción; límite/plan varía por tenant y etiqueta. [Entornos](https://auth0.com/docs/get-started/auth0-overview/create-tenants/set-up-multiple-environments) | Mismo código/migraciones, pero DB, secreto, dominio/cookies y clave Resend separados. Soporta esquema PostgreSQL separado. [PostgreSQL](https://better-auth.com/docs/adapters/postgresql) | Better Auth encaja directamente en los entornos del monolito. |

## Coste y límites publicados

- Auth0 Free: $0 hasta 25,000 MAU, una custom domain con verificación de tarjeta,
  cinco Organizations, protección básica y soporte comunitario. Essentials: $35/mes
  hasta 500 MAU; Professional: $240/mes hasta 500 MAU. Funciones, cuota y precio
  dependen del producto/contrato; confirmar en tenant antes de comprometer una
  salvaguarda. [Precios Auth0](https://auth0.com/pricing)
- Better Auth es MIT y gratuito; hosting/Postgres, desarrollo y operación son el
  coste real. La infraestructura gestionada opcional no es la librería OSS:
  Starter retiene 1 día de logs; Pro $20/mes, 7 días. [Precios Better Auth](https://better-auth.com/pricing)
- Resend Free ofrece 3,000 correos/mes, máximo 100/día. Pro cuesta $20/mes e
  incluye 50,000 correos, luego $0.90/1,000. Dominio, SPF/DKIM y límites de reenvío
  son requisitos de salida. [Precios Resend](https://resend.com/docs/knowledge-base/what-is-resend-pricing)

## Diseño mínimo si se confirma Better Auth

1. Tablas Better Auth en esquema `auth`, separadas de dominio y de las políticas
   RLS; Drizzle genera las migraciones versionadas.
2. `IdentityGateway` devuelve solo `subject` y email verificado. Luego Praxia
   resuelve usuario/membresía activa y aplica `SET LOCAL app.clinica_id` antes de
   tocar datos clínicos.
3. Invitación propia opaca, de un uso y vencimiento corto. `disableSignUp`,
   `requireEmailVerification`, reset y cambio de password revocan sesiones.
4. Resend se llama desde `EmailSender`; conservar solo metadatos de entrega y usar
   `Idempotency-Key`, nunca password, token o datos de pacientes. [API Resend](https://resend.com/docs/api-reference/emails/send-email)
5. Sesiones en DB sin cache para operadores, expiración razonable y sesión reciente
   para impersonación/suspensión. MFA TOTP obligatoria para superadmin.
6. Rate limits persistentes por IP/cuenta/end-point, proxy confiable, pruebas de
   CSRF y tabla de auditoría para login, fallo, reset, invitación, suspensión e
   impersonación. [Rate limiting](https://better-auth.com/docs/concepts/rate-limit)

## Disparadores para reevaluar Auth0

Abrir una decisión nueva si una clínica pide SSO/SAML/SCIM; se exigen SLA, BAA o
protecciones adaptativas gestionadas; el panel se vuelve varias aplicaciones/API
OIDC; o el equipo no puede sostener parches, monitoreo, respuesta a incidentes y
pentest de auth. Mantener el `IdentityGateway` y las membresías propias permite
migrar sin alterar agenda/RLS; una migración de passwords requiere plan y prueba,
no una copia improvisada de hashes.
