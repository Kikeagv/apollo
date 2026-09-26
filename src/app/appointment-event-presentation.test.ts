import { describe, expect, it } from "vitest";

import { appointmentEventLabel } from "./appointment-event-presentation";

describe("etiquetas de Eventos de Cita", () => {
  it("usa las mismas etiquetas operativas en el Calendario y la Ficha", () => {
    const eventTypes = [
      "manual-confirmation-sent",
      "manual-confirmation-failed",
      "manual-cancellation-sent",
      "manual-cancellation-failed",
      "appointment-reschedule-sent",
      "appointment-reschedule-failed",
      "appointment-confirmation-sent",
      "appointment-confirmation-failed",
      "appointment-cancellation-sent",
      "appointment-cancellation-failed",
    ] as const;

    expect(eventTypes.map(appointmentEventLabel)).toEqual([
      "Confirmación por WhatsApp enviada",
      "No se pudo enviar la confirmación por WhatsApp",
      "Aviso de cancelación por WhatsApp enviado",
      "No se pudo enviar el aviso de cancelación por WhatsApp",
      "Aviso de reprogramación por WhatsApp enviado",
      "No se pudo enviar el aviso de reprogramación por WhatsApp",
      "Confirmación por WhatsApp enviada",
      "No se pudo enviar la confirmación por WhatsApp",
      "Aviso de cancelación por WhatsApp enviado",
      "No se pudo enviar el aviso de cancelación por WhatsApp",
    ]);
  });
});
