# Identidad local con Better Auth

La fase 1 usa Better Auth autoalojado en el monolito y Resend para los correos de identidad. Better Auth prueba identidades y gestiona sesiones; Praxia conserva usuarios de clínica, roles, suspensión, auditoría y RLS en su propio Postgres. Auth0 se reevalúa solo ante requisitos de SSO/SAML/SCIM, BAA/SLA, protección adaptativa gestionada o una incapacidad demostrada de operar identidad local.
