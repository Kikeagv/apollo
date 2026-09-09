import { describe, expect, it } from "vitest";

import { parseKapsoInboundMessagePayload } from "./whatsapp-inbound";

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
        direction: "inbound",
        fromWaId: "50370001111",
        id: "wamid.123",
        origin: "cloud_api",
        parentBusinessScopedUserId: "US.ENT.456",
        phoneE164: "+50370001111",
        phoneNumberId: "phone-1",
        text: "info",
        businessScopedUserId: "US.USER.123",
        username: "@ana",
      },
    ]);
  });

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
      { batchSequence: 101, id: "wamid.123", text: "info" },
      { batchSequence: 102, id: "wamid.124", text: "servicios" },
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
});
