import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;
const run = promisify(execFile);

describe("migraciones de PostgreSQL", () => {
  databaseTest(
    "aplican desde una base vacía y preservan los Eventos de Cita como append-only",
    async () => {
      const databaseName = `apo_45_${randomUUID().replaceAll("-", "")}`;
      const roleName = `apo_45_${randomUUID().replaceAll("-", "")}`;
      const password = randomUUID();
      const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
      const migratedUrl = new URL(process.env.DATABASE_URL!);
      migratedUrl.pathname = `/${databaseName}`;

      try {
        await admin.unsafe(`create database "${databaseName}"`);

        await run(
          process.execPath,
          [
            "node_modules/drizzle-kit/bin.cjs",
            "migrate",
            "--config=drizzle.config.ts",
          ],
          {
            cwd: process.cwd(),
            env: { ...process.env, DATABASE_URL: migratedUrl.toString() },
          },
        );

        const migrated = postgres(migratedUrl.toString(), { max: 1 });
        try {
          const policies = await migrated<
            Array<{ command: "INSERT" | "SELECT"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_appointment_event'
            order by cmd, policyname
          `;
          expect(policies).toEqual(
            expect.arrayContaining([
              { command: "INSERT", name: "appointment_event_append" },
              {
                command: "INSERT",
                name: "appointment_event_scheduler_append",
              },
              {
                command: "SELECT",
                name: "appointment_event_operating_read",
              },
              {
                command: "SELECT",
                name: "appointment_event_scheduler_read",
              },
            ]),
          );
          const clinicMembershipPolicies = await migrated<
            Array<{ command: "SELECT"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_clinic_user'
              and cmd = 'SELECT'
          `;
          expect(clinicMembershipPolicies).toEqual(
            expect.arrayContaining([
              {
                command: "SELECT",
                name: "clinic_membership_configuration_owner_read",
              },
            ]),
          );
          const escalationPolicies = await migrated<
            Array<{ command: "INSERT" | "SELECT" | "UPDATE"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_appointment_self_management_escalation'
            order by cmd, policyname
          `;
          expect(escalationPolicies).toEqual(
            expect.arrayContaining([
              {
                command: "INSERT",
                name: "appointment_self_management_escalation_whatsapp_append",
              },
              {
                command: "SELECT",
                name: "appointment_self_management_escalation_operating_read",
              },
              {
                command: "UPDATE",
                name: "appointment_self_management_escalation_operating_resolve",
              },
            ]),
          );
          const deliveryPolicies = await migrated<
            Array<{ command: "ALL" | "SELECT"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_transactional_delivery'
            order by cmd, policyname
          `;
          expect(deliveryPolicies).toEqual(
            expect.arrayContaining([
              {
                command: "ALL",
                name: "transactional_delivery_scheduler_access",
              },
              {
                command: "SELECT",
                name: "transactional_delivery_clinic_read",
              },
            ]),
          );
          const whatsappPolicy = await migrated<
            Array<{ command: "UPDATE"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_clinic'
              and cmd = 'UPDATE'
              and policyname = 'clinic_owner_updates_whatsapp_policies'
          `;
          expect(whatsappPolicy).toEqual([
            {
              command: "UPDATE",
              name: "clinic_owner_updates_whatsapp_policies",
            },
          ]);
          const whatsappUpdateColumns = await migrated<
            Array<{ column_name: string }>
          >`
            select column_name
            from information_schema.column_privileges
            where table_schema = 'public'
              and table_name = 'pg-drizzle_clinic'
              and grantee = 'panacea_clinical_access'
              and privilege_type = 'UPDATE'
            order by column_name
          `;
          expect(whatsappUpdateColumns).toEqual([
            { column_name: "escalation_notifications_enabled" },
            { column_name: "escalation_secretary_phone_e164" },
            { column_name: "name" },
            { column_name: "no_show_policy" },
            { column_name: "voice_transcription_enabled" },
          ]);
          const clinicReadinessPolicies = await migrated<
            Array<{ command: "INSERT" | "SELECT" | "UPDATE"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_clinic_readiness'
            order by cmd, policyname
          `;
          expect(clinicReadinessPolicies).toEqual(
            expect.arrayContaining([
              {
                command: "INSERT",
                name: "clinic_readiness_owner_insert",
              },
              {
                command: "SELECT",
                name: "clinic_readiness_clinic_read",
              },
              {
                command: "UPDATE",
                name: "clinic_readiness_owner_update",
              },
            ]),
          );
        } finally {
          await migrated.end();
        }

        await admin.unsafe(
          `create role "${roleName}" login password '${password}'`,
        );
        await admin.unsafe(`grant panacea_clinical_access to "${roleName}"`);

        const rlsClinicId = randomUUID();
        const otherClinicId = randomUUID();
        const rlsIdentities = {
          doctor: randomUUID(),
          other: randomUUID(),
          owner: randomUUID(),
          secretary: randomUUID(),
        };
        const rlsMemberships = {
          doctor: randomUUID(),
          other: randomUUID(),
          owner: randomUUID(),
          secretary: randomUUID(),
        };
        const rlsDoctors = {
          doctor: randomUUID(),
          owner: randomUUID(),
          other: randomUUID(),
        };
        const rlsAdmin = postgres(migratedUrl.toString(), { max: 1 });
        await rlsAdmin`
          insert into "user" (
            id, name, email, email_verified, created_at, updated_at
          ) values
            (${rlsIdentities.owner}, 'RLS owner', ${`${rlsIdentities.owner}@test`}, true, now(), now()),
            (${rlsIdentities.doctor}, 'RLS doctor', ${`${rlsIdentities.doctor}@test`}, true, now(), now()),
            (${rlsIdentities.secretary}, 'RLS secretary', ${`${rlsIdentities.secretary}@test`}, true, now(), now()),
            (${rlsIdentities.other}, 'RLS other', ${`${rlsIdentities.other}@test`}, true, now(), now())
        `;
        await rlsAdmin`
          insert into "pg-drizzle_clinic" (id, name)
          values
            (${rlsClinicId}, 'RLS clinic'),
            (${otherClinicId}, 'Other RLS clinic')
        `;
        await rlsAdmin`
          insert into "pg-drizzle_clinic_user" (
            id, clinic_id, identity_id, role, active
          ) values
            (${rlsMemberships.owner}, ${rlsClinicId}, ${rlsIdentities.owner}, 'owner', true),
            (${rlsMemberships.doctor}, ${rlsClinicId}, ${rlsIdentities.doctor}, 'doctor', true),
            (${rlsMemberships.secretary}, ${rlsClinicId}, ${rlsIdentities.secretary}, 'secretary', true),
            (${rlsMemberships.other}, ${otherClinicId}, ${rlsIdentities.other}, 'doctor', true)
        `;
        await rlsAdmin`
          insert into "pg-drizzle_doctor" (
            id, clinic_id, clinic_user_id, public_name, primary_specialty
          ) values
            (${rlsDoctors.owner}, ${rlsClinicId}, ${rlsMemberships.owner}, 'Owner', 'General'),
            (${rlsDoctors.doctor}, ${rlsClinicId}, ${rlsMemberships.doctor}, 'Doctor', 'General'),
            (${rlsDoctors.other}, ${otherClinicId}, ${rlsMemberships.other}, 'Other', 'General')
        `;
        await rlsAdmin.end();

        const restrictedUrl = new URL(migratedUrl);
        restrictedUrl.username = roleName;
        restrictedUrl.password = password;
        const restricted = postgres(restrictedUrl.toString(), { max: 1 });
        try {
          const ownerMemberships = await withClinicContext(
            restricted,
            {
              clinicId: rlsClinicId,
              clinicRole: "owner",
              clinicUserId: rlsMemberships.owner,
              identityId: rlsIdentities.owner,
            },
            (transaction) =>
              transaction<Array<{ clinic_id: string; identity_id: string }>>`
                select clinic_id, identity_id
                from "pg-drizzle_clinic_user"
                order by identity_id
              `,
          );
          expect(ownerMemberships).toHaveLength(3);
          expect(ownerMemberships.map((row) => row.identity_id).sort()).toEqual(
            [
              rlsIdentities.doctor,
              rlsIdentities.owner,
              rlsIdentities.secretary,
            ].sort(),
          );

          const doctorMemberships = await withClinicContext(
            restricted,
            {
              clinicId: rlsClinicId,
              clinicRole: "doctor",
              clinicUserId: rlsMemberships.doctor,
              identityId: rlsIdentities.doctor,
            },
            (transaction) =>
              transaction<Array<{ clinic_id: string; identity_id: string }>>`
                select clinic_id, identity_id
                from "pg-drizzle_clinic_user"
                order by identity_id
              `,
          );
          expect(doctorMemberships).toEqual([
            { clinic_id: rlsClinicId, identity_id: rlsIdentities.doctor },
          ]);

          const secretaryMemberships = await withClinicContext(
            restricted,
            {
              clinicId: rlsClinicId,
              clinicRole: "secretary",
              clinicUserId: rlsMemberships.secretary,
              identityId: rlsIdentities.secretary,
            },
            (transaction) =>
              transaction<Array<{ clinic_id: string; identity_id: string }>>`
                select clinic_id, identity_id
                from "pg-drizzle_clinic_user"
                order by identity_id
              `,
          );
          expect(secretaryMemberships).toEqual([
            { clinic_id: rlsClinicId, identity_id: rlsIdentities.secretary },
          ]);

          const visibleClinics = await withClinicContext(
            restricted,
            {
              clinicId: rlsClinicId,
              clinicRole: "owner",
              clinicUserId: rlsMemberships.owner,
              identityId: rlsIdentities.owner,
            },
            (transaction) =>
              transaction<Array<{ id: string }>>`
                select id
                from "pg-drizzle_clinic"
                order by id
              `,
          );
          expect(visibleClinics).toEqual([{ id: rlsClinicId }]);

          await expect(
            withClinicContext(
              restricted,
              {
                clinicId: rlsClinicId,
                clinicRole: "owner",
                clinicUserId: rlsMemberships.owner,
                identityId: rlsIdentities.owner,
              },
              (transaction) =>
                transaction`
                  update "pg-drizzle_clinic"
                  set
                    no_show_policy = 'cancel-after-third-reminder',
                    escalation_notifications_enabled = true,
                    escalation_secretary_phone_e164 = '+50370000000',
                    voice_transcription_enabled = true
                  where id = ${rlsClinicId}
                  returning id
                `,
            ),
          ).resolves.toEqual([{ id: rlsClinicId }]);

          await expect(
            withClinicContext(
              restricted,
              {
                clinicId: rlsClinicId,
                clinicRole: "doctor",
                clinicUserId: rlsMemberships.doctor,
                identityId: rlsIdentities.doctor,
              },
              (transaction) =>
                transaction`
                  update "pg-drizzle_clinic"
                  set no_show_policy = 'alert'
                  where id = ${rlsClinicId}
                `,
            ),
          ).resolves.toEqual([]);

          const ownerDoctors = await withClinicContext(
            restricted,
            {
              clinicId: rlsClinicId,
              clinicRole: "owner",
              clinicUserId: rlsMemberships.owner,
              identityId: rlsIdentities.owner,
            },
            (transaction) =>
              transaction<Array<{ clinic_id: string; id: string }>>`
                select clinic_id, id
                from "pg-drizzle_doctor"
                order by id
              `,
          );
          expect(ownerDoctors).toHaveLength(2);
          expect(ownerDoctors.map((doctor) => doctor.clinic_id)).toEqual([
            rlsClinicId,
            rlsClinicId,
          ]);

          const doctorDoctors = await withClinicContext(
            restricted,
            {
              clinicId: rlsClinicId,
              clinicRole: "doctor",
              clinicUserId: rlsMemberships.doctor,
              identityId: rlsIdentities.doctor,
            },
            (transaction) =>
              transaction<Array<{ clinic_id: string; id: string }>>`
                select clinic_id, id
                from "pg-drizzle_doctor"
              `,
          );
          expect(doctorDoctors).toEqual([
            { clinic_id: rlsClinicId, id: rlsDoctors.doctor },
          ]);

          const secretaryDoctors = await withClinicContext(
            restricted,
            {
              clinicId: rlsClinicId,
              clinicRole: "secretary",
              clinicUserId: rlsMemberships.secretary,
              identityId: rlsIdentities.secretary,
            },
            (transaction) =>
              transaction<Array<{ clinic_id: string; id: string }>>`
                select clinic_id, id
                from "pg-drizzle_doctor"
              `,
          );
          expect(secretaryDoctors).toEqual([]);

          await expect(
            withSuperadminContext(
              restricted,
              (transaction) =>
                transaction`select id from "pg-drizzle_appointment_event"`,
            ),
          ).resolves.toEqual([]);
          await expect(
            withSuperadminContext(
              restricted,
              (transaction, clinicId) =>
                transaction`
                insert into "pg-drizzle_appointment_event" (
                  clinic_id,
                  appointment_id,
                  type,
                  actor_clinic_user_id
                ) values (${clinicId}, ${randomUUID()}, 'manual-created', ${randomUUID()})
              `,
            ),
          ).rejects.toThrow(/foreign key|row-level security/i);
          await expect(
            withSuperadminContext(
              restricted,
              (transaction) =>
                transaction`update "pg-drizzle_appointment_event" set type = type where false`,
            ),
          ).rejects.toThrow(/permission denied/i);
          await expect(
            withSuperadminContext(
              restricted,
              (transaction) =>
                transaction`delete from "pg-drizzle_appointment_event" where false`,
            ),
          ).rejects.toThrow(/permission denied/i);
        } finally {
          await restricted.end();
        }

        const activeClinicId = randomUUID();
        const suspendedClinicId = randomUUID();
        const schedulerDb = postgres(migratedUrl.toString(), { max: 1 });
        const schedulerRestricted = postgres(restrictedUrl.toString(), {
          max: 1,
        });
        await schedulerDb`
          insert into "pg-drizzle_clinic" (id, name, subscription_status)
          values
            (${activeClinicId}, 'Clínica activa', 'active'),
            (${suspendedClinicId}, 'Clínica suspendida', 'suspended')
        `;
        try {
          await schedulerRestricted.begin(async (transaction) => {
            await transaction`select set_config(
              'app.appointment_scheduler', 'true', true
            )`;
            await transaction`
              insert into "pg-drizzle_transactional_delivery" (
                clinic_id,
                kind,
                idempotency_key,
                payload,
                next_attempt_at,
                retain_until
              ) values (
                ${activeClinicId},
                'daily-agenda-pdf',
                ${randomUUID()},
                '{}'::jsonb,
                now(),
                now()
              )
            `;
          });
          await expect(
            schedulerRestricted.begin(async (transaction) => {
              await transaction`select set_config(
                'app.appointment_scheduler', 'true', true
              )`;
              return transaction`
                insert into "pg-drizzle_transactional_delivery" (
                  clinic_id,
                  kind,
                  idempotency_key,
                  payload,
                  next_attempt_at,
                  retain_until
                ) values (
                  ${suspendedClinicId},
                  'daily-agenda-pdf',
                  ${randomUUID()},
                  '{}'::jsonb,
                  now(),
                  now()
                )
              `;
            }),
          ).rejects.toThrow(/row-level security/i);
        } finally {
          await schedulerRestricted.end();
          await schedulerDb`
            delete from "pg-drizzle_clinic"
            where id in (${activeClinicId}, ${suspendedClinicId})
          `;
          await schedulerDb.end();
        }
      } finally {
        await admin.unsafe(`drop role if exists "${roleName}"`);
        await admin.unsafe(`drop database if exists "${databaseName}"`);
        await admin.end();
      }
    },
  );
});

async function withSuperadminContext<T>(
  connection: postgres.Sql,
  operation: (
    transaction: postgres.TransactionSql,
    clinicId: string,
  ) => Promise<T>,
) {
  return connection.begin(async (transaction) => {
    const clinicId = randomUUID();
    await transaction`select set_config('app.clinic_id', ${clinicId}, true)`;
    await transaction`select set_config('app.superadmin_id', ${randomUUID()}, true)`;
    return operation(transaction, clinicId);
  });
}

async function withClinicContext<T>(
  connection: postgres.Sql,
  input: {
    clinicId: string;
    clinicRole: "doctor" | "owner" | "secretary";
    clinicUserId: string;
    identityId: string;
  },
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
) {
  return connection.begin(async (transaction) => {
    await transaction`set local role panacea_clinical_access`;
    await transaction`select set_config('app.clinic_id', ${input.clinicId}, true)`;
    await transaction`select set_config('app.identity_id', ${input.identityId}, true)`;
    await transaction`select set_config('app.clinic_role', ${input.clinicRole}, true)`;
    await transaction`select set_config('app.clinic_user_id', ${input.clinicUserId}, true)`;
    return operation(transaction);
  });
}
