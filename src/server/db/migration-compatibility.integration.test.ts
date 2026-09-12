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
