import { and, eq, sql } from "drizzle-orm";

import {
  reservationOutcomeIsBillable,
  WHATSAPP_DEFAULT_META_RESERVATION_CENTS,
  WHATSAPP_DEFAULT_QUOTA_RESERVATION_UNITS,
  type WhatsAppBillingCapacityStore,
} from "~/server/application/whatsapp-billing-capacity";
import {
  inWhatsAppOutboundWorkerTransaction,
  lockWhatsAppCircuit,
} from "~/server/db/clinic-context";
import { openWhatsAppCircuitInTransaction } from "~/server/db/whatsapp-circuit-breaker-store";
import type { ClinicTransaction } from "~/server/db/clinic-context";
import {
  clinics,
  whatsappCircuitBreakers,
  whatsappBilling,
  whatsappBillingReservations,
} from "~/server/db/schema";

const RETAIN_MS = 365 * 24 * 60 * 60_000;

/** Reserva de capacidad bajo el mismo RLS que protege los envíos outbound. */
export const drizzleWhatsAppBillingCapacityStore: WhatsAppBillingCapacityStore =
  {
    async reserve(input) {
      return inWhatsAppOutboundWorkerTransaction(async (transaction) => {
        await setWorkerClinicContext(transaction, input.clinicId);
        await lockCapacity(transaction, input.clinicId);

        const circuit = await readCircuitStatus(transaction, input.clinicId);
        if (circuit === "open") {
          return { reason: "circuit-open", reserved: false } as const;
        }

        const [existing] = await transaction
          .select()
          .from(whatsappBillingReservations)
          .where(
            and(
              eq(whatsappBillingReservations.clinicId, input.clinicId),
              eq(
                whatsappBillingReservations.reservationKey,
                input.reservationKey,
              ),
            ),
          )
          .for("update");
        if (existing?.status === "reserved") {
          return { reserved: true, status: "already-reserved" } as const;
        }
        if (existing !== undefined) {
          if (existing.status === "settled") {
            // La clave de idempotencia ya cruzó el proveedor. Permitir que el
            // outbox repita la petición deja que Kapso reconcilie el mismo
            // envío sin volver a reservar crédito ni cuota.
            return { reserved: true, status: "already-settled" } as const;
          }
        }

        const [billing] = await transaction
          .select()
          .from(whatsappBilling)
          .where(eq(whatsappBilling.clinicId, input.clinicId))
          .for("update");
        if (billing?.status !== "ready") {
          return { reason: "billing-not-ready", reserved: false } as const;
        }

        const quotaUnits = Math.max(
          1,
          Math.round(
            input.quotaUnits ?? WHATSAPP_DEFAULT_QUOTA_RESERVATION_UNITS,
          ),
        );
        const creditCents = Math.max(
          0,
          Math.round(
            input.estimatedMetaChargesCents ??
              WHATSAPP_DEFAULT_META_RESERVATION_CENTS,
          ),
        );
        const availableCredit =
          billing.creditCents - billing.creditInFlightCents - creditCents;
        if (availableCredit <= (billing.creditReserveCents ?? 0)) {
          await openWhatsAppCircuitInTransaction(transaction, {
            actorKind: "worker",
            cause: "credit-exhausted",
            clinicId: input.clinicId,
            now: input.now,
            reason: "La reserva de crédito de Kapso está agotada",
          });
          return { reason: "credit-exhausted", reserved: false } as const;
        }

        const quotaUnavailable =
          billing.kapsoMonthlyQuota !== null &&
          billing.kapsoQuotaConsumed +
            billing.kapsoQuotaReserved +
            billing.kapsoQuotaInFlight +
            quotaUnits >
            billing.kapsoMonthlyQuota;
        if (quotaUnavailable) {
          await openWhatsAppCircuitInTransaction(transaction, {
            actorKind: "worker",
            cause: "quota-exhausted",
            clinicId: input.clinicId,
            now: input.now,
            reason: "La cuota mensual de mensajes de Kapso está agotada",
          });
          return { reason: "quota-exhausted", reserved: false } as const;
        }

        await transaction
          .update(whatsappBilling)
          .set({
            creditInFlightCents: sql`${whatsappBilling.creditInFlightCents} + ${creditCents}`,
            kapsoQuotaInFlight: sql`${whatsappBilling.kapsoQuotaInFlight} + ${quotaUnits}`,
            updatedAt: input.now,
          })
          .where(eq(whatsappBilling.clinicId, input.clinicId));
        if (existing?.status === "released") {
          await transaction
            .update(whatsappBillingReservations)
            .set({
              creditCents,
              reservedAt: input.now,
              outcome: null,
              quotaUnits,
              retainUntil: new Date(input.now.valueOf() + RETAIN_MS),
              settledAt: null,
              status: "reserved",
            })
            .where(eq(whatsappBillingReservations.id, existing.id));
        } else {
          await transaction.insert(whatsappBillingReservations).values({
            clinicId: input.clinicId,
            creditCents,
            quotaUnits,
            reservationKey: input.reservationKey,
            retainUntil: new Date(input.now.valueOf() + RETAIN_MS),
            reservedAt: input.now,
            status: "reserved",
          });
        }
        return { reserved: true, status: "reserved" } as const;
      });
    },

    async settle(input) {
      await inWhatsAppOutboundWorkerTransaction(async (transaction) => {
        await setWorkerClinicContext(transaction, input.clinicId);
        await lockCapacity(transaction, input.clinicId);
        const [reservation] = await transaction
          .select()
          .from(whatsappBillingReservations)
          .where(
            and(
              eq(whatsappBillingReservations.clinicId, input.clinicId),
              eq(
                whatsappBillingReservations.reservationKey,
                input.reservationKey,
              ),
              eq(whatsappBillingReservations.status, "reserved"),
            ),
          )
          .for("update");
        if (reservation === undefined) return;

        await transaction
          .update(whatsappBilling)
          .set({
            creditCents: reservationOutcomeIsBillable(input.outcome)
              ? sql`greatest(0, ${whatsappBilling.creditCents} - ${reservation.creditCents})`
              : undefined,
            creditInFlightCents: sql`greatest(0, ${whatsappBilling.creditInFlightCents} - ${reservation.creditCents})`,
            consumedCents: reservationOutcomeIsBillable(input.outcome)
              ? sql`${whatsappBilling.consumedCents} + ${reservation.creditCents}`
              : undefined,
            // Los cargos reales de Meta llegan después mediante la
            // sincronización de billing; la reserva nunca los atribuye.
            metaChargesCents: undefined,
            kapsoQuotaConsumed: reservationOutcomeIsBillable(input.outcome)
              ? sql`${whatsappBilling.kapsoQuotaConsumed} + ${reservation.quotaUnits}`
              : undefined,
            kapsoQuotaInFlight: sql`greatest(0, ${whatsappBilling.kapsoQuotaInFlight} - ${reservation.quotaUnits})`,
            updatedAt: input.now,
          })
          .where(eq(whatsappBilling.clinicId, input.clinicId));
        await transaction
          .update(whatsappBillingReservations)
          .set({
            outcome: input.outcome,
            settledAt: input.now,
            status: reservationOutcomeIsBillable(input.outcome)
              ? "settled"
              : "released",
          })
          .where(eq(whatsappBillingReservations.id, reservation.id));
      });
    },
  };

async function setWorkerClinicContext(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  await transaction.execute(
    sql`select set_config('app.clinic_id', ${clinicId}, true)`,
  );
  const clinic = await transaction.query.clinics.findFirst({
    columns: { subscriptionStatus: true },
    where: eq(clinics.id, clinicId),
  });
  if (clinic?.subscriptionStatus !== "active") {
    throw new Error("La Clínica no está activa");
  }
  await transaction.execute(
    sql`select set_config('app.subscription_status', ${clinic.subscriptionStatus}, true)`,
  );
}

async function lockCapacity(transaction: ClinicTransaction, clinicId: string) {
  await lockWhatsAppCircuit(transaction, clinicId);
}

async function readCircuitStatus(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  const circuit = await transaction.query.whatsappCircuitBreakers.findFirst({
    columns: { status: true },
    where: eq(whatsappCircuitBreakers.clinicId, clinicId),
  });
  return circuit?.status === "open" ? "open" : "closed";
}
