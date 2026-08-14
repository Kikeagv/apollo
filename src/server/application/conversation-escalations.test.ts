import { describe, expect, it } from "vitest";

import {
  listConversationEscalations,
  resolveConversationEscalation,
} from "./conversation-escalations";

describe("Escalamientos humanos", () => {
  it("expone el Escalamiento de una Clínica y permite cerrarlo", async () => {
    const calls: string[] = [];
    const store = {
      async listConversationEscalations() {
        calls.push("list");
        return [
          {
            contact: { id: "contact-1", name: "Ana" },
            createdAt: new Date("2026-08-14T12:00:00.000Z"),
            id: "escalation-1",
            trigger: "human-request" as const,
          },
        ];
      },
      async resolveConversationEscalation() {
        calls.push("resolve");
        return true;
      },
    };

    await expect(
      listConversationEscalations(
        { clinicId: "clinic-1", identityId: "identity-1" },
        store,
      ),
    ).resolves.toMatchObject([
      { id: "escalation-1", trigger: "human-request" },
    ]);
    await expect(
      resolveConversationEscalation(
        {
          clinicId: "clinic-1",
          escalationId: "escalation-1",
          identityId: "identity-1",
        },
        store,
      ),
    ).resolves.toBe(true);
    expect(calls).toEqual(["list", "resolve"]);
  });
});
