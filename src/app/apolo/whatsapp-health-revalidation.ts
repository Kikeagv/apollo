import type { WhatsAppNumberHealth } from "~/domain/whatsapp-readiness";

export function shouldAutomaticallyRevalidateWhatsAppHealth(input: {
  activationVisible: boolean;
  health: WhatsAppNumberHealth;
  phoneNumberId: string | null;
  provider: "kapso" | "simulated" | null;
}) {
  return (
    input.activationVisible &&
    input.provider === "kapso" &&
    input.phoneNumberId !== null &&
    input.health === "unknown"
  );
}
