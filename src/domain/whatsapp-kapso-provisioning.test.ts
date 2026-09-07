import { describe, expect, it } from "vitest";

import { parseKapsoPhoneNumberLifecycleEvent } from "./whatsapp-kapso-provisioning";
import type { KapsoPhoneNumberLifecycleEventName } from "./whatsapp-kapso-provisioning";

describe("eventos de ciclo de vida Kapso", () => {
  it("normaliza el evento de número creado a un contrato seguro", () => {
    expect(
      parseKapsoPhoneNumberLifecycleEvent("whatsapp.phone_number.created", {
        business_account_id: "waba-1",
        display_phone_number: "+503 7000 0000",
        phone_number_id: "phone-1",
        project: { id: "project-1" },
        customer: { id: "customer-1" },
        access_token: "no-debe-cruzar-la-frontera",
      }),
    ).toEqual({
      businessAccountId: "waba-1",
      customerId: "customer-1",
      displayPhoneE164: "+50370000000",
      eventName: "whatsapp.phone_number.created",
      phoneNumberId: "phone-1",
      projectId: "project-1",
    });
  });

  it("acepta la forma mínima de un evento eliminado", () => {
    expect(
      parseKapsoPhoneNumberLifecycleEvent("whatsapp.phone_number.deleted", {
        phone_number_id: "phone-1",
        project: { id: "project-1" },
        customer: { id: "customer-1" },
      }),
    ).toMatchObject({
      customerId: "customer-1",
      eventName: "whatsapp.phone_number.deleted",
      phoneNumberId: "phone-1",
      projectId: "project-1",
    });
  });

  it.each([
    ["whatsapp.phone_number.created", {}],
    [
      "whatsapp.phone_number.created",
      {
        phone_number_id: "phone-1",
        project: { id: "project-1" },
      },
    ],
    [
      "whatsapp.phone_number.created",
      {
        phone_number_id: "phone-1",
        project: { id: "project-1" },
        customer: { id: "customer-1" },
        display_phone_number: "not-a-phone",
      },
    ],
  ])("rechaza payloads incompletos o inválidos (%s)", (eventName, payload) => {
    expect(() =>
      parseKapsoPhoneNumberLifecycleEvent(
        eventName as KapsoPhoneNumberLifecycleEventName,
        payload,
      ),
    ).toThrow();
  });

  it("rechaza eventos que no pertenecen al ciclo soportado", () => {
    expect(() =>
      parseKapsoPhoneNumberLifecycleEvent("whatsapp.message.received", {}),
    ).toThrow("Evento de ciclo de vida Kapso no soportado");
  });
});
