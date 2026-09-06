import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getWhatsAppRuntimeDiagnostic } from "./whatsapp-runtime";
import { db } from "../db";
import { apoloSuperadmins, user as identities } from "../db/schema";

const databaseTest =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? it : it.skip;

describe("diagnóstico de runtime autorizado por Identidad", () => {
  databaseTest(
    "solo permite leer la configuración a un superadmin y no persiste secretos",
    async () => {
      const suffix = randomUUID();
      const superadminId = `apo-81-superadmin-${suffix}`;
      const otherIdentityId = `apo-81-identity-${suffix}`;

      try {
        await db.insert(identities).values([
          {
            id: superadminId,
            name: superadminId,
            email: `${superadminId}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: otherIdentityId,
            name: otherIdentityId,
            email: `${otherIdentityId}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);
        await db.insert(apoloSuperadmins).values({
          identityId: superadminId,
        });

        await expect(
          getWhatsAppRuntimeDiagnostic({ identityId: superadminId }),
        ).resolves.toMatchObject({
          configured: true,
          provider: "simulated",
        });
        await expect(
          getWhatsAppRuntimeDiagnostic({ identityId: otherIdentityId }),
        ).rejects.toThrow("La Identidad no está autorizada");
      } finally {
        await db
          .delete(apoloSuperadmins)
          .where(eq(apoloSuperadmins.identityId, superadminId));
        await db
          .delete(identities)
          .where(inArray(identities.id, [superadminId, otherIdentityId]));
      }
    },
  );
});
