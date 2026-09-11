import { describe, expect, it } from "vitest";

import {
  classifyWhatsAppInboundMessage,
  matchesWhatsAppCustomer,
} from "./whatsapp-inbound";
import { parseKapsoInboundMessagePayload } from "~/server/whatsapp/kapso-inbound";

const message = (overrides: Record<string, unknown> = {}) => ({
  message: {
    id: "wamid.123",
    timestamp: "1730092800",
    type: "text",
    from: "50370001111",
    from_user_id: "US.USER.123",
    from_parent_user_id: "US.ENT.456",
    username: "@ana",
    text: { body: "info" },
    kapso: {
      direction: "inbound",
      origin: "cloud_api",
    },
  },
  conversation: {
    id: "conv-1",
    phone_number: "50370001111",
    business_scoped_user_id: "US.USER.123",
    parent_business_scoped_user_id: "US.ENT.456",
    username: "@ana",
    phone_number_id: "phone-1",
  },
  phone_number_id: "phone-1",
  ...overrides,
});

describe("payloads entrantes de Kapso", () => {
  it("normaliza el evento individual y conserva la identidad completa", () => {
    expect(parseKapsoInboundMessagePayload(message())).toMatchObject([
      {
        conversationId: "conv-1",
        customerReference: null,
        direction: "inbound",
        fromWaId: "50370001111",
        id: "wamid.123",
        origin: "api",
        parentBusinessScopedUserId: "US.ENT.456",
        phoneE164: "+50370001111",
        connectionReference: "phone-1",
        text: "info",
        businessScopedUserId: "US.USER.123",
        username: "@ana",
      },
    ]);
  });

  it("resuelve al contacto destinatario en un evento saliente de Business App", () => {
    const [parsed] = parseKapsoInboundMessagePayload(
      message({
        message: {
          ...message().message,
          from: "50320000000",
          from_user_id: "US.BUSINESS.123",
          to: "50370002222",
          to_parent_user_id: "US.ENT.OUTBOUND",
          to_user_id: "US.USER.OUTBOUND",
          kapso: { direction: "outbound", origin: "business_app" },
        },
        conversation: {
          ...message().conversation,
          business_scoped_user_id: "US.BUSINESS.123",
          phone_number: "50320000000",
        },
      }),
    );

    expect(parsed).toMatchObject({
      businessScopedUserId: "US.USER.OUTBOUND",
      direction: "outbound",
      fromWaId: "50370002222",
      origin: "business-app",
      parentBusinessScopedUserId: "US.ENT.OUTBOUND",
      phoneE164: "+50370002222",
    });
  });

  it("conserva el evento sent cuando el adaptador recibe un mensaje enviado", () => {
    const [parsed] = parseKapsoInboundMessagePayload(
      message({
        message: {
          ...message().message,
          kapso: { direction: "outbound", origin: "business_app" },
        },
      }),
      "whatsapp.message.sent",
    );

    expect(parsed?.eventName).toBe("whatsapp.message.sent");
  });

  it("reduce multimedia a metadatos sin conservar la URL del recurso", () => {
    const [parsed] = parseKapsoInboundMessagePayload(
      message({
        message: {
          ...message().message,
          image: {
            id: "media-1",
            mime_type: "image/jpeg",
            url: "https://kapso.example/media-1",
          },
          text: undefined,
          type: "image",
        },
      }),
    );
    const rawMessage = parsed?.rawPayload.message as
      Record<string, unknown> | undefined;
    expect(rawMessage).toMatchObject({
      id: "wamid.123",
      image: { id: "media-1", mime_type: "image/jpeg" },
      type: "image",
    });
    expect(
      (rawMessage?.image as Record<string, unknown> | undefined)?.url,
    ).toBe(undefined);
  });

  it.each([
    ["sin customer en el evento", null, true],
    ["customer asociado", "customer-1", true],
    ["customer de otra Conexión", "customer-2", false],
  ])(
    "valida el customer opcional: %s",
    (_label, messageCustomerId, expected) => {
      expect(
        matchesWhatsAppCustomer({
          connectionCustomerReference: "customer-1",
          messageCustomerReference: messageCustomerId,
        }),
      ).toBe(expected);
    },
  );

  it("descompone un lote en mensajes independientes y conserva su orden", () => {
    const payload = {
      type: "whatsapp.message.received",
      batch: true,
      data: [
        message(),
        message({
          message: {
            ...message().message,
            id: "wamid.124",
            text: { body: "servicios" },
          },
        }),
      ],
      batch_info: { first_sequence: 101, last_sequence: 102 },
    };

    expect(parseKapsoInboundMessagePayload(payload)).toMatchObject([
      {
        batchFirstSequence: 101,
        batchSequence: 101,
        id: "wamid.123",
        text: "info",
      },
      {
        batchFirstSequence: 101,
        batchSequence: 102,
        id: "wamid.124",
        text: "servicios",
      },
    ]);
  });

  it("acepta una identidad BSUID sin teléfono", () => {
    const payload = message({
      message: {
        ...message().message,
        from: undefined,
        from_user_id: "US.USER.ONLY",
      },
      conversation: {
        ...message().conversation,
        phone_number: null,
        business_scoped_user_id: "US.USER.ONLY",
      },
    });

    expect(parseKapsoInboundMessagePayload(payload)).toMatchObject([
      {
        businessScopedUserId: "US.USER.ONLY",
        fromWaId: null,
        phoneE164: null,
      },
    ]);
  });

  it("no confunde un BSUID del remitente con el wa_id telefónico", () => {
    const payload = message({
      message: {
        ...message().message,
        from: "US.USER.ONLY",
        from_user_id: undefined,
      },
      conversation: {
        ...message().conversation,
        phone_number: null,
        business_scoped_user_id: undefined,
      },
    });

    expect(parseKapsoInboundMessagePayload(payload)).toMatchObject([
      {
        businessScopedUserId: "US.USER.ONLY",
        fromWaId: null,
        phoneE164: null,
      },
    ]);
  });

  it("clasifica los mensajes salientes sin convertirlos en entrada", () => {
    const payload = message({
      message: {
        ...message().message,
        to: "50370002222",
        from: undefined,
        kapso: { direction: "outbound", origin: "cloud_api" },
      },
    });

    const parsed = parseKapsoInboundMessagePayload(payload);
    expect(parsed[0]).toMatchObject({ direction: "outbound" });
    expect(parsed[0]?.text).toBe("info");
  });

  it("normaliza el botón interactivo aprobado sin tratar otros botones como consentimiento", () => {
    const approved = parseKapsoInboundMessagePayload(
      message({
        message: {
          ...message().message,
          id: "wamid.continue",
          type: "interactive",
          text: undefined,
          interactive: {
            type: "button_reply",
            button_reply: { id: "continue", title: "CONTINUAR" },
          },
        },
      }),
    );
    expect(approved[0]).toMatchObject({
      interactiveAction: "continue",
      text: null,
      type: "interactive",
    });

    const other = parseKapsoInboundMessagePayload(
      message({
        message: {
          ...message().message,
          id: "wamid.other-button",
          type: "interactive",
          text: undefined,
          interactive: {
            type: "button_reply",
            button_reply: { id: "CANCELAR", title: "CANCELAR" },
          },
        },
      }),
    );
    expect(other[0]?.interactiveAction).toBeNull();
  });

  it("ignora campos de botón fuera de un mensaje interactivo y no mezcla título con id", () => {
    const textWithResidualButton = parseKapsoInboundMessagePayload(
      message({
        message: {
          ...message().message,
          button_id: "CONTINUAR",
        },
      }),
    );
    expect(textWithResidualButton[0]?.interactiveAction).toBeNull();

    const missingInteractiveSubtype = parseKapsoInboundMessagePayload(
      message({
        message: {
          ...message().message,
          type: "interactive",
          text: undefined,
          button_id: "CONTINUAR",
        },
      }),
    );
    expect(missingInteractiveSubtype[0]?.interactiveAction).toBeNull();

    const mismatchedInteractive = parseKapsoInboundMessagePayload(
      message({
        message: {
          ...message().message,
          type: "interactive",
          text: undefined,
          interactive: {
            type: "button_reply",
            button_reply: { id: "CANCELAR", title: "CONTINUAR" },
          },
        },
      }),
    );
    expect(mismatchedInteractive[0]?.interactiveAction).toBeNull();

    const listReply = parseKapsoInboundMessagePayload(
      message({
        message: {
          ...message().message,
          type: "interactive",
          text: undefined,
          interactive: {
            list_reply: { id: "continue", title: "CONTINUAR" },
            type: "list_reply",
          },
        },
      }),
    );
    expect(listReply[0]?.interactiveAction).toBeNull();
  });

  it.each([
    ["text cloud_api", {}, "assistant"],
    [
      "CONTINUAR interactivo cloud_api",
      {
        message: {
          ...message().message,
          type: "interactive",
          text: undefined,
          interactive: {
            type: "button_reply",
            button_reply: { id: "continue", title: "CONTINUAR" },
          },
        },
      },
      "assistant",
    ],
    [
      "business app",
      {
        message: {
          ...message().message,
          kapso: { direction: "inbound", origin: "business_app" },
        },
      },
      "business-app",
    ],
    [
      "business app saliente",
      {
        message: {
          ...message().message,
          kapso: { direction: "outbound", origin: "business_app" },
        },
      },
      "business-app",
    ],
    [
      "history sync",
      {
        message: {
          ...message().message,
          kapso: { direction: "inbound", origin: "history_sync" },
        },
      },
      "history-sync",
    ],
    [
      "history sync multimedia",
      {
        message: {
          ...message().message,
          type: "image",
          text: undefined,
          kapso: { direction: "inbound", origin: "history_sync" },
        },
      },
      "history-sync",
    ],
    [
      "history sync saliente",
      {
        message: {
          ...message().message,
          kapso: { direction: "outbound", origin: "history_sync" },
        },
      },
      "history-sync",
    ],
    [
      "multimedia cloud_api",
      {
        message: {
          ...message().message,
          type: "image",
          text: undefined,
        },
      },
      "unsupported",
    ],
    [
      "origen desconocido",
      {
        message: {
          ...message().message,
          kapso: { direction: "inbound", origin: "future_origin" },
        },
      },
      "unsupported",
    ],
    [
      "saliente",
      {
        message: {
          ...message().message,
          kapso: { direction: "outbound", origin: "cloud_api" },
        },
      },
      "not-inbound",
    ],
  ] as const)(
    "clasifica %s sin despertar una ruta incorrecta",
    (_label, overrides, expected) => {
      const [parsed] = parseKapsoInboundMessagePayload(message(overrides));

      expect(parsed).toBeDefined();
      expect(classifyWhatsAppInboundMessage(parsed!)).toBe(expected);
    },
  );
});
