import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { lockWhatsAppCircuit } from "./clinic-context";
import * as schema from "./schema";

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

describe("RLS de cancelación de Entregas al retirar WhatsApp", () => {
  databaseTest(
    "limita la cancelación a una Clínica y serializa cambios concurrentes",
    async () => {
      const databaseName = `apo_108_${randomUUID().replaceAll("-", "")}`;
      const roleName = `apo_108_${randomUUID().replaceAll("-", "")}`;
      const password = randomUUID();
      const clinicId = randomUUID();
      const otherClinicId = randomUUID();
      const deliveryIds = {
        clinic: randomUUID(),
        other: randomUUID(),
        nonWhatsApp: randomUUID(),
      };
      const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
      const migratedUrl = new URL(process.env.DATABASE_URL!);
      migratedUrl.pathname = `/${databaseName}`;
      let databaseCreated = false;
      let roleCreated = false;

      try {
        await admin.unsafe(`create database "${databaseName}"`);
        databaseCreated = true;
        await runMigrations(migratedUrl.toString());

        const migrated = postgres(migratedUrl.toString(), { max: 1 });
        const restrictedUrl = new URL(migratedUrl);
        restrictedUrl.username = roleName;
        restrictedUrl.password = password;
        let restricted: postgres.Sql | undefined;
        try {
          await admin.unsafe(
            `create role "${roleName}" login password '${password}'`,
          );
          roleCreated = true;
          await admin.unsafe(`grant panacea_clinical_access to "${roleName}"`);
          await migrated`
            insert into "pg-drizzle_transactional_delivery" (
              id, clinic_id, kind, idempotency_key, payload, status,
              next_attempt_at, retain_until
            ) values
              (
                ${deliveryIds.clinic}, ${clinicId}, 'appointment-message',
                'apo108-clinic-delivery', '{}'::jsonb, 'pending', now(),
                now() + interval '1 year'
              ),
              (
                ${deliveryIds.other}, ${otherClinicId},
                'appointment-reminder', 'apo108-other-delivery',
                '{}'::jsonb, 'pending', now(), now() + interval '1 year'
              ),
              (
                ${deliveryIds.nonWhatsApp}, ${clinicId}, 'daily-agenda-pdf',
                'apo108-non-whatsapp-delivery', '{}'::jsonb, 'pending', now(),
                now() + interval '1 year'
              )
          `;
          restricted = postgres(restrictedUrl.toString(), { max: 1 });

          const updateAs = async (superadminId: string | null) =>
            restricted!.begin(async (transaction) => {
              await transaction`set local role panacea_clinical_access`;
              await transaction`select set_config(
                'app.clinic_id', ${clinicId}, true
              )`;
              await transaction`select set_config(
                'app.subscription_status', 'suspended', true
              )`;
              await transaction`select set_config(
                'app.whatsapp_offboarding', 'true', true
              )`;
              if (superadminId !== null) {
                await transaction`select set_config(
                  'app.superadmin_id', ${superadminId}, true
                )`;
              }
              return transaction<Array<{ id: string }>>`
                update "pg-drizzle_transactional_delivery"
                set
                  status = 'suppressed',
                  last_error = 'Conexión de WhatsApp retirada de Praxia'
                where status = 'pending'
                returning id
              `;
            });

          await expect(updateAs(null)).resolves.toEqual([]);
          await expect(updateAs("offboarding-superadmin")).resolves.toEqual([
            { id: deliveryIds.clinic },
          ]);

          const statuses = await migrated<
            Array<{ id: string; status: string }>
          >`
            select id, status
            from "pg-drizzle_transactional_delivery"
            where id in (
              ${deliveryIds.clinic}, ${deliveryIds.other},
              ${deliveryIds.nonWhatsApp}
            )
            order by id
          `;
          expect(statuses).toEqual(
            [
              { id: deliveryIds.clinic, status: "suppressed" },
              { id: deliveryIds.nonWhatsApp, status: "pending" },
              { id: deliveryIds.other, status: "pending" },
            ].sort((left, right) => left.id.localeCompare(right.id)),
          );

          const competingClient = postgres(migratedUrl.toString(), {
            max: 1,
          });
          const firstDatabase = drizzle(migrated, { schema });
          const competingDatabase = drizzle(competingClient, { schema });
          let releaseHeldLock!: () => void;
          let signalLockHeld!: () => void;
          const heldLock = new Promise<void>((resolve) => {
            signalLockHeld = resolve;
          });
          const releaseLock = new Promise<void>((resolve) => {
            releaseHeldLock = resolve;
          });
          const pendingTransactions: Promise<unknown>[] = [];
          try {
            const firstTransaction = firstDatabase.transaction(
              async (transaction) => {
                await lockWhatsAppCircuit(transaction, clinicId);
                signalLockHeld();
                await releaseLock;
              },
            );
            pendingTransactions.push(firstTransaction);
            await heldLock;

            let signalWaiterStarted!: () => void;
            const waiterStarted = new Promise<void>((resolve) => {
              signalWaiterStarted = resolve;
            });
            let waiterAcquiredLock = false;
            const waitingTransaction = competingDatabase.transaction(
              async (transaction) => {
                signalWaiterStarted();
                await lockWhatsAppCircuit(transaction, clinicId);
                waiterAcquiredLock = true;
              },
            );
            pendingTransactions.push(waitingTransaction);
            await waiterStarted;
            await new Promise((resolve) => setTimeout(resolve, 25));
            expect(waiterAcquiredLock).toBe(false);

            releaseHeldLock();
            await Promise.all([firstTransaction, waitingTransaction]);
            expect(waiterAcquiredLock).toBe(true);
          } finally {
            releaseHeldLock();
            await Promise.allSettled(pendingTransactions);
            await competingClient.end();
          }
        } finally {
          await restricted?.end();
          await migrated.end();
        }
      } finally {
        if (databaseCreated) {
          await admin.unsafe(`drop database if exists "${databaseName}"`);
        }
        if (roleCreated) {
          await admin.unsafe(`drop role if exists "${roleName}"`);
        }
        await admin.end();
      }
    },
  );
});
