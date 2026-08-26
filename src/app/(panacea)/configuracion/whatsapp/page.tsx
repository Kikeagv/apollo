import { PanaceaDestinationPage } from "~/app/panacea-destination-page";
import { EscalationNotificationSettingsSection } from "~/app/escalation-notification-settings-section";
import { NoShowPolicySection } from "~/app/no-show-policy-section";
import { VoiceNoteTranscriptionSettingsSection } from "~/app/voice-note-transcription-settings-section";

import { requirePanaceaConfigurationSection } from "../../route-access";

export default async function WhatsAppSettingsPage() {
  await requirePanaceaConfigurationSection("whatsapp");

  return (
    <PanaceaDestinationPage
      description="Separe las reglas de atención por WhatsApp de la Operación diaria y de la bandeja de Pendientes."
      eyebrow="Configuración · Atención por WhatsApp"
      title="Atención por WhatsApp"
    >
      <NoShowPolicySection />
      <EscalationNotificationSettingsSection />
      <VoiceNoteTranscriptionSettingsSection />
    </PanaceaDestinationPage>
  );
}
