import { describe, expect, it, vi } from "vitest";

import type { WhatsAppOutboundReplyStore } from "./whatsapp-outbound";
import { runWhatsAppOutboundReplyWorker } from "./whatsapp-outbound";

const reply = {
  attempts: 1,
  buttonLabel: undefined,
  clinicId: "clinic-1",
  id: "reply-1",
  idempotencyKey: "message-1",
  leaseToken: "lease-1",
  recipientBusinessScopedUserId: "bsuid-1",
  recipientPhoneE164: null,
  text: "Respuesta",
};

describe("worker outbound de respuestas WhatsApp", () => {
  it("persiste el ID de Kapso y no reenvía desde el worker de estado", async () => {
    const store = {
      claimDueReplies: vi.fn().mockResolvedValue([reply]),
      markAcceptedReply: vi.fn().mockResolvedValue(undefined),
      markFailedReply: vi.fn(),
      markUnknownReply: vi.fn(),
      scheduleReplyRetry: vi.fn(),
    };

    await expect(
      runWhatsAppOutboundReplyWorker(
        { now: new Date("2026-09-09T12:00:00.000Z") },
        store,
        {
          send: vi.fn().mockResolvedValue({
            providerMessageId: "wamid-1",
            status: "accepted",
          }),
        },
      ),
    ).resolves.toEqual({
      accepted: 1,
      claimed: 1,
      failed: 0,
      retried: 0,
      unknown: 0,
    });

    expect(store.markAcceptedReply).toHaveBeenCalledWith({
      id: "reply-1",
      leaseToken: "lease-1",
      now: new Date("2026-09-09T12:00:00.000Z"),
      providerMessageId: "wamid-1",
    });
  });

  it("honra un 429 sin hot retry y marca fallo permanente sin duplicar", async () => {
    const store = {
      claimDueReplies: vi.fn().mockResolvedValue([reply]),
      markAcceptedReply: vi.fn(),
      markFailedReply: vi.fn(),
      markUnknownReply: vi.fn(),
      scheduleReplyRetry: vi.fn().mockResolvedValue(undefined),
    };
    const nextAttemptAt = new Date("2026-09-09T12:00:09.000Z");

    await runWhatsAppOutboundReplyWorker(
      { now: new Date("2026-09-09T12:00:00.000Z") },
      store,
      {
        send: vi.fn().mockRejectedValue(
          Object.assign(new Error("rate limit"), {
            nextAttemptAt,
            retryable: true,
          }),
        ),
      },
    );

    expect(store.scheduleReplyRetry).toHaveBeenCalledWith({
      id: "reply-1",
      leaseToken: "lease-1",
      nextAttemptAt,
      reason: "rate limit",
      retriedAt: new Date("2026-09-09T12:00:00.000Z"),
    });
  });

  it("no envía una respuesta cuando la Ventana de servicio ya expiró", async () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    const expiredReply = {
      ...reply,
      serviceWindowExpiresAt: new Date("2026-09-09T11:59:59.000Z"),
    };
    const store = {
      claimDueReplies: vi.fn().mockResolvedValue([expiredReply]),
      markAcceptedReply: vi.fn(),
      markFailedReply: vi.fn().mockResolvedValue(undefined),
      markUnknownReply: vi.fn(),
      scheduleReplyRetry: vi.fn(),
    };
    const send = vi.fn();

    await expect(
      runWhatsAppOutboundReplyWorker({ now }, store, { send }),
    ).resolves.toMatchObject({
      accepted: 0,
      claimed: 1,
      failed: 1,
    });

    expect(send).not.toHaveBeenCalled();
    expect(store.markFailedReply).toHaveBeenCalledWith({
      id: "reply-1",
      leaseToken: "lease-1",
      now,
      reason: "La Ventana de servicio de WhatsApp ya expiró",
    });
  });

  it("no reintenta si falla guardar un ID ya aceptado por Kapso", async () => {
    const markUnknownReply = vi
      .fn<WhatsAppOutboundReplyStore["markUnknownReply"]>()
      .mockResolvedValue(undefined);
    const store = {
      claimDueReplies: vi.fn().mockResolvedValue([reply]),
      markAcceptedReply: vi
        .fn()
        .mockRejectedValue(new Error("base no disponible")),
      markFailedReply: vi.fn(),
      markUnknownReply,
      scheduleReplyRetry: vi.fn(),
    };

    await expect(
      runWhatsAppOutboundReplyWorker(
        { now: new Date("2026-09-09T12:00:00.000Z") },
        store,
        {
          send: vi.fn().mockResolvedValue({
            providerMessageId: "wamid-1",
            status: "accepted",
          }),
        },
      ),
    ).resolves.toMatchObject({ accepted: 0, retried: 0, unknown: 1 });

    const unknownCall = markUnknownReply.mock.calls[0]?.[0];
    expect(unknownCall?.id).toBe("reply-1");
    expect(unknownCall?.leaseToken).toBe("lease-1");
    expect(unknownCall?.now).toEqual(new Date("2026-09-09T12:00:00.000Z"));
    expect(unknownCall?.reason).toContain("base");
    expect(store.scheduleReplyRetry).not.toHaveBeenCalled();
  });
});
