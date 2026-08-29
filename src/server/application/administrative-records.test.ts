import { describe, expect, it, vi } from "vitest";

import {
  createContact,
  createContactPatientLink,
  createIncompletePatient,
  createPatient,
  findContactByPhone,
  getPatientAdministrativeDetail,
  addPatientContact,
  listPatientDirectory,
  registerPatient,
  registerAdministrativeRecordsForManualAppointment,
  updateContact,
  updatePatient,
  verifyPatientGuardianship,
} from "./administrative-records";

describe("gestionar fichas administrativas", () => {
  it("marca una tutela pendiente como verificada desde la ficha", async () => {
    const verifiedLink = {
      contact: {
        id: "contact-tutor",
        name: "Ana Martínez",
        phoneE164: "+50371234567",
      },
      guardianDui: "01234567-8",
      guardianshipVerificationStatus: "verified" as const,
      id: "link-tutor",
      relationship: "tutor" as const,
    };
    const verify = vi.fn().mockResolvedValue(verifiedLink);

    await expect(
      verifyPatientGuardianship(
        {
          clinicId: "clinic-1",
          identityId: "operator-1",
          linkId: "link-tutor",
        },
        { verifyPatientGuardianship: verify },
      ),
    ).resolves.toEqual(verifiedLink);

    expect(verify).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "operator-1",
      linkId: "link-tutor",
    });
  });

  it("agrega un Tutor desde la ficha y deja su tutela pendiente de verificación", async () => {
    const addContact = vi.fn().mockResolvedValue({
      contact: {
        id: "contact-tutor",
        name: "Ana Martínez",
        phoneE164: "+50371234567",
      },
      guardianDui: "01234567-8",
      guardianshipVerificationStatus: "pending",
      id: "link-tutor",
      relationship: "tutor",
    });

    await expect(
      addPatientContact(
        {
          clinicId: "clinic-1",
          contact: {
            kind: "new",
            name: " Ana  Martínez ",
            phone: "+503 7123-4567",
          },
          guardianDui: "01234567-8",
          identityId: "operator-1",
          patientId: "patient-minor",
          relationship: "tutor",
        },
        { addPatientContact: addContact },
      ),
    ).resolves.toMatchObject({
      guardianDui: "01234567-8",
      guardianshipVerificationStatus: "pending",
      relationship: "tutor",
    });

    expect(addContact).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      contact: {
        kind: "new",
        name: "Ana Martínez",
        phoneE164: "+50371234567",
      },
      guardianDui: "01234567-8",
      identityId: "operator-1",
      patientId: "patient-minor",
      relationship: "tutor",
    });
  });

  it("consulta el detalle administrativo de un Paciente desde su ficha", async () => {
    const detail = {
      appointments: [],
      contacts: [],
      patient: {
        birthDate: "2018-04-02",
        id: "patient-1",
        name: "Lucía Martínez",
      },
    };
    const getDetail = vi.fn().mockResolvedValue(detail);

    await expect(
      getPatientAdministrativeDetail(
        {
          clinicId: "clinic-1",
          identityId: "operator-1",
          patientId: "patient-1",
        },
        { getPatientAdministrativeDetail: getDetail },
      ),
    ).resolves.toEqual(detail);

    expect(getDetail).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "operator-1",
      patientId: "patient-1",
    });
  });

  it("consulta el directorio distinguiendo búsqueda de Pacientes y Contactos", async () => {
    const directory = {
      contacts: [],
      patients: [
        {
          appointmentCount: 0,
          birthDate: "2018-04-02",
          contactCount: 1,
          id: "patient-1",
          name: "Lucía Martínez",
        },
      ],
    };
    const listDirectory = vi.fn().mockResolvedValue(directory);

    await expect(
      listPatientDirectory(
        {
          clinicId: "clinic-1",
          identityId: "operator-1",
          query: "  Lucía ",
          searchTarget: "patients",
        },
        { listPatientDirectory: listDirectory },
      ),
    ).resolves.toEqual(directory);

    expect(listDirectory).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "operator-1",
      query: "Lucía",
      searchTarget: "patients",
    });
  });

  it("crea una Ficha de Paciente incompleta solo como acción explícita", async () => {
    const createPatientRecord = vi.fn().mockResolvedValue({
      birthDate: "2020-01-10",
      id: "patient-incomplete",
      name: "Sofía López",
    });

    await expect(
      createIncompletePatient(
        {
          birthDate: "2020-01-10",
          clinicId: "clinic-1",
          identityId: "operator-1",
          name: " Sofía  López ",
        },
        { createPatient: createPatientRecord },
      ),
    ).resolves.toEqual({
      birthDate: "2020-01-10",
      id: "patient-incomplete",
      name: "Sofía López",
    });

    expect(createPatientRecord).toHaveBeenCalledWith({
      birthDate: "2020-01-10",
      clinicId: "clinic-1",
      identityId: "operator-1",
      name: "Sofía López",
    });
  });

  it("encuentra un Contacto por teléfono y conserva sus Pacientes vinculados", async () => {
    const contact = {
      id: "contact-family",
      name: "Ana Martínez",
      patientIds: ["patient-1", "patient-2"],
      phoneE164: "+50371234567",
    };
    const findContact = vi.fn().mockResolvedValue(contact);

    await expect(
      findContactByPhone(
        {
          clinicId: "clinic-1",
          identityId: "operator-1",
          phone: " +503 7123-4567 ",
        },
        { findContactByPhone: findContact },
      ),
    ).resolves.toEqual(contact);

    expect(findContact).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      identityId: "operator-1",
      phoneE164: "+50371234567",
    });
  });

  it("usa al Paciente como Contacto cuando el alta no indica un Tutor", async () => {
    const registerPatientRecord = vi.fn().mockResolvedValue({
      contact: {
        id: "contact-adult",
        name: "Pablo Adulto",
        phoneE164: "+50370000002",
      },
      link: {
        contactId: "contact-adult",
        id: "link-adult",
        patientId: "patient-adult",
      },
      patient: {
        birthDate: "1990-01-01",
        id: "patient-adult",
        name: "Pablo Adulto",
      },
      reusedContact: false,
    });

    await expect(
      registerPatient(
        {
          birthDate: "1990-01-01",
          clinicId: "clinic-1",
          contact: {
            kind: "new",
            name: "Nombre que ya no se solicita",
            phone: "+503 7000-0002",
          },
          identityId: "operator-1",
          patientName: "Pablo Adulto",
        },
        { registerPatient: registerPatientRecord },
      ),
    ).resolves.toMatchObject({
      contact: { name: "Pablo Adulto" },
      link: { contactId: "contact-adult", patientId: "patient-adult" },
      patient: { name: "Pablo Adulto" },
    });

    expect(registerPatientRecord).toHaveBeenCalledWith({
      birthDate: "1990-01-01",
      clinicId: "clinic-1",
      contact: {
        kind: "new",
        name: "Pablo Adulto",
        phoneE164: "+50370000002",
      },
      guardianDui: null,
      identityId: "operator-1",
      patientName: "Pablo Adulto",
      relationship: "contact",
    });
  });

  it("registra un Paciente con un Contacto inicial en una sola intención", async () => {
    const registerPatientRecord = vi.fn().mockResolvedValue({
      contact: {
        id: "contact-1",
        name: "Ana Martínez",
        phoneE164: "+50371234567",
      },
      link: {
        contactId: "contact-1",
        id: "link-1",
        patientId: "patient-1",
      },
      patient: {
        birthDate: "2018-04-02",
        id: "patient-1",
        name: "Lucía Martínez",
      },
      reusedContact: false,
    });

    await expect(
      registerPatient(
        {
          birthDate: "2018-04-02",
          clinicId: "clinic-1",
          contact: {
            kind: "new",
            name: "  Ana   Martínez ",
            phone: " +503 7123-4567 ",
          },
          guardianDui: "01234567-8",
          identityId: "operator-1",
          patientName: " Lucía  Martínez ",
          relationship: "tutor",
        },
        { registerPatient: registerPatientRecord },
      ),
    ).resolves.toMatchObject({
      patient: { id: "patient-1", name: "Lucía Martínez" },
      reusedContact: false,
    });

    expect(registerPatientRecord).toHaveBeenCalledWith({
      birthDate: "2018-04-02",
      clinicId: "clinic-1",
      contact: {
        kind: "new",
        name: "Ana Martínez",
        phoneE164: "+50371234567",
      },
      guardianDui: "01234567-8",
      identityId: "operator-1",
      patientName: "Lucía Martínez",
      relationship: "tutor",
    });
  });

  it("permite reutilizar explícitamente un Contacto existente", async () => {
    const registerPatientRecord = vi.fn().mockResolvedValue({
      contact: {
        id: "contact-family",
        name: "Ana Martínez",
        phoneE164: "+50371234567",
      },
      link: {
        contactId: "contact-family",
        id: "link-2",
        patientId: "patient-2",
      },
      patient: {
        birthDate: "2015-08-11",
        id: "patient-2",
        name: "Mateo Martínez",
      },
      reusedContact: true,
    });

    await expect(
      registerPatient(
        {
          birthDate: "2015-08-11",
          clinicId: "clinic-1",
          contact: { contactId: "contact-family", kind: "existing" },
          guardianDui: "01234567-8",
          identityId: "operator-1",
          patientName: " Mateo  Martínez ",
          relationship: "tutor",
        },
        { registerPatient: registerPatientRecord },
      ),
    ).resolves.toMatchObject({
      patient: { id: "patient-2" },
      reusedContact: true,
    });

    expect(registerPatientRecord).toHaveBeenCalledWith({
      birthDate: "2015-08-11",
      clinicId: "clinic-1",
      contact: { contactId: "contact-family", kind: "existing" },
      guardianDui: "01234567-8",
      identityId: "operator-1",
      patientName: "Mateo Martínez",
      relationship: "tutor",
    });
  });

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

  it("registra un Contacto, Paciente y Vínculo atómicos para una Cita manual", async () => {
    const register = vi.fn().mockResolvedValue({
      contact: {
        id: "contact-1",
        name: "Ana Martínez",
        phoneE164: "+50371234567",
      },
      link: {
        contactId: "contact-1",
        id: "link-1",
        patientId: "patient-1",
      },
      patient: {
        birthDate: "2018-04-02",
        id: "patient-1",
        name: "Lucía Martínez",
      },
    });

    await expect(
      registerAdministrativeRecordsForManualAppointment(
        {
          birthDate: "2018-04-02",
          clinicId: "clinic-1",
          contactName: "  Ana   Martínez ",
          identityId: "operator-1",
          patientName: " Lucía  Martínez ",
          phone: " +503 7123-4567 ",
        },
        { register },
      ),
    ).resolves.toMatchObject({ patient: { id: "patient-1" } });

    expect(register).toHaveBeenCalledWith({
      birthDate: "2018-04-02",
      clinicId: "clinic-1",
      contactName: "Ana Martínez",
      identityId: "operator-1",
      patientName: "Lucía Martínez",
      phoneE164: "+50371234567",
    });
  });
});
