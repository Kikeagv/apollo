import { DoctorProfileSetup } from "~/app/doctor-profile-setup";
import { PanaceaDestinationPage } from "~/app/panacea-destination-page";
import { PanaceaSettingsIndex } from "~/app/panacea-settings-index";
import { findOwnDoctorProfile } from "~/server/application/doctor-profile";

import { requirePanaceaDestination } from "../route-access";

export default async function SettingsPage() {
  const context = await requirePanaceaDestination("settings");
  const profile =
    context.clinic.role === "doctor"
      ? await findOwnDoctorProfile({
          clinicId: context.clinic.clinicId,
          identityId: context.clinic.identityId,
        })
      : undefined;

  return (
    <PanaceaDestinationPage
      description="Configure la capacidad de la Clínica por áreas, con el alcance que corresponde a su rol."
      title="Configuración"
    >
      {profile ? <DoctorProfileSetup initialProfile={profile} /> : null}
      <PanaceaSettingsIndex role={context.clinic.role} />
    </PanaceaDestinationPage>
  );
}
