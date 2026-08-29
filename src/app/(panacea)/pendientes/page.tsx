import { PendingInboxSection } from "~/app/pending-inbox-section";
import { PanaceaDestinationPage } from "~/app/panacea-destination-page";

import { requirePanaceaDestination } from "../route-access";

export default async function PendingPage() {
  await requirePanaceaDestination("pending");

  return (
    <PanaceaDestinationPage
      description="Reúna el trabajo que requiere atención humana y resuelva cada caso con la acción propia de su tipo."
      title="Pendientes"
    >
      <PendingInboxSection />
    </PanaceaDestinationPage>
  );
}
