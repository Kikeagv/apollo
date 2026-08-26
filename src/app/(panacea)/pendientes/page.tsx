import { AppointmentSelfManagementEscalationsSection } from "~/app/appointment-self-management-escalations-section";
import { ConversationEscalationsSection } from "~/app/conversation-escalations-section";
import { PanaceaDestinationPage } from "~/app/panacea-destination-page";
import { TransactionalDeliveryAlertsSection } from "~/app/transactional-delivery-alerts-section";

import { requirePanaceaDestination } from "../route-access";

export default async function PendingPage() {
  await requirePanaceaDestination("pending");

  return (
    <PanaceaDestinationPage
      description="Reúna el trabajo que requiere atención humana y resuelva cada caso con la acción propia de su tipo."
      title="Pendientes"
    >
      <div className="grid gap-6 xl:grid-cols-3">
        <ConversationEscalationsSection />
        <AppointmentSelfManagementEscalationsSection />
        <TransactionalDeliveryAlertsSection />
      </div>
    </PanaceaDestinationPage>
  );
}
