import { notFound } from "next/navigation";

import { env } from "~/env";
import { PanaceaDestinationPage } from "~/app/panacea-destination-page";
import { SyntheticClinicalActionForm } from "~/app/synthetic-clinical-action-form";
import { canAccessPanaceaTechnicalSurface } from "~/server/application/panacea-technical-surface";
import { getPanaceaSessionContext } from "~/server/application/panacea-shell";

export const metadata = {
  robots: { follow: false, index: false },
};

export default async function TechnicalClinicalCheckPage() {
  const context = await getPanaceaSessionContext();
  if (
    context === undefined ||
    !canAccessPanaceaTechnicalSurface({
      nodeEnv: env.NODE_ENV,
      role: context.clinic.role,
    })
  ) {
    notFound();
  }

  return (
    <main className="bg-background text-foreground min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <PanaceaDestinationPage
          description="Superficie protegida para pruebas técnicas de aislamiento por Clínica. No forma parte de la operación normal de Panacea."
          eyebrow="Superficie técnica protegida"
          title="Comprobación clínica"
        >
          <SyntheticClinicalActionForm />
        </PanaceaDestinationPage>
      </div>
    </main>
  );
}
