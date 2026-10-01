import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

const canonicalTermsAcceptanceErrorMessage =
  "Debe aceptar los Términos de uso de Praxia en su versión vigente antes de habilitar la atención por WhatsApp.";
const forwardRepairStatements = readFileSync(
  "drizzle/0109_apo101_forward_schema_repairs.sql",
  "utf8",
)
  .split(/--> statement-breakpoint/g)
  .map((statement) => statement.trim())
  .filter(Boolean);

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

async function reapplyForwardRepairs(migrated: ReturnType<typeof postgres>) {
  await migrated.begin(async (transaction) => {
    for (const statement of forwardRepairStatements) {
      await transaction.unsafe(statement);
    }
  });
}

describe("migraciones de PostgreSQL", () => {
  databaseTest(
    "APO-109 expone solo contadores de entregas al superadmin mediante RLS",
    async () => {
      const databaseName = `apo_109_${randomUUID().replaceAll("-", "")}`;
      const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
      const migratedUrl = new URL(process.env.DATABASE_URL!);
      migratedUrl.pathname = `/${databaseName}`;

      try {
        await admin.unsafe(`create database "${databaseName}"`);
        await runMigrations(migratedUrl.toString());

        const migrated = postgres(migratedUrl.toString(), { max: 1 });
        try {
          const functionInfo = await migrated<
            Array<{ is_security_definer: boolean; settings: string[] | null }>
          >`
            select
              routine.prosecdef as is_security_definer,
              routine.proconfig as settings
            from pg_proc as routine
            inner join pg_namespace as namespace
              on namespace.oid = routine.pronamespace
            where namespace.nspname = 'public'
              and routine.proname = 'apolo_supervision_delivery_queue_status'
          `;
          expect(functionInfo).toHaveLength(1);
          expect(functionInfo[0]).toMatchObject({
            is_security_definer: true,
          });
          expect(functionInfo[0]?.settings?.join(",")).toContain(
            "search_path=pg_catalog, public",
          );

          const policy = await migrated<
            Array<{ name: string; command: string }>
          >`
            select policyname as name, cmd as command
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_transactional_delivery_alert'
              and policyname = 'transactional_delivery_alert_superadmin_read'
          `;
          expect(policy).toEqual([
            {
              name: "transactional_delivery_alert_superadmin_read",
              command: "SELECT",
            },
          ]);

          await expect(
            migrated.begin(async (transaction) => {
              await transaction`set local role panacea_clinical_access`;
              return transaction`
                select * from public.apolo_supervision_delivery_queue_status()
              `;
            }),
          ).rejects.toThrow(/superadmin authorization required/i);

          const identityId = `apo-109-${randomUUID()}`;
          const [clinic] = await migrated<{ id: string }[]>`
            insert into public."pg-drizzle_clinic" (name, is_synthetic)
            values ('Clínica de prueba APO-109', true)
            returning id
          `;
          if (!clinic) throw new Error("No se creó la Clínica de prueba");
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
          await migrated`
            insert into public."pg-drizzle_transactional_delivery" (
              clinic_id, kind, idempotency_key, payload,
              next_attempt_at, retain_until
            ) values (
              ${clinic.id}, 'daily-agenda-pdf', ${randomUUID()},
              '{"patientReference":"private-sentinel"}'::jsonb,
              now(), now()
            )
          `;

          const counts = await migrated.begin(async (transaction) => {
            await transaction`set local role panacea_clinical_access`;
            await transaction`
              select set_config('app.superadmin_id', ${identityId}, true)
            `;
            return transaction<
              Array<{
                pending: number;
                processing: number;
                attention: number;
              }>
            >`
              select * from public.apolo_supervision_delivery_queue_status()
            `;
          });
          expect(counts).toEqual([{ pending: 1, processing: 0, attention: 0 }]);
          expect(JSON.stringify(counts)).not.toContain("private-sentinel");
        } finally {
          await migrated.end();
        }
      } finally {
        await admin`
          select pg_terminate_backend(pid)
          from pg_stat_activity
          where datname = ${databaseName}
            and pid <> pg_backend_pid()
        `;
        await admin.unsafe(`drop database if exists "${databaseName}"`);
        await admin.end();
      }
    },
    30_000,
  );

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

        await runMigrations(migratedUrl.toString());

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
                command: "INSERT",
                name: "appointment_event_outbound_delivery_append",
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
              {
                command: "SELECT",
                name: "appointment_event_outbound_clinic_user_read",
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
            Array<{ command: "ALL" | "SELECT" | "UPDATE"; name: string }>
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
              {
                command: "ALL",
                name: "transactional_delivery_outbound_worker_access",
              },
              {
                command: "UPDATE",
                name: "transactional_delivery_whatsapp_offboarding_update",
              },
            ]),
          );
          const deliveryColumns = await migrated<
            Array<{ column_name: string }>
          >`
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_transactional_delivery'
              and column_name in (
                'provider_message_id',
                'provider_status',
                'consent_reference',
                'patient_consent_reference',
                'consent_decision',
                'consent_privacy_version',
                'consent_terms_version',
                'consent_text_reference',
                'consent_accepted_at'
              )
            order by column_name
          `;
          expect(deliveryColumns).toEqual([
            { column_name: "consent_accepted_at" },
            { column_name: "consent_decision" },
            { column_name: "consent_privacy_version" },
            { column_name: "consent_reference" },
            { column_name: "consent_terms_version" },
            { column_name: "consent_text_reference" },
            { column_name: "patient_consent_reference" },
            { column_name: "provider_message_id" },
            { column_name: "provider_status" },
          ]);
          const deliveryAlertColumns = await migrated<
            Array<{ column_name: string }>
          >`
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_transactional_delivery_alert'
              and column_name = 'resolution_evidence'
          `;
          expect(deliveryAlertColumns).toEqual([
            { column_name: "resolution_evidence" },
          ]);
          const deliveryAlertPolicies = await migrated<
            Array<{ command: "UPDATE"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_transactional_delivery_alert'
              and policyname = 'transactional_delivery_alert_clinic_resolve'
          `;
          expect(deliveryAlertPolicies).toEqual([
            {
              command: "UPDATE",
              name: "transactional_delivery_alert_clinic_resolve",
            },
          ]);
          const deliveryAlertConstraints = await migrated<
            Array<{ constraintName: string }>
          >`
            select conname as "constraintName"
            from pg_constraint
            where conrelid = 'pg-drizzle_transactional_delivery_alert'::regclass
              and conname = 'transactional_delivery_alert_resolution_evidence'
          `;
          expect(deliveryAlertConstraints).toEqual([
            {
              constraintName:
                "transactional_delivery_alert_resolution_evidence",
            },
          ]);
          const deliveryAttemptPolicies = await migrated<
            Array<{ command: "ALL" | "SELECT"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_transactional_delivery_attempt'
          `;
          expect(deliveryAttemptPolicies).toEqual(
            expect.arrayContaining([
              {
                command: "ALL",
                name: "transactional_delivery_attempt_outbound_worker_access",
              },
            ]),
          );
          const webhookEventPolicies = await migrated<
            Array<{ command: "ALL" | "SELECT" | "UPDATE"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_whatsapp_webhook_event'
          `;
          expect(webhookEventPolicies).toEqual(
            expect.arrayContaining([
              {
                command: "ALL",
                name: "whatsapp_webhook_event_delivery_status_worker_manage",
              },
              {
                command: "UPDATE",
                name: "whatsapp_webhook_event_superadmin_retry",
              },
            ]),
          );
          const rateLimitPolicies = await migrated<
            Array<{ command: "ALL"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_whatsapp_send_rate_limit_slot'
          `;
          expect(rateLimitPolicies).toEqual(
            expect.arrayContaining([
              {
                command: "ALL",
                name: "whatsapp_send_rate_limit_slot_provider_access",
              },
            ]),
          );
          const apo92Policies = await migrated<
            Array<{
              command: "ALL" | "INSERT" | "SELECT" | "UPDATE";
              name: string;
            }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename in (
                'pg-drizzle_whatsapp_traffic_gate_evidence',
                'pg-drizzle_whatsapp_smoke_run',
                'pg-drizzle_whatsapp_offboarding_run',
                'pg-drizzle_whatsapp_offboarding_step_audit'
              )
          `;
          expect(apo92Policies).toEqual(
            expect.arrayContaining([
              {
                command: "ALL",
                name: "whatsapp_traffic_gate_evidence_superadmin_manage",
              },
              {
                command: "SELECT",
                name: "whatsapp_traffic_gate_evidence_provider_read",
              },
              {
                command: "ALL",
                name: "whatsapp_smoke_run_superadmin_manage",
              },
              {
                command: "SELECT",
                name: "whatsapp_smoke_run_provider_read",
              },
              {
                command: "SELECT",
                name: "whatsapp_smoke_run_worker_read",
              },
              {
                command: "UPDATE",
                name: "whatsapp_smoke_run_worker_update",
              },
              {
                command: "ALL",
                name: "whatsapp_offboarding_run_superadmin_manage",
              },
              {
                command: "SELECT",
                name: "whatsapp_offboarding_step_audit_superadmin_read",
              },
              {
                command: "INSERT",
                name: "whatsapp_offboarding_step_audit_superadmin_append",
              },
            ]),
          );
          const apo106SmokeColumns = await migrated<
            Array<{ column_name: string; is_nullable: string }>
          >`
            select column_name, is_nullable
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_whatsapp_smoke_run'
              and column_name in (
                'finished_at', 'requires_real_roundtrip', 'test_contact_id',
                'test_contact_masked_phone', 'timeout_at', 'timed_out_at'
              )
            order by column_name
          `;
          expect(apo106SmokeColumns).toEqual([
            { column_name: "finished_at", is_nullable: "YES" },
            { column_name: "requires_real_roundtrip", is_nullable: "NO" },
            { column_name: "test_contact_id", is_nullable: "YES" },
            { column_name: "test_contact_masked_phone", is_nullable: "YES" },
            { column_name: "timed_out_at", is_nullable: "YES" },
            { column_name: "timeout_at", is_nullable: "YES" },
          ]);
          const apo106ContactConstraint = await migrated<
            Array<{ columns: string[]; referencedColumns: string[] }>
          >`
            select
              array(
                select attribute.attname
                from unnest(constraint_row.conkey) with ordinality as key(attnum, ordinality)
                inner join pg_attribute attribute
                  on attribute.attrelid = constraint_row.conrelid
                 and attribute.attnum = key.attnum
                order by key.ordinality
              ) as columns,
              array(
                select attribute.attname
                from unnest(constraint_row.confkey) with ordinality as key(attnum, ordinality)
                inner join pg_attribute attribute
                  on attribute.attrelid = constraint_row.confrelid
                 and attribute.attnum = key.attnum
                order by key.ordinality
              ) as "referencedColumns"
            from pg_constraint constraint_row
            where constraint_row.conname = 'whatsapp_smoke_run_test_contact_fk'
          `;
          expect(apo106ContactConstraint).toEqual([
            {
              columns: ["clinic_id", "test_contact_id"],
              referencedColumns: ["clinic_id", "id"],
            },
          ]);
          const apo92Rls = await migrated<
            Array<{
              force_row_security: boolean;
              relname: string;
              row_security: boolean;
            }>
          >`
            select c.relname, c.relrowsecurity as row_security,
              c.relforcerowsecurity as force_row_security
            from pg_class c
            inner join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname in (
                'pg-drizzle_whatsapp_traffic_gate_evidence',
                'pg-drizzle_whatsapp_smoke_run',
                'pg-drizzle_whatsapp_offboarding_run',
                'pg-drizzle_whatsapp_offboarding_step_audit'
              )
            order by c.relname
          `;
          expect(apo92Rls).toEqual([
            {
              force_row_security: true,
              relname: "pg-drizzle_whatsapp_offboarding_run",
              row_security: true,
            },
            {
              force_row_security: true,
              relname: "pg-drizzle_whatsapp_offboarding_step_audit",
              row_security: true,
            },
            {
              force_row_security: true,
              relname: "pg-drizzle_whatsapp_smoke_run",
              row_security: true,
            },
            {
              force_row_security: true,
              relname: "pg-drizzle_whatsapp_traffic_gate_evidence",
              row_security: true,
            },
          ]);
          const offboardingAuditActor = await migrated<
            Array<{ column_name: string; is_nullable: string }>
          >`
            select column_name, is_nullable
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_whatsapp_offboarding_step_audit'
              and column_name = 'actor_identity_id'
          `;
          expect(offboardingAuditActor).toEqual([
            { column_name: "actor_identity_id", is_nullable: "NO" },
          ]);
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
          const apo92GenerationColumns = await migrated<
            Array<{ column_name: string; table_name: string }>
          >`
            select table_name, column_name
            from information_schema.columns
            where table_schema = 'public'
              and (
                (table_name = 'pg-drizzle_whatsapp_connection'
                  and column_name in (
                    'offboarding_authorized_at',
                    'offboarding_authorized_by_identity_id'
                  ))
                or (table_name = 'pg-drizzle_whatsapp_smoke_run'
                  and column_name in ('provisioning_event_id', 'provider_transport_verified'))
                or (table_name = 'pg-drizzle_whatsapp_offboarding_run'
                  and column_name = 'provisioning_event_id')
              )
            order by table_name, column_name
          `;
          expect(apo92GenerationColumns).toEqual([
            {
              column_name: "offboarding_authorized_at",
              table_name: "pg-drizzle_whatsapp_connection",
            },
            {
              column_name: "offboarding_authorized_by_identity_id",
              table_name: "pg-drizzle_whatsapp_connection",
            },
            {
              column_name: "provisioning_event_id",
              table_name: "pg-drizzle_whatsapp_offboarding_run",
            },
            {
              column_name: "provider_transport_verified",
              table_name: "pg-drizzle_whatsapp_smoke_run",
            },
            {
              column_name: "provisioning_event_id",
              table_name: "pg-drizzle_whatsapp_smoke_run",
            },
          ]);
          const offboardingAuthorizationPolicy = await migrated<
            Array<{ command: "UPDATE"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_whatsapp_connection'
              and policyname = 'whatsapp_connection_clinic_owner_authorize_offboarding'
          `;
          expect(offboardingAuthorizationPolicy).toEqual([
            {
              command: "UPDATE",
              name: "whatsapp_connection_clinic_owner_authorize_offboarding",
            },
          ]);
          const connectionUpdateColumns = await migrated<
            Array<{ column_name: string }>
          >`
            select column_name
            from information_schema.column_privileges
            where table_schema = 'public'
              and table_name = 'pg-drizzle_whatsapp_connection'
              and grantee = 'panacea_clinical_access'
              and privilege_type = 'UPDATE'
            order by column_name
          `;
          expect(connectionUpdateColumns).toEqual(
            expect.arrayContaining([
              { column_name: "metadata" },
              { column_name: "offboarding_authorized_at" },
              { column_name: "offboarding_authorized_by_identity_id" },
              { column_name: "status" },
            ]),
          );
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
          expect(clinicReadinessPolicies.map(({ name }) => name)).not.toContain(
            "clinic_readiness_terms_acceptance_guard",
          );
          const clinicReadinessTriggers = await migrated<
            Array<{ definition: string; name: string }>
          >`
            select tgname as name, pg_get_triggerdef(oid) as definition
            from pg_trigger
            where tgrelid = 'pg-drizzle_clinic_readiness'::regclass
              and not tgisinternal
              and tgname = 'clinic_readiness_terms_acceptance_guard'
          `;
          expect(clinicReadinessTriggers).toHaveLength(1);
          expect(clinicReadinessTriggers[0]?.definition).toContain(
            "clinic_readiness_validate_terms_acceptance",
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
          for (const policy of termsAcceptancePolicies) {
            expect(policy.with_check).not.toContain(
              "clinic_terms_acceptance_is_current",
            );
          }
          const termsAcceptanceFunctions = await migrated<
            Array<{ definition: string; name: string }>
          >`
            select p.proname as name, pg_get_functiondef(p.oid) as definition
            from pg_proc p
            inner join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in (
                'clinic_terms_acceptance_is_current',
                'clinic_terms_version_is_current'
              )
          `;
          expect(termsAcceptanceFunctions).toHaveLength(2);
          const acceptanceFunction = termsAcceptanceFunctions.find(
            ({ name }) => name === "clinic_terms_acceptance_is_current",
          );
          const versionFunction = termsAcceptanceFunctions.find(
            ({ name }) => name === "clinic_terms_version_is_current",
          );
          expect(acceptanceFunction).toMatchObject({
            name: "clinic_terms_acceptance_is_current",
          });
          expect(acceptanceFunction?.definition).toContain(
            "clinic_terms_version_is_current",
          );
          expect(versionFunction).toMatchObject({
            name: "clinic_terms_version_is_current",
          });
          expect(versionFunction?.definition).toContain(
            "clinic_terms_contract",
          );
          for (const functionDefinition of termsAcceptanceFunctions) {
            expect(functionDefinition.definition).not.toContain(
              "app.clinic_terms_version",
            );
          }
          const termsContracts = await migrated<
            Array<{
              acceptance_error_message: string;
              current_version: string;
            }>
          >`
            select acceptance_error_message, current_version
            from "pg-drizzle_clinic_terms_contract"
          `;
          expect(termsContracts).toEqual([
            {
              acceptance_error_message: canonicalTermsAcceptanceErrorMessage,
              current_version: "1.0",
            },
          ]);
          const termsAcceptanceChecks = await migrated<
            Array<{
              current_acceptance: boolean;
              current_version: boolean;
              missing_acceptance: boolean;
              missing_version: boolean;
              stale_acceptance: boolean;
              stale_version: boolean;
            }>
          >`
            select
              "public"."clinic_terms_version_is_current"('1.0') as current_version,
              "public"."clinic_terms_version_is_current"('0.9') as stale_version,
              "public"."clinic_terms_version_is_current"(null) as missing_version,
              "public"."clinic_terms_acceptance_is_current"(now(), '1.0') as current_acceptance,
              "public"."clinic_terms_acceptance_is_current"(null, '1.0') as missing_acceptance,
              "public"."clinic_terms_acceptance_is_current"(now(), '0.9') as stale_acceptance
          `;
          expect(termsAcceptanceChecks).toEqual([
            {
              current_acceptance: true,
              current_version: true,
              missing_acceptance: false,
              missing_version: false,
              stale_acceptance: false,
              stale_version: false,
            },
          ]);
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

          await migrated`
            delete from "pg-drizzle_clinic_terms_contract"
            where id = true
          `;
          await reapplyForwardRepairs(migrated);
          const repairedTermsContracts = await migrated<
            Array<{
              acceptance_error_message: string;
              current_version: string;
            }>
          >`
            select acceptance_error_message, current_version
            from "pg-drizzle_clinic_terms_contract"
          `;
          expect(repairedTermsContracts).toEqual([
            {
              acceptance_error_message: canonicalTermsAcceptanceErrorMessage,
              current_version: "1.0",
            },
          ]);
          const repairedTermsAcceptanceChecks = await migrated<
            Array<{
              current_acceptance: boolean;
              current_version: boolean;
              stale_acceptance: boolean;
              stale_version: boolean;
            }>
          >`
            select
              "public"."clinic_terms_version_is_current"('1.0') as current_version,
              "public"."clinic_terms_version_is_current"('0.9') as stale_version,
              "public"."clinic_terms_acceptance_is_current"(now(), '1.0') as current_acceptance,
              "public"."clinic_terms_acceptance_is_current"(now(), '0.9') as stale_acceptance
          `;
          expect(repairedTermsAcceptanceChecks).toEqual([
            {
              current_acceptance: true,
              current_version: true,
              stale_acceptance: false,
              stale_version: false,
            },
          ]);
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
        const apo92SmokeRuns = {
          clinic: randomUUID(),
          other: randomUUID(),
        };
        const apo92Generations = {
          clinic: randomUUID(),
          other: randomUUID(),
        };
        await rlsAdmin`
          insert into "pg-drizzle_whatsapp_connection" (
            clinic_id, provider, status, connection_type, customer,
            phone_number_id, metadata
          ) values (
            ${rlsClinicId}, 'simulated', 'ready', 'simulated',
            ${`rls-simulated:${rlsClinicId}`}, 'phone-92',
            ${rlsAdmin.json({
              projectId: "project-92",
              provisioningEventId: apo92Generations.clinic,
            })}
          )
        `;
        await rlsAdmin`
          insert into "pg-drizzle_whatsapp_webhook_event" (
            id, idempotency_key, event_name, payload, status
          ) values
            (
              ${apo92Generations.clinic}, 'apo92-generation-clinic',
              'whatsapp.phone_number.created', '{}'::jsonb, 'processed'
            ),
            (
              ${apo92Generations.other}, 'apo92-generation-other',
              'whatsapp.phone_number.created', '{}'::jsonb, 'processed'
            )
        `;
        const currentReadinessGeneration = await rlsAdmin<
          Array<{
            businessAccountId: string | null;
            matches: boolean;
            phoneNumberId: string | null;
            projectId: string | null;
            provisioningEventId: string | null;
          }>
        >`
          select
            public.whatsapp_readiness_matches_current_generation(
              ${rlsClinicId}, 'phone-92', null, 'project-92',
              ${apo92Generations.clinic}
            ) as matches,
            connection.phone_number_id as "phoneNumberId",
            connection.business_account_id as "businessAccountId",
            connection.metadata ->> 'projectId' as "projectId",
            connection.metadata ->> 'provisioningEventId' as "provisioningEventId"
          from "pg-drizzle_whatsapp_connection" as connection
          where connection.clinic_id = ${rlsClinicId}
        `;
        expect(currentReadinessGeneration).toEqual([
          {
            businessAccountId: null,
            matches: true,
            phoneNumberId: "phone-92",
            projectId: "project-92",
            provisioningEventId: apo92Generations.clinic,
          },
        ]);
        await rlsAdmin`
          insert into "pg-drizzle_whatsapp_readiness" (
            clinic_id, phone_number_id, project_id, provisioning_event_id,
            status_reason
          ) values (
            ${rlsClinicId}, 'phone-92', 'project-92',
            ${apo92Generations.clinic}, 'ready'
          )
        `;
        await rlsAdmin`
          update "pg-drizzle_whatsapp_connection"
          set metadata = ${rlsAdmin.json({
            projectId: "project-92",
            provisioningEventId: apo92Generations.other,
          })}
          where clinic_id = ${rlsClinicId}
        `;
        await expect(
          rlsAdmin`
            update "pg-drizzle_whatsapp_readiness"
            set status_reason = 'resultado obsoleto'
            where clinic_id = ${rlsClinicId}
          `,
        ).rejects.toThrow(/generación vigente/i);
        await rlsAdmin`
          update "pg-drizzle_whatsapp_connection"
          set metadata = ${rlsAdmin.json({
            projectId: "project-92",
            provisioningEventId: apo92Generations.clinic,
          })}
          where clinic_id = ${rlsClinicId}
        `;
        await rlsAdmin`
          insert into "pg-drizzle_whatsapp_provisioning_step" (
            event_id, clinic_id, phone_number_id, step, status
          ) values (
            ${apo92Generations.clinic}, ${rlsClinicId}, 'phone-92',
            'project-webhook', 'succeeded'
          )
        `;
        await rlsAdmin`
          insert into "pg-drizzle_whatsapp_smoke_run" (
            id, clinic_id, actor_identity_id, provisioning_event_id, status, synthetic_contact,
            real_patients_enabled, steps, blockers, started_at, finished_at
          ) values
            (
              ${apo92SmokeRuns.clinic}, ${rlsClinicId}, ${rlsIdentities.owner}, ${apo92Generations.clinic},
              'passed', true, false, '[]'::jsonb, '[]'::jsonb, now(), now()
            ),
            (
              ${apo92SmokeRuns.other}, ${otherClinicId}, ${rlsIdentities.other}, null,
              'passed', true, false, '[]'::jsonb, '[]'::jsonb, now(), now()
            )
        `;
        await expect(
          rlsAdmin`
            insert into "pg-drizzle_whatsapp_smoke_run" (
              id, clinic_id, actor_identity_id, provisioning_event_id, status,
              synthetic_contact, real_patients_enabled, steps, blockers,
              started_at, finished_at
            ) values (
              ${randomUUID()}, ${rlsClinicId}, ${rlsIdentities.owner},
              ${apo92Generations.other}, 'failed', false, true,
              '[]'::jsonb, '[]'::jsonb, now(), now()
            )
          `,
        ).rejects.toThrow(/generación.*pertenece.*Clínica/i);
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

          const providerSmokeRuns = await withClinicContext(
            restricted,
            {
              clinicId: rlsClinicId,
              clinicRole: "owner",
              clinicUserId: rlsMemberships.owner,
              identityId: rlsIdentities.owner,
            },
            async (transaction) => {
              await transaction`select set_config(
                'app.whatsapp_provider', 'true', true
              )`;
              return transaction<Array<{ clinic_id: string }>>`
                select clinic_id
                from "pg-drizzle_whatsapp_smoke_run"
                order by clinic_id
              `;
            },
          );
          expect(providerSmokeRuns).toEqual([{ clinic_id: rlsClinicId }]);

          const providerSmokeRunsFromOtherClinic = await withClinicContext(
            restricted,
            {
              clinicId: otherClinicId,
              clinicRole: "doctor",
              clinicUserId: rlsMemberships.other,
              identityId: rlsIdentities.other,
            },
            async (transaction) => {
              await transaction`select set_config(
                'app.whatsapp_provider', 'true', true
              )`;
              return transaction<Array<{ clinic_id: string }>>`
                select clinic_id
                from "pg-drizzle_whatsapp_smoke_run"
                order by clinic_id
              `;
            },
          );
          expect(providerSmokeRunsFromOtherClinic).toEqual([
            { clinic_id: otherClinicId },
          ]);

          const inboundWorkerSmokeUpdate = await restricted.begin(
            async (transaction) => {
              await transaction`set local role panacea_clinical_access`;
              await transaction`select set_config(
                'app.whatsapp_inbound_worker', 'true', true
              )`;
              await transaction`select set_config(
                'app.whatsapp_inbound', 'true', true
              )`;
              await transaction`select set_config(
                'app.clinic_id', ${rlsClinicId}, true
              )`;
              await transaction`select set_config(
                'app.subscription_status', 'active', true
              )`;
              const [generationVisibility] = await transaction<
                Array<{ provisioningSteps: number; readiness: number }>
              >`
                select
                  (
                    select count(*)::int
                    from "pg-drizzle_whatsapp_provisioning_step"
                    where clinic_id = ${rlsClinicId}
                      and event_id = ${apo92Generations.clinic}
                  ) as "provisioningSteps",
                  (
                    select count(*)::int
                    from "pg-drizzle_whatsapp_readiness"
                    where clinic_id = ${rlsClinicId}
                      and provisioning_event_id = ${apo92Generations.clinic}
                  ) as readiness
              `;
              const updated = await transaction<Array<{ id: string }>>`
                update "pg-drizzle_whatsapp_smoke_run"
                set evidence = 'Persisted by the inbound worker'
                where clinic_id = ${rlsClinicId}
                  and id = ${apo92SmokeRuns.clinic}
                returning id
              `;
              return { generationVisibility, updated };
            },
          );
          expect(inboundWorkerSmokeUpdate.generationVisibility).toEqual({
            provisioningSteps: 0,
            readiness: 0,
          });
          expect(inboundWorkerSmokeUpdate.updated).toEqual([
            { id: apo92SmokeRuns.clinic },
          ]);

          await expect(
            restricted.begin(async (transaction) => {
              await transaction`set local role panacea_clinical_access`;
              await transaction`select set_config(
                'app.whatsapp_inbound_worker', 'true', true
              )`;
              await transaction`select set_config(
                'app.clinic_id', ${rlsClinicId}, true
              )`;
              return transaction`
                update "pg-drizzle_whatsapp_smoke_run"
                set provisioning_event_id = ${apo92Generations.other}
                where clinic_id = ${rlsClinicId}
                  and id = ${apo92SmokeRuns.clinic}
              `;
            }),
          ).rejects.toThrow(
            /generación de provisión.*no pertenece a la Clínica/i,
          );

          const ownerAuthorization = await withClinicContext(
            restricted,
            {
              clinicId: rlsClinicId,
              clinicRole: "owner",
              clinicUserId: rlsMemberships.owner,
              identityId: rlsIdentities.owner,
            },
            async (transaction) => {
              await transaction`select set_config(
                'app.subscription_status', 'active', true
              )`;
              return transaction<Array<{ clinic_id: string }>>`
                update "pg-drizzle_whatsapp_connection"
                set
                  offboarding_authorized_at = now(),
                  offboarding_authorized_by_identity_id = ${rlsIdentities.owner}
                where clinic_id = ${rlsClinicId}
                returning clinic_id
              `;
            },
          );
          expect(ownerAuthorization).toEqual([{ clinic_id: rlsClinicId }]);

          const doctorAuthorization = await withClinicContext(
            restricted,
            {
              clinicId: rlsClinicId,
              clinicRole: "doctor",
              clinicUserId: rlsMemberships.doctor,
              identityId: rlsIdentities.doctor,
            },
            async (transaction) => {
              await transaction`select set_config(
                'app.subscription_status', 'active', true
              )`;
              return transaction<Array<{ clinic_id: string }>>`
                update "pg-drizzle_whatsapp_connection"
                set
                  offboarding_authorized_at = now(),
                  offboarding_authorized_by_identity_id = ${rlsIdentities.doctor}
                where clinic_id = ${rlsClinicId}
                returning clinic_id
              `;
            },
          );
          expect(doctorAuthorization).toEqual([]);

          await expect(
            withClinicContext(
              restricted,
              {
                clinicId: rlsClinicId,
                clinicRole: "owner",
                clinicUserId: rlsMemberships.owner,
                identityId: rlsIdentities.owner,
              },
              async (transaction) => {
                await transaction`select set_config(
                  'app.subscription_status', 'active', true
                )`;
                return transaction`
                  update "pg-drizzle_whatsapp_connection"
                  set metadata = '{"owner_probe":true}'::jsonb
                  where clinic_id = ${rlsClinicId}
                `;
              },
            ),
          ).rejects.toThrow(/propietario.*actualizar.*autorización/i);

          const provisioningWorkerUpdate = await withClinicContext(
            restricted,
            {
              clinicId: rlsClinicId,
              clinicRole: "doctor",
              clinicUserId: rlsMemberships.doctor,
              identityId: rlsIdentities.doctor,
            },
            async (transaction) => {
              await transaction`select set_config(
                'app.whatsapp_provisioning_worker', 'true', true
              )`;
              await transaction`select set_config(
                'app.subscription_status', 'active', true
              )`;
              return transaction<Array<{ clinic_id: string }>>`
                update "pg-drizzle_whatsapp_connection"
                set
                  metadata = '{"worker_probe":true}'::jsonb,
                  status = 'provisioning'
                where clinic_id = ${rlsClinicId}
                returning clinic_id
              `;
            },
          );
          expect(provisioningWorkerUpdate).toEqual([
            { clinic_id: rlsClinicId },
          ]);

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
          ).rejects.toMatchObject({
            code: "PT001",
            message: canonicalTermsAcceptanceErrorMessage,
          });

          await expect(
            withClinicContext(
              restricted,
              {
                clinicId: rlsClinicId,
                clinicRole: "owner",
                clinicUserId: rlsMemberships.owner,
                identityId: rlsIdentities.owner,
              },
              async (transaction) => {
                await transaction`select set_config('app.clinic_terms_version', '0.9', true)`;
                return transaction`
                  update "pg-drizzle_clinic_readiness"
                  set
                    asclepio_enabled = true,
                    readiness_status = 'ready',
                    terms_accepted_at = now(),
                    terms_accepted_version = '0.9'
                  where clinic_id = ${rlsClinicId}
                `;
              },
            ),
          ).rejects.toMatchObject({
            code: "PT001",
            message: canonicalTermsAcceptanceErrorMessage,
          });

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
        await admin`
          select pg_terminate_backend(pid)
          from pg_stat_activity
          where datname = ${databaseName}
            and pid <> pg_backend_pid()
        `;
        await admin.unsafe(`drop database if exists "${databaseName}"`);
        await admin.end();
      }
    },
    30_000,
  );

  databaseTest(
    "crean los gates de readiness con RLS y estados de proveedor explícitos",
    async () => {
      const databaseName = `apo_86_${randomUUID().replaceAll("-", "")}`;
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
          const rlsTables = await migrated<
            Array<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>
          >`
            select c.relrowsecurity, c.relforcerowsecurity
            from pg_class c
            inner join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname in (
                'pg-drizzle_whatsapp_readiness',
                'pg-drizzle_whatsapp_critical_template',
                'pg-drizzle_whatsapp_billing',
                'pg-drizzle_whatsapp_connection_alert',
                'pg-drizzle_whatsapp_connection'
              )
            order by c.relname
          `;
          expect(rlsTables).toEqual([
            { relforcerowsecurity: true, relrowsecurity: true },
            { relforcerowsecurity: true, relrowsecurity: true },
            { relforcerowsecurity: true, relrowsecurity: true },
            { relforcerowsecurity: true, relrowsecurity: true },
            { relforcerowsecurity: true, relrowsecurity: true },
          ]);

          const policies = await migrated<
            Array<{ name: string; table_name: string }>
          >`
            select policyname as name, tablename as table_name
            from pg_policies
            where schemaname = 'public'
              and tablename in (
                'pg-drizzle_whatsapp_readiness',
                'pg-drizzle_whatsapp_critical_template',
                'pg-drizzle_whatsapp_billing',
                'pg-drizzle_whatsapp_connection_alert',
                'pg-drizzle_whatsapp_connection'
              )
          `;
          expect(policies).toEqual(
            expect.arrayContaining([
              {
                name: "whatsapp_readiness_superadmin_manage",
                table_name: "pg-drizzle_whatsapp_readiness",
              },
              {
                name: "whatsapp_readiness_clinic_owner_read",
                table_name: "pg-drizzle_whatsapp_readiness",
              },
              {
                name: "whatsapp_readiness_provider_read",
                table_name: "pg-drizzle_whatsapp_readiness",
              },
              {
                name: "whatsapp_readiness_inbound_smoke_read",
                table_name: "pg-drizzle_whatsapp_readiness",
              },
              {
                name: "whatsapp_critical_template_superadmin_manage",
                table_name: "pg-drizzle_whatsapp_critical_template",
              },
              {
                name: "whatsapp_critical_template_clinic_owner_read",
                table_name: "pg-drizzle_whatsapp_critical_template",
              },
              {
                name: "whatsapp_critical_template_provider_read",
                table_name: "pg-drizzle_whatsapp_critical_template",
              },
              {
                name: "whatsapp_billing_superadmin_manage",
                table_name: "pg-drizzle_whatsapp_billing",
              },
              {
                name: "whatsapp_billing_clinic_owner_read",
                table_name: "pg-drizzle_whatsapp_billing",
              },
              {
                name: "whatsapp_billing_provider_read",
                table_name: "pg-drizzle_whatsapp_billing",
              },
              {
                name: "whatsapp_readiness_provisioning_worker_manage",
                table_name: "pg-drizzle_whatsapp_readiness",
              },
              {
                name: "whatsapp_readiness_current_generation_insert",
                table_name: "pg-drizzle_whatsapp_readiness",
              },
              {
                name: "whatsapp_readiness_current_generation_update",
                table_name: "pg-drizzle_whatsapp_readiness",
              },
              {
                name: "whatsapp_readiness_reconciliation_worker_manage",
                table_name: "pg-drizzle_whatsapp_readiness",
              },
              {
                name: "whatsapp_critical_template_provisioning_worker_manage",
                table_name: "pg-drizzle_whatsapp_critical_template",
              },
              {
                name: "whatsapp_billing_provisioning_worker_manage",
                table_name: "pg-drizzle_whatsapp_billing",
              },
              {
                name: "whatsapp_connection_alert_superadmin_manage",
                table_name: "pg-drizzle_whatsapp_connection_alert",
              },
              {
                name: "whatsapp_connection_alert_provisioning_worker_manage",
                table_name: "pg-drizzle_whatsapp_connection_alert",
              },
              {
                name: "whatsapp_connection_alert_reconciliation_worker_manage",
                table_name: "pg-drizzle_whatsapp_connection_alert",
              },
              {
                name: "whatsapp_connection_alert_clinic_owner_read",
                table_name: "pg-drizzle_whatsapp_connection_alert",
              },
              {
                name: "whatsapp_connection_reconciliation_worker_update",
                table_name: "pg-drizzle_whatsapp_connection",
              },
            ]),
          );

          const alertClinicId = randomUUID();
          const otherAlertClinicId = randomUUID();
          const alertEventId = randomUUID();
          const inboundSmokeGeneration = randomUUID();
          const otherSmokeGeneration = randomUUID();
          const inboundSmokeProjectId = `project-${randomUUID()}`;
          const otherSmokeProjectId = `project-${randomUUID()}`;
          const inboundSmokePhoneNumberId = `phone-${randomUUID()}`;
          const otherSmokePhoneNumberId = `phone-${randomUUID()}`;
          await migrated`
            insert into "pg-drizzle_clinic" (id, name, subscription_status)
            values
              (${alertClinicId}, 'Clínica alerta APO-101', 'active'),
              (${otherAlertClinicId}, 'Otra Clínica APO-101', 'active')
          `;
          await migrated`
            insert into "pg-drizzle_whatsapp_connection" (
              clinic_id, provider, status, connection_type, customer,
              phone_number_id, metadata, business_account_id
            ) values
              (
                ${alertClinicId}, 'kapso', 'blocked', 'coexistence',
                ${`customer-${randomUUID()}`}, ${inboundSmokePhoneNumberId},
                jsonb_build_object(
                  'projectId', ${inboundSmokeProjectId}::text,
                  'provisioningEventId', ${inboundSmokeGeneration}::text
                ),
                ${`waba-${randomUUID()}`}
              ),
              (
                ${otherAlertClinicId}, 'kapso', 'blocked', 'coexistence',
                ${`customer-${randomUUID()}`}, ${otherSmokePhoneNumberId},
                jsonb_build_object(
                  'projectId', ${otherSmokeProjectId}::text,
                  'provisioningEventId', ${otherSmokeGeneration}::text
                ),
                ${`waba-${randomUUID()}`}
              )
          `;
          await migrated`
            insert into "pg-drizzle_whatsapp_readiness" (
              clinic_id, phone_number_id, business_account_id, project_id,
              provisioning_event_id, status_reason
            )
            select clinic_id, phone_number_id, business_account_id,
              metadata->>'projectId',
              (metadata->>'provisioningEventId')::uuid,
              'Readiness de prueba'
            from "pg-drizzle_whatsapp_connection"
            where clinic_id in (${alertClinicId}, ${otherAlertClinicId})
          `;
          const readinessHiddenFromRegularInboundWorker = await migrated.begin(
            async (transaction) => {
              await transaction`set local role panacea_clinical_access`;
              await transaction`
                select set_config('app.whatsapp_inbound_worker', 'true', true)
              `;
              await transaction`
                select set_config('app.clinic_id', ${alertClinicId}, true)
              `;
              await transaction`
                select set_config('app.subscription_status', 'active', true)
              `;
              return transaction<Array<{ clinic_id: string }>>`
                select clinic_id from "pg-drizzle_whatsapp_readiness"
              `;
            },
          );
          expect(readinessHiddenFromRegularInboundWorker).toEqual([]);
          const smokeWorkerReadiness = await migrated.begin(
            async (transaction) => {
              await transaction`set local role panacea_clinical_access`;
              await transaction`
                select set_config('app.whatsapp_inbound_worker', 'true', true)
              `;
              await transaction`
                select set_config('app.whatsapp_inbound_smoke_read', 'true', true)
              `;
              await transaction`
                select set_config('app.clinic_id', ${alertClinicId}, true)
              `;
              await transaction`
                select set_config('app.subscription_status', 'active', true)
              `;
              return transaction<Array<{ clinic_id: string }>>`
                select clinic_id from "pg-drizzle_whatsapp_readiness"
              `;
            },
          );
          expect(smokeWorkerReadiness).toEqual([{ clinic_id: alertClinicId }]);
          await migrated`
            insert into "pg-drizzle_whatsapp_webhook_event" (
              id, idempotency_key, event_name, payload, status
            ) values (
              ${alertEventId}, ${`apo101-alert-${alertEventId}`},
              'whatsapp.phone_number.created', '{}'::jsonb, 'processed'
            )
          `;
          await migrated`
            insert into "pg-drizzle_whatsapp_connection_alert" (
              clinic_id, provisioning_event_id, gate_code, reason, next_action
            ) values
              (${alertClinicId}, ${alertEventId}, 'webhooks', 'Falla del webhook', 'Contacte soporte'),
              (${otherAlertClinicId}, ${alertEventId}, 'webhooks', 'Otra falla', 'Contacte soporte')
          `;
          const ownerVisibleAlerts = await migrated.begin(
            async (transaction) => {
              await transaction`set local role panacea_clinical_access`;
              await transaction`select set_config('app.clinic_id', ${alertClinicId}, true)`;
              await transaction`select set_config('app.clinic_role', 'owner', true)`;
              return transaction<Array<{ clinic_id: string }>>`
              select clinic_id from "pg-drizzle_whatsapp_connection_alert"
              order by clinic_id
            `;
            },
          );
          expect(ownerVisibleAlerts).toEqual([{ clinic_id: alertClinicId }]);
          const doctorVisibleAlerts = await migrated.begin(
            async (transaction) => {
              await transaction`set local role panacea_clinical_access`;
              await transaction`select set_config('app.clinic_id', ${alertClinicId}, true)`;
              await transaction`select set_config('app.clinic_role', 'doctor', true)`;
              return transaction<Array<{ clinic_id: string }>>`
              select clinic_id from "pg-drizzle_whatsapp_connection_alert"
            `;
            },
          );
          expect(doctorVisibleAlerts).toEqual([]);

          const alertColumns = await migrated<Array<{ column_name: string }>>`
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_whatsapp_connection_alert'
              and column_name in (
                'clinic_id',
                'provisioning_event_id',
                'gate_code',
                'status',
                'reason',
                'next_action',
                'resolved_at'
              )
            order by column_name
          `;
          expect(alertColumns).toEqual([
            { column_name: "clinic_id" },
            { column_name: "gate_code" },
            { column_name: "next_action" },
            { column_name: "provisioning_event_id" },
            { column_name: "reason" },
            { column_name: "resolved_at" },
            { column_name: "status" },
          ]);

          const templateStatuses = await migrated<
            Array<{ definition: string }>
          >`
            select pg_get_constraintdef(oid) as definition
            from pg_constraint
            where conrelid = 'pg-drizzle_whatsapp_critical_template'::regclass
              and conname = 'whatsapp_critical_template_status'
          `;
          expect(templateStatuses[0]?.definition).toMatch(
            /PENDING.*APPROVED.*REJECTED.*DISABLED/,
          );
          const templateCatalogColumns = await migrated<
            Array<{ column_name: string }>
          >`
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_whatsapp_critical_template'
              and column_name in ('catalog_version', 'content', 'examples', 'provisioning_status')
            order by column_name
          `;
          expect(templateCatalogColumns).toEqual([
            { column_name: "catalog_version" },
            { column_name: "content" },
            { column_name: "examples" },
            { column_name: "provisioning_status" },
          ]);
          const templateProvisioningStatuses = await migrated<
            Array<{ definition: string }>
          >`
            select pg_get_constraintdef(oid) as definition
            from pg_constraint
            where conrelid = 'pg-drizzle_whatsapp_critical_template'::regclass
              and conname = 'whatsapp_critical_template_provisioning_status'
          `;
          expect(templateProvisioningStatuses[0]?.definition).toMatch(
            /missing.*submitted.*in_review.*approved.*rejected/,
          );
          const templateCategories = await migrated<
            Array<{ definition: string }>
          >`
            select pg_get_constraintdef(oid) as definition
            from pg_constraint
            where conrelid = 'pg-drizzle_whatsapp_critical_template'::regclass
              and conname = 'whatsapp_critical_template_category'
          `;
          expect(templateCategories[0]?.definition).toContain("'UTILITY'");

          const readinessColumns = await migrated<
            Array<{ column_name: string }>
          >`
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_whatsapp_readiness'
              and column_name in ('e2e_evidence_scope', 'number_health', 'number_health_checked_at', 'project_id', 'provisioning_event_id', 'reconciliation_attempts', 'reconciliation_last_attempt_at', 'reconciliation_last_error', 'reconciliation_next_attempt_at', 'reconciliation_status')
            order by column_name
          `;
          expect(readinessColumns).toEqual([
            { column_name: "e2e_evidence_scope" },
            { column_name: "number_health" },
            { column_name: "number_health_checked_at" },
            { column_name: "project_id" },
            { column_name: "provisioning_event_id" },
            { column_name: "reconciliation_attempts" },
            { column_name: "reconciliation_last_attempt_at" },
            { column_name: "reconciliation_last_error" },
            { column_name: "reconciliation_next_attempt_at" },
            { column_name: "reconciliation_status" },
          ]);

          const readinessTriggers = await migrated<
            Array<{ trigger_name: string }>
          >`
            select distinct trigger_name
            from information_schema.triggers
            where trigger_schema = 'public'
              and event_object_table = 'pg-drizzle_whatsapp_readiness'
              and trigger_name = 'whatsapp_readiness_current_generation_guard'
          `;
          expect(readinessTriggers).toEqual([
            {
              trigger_name: "whatsapp_readiness_current_generation_guard",
            },
          ]);

          const provisioningColumns = await migrated<
            Array<{ column_name: string }>
          >`
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_whatsapp_provisioning_step'
              and column_name = 'project_id'
          `;
          expect(provisioningColumns).toEqual([{ column_name: "project_id" }]);

          const inboundTables = await migrated<
            Array<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>
          >`
            select c.relrowsecurity, c.relforcerowsecurity
            from pg_class c
            inner join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname in (
                'pg-drizzle_whatsapp_identity',
                'pg-drizzle_whatsapp_inbound_message',
                'pg-drizzle_whatsapp_inbound_reply',
                'pg-drizzle_whatsapp_conversation_lock'
              )
            order by c.relname
          `;
          expect(inboundTables).toEqual([
            { relforcerowsecurity: true, relrowsecurity: true },
            { relforcerowsecurity: true, relrowsecurity: true },
            { relforcerowsecurity: true, relrowsecurity: true },
            { relforcerowsecurity: true, relrowsecurity: true },
          ]);

          const consentTable = await migrated<
            Array<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>
          >`
            select c.relrowsecurity, c.relforcerowsecurity
            from pg_class c
            inner join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname = 'pg-drizzle_whatsapp_contact_consent'
          `;
          expect(consentTable).toEqual([
            { relforcerowsecurity: true, relrowsecurity: true },
          ]);

          const consentPolicies = await migrated<
            Array<{ command: "INSERT" | "SELECT"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_whatsapp_contact_consent'
            order by cmd, policyname
          `;
          expect(consentPolicies).toEqual(
            expect.arrayContaining([
              {
                command: "INSERT",
                name: "whatsapp_contact_consent_worker_append",
              },
              {
                command: "INSERT",
                name: "whatsapp_contact_consent_clinic_registration_append",
              },
              {
                command: "SELECT",
                name: "whatsapp_contact_consent_worker_read",
              },
              {
                command: "SELECT",
                name: "whatsapp_contact_consent_clinic_owner_read",
              },
              {
                command: "SELECT",
                name: "whatsapp_contact_consent_superadmin_read",
              },
              {
                command: "SELECT",
                name: "whatsapp_contact_consent_delivery_read",
              },
            ]),
          );

          const consentColumns = await migrated<Array<{ column_name: string }>>`
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_whatsapp_contact_consent'
              and column_name in (
                'clinic_id',
                'contact_id',
                'identity_id',
                'origin',
                'actor_identity_id',
                'source_patient_id',
                'patient_id',
                'declaration',
                'accepted_role',
                'privacy_version',
                'terms_version',
                'text_reference',
                'accepted_at',
                'provider',
                'interaction_id',
                'status'
              )
            order by column_name
          `;
          expect(consentColumns).toEqual([
            { column_name: "accepted_at" },
            { column_name: "accepted_role" },
            { column_name: "actor_identity_id" },
            { column_name: "clinic_id" },
            { column_name: "contact_id" },
            { column_name: "declaration" },
            { column_name: "identity_id" },
            { column_name: "interaction_id" },
            { column_name: "origin" },
            { column_name: "patient_id" },
            { column_name: "privacy_version" },
            { column_name: "provider" },
            { column_name: "source_patient_id" },
            { column_name: "status" },
            { column_name: "terms_version" },
            { column_name: "text_reference" },
          ]);

          const consentIdentityNullability = await migrated<
            Array<{ isNullable: "YES" | "NO" }>
          >`
            select is_nullable as "isNullable"
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_whatsapp_contact_consent'
              and column_name = 'identity_id'
          `;
          expect(consentIdentityNullability).toEqual([{ isNullable: "YES" }]);

          const consentIndexes = await migrated<Array<{ indexName: string }>>`
            select indexname as "indexName"
            from pg_indexes
            where schemaname = 'public'
              and tablename = 'pg-drizzle_whatsapp_contact_consent'
              and indexname in (
                'whatsapp_contact_consent_current_idx',
                'whatsapp_contact_consent_interaction_unique',
                'whatsapp_contact_consent_source_patient_idx'
              )
            order by indexname
          `;
          expect(consentIndexes).toEqual([
            { indexName: "whatsapp_contact_consent_current_idx" },
            { indexName: "whatsapp_contact_consent_interaction_unique" },
            { indexName: "whatsapp_contact_consent_source_patient_idx" },
          ]);
          const consentStatusConstraints = await migrated<
            Array<{ constraintName: string }>
          >`
            select conname as "constraintName"
            from pg_constraint
            where conrelid = 'pg-drizzle_whatsapp_contact_consent'::regclass
              and conname = 'whatsapp_contact_consent_status'
          `;
          expect(consentStatusConstraints).toEqual([
            { constraintName: "whatsapp_contact_consent_status" },
          ]);

          const consentOriginConstraints = await migrated<
            Array<{ constraintName: string }>
          >`
            select conname as "constraintName"
            from pg_constraint
            where conrelid = 'pg-drizzle_whatsapp_contact_consent'::regclass
              and conname in (
                'whatsapp_contact_consent_origin',
                'whatsapp_contact_consent_origin_evidence'
              )
            order by conname
          `;
          expect(consentOriginConstraints).toEqual([
            { constraintName: "whatsapp_contact_consent_origin" },
            { constraintName: "whatsapp_contact_consent_origin_evidence" },
          ]);

          const consentDeclarationConstraints = await migrated<
            Array<{ constraintName: string }>
          >`
            select conname as "constraintName"
            from pg_constraint
            where conrelid = 'pg-drizzle_whatsapp_contact_consent'::regclass
              and conname = 'whatsapp_contact_consent_declaration'
          `;
          expect(consentDeclarationConstraints).toEqual([
            {
              constraintName: "whatsapp_contact_consent_declaration",
            },
          ]);

          const consentForeignKeys = await migrated<
            Array<{ constraintName: string }>
          >`
            select conname as "constraintName"
            from pg_constraint
            where conrelid = 'pg-drizzle_whatsapp_contact_consent'::regclass
              and conname in (
                'whatsapp_contact_consent_identity_contact_same_clinic_fk',
                'whatsapp_contact_consent_actor_identity_fk',
                'whatsapp_contact_consent_source_patient_same_clinic_fk'
              )
            order by conname
          `;
          expect(consentForeignKeys).toEqual([
            {
              constraintName: "whatsapp_contact_consent_actor_identity_fk",
            },
            {
              constraintName:
                "whatsapp_contact_consent_identity_contact_same_clinic_fk",
            },
            {
              constraintName:
                "whatsapp_contact_consent_source_patient_same_clinic_fk",
            },
          ]);

          const consentGateIdempotencyIndexes = await migrated<
            Array<{ indexName: string }>
          >`
            select indexname as "indexName"
            from pg_indexes
            where schemaname = 'public'
              and indexname in (
                'patient_clinic_registration_message_unique',
                'conversation_escalation_source_message_unique',
                'conversation_event_source_message_unique'
              )
            order by indexname
          `;
          expect(consentGateIdempotencyIndexes).toEqual([
            { indexName: "conversation_escalation_source_message_unique" },
            { indexName: "conversation_event_source_message_unique" },
            { indexName: "patient_clinic_registration_message_unique" },
          ]);

          const consentGateColumns = await migrated<
            Array<{ table_name: string; column_name: string }>
          >`
            select table_name, column_name
            from information_schema.columns
            where table_schema = 'public'
              and (
                (table_name = 'pg-drizzle_patient'
                  and column_name = 'registration_message_id')
                or (table_name = 'pg-drizzle_conversation_escalation'
                  and column_name in ('source_message_id', 'notification_sent_at'))
                or (table_name = 'pg-drizzle_conversation_event'
                  and column_name = 'source_message_id')
              )
            order by table_name, column_name
          `;
          expect(consentGateColumns).toEqual([
            {
              column_name: "notification_sent_at",
              table_name: "pg-drizzle_conversation_escalation",
            },
            {
              column_name: "source_message_id",
              table_name: "pg-drizzle_conversation_escalation",
            },
            {
              column_name: "source_message_id",
              table_name: "pg-drizzle_conversation_event",
            },
            {
              column_name: "registration_message_id",
              table_name: "pg-drizzle_patient",
            },
          ]);

          const inboundOrderingColumns = await migrated<
            Array<{ table_name: string; column_name: string }>
          >`
            select table_name, column_name
            from information_schema.columns
            where table_schema = 'public'
              and (
                (table_name = 'pg-drizzle_whatsapp_inbound_message'
                  and column_name = 'batch_first_sequence')
                or (table_name = 'pg-drizzle_whatsapp_inbound_alert'
                  and column_name = 'resolved_by_identity_id')
                or (table_name = 'pg-drizzle_whatsapp_inbound_reply'
                  and column_name = 'service_window_expires_at')
                or (table_name = 'pg-drizzle_temporary_reservation'
                  and column_name = 'source_message_id')
                or (table_name = 'pg-drizzle_appointment'
                  and column_name = 'source_message_id')
              )
            order by table_name, column_name
          `;
          expect(inboundOrderingColumns).toEqual([
            {
              column_name: "source_message_id",
              table_name: "pg-drizzle_appointment",
            },
            {
              column_name: "source_message_id",
              table_name: "pg-drizzle_temporary_reservation",
            },
            {
              column_name: "resolved_by_identity_id",
              table_name: "pg-drizzle_whatsapp_inbound_alert",
            },
            {
              column_name: "batch_first_sequence",
              table_name: "pg-drizzle_whatsapp_inbound_message",
            },
            {
              column_name: "service_window_expires_at",
              table_name: "pg-drizzle_whatsapp_inbound_reply",
            },
          ]);

          const inboundEventNameConstraint = await migrated<
            Array<{ definition: string }>
          >`
            select pg_get_constraintdef(oid) as definition
            from pg_constraint
            where conrelid = 'pg-drizzle_whatsapp_inbound_message'::regclass
              and conname = 'whatsapp_inbound_message_event_name'
          `;
          expect(inboundEventNameConstraint[0]?.definition).toContain(
            "whatsapp.message.sent",
          );

          const bookingIdempotencyIndexes = await migrated<
            Array<{ indexName: string }>
          >`
            select indexname as "indexName"
            from pg_indexes
            where schemaname = 'public'
              and indexname in (
                'appointment_source_message_unique',
                'temporary_reservation_source_message_unique'
              )
            order by indexname
          `;
          expect(bookingIdempotencyIndexes).toEqual([
            { indexName: "appointment_source_message_unique" },
            { indexName: "temporary_reservation_source_message_unique" },
          ]);

          const conversationEscalationTriggers = await migrated<
            Array<{ definition: string }>
          >`
            select pg_get_constraintdef(oid) as definition
            from pg_constraint
            where conrelid = 'pg-drizzle_conversation_escalation'::regclass
              and conname = 'pg-drizzle_conversation_escalation_trigger_check'
          `;
          expect(conversationEscalationTriggers[0]?.definition).toMatch(
            /business-app.*unsupported-message/s,
          );

          const conversationEscalationTable = await migrated<
            Array<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>
          >`
            select c.relrowsecurity, c.relforcerowsecurity
            from pg_class c
            inner join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname = 'pg-drizzle_conversation_escalation'
          `;
          expect(conversationEscalationTable).toEqual([
            { relforcerowsecurity: true, relrowsecurity: true },
          ]);

          const conversationEscalationPolicies = await migrated<
            Array<{ command: "INSERT" | "SELECT" | "UPDATE"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_conversation_escalation'
            order by cmd, policyname
          `;
          expect(conversationEscalationPolicies).toEqual(
            expect.arrayContaining([
              {
                command: "INSERT",
                name: "conversation_escalation_whatsapp_append",
              },
              {
                command: "SELECT",
                name: "conversation_escalation_operating_read",
              },
              {
                command: "UPDATE",
                name: "conversation_escalation_operating_resolve",
              },
              {
                command: "UPDATE",
                name: "conversation_escalation_outbound_worker_notification",
              },
            ]),
          );

          const inboundAlertTable = await migrated<
            Array<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>
          >`
            select c.relrowsecurity, c.relforcerowsecurity
            from pg_class c
            inner join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname = 'pg-drizzle_whatsapp_inbound_alert'
          `;
          expect(inboundAlertTable).toEqual([
            { relforcerowsecurity: true, relrowsecurity: true },
          ]);
          const inboundAlertPolicies = await migrated<
            Array<{ command: "INSERT" | "SELECT" | "UPDATE"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_whatsapp_inbound_alert'
            order by cmd, policyname
          `;
          expect(inboundAlertPolicies).toEqual(
            expect.arrayContaining([
              {
                command: "INSERT",
                name: "whatsapp_inbound_alert_worker_append",
              },
              {
                command: "SELECT",
                name: "whatsapp_inbound_alert_superadmin_read",
              },
              {
                command: "SELECT",
                name: "whatsapp_inbound_alert_worker_read",
              },
              {
                command: "UPDATE",
                name: "whatsapp_inbound_alert_superadmin_resolve",
              },
              {
                command: "UPDATE",
                name: "whatsapp_inbound_alert_worker_refresh",
              },
            ]),
          );

          const inboundPolicies = await migrated<
            Array<{ name: string; table_name: string }>
          >`
            select policyname as name, tablename as table_name
            from pg_policies
            where schemaname = 'public'
              and tablename in (
                'pg-drizzle_whatsapp_identity',
                'pg-drizzle_whatsapp_inbound_message',
                'pg-drizzle_whatsapp_inbound_reply',
                'pg-drizzle_whatsapp_conversation_lock'
              )
          `;
          expect(inboundPolicies).toEqual(
            expect.arrayContaining([
              {
                name: "whatsapp_identity_worker_manage",
                table_name: "pg-drizzle_whatsapp_identity",
              },
              {
                name: "whatsapp_inbound_message_ingress_insert",
                table_name: "pg-drizzle_whatsapp_inbound_message",
              },
              {
                name: "whatsapp_inbound_message_worker_manage",
                table_name: "pg-drizzle_whatsapp_inbound_message",
              },
              {
                name: "whatsapp_inbound_reply_worker_manage",
                table_name: "pg-drizzle_whatsapp_inbound_reply",
              },
              {
                name: "whatsapp_conversation_lock_worker_manage",
                table_name: "pg-drizzle_whatsapp_conversation_lock",
              },
            ]),
          );
          const inboundIngressAckPolicy = await migrated<
            Array<{ definition: string }>
          >`
            select qual as definition
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_whatsapp_inbound_message'
              and policyname = 'whatsapp_inbound_message_ingress_ack'
          `;
          expect(inboundIngressAckPolicy[0]?.definition).toMatch(
            /idempotency_key.*phone_number_id.*customer_id.*whatsapp_webhook_message_id/s,
          );
          const contactPhoneColumn = await migrated<
            Array<{ columnName: string; isNullable: string }>
          >`
            select column_name as "columnName", is_nullable as "isNullable"
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_contact'
              and column_name = 'phone_e164'
          `;
          expect(contactPhoneColumn).toEqual([
            { columnName: "phone_e164", isNullable: "YES" },
          ]);

          const circuitTables = await migrated<
            Array<{
              relforcerowsecurity: boolean;
              relrowsecurity: boolean;
              relname: string;
            }>
          >`
            select c.relname, c.relrowsecurity, c.relforcerowsecurity
            from pg_class c
            inner join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname in (
                'pg-drizzle_whatsapp_billing_reservation',
                'pg-drizzle_whatsapp_circuit_breaker',
                'pg-drizzle_whatsapp_circuit_breaker_alert',
                'pg-drizzle_whatsapp_circuit_breaker_audit',
                'pg-drizzle_whatsapp_usage_metric'
              )
            order by c.relname
          `;
          expect(circuitTables).toEqual([
            {
              relname: "pg-drizzle_whatsapp_billing_reservation",
              relforcerowsecurity: true,
              relrowsecurity: true,
            },
            {
              relname: "pg-drizzle_whatsapp_circuit_breaker",
              relforcerowsecurity: true,
              relrowsecurity: true,
            },
            {
              relname: "pg-drizzle_whatsapp_circuit_breaker_alert",
              relforcerowsecurity: true,
              relrowsecurity: true,
            },
            {
              relname: "pg-drizzle_whatsapp_circuit_breaker_audit",
              relforcerowsecurity: true,
              relrowsecurity: true,
            },
            {
              relname: "pg-drizzle_whatsapp_usage_metric",
              relforcerowsecurity: true,
              relrowsecurity: true,
            },
          ]);
          const circuitPolicies = await migrated<
            Array<{
              command: "ALL" | "DELETE" | "INSERT" | "SELECT" | "UPDATE";
              name: string;
              table_name: string;
            }>
          >`
            select cmd as command, policyname as name, tablename as table_name
            from pg_policies
            where schemaname = 'public'
              and tablename in (
                'pg-drizzle_whatsapp_billing_reservation',
                'pg-drizzle_whatsapp_circuit_breaker',
                'pg-drizzle_whatsapp_circuit_breaker_alert',
                'pg-drizzle_whatsapp_circuit_breaker_audit',
                'pg-drizzle_whatsapp_usage_metric'
              )
          `;
          expect(circuitPolicies).toEqual(
            expect.arrayContaining([
              {
                command: "SELECT",
                name: "whatsapp_billing_reservation_outbound_worker_manage",
                table_name: "pg-drizzle_whatsapp_billing_reservation",
              },
              {
                command: "INSERT",
                name: "whatsapp_billing_reservation_outbound_worker_insert",
                table_name: "pg-drizzle_whatsapp_billing_reservation",
              },
              {
                command: "UPDATE",
                name: "whatsapp_billing_reservation_outbound_worker_update",
                table_name: "pg-drizzle_whatsapp_billing_reservation",
              },
              {
                command: "DELETE",
                name: "whatsapp_reservation_retention_scheduler_delete",
                table_name: "pg-drizzle_whatsapp_billing_reservation",
              },
              {
                command: "ALL",
                name: "whatsapp_circuit_breaker_superadmin_manage",
                table_name: "pg-drizzle_whatsapp_circuit_breaker",
              },
              {
                command: "ALL",
                name: "whatsapp_circuit_breaker_alert_superadmin_manage",
                table_name: "pg-drizzle_whatsapp_circuit_breaker_alert",
              },
              {
                command: "SELECT",
                name: "whatsapp_circuit_breaker_alert_worker_read",
                table_name: "pg-drizzle_whatsapp_circuit_breaker_alert",
              },
              {
                command: "INSERT",
                name: "whatsapp_circuit_breaker_alert_worker_insert",
                table_name: "pg-drizzle_whatsapp_circuit_breaker_alert",
              },
              {
                command: "UPDATE",
                name: "whatsapp_circuit_breaker_alert_worker_update",
                table_name: "pg-drizzle_whatsapp_circuit_breaker_alert",
              },
              {
                command: "SELECT",
                name: "whatsapp_circuit_breaker_worker_manage",
                table_name: "pg-drizzle_whatsapp_circuit_breaker",
              },
              {
                command: "INSERT",
                name: "whatsapp_circuit_breaker_worker_insert",
                table_name: "pg-drizzle_whatsapp_circuit_breaker",
              },
              {
                command: "UPDATE",
                name: "whatsapp_circuit_breaker_worker_update",
                table_name: "pg-drizzle_whatsapp_circuit_breaker",
              },
              {
                command: "INSERT",
                name: "whatsapp_circuit_breaker_audit_worker_append",
                table_name: "pg-drizzle_whatsapp_circuit_breaker_audit",
              },
              {
                command: "DELETE",
                name: "whatsapp_operational_retention_scheduler_delete",
                table_name: "pg-drizzle_whatsapp_circuit_breaker_audit",
              },
              {
                command: "DELETE",
                name: "whatsapp_metric_retention_scheduler_delete",
                table_name: "pg-drizzle_whatsapp_usage_metric",
              },
              {
                command: "INSERT",
                name: "whatsapp_usage_metric_worker_append",
                table_name: "pg-drizzle_whatsapp_usage_metric",
              },
              {
                command: "SELECT",
                name: "whatsapp_usage_metric_worker_read",
                table_name: "pg-drizzle_whatsapp_usage_metric",
              },
              {
                command: "SELECT",
                name: "whatsapp_usage_metric_superadmin_read",
                table_name: "pg-drizzle_whatsapp_usage_metric",
              },
            ]),
          );
          const billingWorkerPolicy = await migrated<
            Array<{ command: "SELECT"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_whatsapp_billing'
              and policyname = 'whatsapp_billing_outbound_worker_manage'
          `;
          expect(billingWorkerPolicy).toEqual([
            {
              command: "SELECT",
              name: "whatsapp_billing_outbound_worker_manage",
            },
          ]);
          const circuitConnectionPolicy = await migrated<
            Array<{ command: "UPDATE"; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_whatsapp_connection'
              and policyname = 'whatsapp_connection_circuit_worker_update'
          `;
          expect(circuitConnectionPolicy).toEqual([
            {
              command: "UPDATE",
              name: "whatsapp_connection_circuit_worker_update",
            },
          ]);
          const billingOperationalColumns = await migrated<
            Array<{ column_name: string }>
          >`
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_whatsapp_billing'
              and column_name in (
                'credit_in_flight_cents',
                'credit_reserve_cents',
                'estimated_daily_consumption_cents',
                'kapso_monthly_quota',
                'kapso_quota_consumed',
                'kapso_quota_in_flight',
                'kapso_quota_reserved'
              )
            order by column_name
          `;
          expect(billingOperationalColumns).toEqual([
            { column_name: "credit_in_flight_cents" },
            { column_name: "credit_reserve_cents" },
            { column_name: "estimated_daily_consumption_cents" },
            { column_name: "kapso_monthly_quota" },
            { column_name: "kapso_quota_consumed" },
            { column_name: "kapso_quota_in_flight" },
            { column_name: "kapso_quota_reserved" },
          ]);
        } finally {
          await migrated.end();
        }
      } finally {
        await admin.unsafe(`drop database if exists "${databaseName}"`);
        await admin.end();
      }
    },
  );

  databaseTest(
    "repara el contrato de APO-91 cuando el ledger quedó adelantado",
    async () => {
      const databaseName = `apo_94_schema_repair_${randomUUID().replaceAll(
        "-",
        "",
      )}`;
      const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
      const migratedUrl = new URL(process.env.DATABASE_URL!);
      migratedUrl.pathname = `/${databaseName}`;

      try {
        await admin.unsafe(`create database "${databaseName}"`);
        await runMigrations(migratedUrl.toString());

        const migrated = postgres(migratedUrl.toString(), { max: 1 });
        try {
          await migrated`
            alter table "pg-drizzle_whatsapp_inbound_reply"
            drop column if exists "last_provider_event_id"
          `;
          await migrated`
            alter table "pg-drizzle_whatsapp_billing_reservation"
            drop column if exists "reserved_at"
          `;
          await migrated`
            drop trigger if exists whatsapp_billing_outbound_mutation_guard
            on "pg-drizzle_whatsapp_billing"
          `;
          await migrated`
            drop function if exists guard_whatsapp_billing_outbound_mutation()
          `;
          await migrated`
            drop trigger if exists whatsapp_connection_circuit_mutation_guard
            on "pg-drizzle_whatsapp_connection"
          `;
          await migrated`
            drop function if exists guard_whatsapp_connection_circuit_mutation()
          `;
          await migrated`
            drop trigger if exists whatsapp_circuit_breaker_worker_mutation_guard
            on "pg-drizzle_whatsapp_circuit_breaker"
          `;
          await migrated`
            drop function if exists guard_whatsapp_circuit_breaker_worker_mutation()
          `;
          await migrated`
            drop policy if exists whatsapp_connection_circuit_worker_update
            on "pg-drizzle_whatsapp_connection"
          `;
          await migrated`
            drop policy if exists whatsapp_connection_provisioning_worker_update
            on "pg-drizzle_whatsapp_connection"
          `;
          await migrated`
            drop policy if exists whatsapp_billing_subscription_active_read
            on "pg-drizzle_whatsapp_billing"
          `;
          for (const policy of [
            [
              "whatsapp_billing_outbound_worker_capacity_update",
              "pg-drizzle_whatsapp_billing",
            ],
            [
              "whatsapp_billing_outbound_worker_manage",
              "pg-drizzle_whatsapp_billing",
            ],
            [
              "whatsapp_billing_reservation_outbound_worker_insert",
              "pg-drizzle_whatsapp_billing_reservation",
            ],
            [
              "whatsapp_billing_reservation_outbound_worker_manage",
              "pg-drizzle_whatsapp_billing_reservation",
            ],
            [
              "whatsapp_billing_reservation_outbound_worker_update",
              "pg-drizzle_whatsapp_billing_reservation",
            ],
            ["whatsapp_billing_scheduler_read", "pg-drizzle_whatsapp_billing"],
            [
              "whatsapp_billing_scheduler_capacity_update",
              "pg-drizzle_whatsapp_billing",
            ],
            [
              "whatsapp_billing_reservation_scheduler_read",
              "pg-drizzle_whatsapp_billing_reservation",
            ],
            [
              "whatsapp_billing_reservation_scheduler_update",
              "pg-drizzle_whatsapp_billing_reservation",
            ],
            [
              "whatsapp_inbound_reply_scheduler_read",
              "pg-drizzle_whatsapp_inbound_reply",
            ],
            [
              "whatsapp_circuit_breaker_audit_superadmin_append",
              "pg-drizzle_whatsapp_circuit_breaker_audit",
            ],
            [
              "whatsapp_circuit_breaker_audit_superadmin_read",
              "pg-drizzle_whatsapp_circuit_breaker_audit",
            ],
            [
              "whatsapp_circuit_breaker_audit_worker_append",
              "pg-drizzle_whatsapp_circuit_breaker_audit",
            ],
            [
              "whatsapp_circuit_breaker_clinic_owner_read",
              "pg-drizzle_whatsapp_circuit_breaker",
            ],
            [
              "whatsapp_circuit_breaker_provider_read",
              "pg-drizzle_whatsapp_circuit_breaker",
            ],
            [
              "whatsapp_circuit_breaker_superadmin_manage",
              "pg-drizzle_whatsapp_circuit_breaker",
            ],
            [
              "whatsapp_circuit_breaker_worker_insert",
              "pg-drizzle_whatsapp_circuit_breaker",
            ],
            [
              "whatsapp_circuit_breaker_worker_manage",
              "pg-drizzle_whatsapp_circuit_breaker",
            ],
            [
              "whatsapp_circuit_breaker_worker_update",
              "pg-drizzle_whatsapp_circuit_breaker",
            ],
            [
              "whatsapp_metric_retention_scheduler_delete",
              "pg-drizzle_whatsapp_usage_metric",
            ],
            [
              "whatsapp_operational_retention_scheduler_delete",
              "pg-drizzle_whatsapp_circuit_breaker_audit",
            ],
            [
              "whatsapp_reservation_retention_scheduler_delete",
              "pg-drizzle_whatsapp_billing_reservation",
            ],
            [
              "whatsapp_usage_metric_superadmin_read",
              "pg-drizzle_whatsapp_usage_metric",
            ],
            [
              "whatsapp_usage_metric_worker_append",
              "pg-drizzle_whatsapp_usage_metric",
            ],
            [
              "whatsapp_usage_metric_worker_read",
              "pg-drizzle_whatsapp_usage_metric",
            ],
          ] as const) {
            await migrated.unsafe(
              `drop policy if exists "${policy[0]}" on "${policy[1]}"`,
            );
          }
          await migrated`
            drop table if exists "pg-drizzle_whatsapp_circuit_breaker_alert"
            cascade
          `;
          await reapplyForwardRepairs(migrated);

          const inboundColumns = await migrated<Array<{ column_name: string }>>`
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_whatsapp_inbound_reply'
              and column_name = 'last_provider_event_id'
          `;
          expect(inboundColumns).toEqual([
            { column_name: "last_provider_event_id" },
          ]);

          const reservationColumns = await migrated<
            Array<{ column_name: string }>
          >`
            select column_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'pg-drizzle_whatsapp_billing_reservation'
              and column_name = 'reserved_at'
          `;
          expect(reservationColumns).toEqual([{ column_name: "reserved_at" }]);

          const alertTables = await migrated<Array<{ table_name: string }>>`
            select table_name
            from information_schema.tables
            where table_schema = 'public'
              and table_name = 'pg-drizzle_whatsapp_circuit_breaker_alert'
          `;
          expect(alertTables).toEqual([
            { table_name: "pg-drizzle_whatsapp_circuit_breaker_alert" },
          ]);

          const billingTriggers = await migrated<
            Array<{ trigger_name: string }>
          >`
            select trigger_name
            from information_schema.triggers
            where trigger_schema = 'public'
              and event_object_table = 'pg-drizzle_whatsapp_billing'
              and trigger_name = 'whatsapp_billing_outbound_mutation_guard'
          `;
          expect(billingTriggers).toEqual([
            { trigger_name: "whatsapp_billing_outbound_mutation_guard" },
          ]);

          const connectionTriggers = await migrated<
            Array<{ trigger_name: string }>
          >`
            select trigger_name
            from information_schema.triggers
            where trigger_schema = 'public'
              and event_object_table = 'pg-drizzle_whatsapp_connection'
              and trigger_name = 'whatsapp_connection_circuit_mutation_guard'
          `;
          expect(connectionTriggers).toEqual([
            { trigger_name: "whatsapp_connection_circuit_mutation_guard" },
          ]);

          const circuitBreakerTriggers = await migrated<
            Array<{ trigger_name: string }>
          >`
            select trigger_name
            from information_schema.triggers
            where trigger_schema = 'public'
              and event_object_table = 'pg-drizzle_whatsapp_circuit_breaker'
              and trigger_name = 'whatsapp_circuit_breaker_worker_mutation_guard'
          `;
          expect(circuitBreakerTriggers).toEqual([
            {
              trigger_name: "whatsapp_circuit_breaker_worker_mutation_guard",
            },
          ]);

          const connectionWorkerPolicies = await migrated<
            Array<{ name: string; withCheck: string | null }>
          >`
            select policyname as name, with_check as "withCheck"
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_whatsapp_connection'
              and policyname in (
                'whatsapp_connection_circuit_worker_update',
                'whatsapp_connection_provisioning_worker_update'
              )
            order by policyname
          `;
          expect(connectionWorkerPolicies.map(({ name }) => name)).toEqual([
            "whatsapp_connection_circuit_worker_update",
            "whatsapp_connection_provisioning_worker_update",
          ]);
          for (const policy of connectionWorkerPolicies) {
            expect(policy.withCheck).toContain("status");
          }
          const provisioningWorkerPolicy = connectionWorkerPolicies.find(
            ({ name }) =>
              name === "whatsapp_connection_provisioning_worker_update",
          );
          expect(provisioningWorkerPolicy?.withCheck ?? "").toContain(
            "'ready'",
          );
          expect(provisioningWorkerPolicy?.withCheck ?? "").toContain(
            "'disconnected'",
          );
          expect(provisioningWorkerPolicy?.withCheck ?? "").toContain(
            "app.whatsapp_provisioning_event_id",
          );
          expect(provisioningWorkerPolicy?.withCheck ?? "").toContain(
            "app.whatsapp_provisioning_lease_token",
          );
          expect(provisioningWorkerPolicy?.withCheck ?? "").toContain(
            "pg-drizzle_whatsapp_provisioning_step",
          );
          expect(provisioningWorkerPolicy?.withCheck ?? "").toContain(
            '"pg-drizzle_whatsapp_connection"',
          );
          for (const clause of [
            "lease_expires_at",
            "clock_timestamp",
            "'succeeded'",
            "phone_number_id",
            "project_id",
            "metadata",
            "project-webhook",
            "phone-number-webhook",
          ]) {
            expect(provisioningWorkerPolicy?.withCheck ?? "").toContain(clause);
          }

          const repairedOperationalPolicies = await migrated<
            Array<{ name: string }>
          >`
            select policyname as name
            from pg_policies
            where schemaname = 'public'
              and policyname in (
                'whatsapp_billing_outbound_worker_capacity_update',
                'whatsapp_billing_outbound_worker_manage',
                'whatsapp_billing_reservation_outbound_worker_insert',
                'whatsapp_billing_reservation_outbound_worker_manage',
                'whatsapp_billing_reservation_outbound_worker_update',
                'whatsapp_billing_scheduler_read',
                'whatsapp_billing_scheduler_capacity_update',
                'whatsapp_billing_reservation_scheduler_read',
                'whatsapp_billing_reservation_scheduler_update',
                'whatsapp_inbound_reply_scheduler_read',
                'whatsapp_circuit_breaker_alert_superadmin_manage',
                'whatsapp_circuit_breaker_alert_worker_insert',
                'whatsapp_circuit_breaker_alert_worker_read',
                'whatsapp_circuit_breaker_alert_worker_update',
                'whatsapp_circuit_breaker_audit_superadmin_append',
                'whatsapp_circuit_breaker_audit_superadmin_read',
                'whatsapp_circuit_breaker_audit_worker_append',
                'whatsapp_circuit_breaker_clinic_owner_read',
                'whatsapp_circuit_breaker_provider_read',
                'whatsapp_circuit_breaker_superadmin_manage',
                'whatsapp_circuit_breaker_worker_insert',
                'whatsapp_circuit_breaker_worker_manage',
                'whatsapp_circuit_breaker_worker_update',
                'whatsapp_connection_circuit_worker_update',
                'whatsapp_connection_provisioning_worker_update',
                'whatsapp_metric_retention_scheduler_delete',
                'whatsapp_operational_retention_scheduler_delete',
                'whatsapp_reservation_retention_scheduler_delete',
                'whatsapp_usage_metric_superadmin_read',
                'whatsapp_usage_metric_worker_append',
                'whatsapp_usage_metric_worker_read'
              )
            order by name
          `;
          expect(repairedOperationalPolicies).toEqual([
            { name: "whatsapp_billing_outbound_worker_capacity_update" },
            { name: "whatsapp_billing_outbound_worker_manage" },
            {
              name: "whatsapp_billing_reservation_outbound_worker_insert",
            },
            {
              name: "whatsapp_billing_reservation_outbound_worker_manage",
            },
            {
              name: "whatsapp_billing_reservation_outbound_worker_update",
            },
            { name: "whatsapp_billing_reservation_scheduler_read" },
            { name: "whatsapp_billing_reservation_scheduler_update" },
            { name: "whatsapp_billing_scheduler_capacity_update" },
            { name: "whatsapp_billing_scheduler_read" },
            { name: "whatsapp_circuit_breaker_alert_superadmin_manage" },
            { name: "whatsapp_circuit_breaker_alert_worker_insert" },
            { name: "whatsapp_circuit_breaker_alert_worker_read" },
            { name: "whatsapp_circuit_breaker_alert_worker_update" },
            { name: "whatsapp_circuit_breaker_audit_superadmin_append" },
            { name: "whatsapp_circuit_breaker_audit_superadmin_read" },
            { name: "whatsapp_circuit_breaker_audit_worker_append" },
            { name: "whatsapp_circuit_breaker_clinic_owner_read" },
            { name: "whatsapp_circuit_breaker_provider_read" },
            { name: "whatsapp_circuit_breaker_superadmin_manage" },
            { name: "whatsapp_circuit_breaker_worker_insert" },
            { name: "whatsapp_circuit_breaker_worker_manage" },
            { name: "whatsapp_circuit_breaker_worker_update" },
            { name: "whatsapp_connection_circuit_worker_update" },
            { name: "whatsapp_connection_provisioning_worker_update" },
            { name: "whatsapp_inbound_reply_scheduler_read" },
            { name: "whatsapp_metric_retention_scheduler_delete" },
            { name: "whatsapp_operational_retention_scheduler_delete" },
            { name: "whatsapp_reservation_retention_scheduler_delete" },
            { name: "whatsapp_usage_metric_superadmin_read" },
            { name: "whatsapp_usage_metric_worker_append" },
            { name: "whatsapp_usage_metric_worker_read" },
          ]);

          const billingSubscriptionPolicy = await migrated<
            Array<{ usingExpression: string | null }>
          >`
            select qual as "usingExpression"
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_whatsapp_billing'
              and policyname = 'whatsapp_billing_subscription_active_read'
          `;
          expect(billingSubscriptionPolicy).toHaveLength(1);
          expect(billingSubscriptionPolicy[0]?.usingExpression).toContain(
            "appointment_scheduler",
          );

          const alertPolicies = await migrated<
            Array<{ command: string; name: string }>
          >`
            select cmd as command, policyname as name
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pg-drizzle_whatsapp_circuit_breaker_alert'
          `;
          expect(alertPolicies).toEqual(
            expect.arrayContaining([
              {
                command: "ALL",
                name: "whatsapp_circuit_breaker_alert_superadmin_manage",
              },
              {
                command: "INSERT",
                name: "whatsapp_circuit_breaker_alert_worker_insert",
              },
              {
                command: "SELECT",
                name: "whatsapp_circuit_breaker_alert_worker_read",
              },
              {
                command: "UPDATE",
                name: "whatsapp_circuit_breaker_alert_worker_update",
              },
            ]),
          );
        } finally {
          await migrated.end();
        }
      } finally {
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
