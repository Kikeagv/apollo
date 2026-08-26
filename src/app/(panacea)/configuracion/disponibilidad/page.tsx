import { AvailabilitySection } from "~/app/availability-section";
import { CareOptionsSection } from "~/app/care-options-section";
import { PanaceaDestinationPage } from "~/app/panacea-destination-page";

import { requirePanaceaConfigurationSection } from "../../route-access";

export default async function AvailabilitySettingsPage() {
  const context = await requirePanaceaConfigurationSection("availability");

  return (
    <PanaceaDestinationPage
      description="Administre Horarios vigentes y Bloqueos, y compruebe las Opciones de atención calculadas por la Agenda."
      eyebrow="Configuración · Disponibilidad"
      title="Disponibilidad"
    >
      <AvailabilitySection canManageAll={context.clinic.role === "owner"} />
      <CareOptionsSection />
    </PanaceaDestinationPage>
  );
}
