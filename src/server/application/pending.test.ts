import { describe, expect, it, vi } from "vitest";

import {
  listPendingCases,
  PendingCaseResolutionError,
  resolvePendingCase,
} from "./pending";
import type { PendingCase } from "~/domain/pending";

const openConversation: PendingCase = {
  category: "conversation",
  contact: { id: "contact-1", name: "Ana" },
  createdAt: new Date("2026-08-14T12:00:00.000Z"),
  id: "conversation-1",
  priority: "high",
  resolvedAt: null,
  status: "open",
  trigger: "human-request",
};

describe("caso de uso de Pendientes", () => {
  it("consulta el read model con la Clínica, Identidad y estado solicitados", async () => {
    const list = vi.fn(async () => [openConversation]);

    await expect(
      listPendingCases(
        {
          category: "all",
          clinicId: "clinic-1",
          identityId: "identity-1",
          status: "open",
        },
        { listPendingCases: list },
      ),
    ).resolves.toMatchObject({
      counts: { conversation: 1 },
      items: [{ id: "conversation-1" }],
      total: 1,
    });
    expect(list).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "identity-1",
      status: "open",
    });
  });

  it("delega cada resolución al comando específico de su categoría", async () => {
    const resolveConversation = vi.fn(async () => true);
    const resolveAppointment = vi.fn(async () => true);
    const resolveDelivery = vi.fn(async () => true);
    const resolver = {
      resolveAppointmentSelfManagementEscalation: resolveAppointment,
      resolveConversationEscalation: resolveConversation,
      resolveTransactionalDeliveryAlert: resolveDelivery,
    };

    await resolvePendingCase(
      {
        category: "conversation",
        clinicId: "clinic-1",
        identityId: "identity-1",
        id: "conversation-1",
      },
      resolver,
    );
    await resolvePendingCase(
      {
        category: "appointment",
        clinicId: "clinic-1",
        identityId: "identity-1",
        id: "appointment-1",
      },
      resolver,
    );
    await resolvePendingCase(
      {
        category: "delivery",
        clinicId: "clinic-1",
        identityId: "identity-1",
        id: "delivery-1",
      },
      resolver,
    );

    expect(resolveConversation).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      escalationId: "conversation-1",
      identityId: "identity-1",
    });
    expect(resolveAppointment).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      escalationId: "appointment-1",
      identityId: "identity-1",
    });
    expect(resolveDelivery).toHaveBeenCalledWith({
      alertId: "delivery-1",
      clinicId: "clinic-1",
      identityId: "identity-1",
      now: expect.any(Date) as Date,
    });
  });

  it("expone como error un caso que ya no puede resolverse para permitir reintento", async () => {
    await expect(
      resolvePendingCase(
        {
          category: "conversation",
          clinicId: "clinic-1",
          identityId: "identity-1",
          id: "conversation-1",
        },
        {
          resolveAppointmentSelfManagementEscalation: async () => true,
          resolveConversationEscalation: async () => false,
          resolveTransactionalDeliveryAlert: async () => true,
        },
      ),
    ).rejects.toBeInstanceOf(PendingCaseResolutionError);
  });
});
