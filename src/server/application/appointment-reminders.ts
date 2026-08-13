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
    now: Date;
    recipientContactId: string;
    result: "sent" | "failed";
  }): Promise<void>;
};

export type AppointmentSchedulerStore = {
  /** Libera ocupaciones temporales cuya Reserva ya venció. */
  releaseExpiredReservations(input: { now: Date }): Promise<number>;
  /**
   * Reclama atómicamente los hitos que todavía pueden enviarse. Un hito ya
   * reclamado no vuelve a aparecer, incluso si dos ejecuciones coinciden.
   */
  claimDueReminders(input: { now: Date }): Promise<
    Array<{
      appointmentId: string;
      checkpoint: AppointmentReminderCheckpoint;
      clinicId: string;
      identityId: string;
    }>
  >;
  /** Aplica la política de silencio solo a cadencias completas y sanas. */
  applyNoShowPolicy(input: { now: Date }): Promise<{
    alerted: number;
    cancelled: number;
  }>;
  claimDailyAgendaEmails?(input: { now: Date }): Promise<DailyAgendaEmail[]>;
};

export type DailyAgendaEmail = {
  agenda: Array<{ patientName: string; startsAt: Date }>;
  clinicName: string;
  doctorName: string;
  recipientEmail: string;
};

export type DailyAgendaEmailSender = {
  send(input: DailyAgendaEmail & { pdf: Uint8Array }): Promise<void>;
};

export type AppointmentReminderCallbackStore = {
  recordCallback(input: {
    appointmentId: string;
    checkpoint: AppointmentReminderCheckpoint;
    clinicId: string;
    recipientContactId: string;
    status: "delivered" | "failed";
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

/**
 * Ejecuta una vuelta idempotente del planificador. La selección y el reclamo
 * ocurren en el almacén para que la concurrencia no duplique envíos; este caso
 * de uso conserva el orden observable de la operación de agenda.
 */
export async function runAppointmentScheduler(
  input: { now: Date },
  schedulerStore: AppointmentSchedulerStore,
  reminderStore: AppointmentReminderStore,
  sender: AppointmentReminderSender,
  agendaEmailSender?: DailyAgendaEmailSender,
) {
  const releasedReservations =
    await schedulerStore.releaseExpiredReservations(input);
  const reminders = await schedulerStore.claimDueReminders(input);
  let sentReminders = 0;
  for (const reminder of reminders) {
    const delivery = await sendAppointmentReminder(
      { ...reminder, now: input.now },
      reminderStore,
      sender,
    );
    sentReminders += delivery.recipients.length;
  }
  const silence = await schedulerStore.applyNoShowPolicy(input);
  const dailyAgendas =
    agendaEmailSender === undefined ||
    schedulerStore.claimDailyAgendaEmails === undefined
      ? []
      : await schedulerStore.claimDailyAgendaEmails(input);
  if (agendaEmailSender !== undefined) {
    for (const agenda of dailyAgendas) {
      await agendaEmailSender.send({
        ...agenda,
        pdf: createDailyAgendaPdf(agenda),
      });
    }
  }
  return {
    alertedForSilence: silence.alerted,
    cancelledForSilence: silence.cancelled,
    releasedReservations,
    sentReminders,
    sentDailyAgendas: dailyAgendas.length,
  };
}

/** Conserva el resultado del proveedor como evento, sin alterar la Cita. */
export function captureAppointmentReminderCallback(
  input: {
    appointmentId: string;
    checkpoint: AppointmentReminderCheckpoint;
    clinicId: string;
    recipientContactId: string;
    status: "delivered" | "failed";
  },
  store: AppointmentReminderCallbackStore,
) {
  return store.recordCallback(input);
}

/** PDF mínimo y determinista para el respaldo operativo nocturno de siete días. */
export function createDailyAgendaPdf(agenda: DailyAgendaEmail) {
  const lines = [
    `Agenda de ${agenda.doctorName}`,
    `Clínica: ${agenda.clinicName}`,
    "Próximos siete días",
    ...agenda.agenda.map(
      (appointment) =>
        `${appointment.startsAt.toISOString()} — ${appointment.patientName}`,
    ),
  ];
  const content = lines
    .map(
      (line, index) =>
        `BT /F1 11 Tf 50 ${760 - index * 18} Td (${escapePdf(line)}) Tj ET`,
    )
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function escapePdf(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}
