import { canAccessPanaceaConfigurationSection } from "~/domain/panacea-shell";
import { PanaceaDestinationPage } from "~/app/panacea-destination-page";
import { ServiceCatalogSection } from "~/app/service-catalog-section";

import { requirePanaceaConfigurationSection } from "../../route-access";

export default async function ServicesSettingsPage() {
  const context = await requirePanaceaConfigurationSection("services");

  return (
    <PanaceaDestinationPage
      description="Defina el catálogo y las Ofertas de servicio que forman la capacidad de atención."
      eyebrow="Configuración · Servicios"
      title="Servicios"
    >
      <ServiceCatalogSection
        canManageServices={context.clinic.role === "owner"}
        canManageOffers={canAccessPanaceaConfigurationSection(
          context.clinic.role,
          "services",
        )}
      />
    </PanaceaDestinationPage>
  );
}
