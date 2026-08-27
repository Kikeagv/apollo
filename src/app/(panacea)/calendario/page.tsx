import { ManualAppointmentsSection } from "~/app/manual-appointments-section";
import { PanaceaDestinationPage } from "~/app/panacea-destination-page";

import { requirePanaceaDestination } from "../route-access";

export default async function CalendarPage() {
  await requirePanaceaDestination("calendar");

  return (
    <PanaceaDestinationPage title="Calendario">
      <ManualAppointmentsSection />
    </PanaceaDestinationPage>
  );
}
