import { and, eq, sql } from "drizzle-orm";

import { inWhatsAppProviderTransaction } from "~/server/db/clinic-context";
import { whatsappSendRateLimitSlots } from "~/server/db/schema";

const KAPSO_MESSAGES_PER_SECOND = 5;
const KAPSO_SEND_INTERVAL_MS = 1_000 / KAPSO_MESSAGES_PER_SECOND;

/** Reserva una ranura distribuida antes de llamar a Kapso. */
export async function reserveWhatsAppSendSlot(input: {
  clinicId: string;
  now: Date;
  phoneNumberId: string;
}) {
  const waitMs = await inWhatsAppProviderTransaction(
    input.clinicId,
    async (transaction) => {
      const lockKey = `whatsapp-send-rate:${input.phoneNumberId}`;
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const current =
        await transaction.query.whatsappSendRateLimitSlots.findFirst({
          columns: { id: true, nextAllowedAt: true },
          where: and(
            eq(whatsappSendRateLimitSlots.clinicId, input.clinicId),
            eq(whatsappSendRateLimitSlots.phoneNumberId, input.phoneNumberId),
          ),
        });
      const slotAt =
        current === undefined || current.nextAllowedAt <= input.now
          ? input.now
          : current.nextAllowedAt;
      const nextAllowedAt = new Date(slotAt.valueOf() + KAPSO_SEND_INTERVAL_MS);
      if (current === undefined) {
        await transaction.insert(whatsappSendRateLimitSlots).values({
          clinicId: input.clinicId,
          nextAllowedAt,
          phoneNumberId: input.phoneNumberId,
        });
      } else {
        await transaction
          .update(whatsappSendRateLimitSlots)
          .set({ nextAllowedAt, updatedAt: input.now })
          .where(eq(whatsappSendRateLimitSlots.id, current.id));
      }
      return Math.max(0, slotAt.valueOf() - input.now.valueOf());
    },
  );
  return waitMs ?? 0;
}

export const whatsappSendRateLimit = {
  intervalMs: KAPSO_SEND_INTERVAL_MS,
};
