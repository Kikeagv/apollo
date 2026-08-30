import { canAccessPanaceaConfigurationSection } from "~/domain/panacea-shell";
import { ManualAppointmentsSection } from "~/app/manual-appointments-section";
import { PanaceaDestinationPage } from "~/app/panacea-destination-page";

import { requirePanaceaDestination } from "../route-access";

export default async function CalendarPage() {
  const context = await requirePanaceaDestination("calendar");

  return (
    <PanaceaDestinationPage title="Calendario">
      <ManualAppointmentsSection
        canManageAvailability={canAccessPanaceaConfigurationSection(
          context.clinic.role,
          "availability",
        )}
      />
    </PanaceaDestinationPage>
  );
}
