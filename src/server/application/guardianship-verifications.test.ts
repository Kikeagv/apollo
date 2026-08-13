import { describe, expect, it } from "vitest";

import { listPendingGuardianshipVerifications } from "./administrative-records";

describe("verificaciones de tutela pendientes", () => {
  it("entrega a Panacea las tareas pendientes de la Clínica", async () => {
    const task = {
      guardianDui: "01234567-8",
      id: "link-1",
      patient: {
        birthDate: "2018-04-02",
        id: "patient-1",
        name: "Lucía Pérez",
      },
      tutor: {
        id: "contact-1",
        name: "Ana Pérez",
        phoneE164: "+50370000002",
      },
    };
    const store = {
      async listPendingGuardianshipVerifications() {
        return [task];
      },
    };

    await expect(
      listPendingGuardianshipVerifications(
        { clinicId: "clinic-1", identityId: "secretary-1" },
        store,
      ),
    ).resolves.toEqual([task]);
  });
});
