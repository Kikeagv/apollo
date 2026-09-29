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

type TemplateStatus = keyof typeof statusLabels;

type SupervisionTemplatesProps = {
  clinicId: string;
  clinicName: string | undefined;
};

function getStatusClasses(status: TemplateStatus) {
  if (status === "approved") {
    return "border-success-border bg-success-muted text-success-foreground";
  }
  if (status === "rejected") {
    return "border-destructive text-destructive";
  }
  return "border-warning-border bg-warning-muted text-warning-foreground";
}

export function SupervisionTemplates({
  clinicId,
  clinicName,
}: SupervisionTemplatesProps) {
  const catalog = api.apolo.getSupervisionTemplateCatalog.useQuery();

  if (catalog.isLoading)
    return <p role="status">Cargando la cobertura de plantillas…</p>;
  if (catalog.error)
    return (
      <p role="alert" className="text-warning-foreground">
        {catalog.error.message}
      </p>
    );

  const selectedWabas =
    catalog.data?.wabas.filter((waba) => waba.clinicId === clinicId) ?? [];
  const displayClinicName =
    selectedWabas[0]?.clinicName ?? clinicName ?? "la Clínica seleccionada";
  const definitions = catalog.data?.definitions ?? [];

  return (
    <div className="text-foreground space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Plantillas de WhatsApp</h2>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
          Consulta primero el estado de la Conexión de WhatsApp de la Clínica
          seleccionada. Las definiciones comunes aparecen aparte en el catálogo
          global.
        </p>
      </header>

      <section
        aria-labelledby="template-clinic-coverage-title"
        className="space-y-3"
      >
        <div>
          <h3
            className="text-lg font-semibold"
            id="template-clinic-coverage-title"
          >
            Cobertura de esta Clínica
          </h3>
          <p className="text-muted-foreground text-sm">{displayClinicName}</p>
        </div>

        {!clinicId ? (
          <p
            className="border-border bg-muted text-muted-foreground rounded-lg border p-4"
            role="status"
          >
            Selecciona una Clínica para consultar sus plantillas y bloqueos.
          </p>
        ) : selectedWabas.length ? (
          <div className="space-y-3">
            {selectedWabas.map((waba) => {
              const approvedCount = waba.templates.filter(
                (template) => template.status === "approved",
              ).length;
              const blockers = waba.templates.filter(
                (template) => template.status !== "approved",
              );
              const hasRejectedTemplate = blockers.some(
                (template) => template.status === "rejected",
              );

              return (
                <article
                  className="border-border bg-card min-w-0 rounded-xl border p-4"
                  key={waba.clinicId}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="font-semibold break-words">
                        {waba.clinicName}
                      </h4>
                      <p className="text-muted-foreground text-xs break-all">
                        WABA: {waba.businessAccountId}
                      </p>
                    </div>
                    <span className="border-border bg-muted rounded-full border px-2.5 py-1 text-sm font-medium tabular-nums">
                      {approvedCount} de {waba.templates.length} aprobadas
                    </span>
                  </div>

                  {blockers.length ? (
                    <div
                      className={`mt-4 rounded-lg border p-3 ${
                        hasRejectedTemplate
                          ? "border-destructive text-destructive"
                          : "border-warning-border bg-warning-muted text-warning-foreground"
                      }`}
                      role="status"
                    >
                      <p className="font-medium">
                        Hay plantillas críticas sin aprobación; la Conexión de
                        WhatsApp no estará lista hasta que se aprueben.
                      </p>
                      <p className="mt-1 text-sm">
                        {blockers
                          .map(
                            (template) =>
                              `${template.name}: ${statusLabels[template.status]}`,
                          )
                          .join(" · ")}
                      </p>
                    </div>
                  ) : (
                    <p
                      className="border-success-border bg-success-muted text-success-foreground mt-4 rounded-lg border p-3 text-sm"
                      role="status"
                    >
                      Todas las plantillas críticas están aprobadas para esta
                      WABA. La Conexión de WhatsApp todavía puede depender de
                      otros requisitos.
                    </p>
                  )}

                  <ul className="divide-border mt-3 divide-y">
                    {waba.templates.map((template) => (
                      <li
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                        key={template.kind}
                      >
                        <div className="min-w-0">
                          <p className="font-medium break-words">
                            {template.name} · v{template.version}
                          </p>
                          <p className="text-muted-foreground text-sm">
                            Provisionamiento:{" "}
                            {statusLabels[template.provisioningStatus]}
                            {" · "}
                            {template.category}
                            {" · "}
                            {template.locale}
                          </p>
                          {template.rejectionReason ? (
                            <p className="text-destructive mt-1 text-sm break-words">
                              Motivo del rechazo: {template.rejectionReason}
                            </p>
                          ) : null}
                          {template.providerTemplateId ? (
                            <details className="text-muted-foreground mt-1 text-xs">
                              <summary className="w-fit cursor-pointer">
                                Detalles técnicos
                              </summary>
                              <p className="mt-1 break-all">
                                ID del proveedor: {template.providerTemplateId}
                              </p>
                            </details>
                          ) : null}
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-1 text-sm font-medium ${getStatusClasses(template.status)}`}
                        >
                          {statusLabels[template.status]}
                        </span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        ) : (
          <p
            className="border-border bg-muted text-muted-foreground rounded-lg border p-4"
            role="status"
          >
            {displayClinicName} todavía no tiene una WABA conectada con
            cobertura de plantillas disponible.
          </p>
        )}
      </section>

      <section aria-labelledby="template-global-catalog-title">
        <details className="border-border bg-muted rounded-xl border">
          <summary
            className="text-foreground cursor-pointer p-4 font-semibold"
            id="template-global-catalog-title"
          >
            Catálogo global de plantillas
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              {definitions.length} definiciones comunes
            </span>
          </summary>
          <div className="border-border space-y-3 border-t p-4">
            <p className="text-muted-foreground text-sm">
              Estas definiciones se comparten entre Clínicas. Su aprobación y
              estado de provisión se muestran arriba, por Conexión de WhatsApp.
            </p>
            <div className="space-y-2">
              {definitions.map((definition) => (
                <details
                  className="border-border bg-card rounded-lg border p-3"
                  key={definition.kind}
                >
                  <summary className="cursor-pointer font-medium">
                    {definition.name} · v{definition.version}
                    <span className="text-muted-foreground ml-2 text-sm font-normal">
                      {definition.category} · {definition.locale}
                    </span>
                  </summary>
                  <div className="border-border mt-3 space-y-3 border-t pt-3">
                    <p className="text-sm break-words">{definition.content}</p>
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Variables</dt>
                        <dd className="break-words">
                          {definition.variables.join(", ") || "Ninguna"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Ejemplos</dt>
                        <dd className="break-words">
                          {Object.entries(definition.examples)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(" · ") || "Sin ejemplos"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
