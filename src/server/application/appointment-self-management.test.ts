import { describe, expect, it } from "vitest";

import { canContactManageAppointment } from "./appointment-self-management";

describe("autogestión de Citas", () => {
  it("no autoriza a un Tutor a modificar una Cita creada por otro Contacto", async () => {
    const store = {
      async isAppointmentAuthor(input: { contactId: string }) {
        return input.contactId === "contact-author";
      },
    };

    await expect(
      canContactManageAppointment(
        {
          appointmentId: "appointment-1",
          clinicId: "clinic-1",
          contactId: "contact-tutor",
        },
        store,
      ),
    ).resolves.toBe(false);
  });
});
