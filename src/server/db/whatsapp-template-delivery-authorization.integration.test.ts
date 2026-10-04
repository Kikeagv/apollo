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
          const [clinic] = await migrated<Array<{ id: string }>>`
            insert into public."pg-drizzle_clinic" (name, is_synthetic)
            values ('Clínica de prueba APO-118', false)
            returning id
          `;
          if (!clinic) throw new Error("No se creó la Clínica de prueba");
          const phoneNumberId = `apo-118-${randomUUID()}`;
          await migrated`
            insert into public."pg-drizzle_whatsapp_connection" (
              clinic_id,
              provider,
              status,
              connection_type,
              customer,
              phone_number_id
            ) values (
              ${clinic.id}, 'kapso', 'ready', 'coexistence',
              ${`apo-118:${randomUUID()}`}, ${phoneNumberId}
            )
          `;
          const [connectionBeforeActivation] = await migrated<
            Array<{
              clinic_id: string;
              status: string;
              provider: string;
              phone_number_id: string | null;
              real_traffic_status: string;
            }>
          >`
            select
              clinic_id,
              status,
              provider,
              phone_number_id,
              real_traffic_status
            from public."pg-drizzle_whatsapp_connection"
            where clinic_id = ${clinic.id}
          `;
          expect(connectionBeforeActivation).toEqual({
            clinic_id: clinic.id,
            status: "ready",
            provider: "kapso",
            phone_number_id: phoneNumberId,
            real_traffic_status: "blocked",
          });

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

          const updateConnectionAsTemplateWorker = (
            actorId: string,
            mutatePhoneNumber = false,
          ) =>
            migrated.begin(async (transaction) => {
              await transaction`
                select set_config('app.clinic_id', ${clinic.id}, true)
              `;
              await transaction`
                select set_config('app.whatsapp_outbound_worker', 'true', true)
              `;
              await transaction`
                select set_config(
                  'app.whatsapp_template_delivery_worker', 'true', true
                )
              `;
              await transaction`
                select set_config('app.superadmin_id', ${actorId}, true)
              `;
              const rows = mutatePhoneNumber
                ? await transaction<Array<{ clinic_id: string }>>`
                    update public."pg-drizzle_whatsapp_connection"
                    set real_traffic_status = 'enabled',
                        real_traffic_enabled_at = now(),
                        real_traffic_enabled_by_identity_id = ${actorId},
                        phone_number_e164 = '+15555550199',
                        updated_at = now()
                    where clinic_id = ${clinic.id}
                      and provider = 'kapso'
                      and status = 'ready'
                      and phone_number_id = ${phoneNumberId}
                      and real_traffic_status = 'blocked'
                    returning clinic_id
                  `
                : await transaction<Array<{ clinic_id: string }>>`
                    update public."pg-drizzle_whatsapp_connection"
                    set real_traffic_status = 'enabled',
                        real_traffic_enabled_at = now(),
                        real_traffic_enabled_by_identity_id = ${actorId},
                        updated_at = now()
                    where clinic_id = ${clinic.id}
                      and provider = 'kapso'
                      and status = 'ready'
                      and phone_number_id = ${phoneNumberId}
                      and real_traffic_status = 'blocked'
                    returning clinic_id
                  `;
              return rows[0]?.clinic_id;
            });

          await expect(
            updateConnectionAsTemplateWorker(
              `not-a-superadmin-${randomUUID()}`,
            ),
          ).rejects.toThrow();
          await expect(
            updateConnectionAsTemplateWorker(identityId, true),
          ).rejects.toThrow(/entrega de plantilla.*tráfico real autorizado/i);
          await expect(
            updateConnectionAsTemplateWorker(identityId),
          ).resolves.toBe(clinic.id);

          const [connectionState] = await migrated<
            Array<{
              real_traffic_status: string;
              phone_number_e164: string | null;
            }>
          >`
            select real_traffic_status, phone_number_e164
            from public."pg-drizzle_whatsapp_connection"
            where clinic_id = ${clinic.id}
          `;
          expect(connectionState).toEqual({
            real_traffic_status: "enabled",
            phone_number_e164: null,
          });
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
