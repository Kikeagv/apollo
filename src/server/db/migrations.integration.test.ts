import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import {
  CLINIC_TERMS_ACCEPTANCE_ERROR_MESSAGE,
  CLINIC_TERMS_VERSION,
} from "~/domain/clinic-setup";

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
          const termsAcceptancePolicies = await migrated<
            Array<{
              command: "INSERT" | "UPDATE";
              name: string;
              with_check: string;
            }>
          >`
            select cmd as command, policyname as name, with_check
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_clinic_readiness'
              and policyname in (
                'clinic_readiness_owner_insert',
                'clinic_readiness_owner_update'
              )
          `;
          expect(termsAcceptancePolicies).toHaveLength(2);
          expect(
            termsAcceptancePolicies.map(({ command, name }) => ({
              command,
              name,
            })),
          ).toEqual(
            expect.arrayContaining([
              {
                command: "INSERT",
                name: "clinic_readiness_owner_insert",
              },
              {
                command: "UPDATE",
                name: "clinic_readiness_owner_update",
              },
            ]),
          );
          for (const policyName of ["clinic_readiness_owner_insert"]) {
            expect(
              termsAcceptancePolicies.find(({ name }) => name === policyName)
                ?.with_check,
            ).toContain("clinic_terms_acceptance_is_current");
          }
          const termsAcceptanceFunctions = await migrated<
            Array<{ definition: string; name: string }>
          >`
            select p.proname as name, pg_get_functiondef(p.oid) as definition
            from pg_proc p
            inner join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname = 'clinic_terms_acceptance_is_current'
          `;
          expect(termsAcceptanceFunctions).toHaveLength(1);
          expect(termsAcceptanceFunctions[0]).toMatchObject({
            name: "clinic_terms_acceptance_is_current",
          });
          expect(termsAcceptanceFunctions[0]?.definition).toContain(
            "app.clinic_terms_version",
          );
          const termsAcceptanceConstraints = await migrated<
            Array<{ definition: string; name: string }>
          >`
            select conname as name, pg_get_constraintdef(oid) as definition
            from pg_constraint
            where conrelid = 'pg-drizzle_clinic_readiness'::regclass
              and conname = 'clinic_readiness_terms_acceptance_complete'
          `;
          expect(termsAcceptanceConstraints).toHaveLength(1);
          expect(termsAcceptanceConstraints[0]).toMatchObject({
            name: "clinic_readiness_terms_acceptance_complete",
          });
          expect(termsAcceptanceConstraints[0]?.definition).toContain(
            "terms_accepted_at",
          );
        } finally {
          await migrated.end();
        }

        await admin.unsafe(
          `create role "${roleName}" login password '${password}'`,
        );
        await admin.unsafe(`grant panacea_clinical_access to "${roleName}"`);

        const rlsClinicId = randomUUID();
        const legacyClinicId = randomUUID();
        const otherClinicId = randomUUID();
        const rlsIdentities = {
          doctor: randomUUID(),
          legacyOwner: randomUUID(),
          other: randomUUID(),
          owner: randomUUID(),
          secretary: randomUUID(),
        };
        const rlsMemberships = {
          doctor: randomUUID(),
          legacyOwner: randomUUID(),
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
            (${rlsIdentities.legacyOwner}, 'Legacy RLS owner', ${`${rlsIdentities.legacyOwner}@test`}, true, now(), now()),
            (${rlsIdentities.secretary}, 'RLS secretary', ${`${rlsIdentities.secretary}@test`}, true, now(), now()),
            (${rlsIdentities.other}, 'RLS other', ${`${rlsIdentities.other}@test`}, true, now(), now())
        `;
        await rlsAdmin`
          insert into "pg-drizzle_clinic" (id, name)
          values
            (${rlsClinicId}, 'RLS clinic'),
            (${legacyClinicId}, 'Legacy RLS clinic'),
            (${otherClinicId}, 'Other RLS clinic')
        `;
        await rlsAdmin`
          insert into "pg-drizzle_clinic_user" (
            id, clinic_id, identity_id, role, active
          ) values
            (${rlsMemberships.owner}, ${rlsClinicId}, ${rlsIdentities.owner}, 'owner', true),
            (${rlsMemberships.doctor}, ${rlsClinicId}, ${rlsIdentities.doctor}, 'doctor', true),
            (${rlsMemberships.secretary}, ${rlsClinicId}, ${rlsIdentities.secretary}, 'secretary', true),
            (${rlsMemberships.legacyOwner}, ${legacyClinicId}, ${rlsIdentities.legacyOwner}, 'owner', true),
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
        await rlsAdmin`
          alter table "pg-drizzle_clinic_readiness"
          disable trigger "clinic_readiness_terms_acceptance_guard"
        `;
        await rlsAdmin`
          insert into "pg-drizzle_clinic_readiness" (
            clinic_id, readiness_status, asclepio_enabled
          ) values (${legacyClinicId}, 'ready', true)
        `;
        await rlsAdmin`
          alter table "pg-drizzle_clinic_readiness"
          enable trigger "clinic_readiness_terms_acceptance_guard"
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
                  insert into "pg-drizzle_clinic_readiness" (clinic_id)
                  values (${rlsClinicId})
                `,
            ),
          ).resolves.toEqual([]);
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
                  update "pg-drizzle_clinic_readiness"
                  set asclepio_enabled = true, readiness_status = 'ready'
                  where clinic_id = ${rlsClinicId}
                `,
            ),
          ).rejects.toThrow(CLINIC_TERMS_ACCEPTANCE_ERROR_MESSAGE);

          await expect(
            withClinicContext(
              restricted,
              {
                clinicId: legacyClinicId,
                clinicRole: "owner",
                clinicUserId: rlsMemberships.legacyOwner,
                identityId: rlsIdentities.legacyOwner,
              },
              (transaction) =>
                transaction`
                  update "pg-drizzle_clinic_readiness"
                  set current_step = 2
                  where clinic_id = ${legacyClinicId}
                  returning current_step, asclepio_enabled
                `,
            ),
          ).resolves.toEqual([{ current_step: 2, asclepio_enabled: true }]);

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
    await transaction`select set_config('app.clinic_terms_version', ${CLINIC_TERMS_VERSION}, true)`;
    await transaction`select set_config('app.clinic_role', ${input.clinicRole}, true)`;
    await transaction`select set_config('app.clinic_user_id', ${input.clinicUserId}, true)`;
    return operation(transaction);
  });
}
