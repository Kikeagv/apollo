import { describe, expect, it } from "vitest";

import {
  appointmentEventTypes,
  appointmentOutboundEventTypes,
} from "./appointment-events";

describe("Vocabulario de Eventos de Cita", () => {
  it("mantiene un conjunto canónico para persistencia y sus consumidores", () => {
    expect(appointmentEventTypes).toEqual([
      "manual-created",
      "cancelled",
      "manual-confirmation-sent",
      "manual-confirmation-failed",
      "manual-cancellation-sent",
      "manual-cancellation-failed",
      "appointment-delivery-status",
      "appointment-reschedule-sent",
      "appointment-reschedule-failed",
      "appointment-confirmation-sent",
      "appointment-confirmation-failed",
      "appointment-cancellation-sent",
      "appointment-cancellation-failed",
      "reservation-confirmed",
      "rescheduled",
      "self-management-escalated",
      "self-management-resolved",
      "reminder-claimed",
      "reminder-sent",
      "reminder-failed",
      "reminder-delivered",
      "reminder-delivery-failed",
      "no-show-alerted",
      "no-show-auto-cancelled",
    ]);
  });

  it("expone el conjunto saliente que debe autorizar la política RLS", () => {
    expect(appointmentOutboundEventTypes).toEqual([
      "appointment-cancellation-failed",
      "appointment-cancellation-sent",
      "appointment-confirmation-failed",
      "appointment-confirmation-sent",
      "appointment-delivery-status",
      "appointment-reschedule-failed",
      "appointment-reschedule-sent",
      "manual-confirmation-failed",
      "manual-confirmation-sent",
      "manual-cancellation-failed",
      "manual-cancellation-sent",
      "reminder-delivery-failed",
      "reminder-sent",
    ]);
  });
});
