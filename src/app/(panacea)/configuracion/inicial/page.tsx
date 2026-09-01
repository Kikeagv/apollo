import { notFound } from "next/navigation";

import { ClinicSetupWizard } from "~/app/clinic-setup-wizard";
import { PanaceaDestinationPage } from "~/app/panacea-destination-page";

import { requirePanaceaDestination } from "../../route-access";

export default async function InitialClinicSetupPage() {
  const context = await requirePanaceaDestination("settings");
  if (context.clinic.role !== "owner") notFound();

  return (
    <PanaceaDestinationPage
      description="Configure la capacidad mínima de la Clínica y declare de forma explícita cuándo Praxia puede ofrecer nuevas Opciones por WhatsApp."
      eyebrow="Configuración · Inicio"
      title="Configuración inicial"
    >
      <ClinicSetupWizard />
    </PanaceaDestinationPage>
  );
}
