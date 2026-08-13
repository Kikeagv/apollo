import { describe, expect, it, vi } from "vitest";

import { sendAppointmentReminder } from "./appointment-reminders";

describe("recordatorios de Citas con Tutor", () => {
  it("envía el recordatorio al autor y a los Tutores sin cambiar la autoría", async () => {
    const author = {
      id: "contact-author",
      name: "Ana",
      phoneE164: "+50370000002",
    };
    const tutor = {
      id: "contact-tutor",
      name: "Carlos",
      phoneE164: "+50370000003",
    };
    const send = vi.fn().mockResolvedValue(undefined);
    const recordDelivery = vi.fn().mockResolvedValue(undefined);
    const store = {
      async listReminderRecipients() {
        return [author, tutor];
      },
      recordReminderDelivery: recordDelivery,
    };

    await expect(
      sendAppointmentReminder(
        {
          appointmentId: "appointment-1",
          checkpoint: "24h",
          clinicId: "clinic-1",
          identityId: "operator-1",
          now: new Date("2026-08-16T14:00:00.000Z"),
        },
        store,
        { send },
      ),
    ).resolves.toEqual({ recipients: [author, tutor] });

    expect(send).toHaveBeenCalledTimes(2);
    expect(recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: "appointment-1",
        recipientContactId: "contact-tutor",
        result: "sent",
      }),
    );
  });
});
