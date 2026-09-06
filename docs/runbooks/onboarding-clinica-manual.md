# Onboarding manual de Clínica (beta — 5 doctores)

Objetivo: dejar el producto listo para que el equipo de Apolo dé de alta
clínicas manualmente (una Clínica = un Médico propietario) y cada doctor entre
a operar Panacea. Documento vivo; actualizar al cambiar el flujo de alta.

## Estado del producto (2026-09-05)

- Alta de Clínica: flujo de aplicación `createSyntheticClinic` (requiere
  superadmin de Apolo, tabla `pg-drizzle_superadmin`). En producción **no hay
  página de superadmin cableada** aún; el alta manual se apoya en el
  procedimiento SQL de abajo mientras se decide la UI.
- Invitaciones por correo **real (Resend, `Praxia <noreply@usepraxia.com>`)**:
  propietario y médicos adicionales reciben el enlace
  `https://app.usepraxia.com/activar-invitacion?token=…` (commit `844fc191`).
- Activación: la persona crea contraseña (mín 8 chars), queda con membresía
  `owner` activa; login con OTP por correo en dispositivo nuevo.
- WhatsApp: el camino productivo decidido es Kapso con un número/WABA propio por
  Clínica, `coexistence`, `partner_managed` y setup link. La implementación del
  adaptador, webhooks y UI de onboarding sigue siendo trabajo pendiente; el
  adaptador simulado continúa siendo el único camino seguro hasta el piloto.
- Datos reales de Pacientes: gate legal `APO-5` (no habilitar hasta aviso,
  consentimiento, contrato y retención aprobados).

## Dar de alta una Clínica (procedimiento manual)

1. **Crear la clínica e invitación** en la BD de producción (conexión
   `postgres` del contenedor `qyqiwapy2ksbyfnd4kn3dcqp`; rol `postgres` omite
   RLS — el camino de app lo hace `createSyntheticClinic`):

```sql
WITH nueva AS (
  INSERT INTO "pg-drizzle_clinic" (name, is_synthetic)
  VALUES ('Clínica Beta 1', true)
  RETURNING id
)
INSERT INTO "pg-drizzle_clinic_invitation"
  (clinic_id, email, token_hash, expires_at, recipient_name, role)
SELECT id, 'doctor@clinica.example',
       encode(digest('<TOKEN-AZAROSO>', 'sha256'), 'hex'),
       now() + interval '72 hours',
       'Dr. Nombre Apellido', 'owner'
FROM nueva;
```

   - El token NO se guarda en texto plano; queda solo en el correo y en la URL.
   - Sustituir `<TOKEN-AZAROSO>` por un valor aleatorio (`openssl rand -hex 24`).
   - Las auditorías de alta/invitación en producción se registran al usar el
     flujo de la aplicación; en el camino SQL se insertan a
     `pg-drizzle_identity_audit_event` / `pg-drizzle_apolo_audit_event` con
     `synthetic-clinic-created` y `clinic-owner-invited`.

2. **Enviar el correo de invitación** replicando el payload del sender de
   producción (Resend, `Praxia <noreply@usepraxia.com>`, asunto
   `Invitación a <Clínica> en Praxia`, cuerpo con el enlace y el vencimiento):

```bash
curl -sS https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"Praxia <noreply@usepraxia.com>","to":["<doctor@clinic>"],
       "subject":"Invitación a <Clínica> en Praxia",
       "text":"Hola <Nombre>:\n\nEl equipo de Praxia la/o invitó a administrar
la clínica \"<Clínica>\".\n\nActive su cuenta y cree su contraseña en este
enlace (vence en 72 horas):\nhttps://app.usepraxia.com/activar-invitacion?token=<TOKEN>\n\nSi no esperaba esta invitación, puede ignorar este correo."}'
```

   La clave vive solo en Coolify (`RESEND_API_KEY`); no guardarla en el repo.

3. **Activación del médico propietario**: abre el enlace, crea contraseña y
   llega a la Panacea vacía; OTP por correo si el navegador es nuevo.

4. **Configuración inicial** (el doctor o el equipo de Apolo):
   - Perfil de Médico (nombre público, especialidad).
   - Servicios de la Clínica y Ofertas por Médico (precio USD, duración, buffer).
   - Horarios vigentes y Bloqueos.
   - Preflight de WhatsApp: número propio de la Clínica activo en WhatsApp
     Business, responsable con acceso al Business Portfolio/WABA, sitio HTTPS,
     privacidad/términos y dispositivo para completar el QR.
   - Generar un único setup link de Kapso desde el flujo del Médico propietario
     o del superadmin. El superadmin puede revocarlo/regenerarlo, pero nunca
     recibe OTP, QR ni credenciales Meta.

5. **Verificación operativa** (smoke):
   - `GET https://app.usepraxia.com/api/health` → 200.
   - Login con OTP y calendario semanal/diario con el filtro de Médico.
   - Alta de una Cita manual y cancelación (libera capacidad, conserva evento).

## Checklist para la beta de 5 clínicas

- [ ] `844fc191` desplegado en `praxia-app` (invitaciones por Resend).
- [ ] Decide estructura: 5 Clínicas × 1 doctor propietario (nombres/emails).
- [ ] Superadmin de Apolo creado o ruta de alta en la UI (decisión pendiente).
- [ ] WhatsApp: ejecutar el [runbook del piloto](activacion-whatsapp-piloto.md)
      con Kapso, `coexistence`, `partner_managed` y contactos sintéticos.
- [ ] Cada Clínica aporta su propio número/WABA; no reutilizar un número entre
      Clínicas ni asumir migración desde Twilio.
- [ ] Legal `APO-5` antes de datos reales de Pacientes.
- [ ] Smoke end-to-end: alta → invitación → activación → Panacea (1 clínica).
