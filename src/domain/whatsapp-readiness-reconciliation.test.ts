import { describe, expect, it } from "vitest";

import {
  isWhatsAppReadinessReconciliationDue,
  nextWhatsAppReadinessHealthCheckAt,
  nextWhatsAppReadinessPendingAt,
  nextWhatsAppReadinessReconciliationAttemptAt,
  whatsappReadinessReconciliationMaxAttempts,
} from "./whatsapp-readiness-reconciliation";

const now = new Date("2026-09-21T12:00:00.000Z");

describe("reconciliación automática de readiness", () => {
  it("usa backoff acotado y deja de reintentar al alcanzar el límite", () => {
    expect(nextWhatsAppReadinessReconciliationAttemptAt(now, 0)).toEqual(
      new Date("2026-09-21T12:00:10.000Z"),
    );
    expect(nextWhatsAppReadinessReconciliationAttemptAt(now, 1)).toEqual(
      new Date("2026-09-21T12:00:10.000Z"),
    );
    expect(nextWhatsAppReadinessReconciliationAttemptAt(now, 2)).toEqual(
      new Date("2026-09-21T12:00:40.000Z"),
    );
    expect(
      nextWhatsAppReadinessReconciliationAttemptAt(
        now,
        whatsappReadinessReconciliationMaxAttempts,
      ),
    ).toBeNull();
  });

  it("considera vencida la salud justo al terminar su ventana de cinco minutos", () => {
    expect(
      nextWhatsAppReadinessHealthCheckAt(
        now,
        new Date("2026-09-21T11:55:00.000Z"),
        5 * 60_000,
      ),
    ).toEqual(now);
    expect(
      isWhatsAppReadinessReconciliationDue(
        { nextAttemptAt: now, status: "succeeded" },
        now,
      ),
    ).toBe(true);
    expect(nextWhatsAppReadinessPendingAt(now)).toEqual(
      new Date("2026-09-21T12:05:00.000Z"),
    );
  });
});
