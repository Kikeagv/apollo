import { describe, expect, it, vi } from "vitest";

import {
  captureAppointmentReminderCallback,
  createDailyAgendaPdf,
  runAppointmentScheduler,
  sendAppointmentReminder,
  type AppointmentSchedulerStore,
} from "./appointment-reminders";

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

describe("planificador de Citas", () => {
  it("libera Reservas, entrega solo los hitos reclamados y aplica la política después del tercero", async () => {
    const calls: string[] = [];
    const store: AppointmentSchedulerStore = {
      async applyNoShowPolicy() {
        calls.push("policy");
        return { alerted: 1, cancelled: 1 };
      },
      async claimDueReminders() {
        return [
          {
            appointmentId: "appointment-1",
            checkpoint: "20h",
            clinicId: "clinic-1",
            identityId: "owner-1",
          },
        ];
      },
      async releaseExpiredReservations() {
        calls.push("reservations");
        return 2;
      },
    };
    const send = vi.fn().mockResolvedValue(undefined);
    const reminderStore = {
      async listReminderRecipients() {
        calls.push("reminder");
        return [{ id: "contact-1", name: "Ana", phoneE164: "+50370000001" }];
      },
      recordReminderDelivery: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      runAppointmentScheduler(
        { now: new Date("2026-08-16T14:00:00.000Z") },
        store,
        reminderStore,
        { send },
      ),
    ).resolves.toEqual({
      alertedForSilence: 1,
      cancelledForSilence: 1,
      releasedReservations: 2,
      sentReminders: 1,
      sentDailyAgendas: 0,
    });

    expect(calls).toEqual(["reservations", "reminder", "policy"]);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: "appointment-1",
        recipient: { id: "contact-1", name: "Ana", phoneE164: "+50370000001" },
      }),
    );
  });
});

describe("callbacks de recordatorios", () => {
  it("registra el callback del proveedor sin volver a enviar el recordatorio", async () => {
    const recordCallback = vi.fn().mockResolvedValue(undefined);

    await captureAppointmentReminderCallback(
      {
        appointmentId: "appointment-1",
        checkpoint: "22h",
        clinicId: "clinic-1",
        recipientContactId: "contact-1",
        status: "delivered",
      },
      { recordCallback },
    );

    expect(recordCallback).toHaveBeenCalledWith({
      appointmentId: "appointment-1",
      checkpoint: "22h",
      clinicId: "clinic-1",
      recipientContactId: "contact-1",
      status: "delivered",
    });
  });
});

describe("respaldo nocturno de agenda", () => {
  it("genera un PDF de siete días con datos administrativos, no motivo ni especialidad", () => {
    const pdf = new TextDecoder().decode(
      createDailyAgendaPdf({
        agenda: [
          {
            patientName: "Ana López",
            startsAt: new Date("2026-08-17T14:00:00.000Z"),
          },
        ],
        clinicName: "Clínica Aurora",
        doctorName: "Dra. Reyes",
        recipientEmail: "ana@aurora.test",
      }),
    );

    expect(pdf).toContain("%PDF-1.4");
    expect(pdf).toContain("Ana López");
    expect(pdf).not.toContain("especialidad");
    expect(pdf).not.toContain("motivo");
  });
});
