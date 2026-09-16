"use client";

import { useEffect, useState } from "react";

import {
  whatsappActivationClosureCriteria,
  type WhatsAppActivationEvidenceSource,
  type WhatsAppActivationCriterionCode,
} from "~/domain/whatsapp-activation";
import { api } from "~/trpc/react";

const stateLabels = {
  blocked: "Bloqueado",
  "not-configured": "Sin configurar",
  offboarded: "Retirado",
  pending: "Pendiente",
  ready: "Listo",
  authenticated: "Autenticada",
  enabled: "Habilitada",
  "synthetic-only": "Solo sintética",
  provisioning: "Provisionando",
  degraded: "Degradada",
  disconnected: "Desconectada",
} as const;

const sourceLabels: Record<WhatsAppActivationEvidenceSource, string> = {
  deployed: "Entorno desplegado",
  kapso: "Kapso",
};

export function WhatsAppActivationClosureSection({
  clinicId,
  refreshToken,
}: {
  clinicId: string;
  refreshToken: number;
}) {
  const [criterionCode, setCriterionCode] =
    useState<WhatsAppActivationCriterionCode>("product-access");
  const [source, setSource] =
    useState<WhatsAppActivationEvidenceSource>("deployed");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [pendingReason, setPendingReason] = useState("");
  const contract = api.apolo.getWhatsAppActivationContract.useQuery(
    { clinicId },
    { enabled: Boolean(clinicId) },
  );
  const refetchContract = contract.refetch;
  useEffect(() => {
    if (clinicId !== "") void refetchContract();
  }, [clinicId, refetchContract, refreshToken]);
  const recordEvidence = api.apolo.recordWhatsAppActivationEvidence.useMutation(
    {
      onSuccess: () => {
        setEvidenceReference("");
        setPendingReason("");
        void contract.refetch();
      },
    },
  );

  const selectedCriterion =
    contract.data?.criteria.find(
      (criterion) => criterion.code === criterionCode,
    ) ??
    whatsappActivationClosureCriteria.find(
      (criterion) => criterion.code === criterionCode,
    );
  const hasReference = evidenceReference.trim() !== "";
  const hasPendingReason = pendingReason.trim() !== "";

  return (
    <section
      aria-labelledby="whatsapp-activation-closure-title"
      className="space-y-4 rounded-xl border border-indigo-400/70 p-5"
      data-whatsapp-activation-closure="true"
    >
      <div>
        <p className="text-xs tracking-[0.14em] text-indigo-200 uppercase">
          APO-94 · Contrato de cierre
        </p>
        <h2
          className="mt-1 text-xl font-semibold"
          id="whatsapp-activation-closure-title"
        >
          Alcance y evidencia de Activación
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          La matriz combina cobertura local con evidencia de Kapso y del entorno
          desplegado. Un pendiente no cambia ningún gate de tráfico real.
        </p>
      </div>

      {!clinicId ? (
        <p className="text-sm text-slate-400">
          Seleccione una Clínica para consultar su contrato de cierre.
        </p>
      ) : contract.isLoading ? (
        <p className="text-sm text-slate-300" role="status">
          Consultando contrato de cierre…
        </p>
      ) : contract.error ? (
        <p className="text-sm text-amber-200" role="alert">
          {contract.error.message}
        </p>
      ) : contract.data ? (
        <>
          <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-7">
            <StateValue
              label="Cierre"
              value={closureStatusLabel(contract.data.closureStatus)}
            />
            <StateValue
              label="Modalidad"
              value={scopeStatusLabel(contract.data.scope.status)}
            />
            <StateValue
              label="Identidad"
              value={stateLabel(contract.data.states.identity)}
            />
            <StateValue
              label="Acceso propietario"
              value={stateLabel(contract.data.states.ownerAccess)}
            />
            <StateValue
              label="Conexión"
              value={stateLabel(contract.data.states.connection)}
            />
            <StateValue
              label="Preparación técnica"
              value={stateLabel(contract.data.states.technicalReadiness)}
            />
            <StateValue
              label="Mensajería"
              value={stateLabel(contract.data.states.messaging)}
            />
          </dl>

          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full min-w-[900px] text-left text-sm">
              <caption className="sr-only">
                Matriz de criterios, comportamiento, pruebas y evidencia externa
              </caption>
              <thead className="bg-slate-900/80 text-xs tracking-wide text-slate-300 uppercase">
                <tr>
                  <th className="p-3" scope="col">
                    Criterio
                  </th>
                  <th className="p-3" scope="col">
                    Comportamiento
                  </th>
                  <th className="p-3" scope="col">
                    Prueba local
                  </th>
                  <th className="p-3" scope="col">
                    Evidencia externa
                  </th>
                  <th className="p-3" scope="col">
                    Estado / pendiente
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {contract.data.criteria.map((criterion) => (
                  <tr key={criterion.code}>
                    <th
                      className="p-3 align-top font-medium text-slate-100"
                      scope="row"
                    >
                      {criterion.label}
                      <span className="mt-1 block text-xs font-normal text-slate-400">
                        {criterion.issue}
                      </span>
                    </th>
                    <td className="max-w-sm p-3 align-top text-slate-300">
                      {criterion.behavior}
                    </td>
                    <td className="p-3 align-top font-mono text-xs text-slate-400">
                      {criterion.testPath}
                    </td>
                    <td className="p-3 align-top text-xs text-slate-300">
                      {criterion.requiredExternalEvidence.length === 0 ? (
                        <span>Decisión local documentada</span>
                      ) : (
                        <ul className="space-y-1">
                          {criterion.requiredExternalEvidence.map(
                            (requiredSource) => {
                              const evidence =
                                criterion.evidence[requiredSource];
                              return (
                                <li key={requiredSource}>
                                  <span className="text-slate-400">
                                    {sourceLabels[requiredSource]}:
                                  </span>{" "}
                                  {evidence?.evidenceReference ?? "Pendiente"}
                                </li>
                              );
                            },
                          )}
                        </ul>
                      )}
                    </td>
                    <td className="p-3 align-top">
                      <span
                        className={
                          criterion.status === "verified"
                            ? "text-emerald-300"
                            : "text-amber-200"
                        }
                      >
                        {criterion.status === "verified"
                          ? "Verificado"
                          : "Pendiente"}
                      </span>
                      {criterion.pending ? (
                        <span className="mt-1 block text-xs text-slate-400">
                          {criterion.pending}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
            <div>
              <h3 className="font-medium text-slate-100">
                Registrar evidencia externa
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Para un mismo criterio y fuente se conserva la última evidencia
                o razón de pendiente, con identidad y fecha de registro.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm text-slate-300">
                <span>Criterio</span>
                <select
                  className="w-full rounded border border-slate-700 bg-slate-950 p-2"
                  onChange={(event) =>
                    setCriterionCode(
                      event.target.value as WhatsAppActivationCriterionCode,
                    )
                  }
                  value={criterionCode}
                >
                  {contract.data.criteria.map((criterion) => (
                    <option key={criterion.code} value={criterion.code}>
                      {criterion.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm text-slate-300">
                <span>Fuente</span>
                <select
                  className="w-full rounded border border-slate-700 bg-slate-950 p-2"
                  onChange={(event) =>
                    setSource(
                      event.target.value as WhatsAppActivationEvidenceSource,
                    )
                  }
                  value={source}
                >
                  {selectedCriterion?.requiredExternalEvidence.map(
                    (requiredSource) => (
                      <option key={requiredSource} value={requiredSource}>
                        {sourceLabels[requiredSource]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <div className="flex items-end">
                <button
                  className="w-full rounded bg-indigo-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-50"
                  disabled={
                    recordEvidence.isPending ||
                    hasReference === hasPendingReason ||
                    !criterionAcceptsSource(selectedCriterion, source)
                  }
                  onClick={() =>
                    recordEvidence.mutate({
                      clinicId,
                      criterionCode,
                      evidenceReference: hasReference
                        ? evidenceReference
                        : null,
                      pendingReason: hasPendingReason ? pendingReason : null,
                      source,
                    })
                  }
                  type="button"
                >
                  {recordEvidence.isPending
                    ? "Guardando…"
                    : "Guardar evidencia"}
                </button>
              </div>
            </div>
            <label
              className="block space-y-1 text-sm text-slate-300"
              htmlFor="whatsapp-activation-evidence-reference"
            >
              <span>Referencia de evidencia</span>
              <input
                className="w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm"
                id="whatsapp-activation-evidence-reference"
                onChange={(event) => setEvidenceReference(event.target.value)}
                placeholder="URL, run o ticket; no secretos"
                value={evidenceReference}
              />
            </label>
            <label
              className="block space-y-1 text-sm text-slate-300"
              htmlFor="whatsapp-activation-pending-reason"
            >
              <span>Razón de pendiente</span>
              <input
                className="w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm"
                id="whatsapp-activation-pending-reason"
                onChange={(event) => setPendingReason(event.target.value)}
                placeholder="Explica qué evidencia falta"
                value={pendingReason}
              />
            </label>
            {recordEvidence.error ? (
              <p className="text-sm text-amber-200" role="alert">
                {recordEvidence.error.message}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function StateValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <dt className="text-xs tracking-wide text-slate-400 uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-medium text-slate-100">{value}</dd>
    </div>
  );
}

function stateLabel(value: string) {
  return stateLabels[value as keyof typeof stateLabels] ?? value;
}

function criterionAcceptsSource(
  criterion:
    | { requiredExternalEvidence: readonly WhatsAppActivationEvidenceSource[] }
    | undefined,
  source: WhatsAppActivationEvidenceSource,
) {
  return (
    criterion?.requiredExternalEvidence.some(
      (requiredSource) => requiredSource === source,
    ) === true
  );
}

function closureStatusLabel(status: "blocked" | "pending" | "ready") {
  return { blocked: "Bloqueado", pending: "Pendiente", ready: "Listo" }[status];
}

function scopeStatusLabel(
  status: "deferred" | "pending" | "requires-approved-extension" | "v1",
) {
  return {
    deferred: "Diferida",
    pending: "Por definir",
    "requires-approved-extension": "Requiere ampliación aprobada",
    v1: "Coexistence v1",
  }[status];
}
