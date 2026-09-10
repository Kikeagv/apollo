import { describe, expect, it } from "vitest";

import { parseKapsoDeliveryStatusPayload } from "./whatsapp-delivery-events";

describe("eventos de estado de Entrega de Kapso", () => {
  it("extrae el ID de mensaje, la correlación y el phone_number_id del envelope v2", () => {
    const result = parseKapsoDeliveryStatusPayload(
      "whatsapp.message.delivered",
      {
        message: {
          id: "wamid-1",
          kapso: {
            direction: "outbound",
            status: "delivered",
          },
        },
        phone_number_id: "phone-1",
        biz_opaque_callback_data: "appointment-1:24h:contact-1",
      },
    );
    expect(result).toMatchObject({
      correlationKey: "appointment-1:24h:contact-1",
      error: null,
      eventName: "whatsapp.message.delivered",
      messageId: "wamid-1",
      phoneNumberId: "phone-1",
      status: "delivered",
    });
    expect(result.rawPayload).toEqual({
      message: {
        id: "wamid-1",
        kapso: { direction: "outbound", status: "delivered" },
      },
      phone_number_id: "phone-1",
      biz_opaque_callback_data: "appointment-1:24h:contact-1",
    });
  });

  it("acepta el formato status plano y conserva el error de fallo", () => {
    expect(
      parseKapsoDeliveryStatusPayload("whatsapp.message.failed", {
        error: { message: "Número no disponible" },
        message_id: "wamid-2",
        phone_number_id: "phone-1",
      }),
    ).toMatchObject({
      correlationKey: null,
      error: "Número no disponible",
      messageId: "wamid-2",
      phoneNumberId: "phone-1",
      status: "failed",
    });
  });

  it("rechaza eventos sin identidad suficiente", () => {
    expect(() =>
      parseKapsoDeliveryStatusPayload("whatsapp.message.sent", {}),
    ).toThrow("id y phone_number_id");
  });
});
