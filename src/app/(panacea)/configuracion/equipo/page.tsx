import { notFound } from "next/navigation";

import { DoctorsSection } from "~/app/doctors-section";
import { DoctorProfileSetup } from "~/app/doctor-profile-setup";
import { PanaceaDestinationPage } from "~/app/panacea-destination-page";
import { findOwnDoctorProfile } from "~/server/application/doctor-profile";

import { requirePanaceaConfigurationSection } from "../../route-access";

export default async function TeamSettingsPage() {
  const context = await requirePanaceaConfigurationSection("team");
  if (context.clinic.role !== "owner") notFound();
  const profile = await findOwnDoctorProfile({
    clinicId: context.clinic.clinicId,
    identityId: context.clinic.identityId,
  });

  return (
    <PanaceaDestinationPage
      description="Administre el equipo de la Clínica y complete los perfiles de Médicos elegibles."
      eyebrow="Configuración · Equipo"
      title="Equipo"
    >
      {profile ? <DoctorProfileSetup initialProfile={profile} /> : null}
      <DoctorsSection />
    </PanaceaDestinationPage>
  );
}
