import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;
const run = promisify(execFile);

function runMigrations(databaseUrl: string) {
  return run(
    process.execPath,
    [
      "node_modules/drizzle-kit/bin.cjs",
      "migrate",
      "--config=drizzle.config.ts",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  );
}

describe("autorización de entrega de plantilla de WhatsApp", () => {
  databaseTest(
    "el worker valida al actor sin permiso de lectura a la tabla de superadmins",
    async () => {
      const databaseName = `apo_118_${randomUUID().replaceAll("-", "")}`;
      const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
      const migratedUrl = new URL(process.env.DATABASE_URL!);
      migratedUrl.pathname = `/${databaseName}`;

      try {
        await admin.unsafe(`create database "${databaseName}"`);
        await runMigrations(migratedUrl.toString());

        const migrated = postgres(migratedUrl.toString(), { max: 1 });
        try {
          const identityId = `apo-118-${randomUUID()}`;
          await migrated`
            insert into public."user" (
              id, name, email, email_verified, created_at, updated_at
            ) values (
              ${identityId}, 'Superadmin de prueba',
              ${`${identityId}@example.test`}, true, now(), now()
            )
          `;
          await migrated`
            insert into public."pg-drizzle_superadmin" (identity_id)
            values (${identityId})
          `;

          const [tableAccess] = await migrated<
            Array<{ can_read_superadmins: boolean }>
          >`
            select has_table_privilege(
              'panacea_clinical_access',
              'public."pg-drizzle_superadmin"',
              'SELECT'
            ) as can_read_superadmins
          `;
          expect(tableAccess?.can_read_superadmins).toBe(false);

          await expect(
            migrated.begin(async (transaction) => {
              await transaction`set local role panacea_clinical_access`;
              return transaction`
                select identity_id
                from public."pg-drizzle_superadmin"
                where identity_id = ${identityId}
              `;
            }),
          ).rejects.toThrow(
            /permission denied for table pg-drizzle_superadmin/i,
          );

          const authorizeAsWorker = (actorIdentityId: string | null) =>
            migrated.begin(async (transaction) => {
              await transaction`set local role panacea_clinical_access`;
              await transaction`
                select set_config('app.whatsapp_outbound_worker', 'true', true)
              `;
              await transaction`
                select set_config(
                  'app.whatsapp_template_delivery_worker', 'true', true
                )
              `;
              if (actorIdentityId !== null) {
                await transaction`
                  select set_config('app.superadmin_id', ${actorIdentityId}, true)
                `;
              }
              const [authorization] = await transaction<
                Array<{ authorized: boolean }>
              >`
                select public.apolo_whatsapp_template_delivery_actor_authorized()
                  as authorized
              `;
              return authorization?.authorized;
            });

          await expect(authorizeAsWorker(identityId)).resolves.toBe(true);
          await expect(
            authorizeAsWorker(`not-a-superadmin-${randomUUID()}`),
          ).resolves.toBe(false);
          await expect(authorizeAsWorker(null)).resolves.toBe(false);

          await expect(
            migrated.begin(async (transaction) => {
              await transaction`set local role panacea_clinical_access`;
              await transaction`
                select set_config('app.superadmin_id', ${identityId}, true)
              `;
              const [authorization] = await transaction<
                Array<{ authorized: boolean }>
              >`
                select public.apolo_whatsapp_template_delivery_actor_authorized()
                  as authorized
              `;
              return authorization?.authorized;
            }),
          ).resolves.toBe(false);
        } finally {
          await migrated.end();
        }
      } finally {
        await admin`select pg_terminate_backend(pid)
          from pg_stat_activity where datname = ${databaseName}`;
        await admin.unsafe(`drop database if exists "${databaseName}"`);
        await admin.end();
      }
    },
    120_000,
  );
});
