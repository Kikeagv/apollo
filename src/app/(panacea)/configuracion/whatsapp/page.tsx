import { PanaceaDestinationPage } from "~/app/panacea-destination-page";
import { EscalationNotificationSettingsSection } from "~/app/escalation-notification-settings-section";
import { NoShowPolicySection } from "~/app/no-show-policy-section";
import { WhatsAppConnectionSection } from "~/app/whatsapp-connection-section";
import { VoiceNoteTranscriptionSettingsSection } from "~/app/voice-note-transcription-settings-section";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";

import { requirePanaceaConfigurationSection } from "../../route-access";

export default async function WhatsAppSettingsPage() {
  await requirePanaceaConfigurationSection("whatsapp");

  return (
    <PanaceaDestinationPage
      description="Separe las reglas de atención por WhatsApp de la Operación diaria y de la bandeja de Pendientes."
      eyebrow="Configuración · Atención por WhatsApp"
      title="Atención por WhatsApp"
    >
      <Alert data-whatsapp-activation-boundary="true" variant="warning">
        <AlertTitle>
          Configuración inicial separada de Activación de clínica
        </AlertTitle>
        <AlertDescription>
          Estas preferencias no activan WhatsApp real ni configuran Kapso, WABA,
          número, plantillas, base legal o aprobaciones externas. La Activación
          de clínica se realizará en un proceso separado cuando corresponda.
        </AlertDescription>
      </Alert>
      <WhatsAppConnectionSection />
      <NoShowPolicySection />
      <EscalationNotificationSettingsSection />
      <VoiceNoteTranscriptionSettingsSection />
    </PanaceaDestinationPage>
  );
}
