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
      const databaseName = `apo_43_${randomUUID().replaceAll("-", "")}`;
      const roleName = `apo_43_${randomUUID().replaceAll("-", "")}`;
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
          expect(policies).toEqual([
            { command: "INSERT", name: "appointment_event_append" },
            { command: "SELECT", name: "appointment_event_operating_read" },
          ]);
        } finally {
          await migrated.end();
        }

        await admin.unsafe(
          `create role "${roleName}" login password '${password}'`,
        );
        await admin.unsafe(`grant panacea_clinical_access to "${roleName}"`);

        const restrictedUrl = new URL(migratedUrl);
        restrictedUrl.username = roleName;
        restrictedUrl.password = password;
        const restricted = postgres(restrictedUrl.toString(), { max: 1 });
        try {
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
          ).rejects.toThrow(/foreign key/i);
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
