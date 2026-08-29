import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  DEMO_REQUEST_WINDOW_MS,
  hashDemoRequestRateLimitKey,
} from "~/server/application/demo-request";
import { db } from "~/server/db";
import { drizzleDemoRequestRateLimitStore } from "~/server/db/demo-request-rate-limit-store";
import { demoRequestRateLimitAttempts } from "~/server/db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("persistencia de límites de Solicitud de demo", () => {
  databaseTest(
    "conserva hashes por ámbito y no expone filas sin el contexto RLS",
    async () => {
      const ipHash = hashDemoRequestRateLimitKey("ip", "203.0.113.68");
      const emailHash = hashDemoRequestRateLimitKey(
        "email",
        "ana-apo68@example.test",
      );
      const requestedAt = new Date("2026-08-29T00:00:00.000Z");

      try {
        await expect(
          drizzleDemoRequestRateLimitStore.reserve({
            emailHash,
            ipHash,
            requestedAt,
            since: new Date(requestedAt.getTime() - DEMO_REQUEST_WINDOW_MS),
          }),
        ).resolves.toBe(true);

        await expect(
          drizzleDemoRequestRateLimitStore.countRecent({
            keyHash: ipHash,
            scope: "ip",
            since: new Date(requestedAt.getTime() - DEMO_REQUEST_WINDOW_MS),
          }),
        ).resolves.toBe(1);
        await expect(
          drizzleDemoRequestRateLimitStore.countRecent({
            keyHash: hashDemoRequestRateLimitKey("ip", "203.0.113.69"),
            scope: "ip",
            since: new Date(requestedAt.getTime() - DEMO_REQUEST_WINDOW_MS),
          }),
        ).resolves.toBe(0);
        await expect(
          drizzleDemoRequestRateLimitStore.countRecent({
            keyHash: emailHash,
            scope: "email",
            since: new Date(requestedAt.getTime() - DEMO_REQUEST_WINDOW_MS),
          }),
        ).resolves.toBe(1);

        const unscopedRows =
          await db.query.demoRequestRateLimitAttempts.findMany({
            columns: { id: true },
          });
        expect(unscopedRows).toEqual([]);
      } finally {
        await db.transaction(async (transaction) => {
          for (const [scope, keyHash] of [
            ["ip", ipHash],
            ["email", emailHash],
          ] as const) {
            await transaction.execute(
              sql`select set_config('app.demo_request_rate_limit_scope', ${scope}, true)`,
            );
            await transaction.execute(
              sql`select set_config('app.demo_request_rate_limit_key', ${keyHash}, true)`,
            );
            await transaction
              .delete(demoRequestRateLimitAttempts)
              .where(
                and(
                  eq(demoRequestRateLimitAttempts.scope, scope),
                  eq(demoRequestRateLimitAttempts.keyHash, keyHash),
                ),
              );
          }
        });
      }
    },
  );
});
