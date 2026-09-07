import { PanaceaDestinationPage } from "~/app/panacea-destination-page";
import { EscalationNotificationSettingsSection } from "~/app/escalation-notification-settings-section";
import { NoShowPolicySection } from "~/app/no-show-policy-section";
import {
  WhatsAppConnectionSection,
  WhatsAppSetupLinkSection,
} from "~/app/whatsapp-connection-section";
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
          Configuración de WhatsApp con el Médico propietario
        </AlertTitle>
        <AlertDescription>
          El enlace de abajo inicia la configuración del número de la Clínica.
          El propietario debe completar el flujo de Meta; la sesión de Praxia
          nunca recibe ni guarda OTP, QR, contraseñas o credenciales.
        </AlertDescription>
      </Alert>
      <WhatsAppConnectionSection />
      <WhatsAppSetupLinkSection />
      <NoShowPolicySection />
      <EscalationNotificationSettingsSection />
      <VoiceNoteTranscriptionSettingsSection />
    </PanaceaDestinationPage>
  );
}
