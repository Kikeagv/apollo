import { describe, expect, it } from "vitest";

import { aggregatePendingCases, type PendingCase } from "./pending";

const date = (value: string) => new Date(`2026-08-${value}T12:00:00.000Z`);

describe("bandeja de Pendientes", () => {
  it("agrupa, cuenta y ordena los casos abiertos por prioridad y antigüedad", () => {
    const cases: PendingCase[] = [
      {
        category: "conversation",
        contact: { id: "contact-1", name: "Ana" },
        createdAt: date("14"),
        id: "conversation-1",
        priority: "low",
        resolvedAt: null,
        status: "open",
        trigger: "human-request",
      },
      {
        action: "cancel",
        appointmentId: "appointment-1",
        category: "appointment",
        contact: { id: "contact-2", name: "Beto" },
        createdAt: date("12"),
        id: "appointment-1",
        priority: "urgent",
        requestedStartsAt: null,
        resolvedAt: null,
        status: "open",
      },
      {
        category: "delivery",
        createdAt: date("13"),
        delivery: {
          attempts: 5,
          idempotencyKey: "delivery-key",
          kind: "appointment-reminder",
          lastError: "Proveedor no disponible",
        },
        id: "delivery-1",
        priority: "high",
        resolvedAt: null,
        status: "open",
      },
      {
        category: "conversation",
        contact: { id: "contact-3", name: "Carla" },
        createdAt: date("11"),
        id: "conversation-2",
        priority: "normal",
        resolvedAt: date("15"),
        status: "resolved",
        trigger: "frustration",
      },
    ];

    const inbox = aggregatePendingCases(cases, { status: "open" });

    expect(inbox.items.map((pending) => pending.id)).toEqual([
      "appointment-1",
      "delivery-1",
      "conversation-1",
    ]);
    expect(inbox.counts).toEqual({
      appointment: 1,
      conversation: 1,
      delivery: 1,
    });
    expect(inbox.total).toBe(3);
  });

  it("filtra una categoría sin alterar los contadores del estado seleccionado", () => {
    const cases: PendingCase[] = [
      {
        category: "conversation",
        contact: { id: "contact-1", name: "Ana" },
        createdAt: date("10"),
        id: "conversation-1",
        priority: null,
        resolvedAt: null,
        status: "open",
        trigger: "misunderstanding",
      },
      {
        category: "delivery",
        createdAt: date("11"),
        delivery: {
          attempts: 5,
          idempotencyKey: "delivery-key",
          kind: "daily-agenda-pdf",
          lastError: null,
        },
        id: "delivery-1",
        priority: null,
        resolvedAt: null,
        status: "open",
      },
    ];

    const inbox = aggregatePendingCases(cases, {
      category: "delivery",
      status: "open",
    });

    expect(inbox.items.map((pending) => pending.category)).toEqual([
      "delivery",
    ]);
    expect(inbox.counts).toEqual({
      appointment: 0,
      conversation: 1,
      delivery: 1,
    });
    expect(inbox.total).toBe(2);
  });

  it("separa el historial resuelto de la cola abierta", () => {
    const cases: PendingCase[] = [
      {
        category: "conversation",
        contact: { id: "contact-1", name: "Ana" },
        createdAt: date("10"),
        id: "conversation-open",
        priority: "high",
        resolvedAt: null,
        status: "open",
        trigger: "human-request",
      },
      {
        category: "conversation",
        contact: { id: "contact-2", name: "Beto" },
        createdAt: date("09"),
        id: "conversation-resolved",
        priority: "high",
        resolvedAt: date("11"),
        status: "resolved",
        trigger: "frustration",
      },
    ];

    const history = aggregatePendingCases(cases, { status: "resolved" });

    expect(history.items.map((pending) => pending.id)).toEqual([
      "conversation-resolved",
    ]);
    expect(history.counts).toEqual({
      appointment: 0,
      conversation: 1,
      delivery: 0,
    });
  });
});
