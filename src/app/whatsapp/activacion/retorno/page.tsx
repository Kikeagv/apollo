import Link from "next/link";

import {
  WHATSAPP_CONFIGURATION_PATH,
  whatsappSetupLinkReturnNextAction,
  whatsappSetupLinkReturnStatusLabels,
} from "~/domain/whatsapp-setup-link-return";
import { env } from "~/env";
import { processWhatsAppSetupLinkReturn } from "~/server/application/whatsapp-setup-link-return";
import { drizzleKapsoOnboardingStore } from "~/server/db/kapso-onboarding-store";
import { createKapsoOnboardingProvider } from "~/server/whatsapp/kapso-onboarding";

export const dynamic = "force-dynamic";

const kapsoOnboardingProvider = createKapsoOnboardingProvider({
  apiKey: env.KAPSO_API_KEY,
});

export default async function WhatsAppSetupLinkReturnPage({
  searchParams,
}: {
  searchParams: Promise<{
    error_code?: string | string[];
    setup_link_id?: string | string[];
    status?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const result = await processWhatsAppSetupLinkReturn(
    {
      errorCode: singleSearchParam(params.error_code),
      setupLinkId: singleSearchParam(params.setup_link_id),
      status: singleSearchParam(params.status),
    },
    {
      provider: kapsoOnboardingProvider,
      store: drizzleKapsoOnboardingStore,
    },
  );

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100"
      data-whatsapp-setup-return-status={result.status}
    >
      <section className="w-full max-w-xl space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm font-medium tracking-[0.2em] text-teal-300">
          PRAXIA
        </p>
        <h1 className="text-3xl font-semibold">Configuración de WhatsApp</h1>
        <p className="text-lg text-slate-100">
          {whatsappSetupLinkReturnStatusLabels[result.status]}
        </p>
        <p className="text-sm leading-6 text-slate-300">
          {result.verified
            ? "El resultado fue verificado contra el enlace que Praxia tiene asociado a su Clínica."
            : "Todavía no pudimos verificar este retorno en el servidor; no se modificó ninguna Conexión."}
        </p>
        <p className="rounded-lg border border-slate-700 bg-slate-950/60 p-4 text-sm leading-6 text-slate-200">
          {whatsappSetupLinkReturnNextAction(result.status)}
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950"
            href={`/?next=${encodeURIComponent(WHATSAPP_CONFIGURATION_PATH)}`}
          >
            Iniciar sesión y continuar
          </Link>
          <Link
            className="rounded border border-slate-600 px-4 py-2 text-slate-100"
            href="/"
          >
            Volver al inicio
          </Link>
        </div>
      </section>
    </main>
  );
}

function singleSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? undefined : value;
}
