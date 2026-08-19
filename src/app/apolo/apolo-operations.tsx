"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

/** Panel mínimo, aislado de Panacea, para pagos, estado y soporte comercial. */
export function ApoloOperations() {
  const clinics = api.apolo.listCommercialClinics.useQuery();
  const [clinicId, setClinicId] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [supportSessionId, setSupportSessionId] = useState("");
  const recordPayment = api.apolo.recordTransferPayment.useMutation();
  const setSubscription = api.apolo.changeSubscriptionStatus.useMutation({
    onSuccess: () => clinics.refetch(),
  });
  const openSupport = api.apolo.openSupportSession.useMutation({
    onSuccess: (session) => setSupportSessionId(session.id),
  });
  const readSupport = api.apolo.readSupportClinicSummary.useMutation();

  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-6 bg-slate-950 p-8 text-slate-100">
      <div>
        <p className="text-sm font-medium tracking-[0.2em] text-teal-300">
          PRAXIA
        </p>
        <h1 className="text-4xl font-semibold">Operación comercial</h1>
        <p className="mt-2 text-slate-300">
          Este camino no abre el panel clínico ni concede acceso clínico por sí
          mismo.
        </p>
      </div>
      <label className="block text-sm">
        Clínica
        <select
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setClinicId(event.target.value)}
          value={clinicId}
        >
          <option value="">Seleccione una Clínica</option>
          {clinics.data?.map((clinic) => (
            <option key={clinic.id} value={clinic.id}>
              {clinic.name} · {clinic.subscriptionStatus}
            </option>
          ))}
        </select>
      </label>
      <section className="space-y-3 rounded-xl border border-slate-700 p-5">
        <h2 className="text-xl font-semibold">Pago por transferencia</h2>
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setAmountUsd(event.target.value)}
          placeholder="Monto USD, por ejemplo 75.00"
          value={amountUsd}
        />
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setReference(event.target.value)}
          placeholder="Referencia de transferencia"
          value={reference}
        />
        <button
          className="rounded bg-teal-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-50"
          disabled={!clinicId || recordPayment.isPending}
          onClick={() =>
            recordPayment.mutate({ amountUsd, clinicId, reference })
          }
          type="button"
        >
          Registrar pago
        </button>
      </section>
      <section className="space-y-3 rounded-xl border border-slate-700 p-5">
        <h2 className="text-xl font-semibold">Suscripción</h2>
        <div className="flex gap-2">
          <button
            className="rounded border border-teal-300 px-3 py-2 disabled:opacity-50"
            disabled={!clinicId || setSubscription.isPending}
            onClick={() =>
              setSubscription.mutate({ clinicId, status: "active" })
            }
            type="button"
          >
            Activar
          </button>
          <button
            className="rounded border border-amber-400 px-3 py-2 disabled:opacity-50"
            disabled={!clinicId || setSubscription.isPending}
            onClick={() =>
              setSubscription.mutate({ clinicId, status: "suspended" })
            }
            type="button"
          >
            Suspender
          </button>
        </div>
      </section>
      <section className="space-y-3 rounded-xl border border-amber-500/70 p-5">
        <h2 className="text-xl font-semibold">Soporte con vencimiento</h2>
        <textarea
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setReason(event.target.value)}
          placeholder="Motivo de soporte"
          value={reason}
        />
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setExpiresAt(event.target.value)}
          type="datetime-local"
          value={expiresAt}
        />
        <button
          className="rounded bg-amber-300 px-3 py-2 font-medium text-slate-950 disabled:opacity-50"
          disabled={!clinicId || !reason || !expiresAt || openSupport.isPending}
          onClick={() =>
            openSupport.mutate({
              clinicId,
              expiresAt: new Date(expiresAt),
              reason,
            })
          }
          type="button"
        >
          Abrir soporte auditado
        </button>
        <input
          className="w-full rounded border border-slate-700 bg-slate-900 p-2"
          onChange={(event) => setSupportSessionId(event.target.value)}
          placeholder="ID de sesión de soporte"
          value={supportSessionId}
        />
        <button
          className="rounded border border-amber-300 px-3 py-2 disabled:opacity-50"
          disabled={!clinicId || !supportSessionId || readSupport.isPending}
          onClick={() => readSupport.mutate({ clinicId, supportSessionId })}
          type="button"
        >
          Consultar estado de soporte
        </button>
        {readSupport.data ? (
          <p className="text-sm text-slate-200">
            {readSupport.data.name}: {readSupport.data.subscriptionStatus}
          </p>
        ) : null}
      </section>
    </main>
  );
}
