"use client";

import { api } from "~/trpc/react";

const statusLabels = {
  approved: "Aprobada",
  disabled: "Deshabilitada",
  missing: "Falta",
  outdated: "Desactualizada",
  pending: "Pendiente",
  rejected: "Rechazada",
} as const;

export function SupervisionTemplates() {
  const catalog = api.apolo.getSupervisionTemplateCatalog.useQuery();

  if (catalog.isLoading)
    return <p role="status">Cargando catálogo y cobertura…</p>;
  if (catalog.error)
    return (
      <p role="alert" className="text-amber-200">
        {catalog.error.message}
      </p>
    );

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Plantillas de WhatsApp</h2>
        <p className="mt-1 text-sm text-slate-300">
          Definición compartida y versión del catálogo junto con cobertura
          independiente para cada WABA.
        </p>
      </header>

      <section
        aria-labelledby="template-definitions-title"
        className="space-y-3"
      >
        <h3 className="text-lg font-semibold" id="template-definitions-title">
          Definición común
        </h3>
        <div className="grid gap-3 lg:grid-cols-2">
          {catalog.data?.definitions.map((definition) => (
            <article
              className="min-w-0 rounded-xl border border-slate-700 p-4"
              key={definition.kind}
            >
              <h4 className="font-semibold">
                {definition.name} · v{definition.version}
              </h4>
              <p className="mt-1 text-sm text-slate-300">
                {definition.category} · {definition.locale}
              </p>
              <p className="mt-3 text-sm break-words">{definition.content}</p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-400">Variables</dt>
                  <dd>{definition.variables.join(", ") || "Ninguna"}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Ejemplos</dt>
                  <dd className="break-words">
                    {Object.entries(definition.examples)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(" · ") || "Sin ejemplos"}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="template-coverage-title" className="space-y-3">
        <h3 className="text-lg font-semibold" id="template-coverage-title">
          Cobertura por WABA
        </h3>
        {catalog.data?.wabas.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {catalog.data.wabas.map((waba) => (
              <article
                className="min-w-0 rounded-xl border border-slate-700 p-4"
                key={waba.clinicId}
              >
                <h4 className="font-semibold break-words">{waba.clinicName}</h4>
                <p className="text-xs break-all text-slate-400">
                  WABA: {waba.businessAccountId}
                </p>
                <ul className="mt-3 space-y-3">
                  {waba.templates.map((template) => (
                    <li
                      className="border-t border-slate-700 pt-3"
                      key={template.kind}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">
                          {template.name} · v{template.version}
                        </span>
                        <span className="text-sm">
                          {statusLabels[template.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-300">
                        Provisionamiento:{" "}
                        {statusLabels[template.provisioningStatus]} ·{" "}
                        {template.category} · {template.locale}
                      </p>
                      {template.rejectionReason ? (
                        <p className="mt-1 text-sm break-words text-amber-200">
                          Motivo del rechazo: {template.rejectionReason}
                        </p>
                      ) : null}
                      {template.providerTemplateId ? (
                        <p className="mt-1 text-xs break-all text-slate-400">
                          ID del proveedor: {template.providerTemplateId}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p
            className="rounded-lg border border-slate-700 p-4 text-slate-300"
            role="status"
          >
            Todavía no hay WABAs conectadas para mostrar cobertura.
          </p>
        )}
      </section>
    </div>
  );
}
