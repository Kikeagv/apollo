export const WHATSAPP_DEFAULT_QUOTA_RESERVATION_UNITS = 1;
export const WHATSAPP_DEFAULT_META_RESERVATION_CENTS = 1;
export const WHATSAPP_BILLING_RESERVATION_LEASE_MS = 30 * 60_000;

export type WhatsAppBillingCapacityReservationResult =
  | {
      reserved: true;
      status: "reserved" | "already-reserved" | "already-settled";
    }
  | {
      reserved: false;
      reason:
        | "billing-not-ready"
        | "credit-exhausted"
        | "quota-exhausted"
        | "circuit-open";
    };

export type WhatsAppBillingCapacityStore = {
  reserve(input: {
    clinicId: string;
    estimatedMetaChargesCents?: number;
    allowOpenCircuitForSmoke?: boolean;
    now: Date;
    quotaUnits?: number;
    recipientPhoneE164?: string | null;
    reservationKey: string;
  }): Promise<WhatsAppBillingCapacityReservationResult>;
  settle(input: {
    clinicId: string;
    now: Date;
    outcome: "accepted" | "delivered" | "failed" | "unknown";
    reservationKey: string;
  }): Promise<void>;
};

export function reservationOutcomeIsBillable(
  outcome: "accepted" | "delivered" | "failed" | "unknown",
) {
  // `unknown` consumió la reserva: no se puede volver a enviar sin
  // idempotencia, aunque el cargo Meta todavía deba reconciliarse.
  return outcome !== "failed";
}
