# Apolo

Monolito TypeScript de Praxia. Incluye Panacea, el panel interno para operar
Clínicas, y su base de identidad, autorización y datos aislados por Clínica.

## Stack

- Next.js App Router y Tailwind CSS
- tRPC para los adaptadores HTTP tipados
- Drizzle ORM y PostgreSQL
- Better Auth para Identidades y sesiones

Praxia mantiene fuera de Better Auth las membresías, roles y el contexto de
Clínica. Toda operación clínica abre una transacción mediante
`inClinicTransaction`, fija ese contexto y queda restringida por RLS.

## Desarrollo

1. Copia `.env.example` a `.env` y configura `BETTER_AUTH_SECRET`,
   `BETTER_AUTH_URL` y `DATABASE_URL`.
2. Inicia PostgreSQL con `./start-database.sh` o usa una instancia local.
3. Ejecuta `npm install` y después `npm run db:migrate`.
4. Inicia la aplicación con `npm run dev`.

## Calidad

```sh
npm test
npm run check
npm run build
```

Las pruebas de casos de uso usan un adaptador de correo simulado y datos
sintéticos. Las políticas SQL de RLS viven en las migraciones bajo `drizzle/`.

### Recorrido E2E de Panacea

Con PostgreSQL local y las migraciones aplicadas, ejecuta:

```sh
npm run test:e2e
```

La prueba levanta un servidor aislado, crea y elimina una Clínica sintética, y
recorre en Chromium la activación del médico propietario, inicio con OTP y la
acción clínica sintética. El OTP fijo se habilita exclusivamente para ese
proceso E2E; el desarrollo normal sigue usando códigos aleatorios.

### Verificación E2E de la landing pública

La landing se sirve como sitio estático independiente de Next.js. Para validar
su mensaje, evidencias, accesibilidad y comportamiento responsive, ejecuta:

```sh
npm run test:e2e:landing
```
