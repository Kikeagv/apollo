import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

const migrationStatements = readFileSync(
  "drizzle/0069_apo90_consent_opt_out_alerts.sql",
  "utf8",
)
  .split(/--> statement-breakpoint/g)
  .map((statement) => statement.trim())
  .filter(Boolean);

describe("compatibilidad de migraciones", () => {
  databaseTest(
    "migra las aceptaciones de canal al alcance de Contacto y conserva las revocaciones",
    async () => {
      const databaseName = `apo_112_${randomUUID().replaceAll("-", "")}`;
      const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
      const migratedUrl = new URL(process.env.DATABASE_URL!);
      migratedUrl.pathname = `/${databaseName}`;

      try {
        await admin.unsafe(`create database "${databaseName}"`);
        const migrated = postgres(migratedUrl.toString(), { max: 1 });
        try {
          await migrated.unsafe(`
            create table "pg-drizzle_whatsapp_contact_consent" (
              id uuid primary key,
              clinic_id uuid not null,
              contact_id uuid not null,
              patient_id uuid,
              accepted_role text not null,
              declaration text not null,
              scope text not null,
              status text not null,
              terms_version text not null,
              text_reference text not null,
              constraint whatsapp_contact_consent_scope check (
                (scope = 'channel' and patient_id is null)
                or (scope = 'patient' and patient_id is not null)
              )
            )
          `);
          await migrated.unsafe(`
            alter table "pg-drizzle_whatsapp_contact_consent"
              enable row level security
          `);
          await migrated.unsafe(`
            alter table "pg-drizzle_whatsapp_contact_consent"
              force row level security
          `);

          const clinicId = randomUUID();
          const contactId = randomUUID();
          const patientId = randomUUID();
          await migrated`
            insert into "pg-drizzle_whatsapp_contact_consent" (
              id, clinic_id, contact_id, patient_id, accepted_role,
              declaration, scope, status, terms_version, text_reference
            ) values
              (
                ${randomUUID()}, ${clinicId}, ${contactId}, null, 'contact',
                'CONTINUAR', 'channel', 'accepted', '0.9', 'terms-v0.9'
              ),
              (
                ${randomUUID()}, ${clinicId}, ${contactId}, null, 'contact',
                'No me escriban más', 'channel', 'revoked', '0.9', 'terms-v0.9'
              ),
              (
                ${randomUUID()}, ${clinicId}, ${contactId}, ${patientId},
                'adult-patient', 'legacy patient grant', 'patient',
                'accepted', '0.9', 'terms-v0.9'
              )
          `;

          const scopeMigrationStatements = readFileSync(
            "drizzle/0125_apo112_contact_whatsapp_consent.sql",
            "utf8",
          )
            .split(/--> statement-breakpoint/g)
            .map((statement) => statement.trim())
            .filter(Boolean);
          await migrated.begin(async (transaction) => {
            for (const statement of scopeMigrationStatements) {
              await transaction.unsafe(statement);
            }
          });

          const records = await migrated<
            Array<{
              declaration: string;
              patient_id: string | null;
              scope: string;
              status: string;
              terms_version: string;
              text_reference: string;
            }>
          >`
            select declaration, patient_id, scope, status,
              terms_version, text_reference
            from "pg-drizzle_whatsapp_contact_consent"
            order by status, scope
          `;
          expect(records).toEqual([
            {
              declaration: "CONTINUAR",
              patient_id: null,
              scope: "contact",
              status: "accepted",
              terms_version: "0.9",
              text_reference: "terms-v0.9",
            },
            {
              declaration: "legacy patient grant",
              patient_id: patientId,
              scope: "patient",
              status: "accepted",
              terms_version: "0.9",
              text_reference: "terms-v0.9",
            },
            {
              declaration: "No me escriban más",
              patient_id: null,
              scope: "contact",
              status: "revoked",
              terms_version: "0.9",
              text_reference: "terms-v0.9",
            },
          ]);

          await migrated.unsafe(`
            grant insert, select on "pg-drizzle_whatsapp_contact_consent"
              to panacea_clinical_access
          `);
          await migrated.begin(async (transaction) => {
            await transaction`set local role panacea_clinical_access`;
            await transaction`
              select set_config('app.clinic_id', ${clinicId}, true)
            `;
            await transaction`
              select set_config('app.whatsapp_inbound_worker', 'true', true)
            `;
            await transaction`
              insert into "pg-drizzle_whatsapp_contact_consent" (
                id, clinic_id, contact_id, patient_id, accepted_role,
                declaration, scope, status, terms_version, text_reference
              ) values (
                ${randomUUID()}, ${clinicId}, ${contactId}, null, 'contact',
                'CONTINUAR', 'contact', 'accepted', '1.0', 'terms-v1.0'
              )
            `;
          });

          await expect(
            migrated.begin(async (transaction) => {
              await transaction`set local role panacea_clinical_access`;
              await transaction`
                select set_config('app.clinic_id', ${clinicId}, true)
              `;
              await transaction`
                select set_config('app.whatsapp_inbound_worker', 'true', true)
              `;
              await transaction`
                insert into "pg-drizzle_whatsapp_contact_consent" (
                  id, clinic_id, contact_id, patient_id, accepted_role,
                  declaration, scope, status, terms_version, text_reference
                ) values (
                  ${randomUUID()}, ${clinicId}, ${contactId}, ${patientId},
                  'adult-patient', 'legacy patient grant', 'patient',
                  'accepted', '1.0', 'terms-v1.0'
                )
              `;
            }),
          ).rejects.toThrow();
        } finally {
          await migrated.end();
        }
      } finally {
        await admin.unsafe(`drop database if exists "${databaseName}"`);
        await admin.end();
      }
    },
    30_000,
  );

  databaseTest(
    "conserva las alertas de entrega resueltas al exigir evidencia nueva",
    async () => {
      const databaseName = `apo_90_${randomUUID().replaceAll("-", "")}`;
      const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
      const migratedUrl = new URL(process.env.DATABASE_URL!);
      migratedUrl.pathname = `/${databaseName}`;

      try {
        await admin.unsafe(`create database "${databaseName}"`);
        const migrated = postgres(migratedUrl.toString(), { max: 1 });
        try {
          await migrated`
            create table "pg-drizzle_whatsapp_contact_consent" (
              id uuid primary key
            )
          `;
          await migrated`
            create table "pg-drizzle_transactional_delivery_alert" (
              id uuid primary key,
              clinic_id uuid not null,
              resolved_at timestamp with time zone,
              resolved_by_clinic_user_id uuid,
              created_at timestamp with time zone default now() not null
            )
          `;
          await migrated`
            create policy "transactional_delivery_alert_clinic_resolve"
            on "pg-drizzle_transactional_delivery_alert"
            for update
            using ("clinic_id" = nullif(current_setting('app.clinic_id', true), '')::uuid)
            with check ("clinic_id" = nullif(current_setting('app.clinic_id', true), '')::uuid)
          `;
          await migrated`
            insert into "pg-drizzle_transactional_delivery_alert" (
              id,
              clinic_id,
              resolved_at,
              resolved_by_clinic_user_id
            ) values (
              ${randomUUID()},
              ${randomUUID()},
              now(),
              ${randomUUID()}
            )
          `;

          await migrated.begin(async (transaction) => {
            for (const statement of migrationStatements) {
              await transaction.unsafe(statement);
            }
          });

          const evidence = await migrated<
            Array<{ resolution_evidence: string | null }>
          >`
            select resolution_evidence
            from "pg-drizzle_transactional_delivery_alert"
          `;
          expect(evidence).toEqual([
            {
              resolution_evidence:
                "Resolución histórica migrada; no existía evidencia registrada antes de APO-90.",
            },
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
});
