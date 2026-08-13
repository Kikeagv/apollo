export type AppointmentReminderRecipient = {
  id: string;
  name: string;
  phoneE164: string;
};

export type AppointmentReminderSender = {
  send(input: {
    appointmentId: string;
    clinicId: string;
    recipient: AppointmentReminderRecipient;
  }): Promise<void>;
};

export const appointmentReminderCheckpoints = ["24h", "22h", "20h"] as const;
export type AppointmentReminderCheckpoint =
  (typeof appointmentReminderCheckpoints)[number];

export type AppointmentReminderStore = {
  listReminderRecipients(input: {
    appointmentId: string;
    checkpoint: AppointmentReminderCheckpoint;
    clinicId: string;
    identityId: string;
    now: Date;
  }): Promise<AppointmentReminderRecipient[] | undefined>;
  recordReminderDelivery(input: {
    appointmentId: string;
    checkpoint: AppointmentReminderCheckpoint;
    clinicId: string;
    identityId: string;
    recipientContactId: string;
    result: "sent" | "failed";
  }): Promise<void>;
};

/** Envía recordatorios al Autor y a los Tutores sin concederles autoría. */
export async function sendAppointmentReminder(
  input: {
    appointmentId: string;
    checkpoint: AppointmentReminderCheckpoint;
    clinicId: string;
    identityId: string;
    now: Date;
  },
  store: AppointmentReminderStore,
  sender: AppointmentReminderSender,
) {
  const recipients = await store.listReminderRecipients(input);
  if (recipients === undefined) {
    throw new Error(
      "La Cita no existe o no está disponible para recordatorios",
    );
  }
  for (const recipient of recipients) {
    let result: "sent" | "failed" = "sent";
    try {
      await sender.send({
        appointmentId: input.appointmentId,
        clinicId: input.clinicId,
        recipient,
      });
    } catch {
      result = "failed";
    }
    await store.recordReminderDelivery({
      ...input,
      recipientContactId: recipient.id,
      result,
    });
  }
  return { recipients };
}
