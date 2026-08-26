import { AdministrativeRecordsSection } from "~/app/administrative-records-section";
import { PanaceaDestinationPage } from "~/app/panacea-destination-page";

import { requirePanaceaDestination } from "../route-access";

export default async function PatientsPage() {
  await requirePanaceaDestination("patients");

  return (
    <PanaceaDestinationPage
      description="Trabaje desde la persona atendida y conserve sus Contactos, Vínculos y continuidad administrativa en un solo lugar."
      title="Pacientes"
    >
      <AdministrativeRecordsSection />
    </PanaceaDestinationPage>
  );
}
