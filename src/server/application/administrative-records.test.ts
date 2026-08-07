import { describe, expect, it, vi } from "vitest";

import {
  createContact,
  createContactPatientLink,
  createPatient,
  updateContact,
  updatePatient,
} from "./administrative-records";

describe("gestionar fichas administrativas", () => {
  it("crea un Contacto con nombre y teléfono E.164 normalizados", async () => {
    const createContactRecord = vi.fn().mockResolvedValue({
      id: "contact-1",
      name: "Ana Martínez",
      phoneE164: "+50371234567",
    });
    const store = { createContact: createContactRecord };

    await expect(
      createContact(
        {
          clinicId: "clinic-1",
          identityId: "operator-1",
          name: "  Ana   Martínez ",
          phone: " +503 7123-4567 ",
        },
        store,
      ),
    ).resolves.toEqual({
      id: "contact-1",
      name: "Ana Martínez",
      phoneE164: "+50371234567",
    });

    expect(createContactRecord).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "operator-1",
      name: "Ana Martínez",
      phoneE164: "+50371234567",
    });
  });

  it("crea y actualiza un Paciente con su fecha de nacimiento", async () => {
    const createPatientRecord = vi.fn().mockResolvedValue({
      birthDate: "2018-04-02",
      id: "patient-1",
      name: "Lucía Martínez",
    });
    const updatePatientRecord = vi.fn().mockResolvedValue({
      birthDate: "2018-04-03",
      id: "patient-1",
      name: "Lucía Reyes",
    });
    const store = {
      createPatient: createPatientRecord,
      updatePatient: updatePatientRecord,
    };

    await expect(
      createPatient(
        {
          birthDate: "2018-04-02",
          clinicId: "clinic-1",
          identityId: "operator-1",
          name: " Lucía  Martínez ",
        },
        store,
      ),
    ).resolves.toMatchObject({ id: "patient-1", name: "Lucía Martínez" });
    await expect(
      updatePatient(
        {
          birthDate: "2018-04-03",
          clinicId: "clinic-1",
          id: "patient-1",
          identityId: "operator-1",
          name: "Lucía Reyes",
        },
        store,
      ),
    ).resolves.toMatchObject({ birthDate: "2018-04-03", id: "patient-1" });

    expect(createPatientRecord).toHaveBeenCalledWith({
      birthDate: "2018-04-02",
      clinicId: "clinic-1",
      identityId: "operator-1",
      name: "Lucía Martínez",
    });
    expect(updatePatientRecord).toHaveBeenCalledWith({
      birthDate: "2018-04-03",
      clinicId: "clinic-1",
      id: "patient-1",
      identityId: "operator-1",
      name: "Lucía Reyes",
    });
  });

  it("edita un Contacto y registra su Vínculo explícito con un Paciente", async () => {
    const updateContactRecord = vi.fn().mockResolvedValue({
      id: "contact-1",
      name: "Ana Reyes",
      phoneE164: "+50372223333",
    });
    const createContactPatientLinkRecord = vi.fn().mockResolvedValue({
      contactId: "contact-1",
      id: "link-1",
      patientId: "patient-1",
    });
    const store = {
      createContactPatientLink: createContactPatientLinkRecord,
      updateContact: updateContactRecord,
    };

    await expect(
      updateContact(
        {
          clinicId: "clinic-1",
          id: "contact-1",
          identityId: "operator-1",
          name: " Ana  Reyes ",
          phone: "+503 7222 3333",
        },
        store,
      ),
    ).resolves.toMatchObject({ id: "contact-1", name: "Ana Reyes" });
    await expect(
      createContactPatientLink(
        {
          clinicId: "clinic-1",
          contactId: "contact-1",
          identityId: "operator-1",
          patientId: "patient-1",
        },
        store,
      ),
    ).resolves.toEqual({
      contactId: "contact-1",
      id: "link-1",
      patientId: "patient-1",
    });
  });
});
