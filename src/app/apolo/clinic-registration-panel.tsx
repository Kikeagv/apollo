"use client";

import { useState } from "react";

import type {
  ClinicRegistration,
  ClinicRegistrationMode,
} from "~/server/application/clinic-registration";
import { api } from "~/trpc/react";

/** Alta explícita de Clínicas con estado recuperable de la invitación. */
export function ClinicRegistrationPanel() {
  const [clinicName, setClinicName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [mode, setMode] = useState<ClinicRegistrationMode>("commercial");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [selectedClinicId, setSelectedClinicId] = useState("");
  const [registration, setRegistration] = useState<ClinicRegistration | null>(
    null,
  );

  const clinics = api.apolo.listCommercialClinics.useQuery();
  const persistedRegistration = api.apolo.getClinicRegistration.useQuery(
    { clinicId: selectedClinicId },
    { enabled: Boolean(selectedClinicId) },
  );
  const createClinic = api.apolo.createManualClinic.useMutation({
    onSuccess: (result) => {
      setRegistration(result);
      setSelectedClinicId(result.clinic.id);
      void clinics.refetch();
    },
  });
  const retryInvitation = api.apolo.retryClinicInvitation.useMutation({
    onSuccess: setRegistration,
  });

  const visibleRegistration =
    registration ??
    (selectedClinicId ? persistedRegistration.data : null) ??
    null;

  const startNewRegistration = () => {
    setClinicName("");
    setOwnerName("");
    setOwnerEmail("");
    setMode("commercial");
    setIdempotencyKey("");
    setSelectedClinicId("");
    setRegistration(null);
  };

  return (
    <section
      aria-labelledby="clinic-registration-title"
      className="bg-card border-border space-y-5 rounded-xl border p-5 shadow-sm sm:p-6"
      data-clinic-registration-panel="true"
    >
      <div>
        <p className="text-primary text-xs font-semibold tracking-[0.14em] uppercase">
          Alta comercial
        </p>
        <h1
          className="mt-1 text-2xl font-semibold tracking-tight"
          id="clinic-registration-title"
        >
          Registrar una Clínica
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
          La Clínica se crea aunque el correo falle. La invitación conserva un
          único registro y puede reintentarse sin duplicar la Clínica.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium">
          Tipo de Clínica
          <select
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 mt-2 min-h-11 w-full rounded-lg border px-3 py-2 font-normal outline-none focus-visible:ring-3"
            onChange={(event) =>
              setMode(event.target.value as ClinicRegistrationMode)
            }
            value={mode}
          >
            <option value="commercial">Comercial / productiva</option>
            <option value="synthetic">Sintética / pruebas</option>
          </select>
          <span className="text-muted-foreground mt-1 block text-xs font-normal">
            {mode === "synthetic"
              ? "Usa datos y WhatsApp simulados; nunca recibe tráfico real."
              : "Preparada para activar un número real después de la invitación."}
          </span>
        </label>
        <label className="text-sm font-medium">
          Nombre de la Clínica
          <input
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 mt-2 min-h-11 w-full rounded-lg border px-3 py-2 font-normal outline-none focus-visible:ring-3"
            onChange={(event) => setClinicName(event.target.value)}
            placeholder="Clínica Santa Ana"
            value={clinicName}
          />
        </label>
        <label className="text-sm font-medium">
          Médico propietario
          <input
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 mt-2 min-h-11 w-full rounded-lg border px-3 py-2 font-normal outline-none focus-visible:ring-3"
            onChange={(event) => setOwnerName(event.target.value)}
            placeholder="Dra. Ana López"
            value={ownerName}
          />
        </label>
        <label className="text-sm font-medium">
          Correo del propietario
          <input
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 mt-2 min-h-11 w-full rounded-lg border px-3 py-2 font-normal outline-none focus-visible:ring-3"
            onChange={(event) => setOwnerEmail(event.target.value)}
            placeholder="ana@clinica.com"
            type="email"
            value={ownerEmail}
          />
        </label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          className="bg-primary text-primary-foreground hover:bg-primary/90 min-h-11 rounded-lg px-4 py-2.5 font-medium transition-colors disabled:opacity-50"
          disabled={
            !clinicName.trim() ||
            !ownerName.trim() ||
            !ownerEmail.trim() ||
            Boolean(visibleRegistration) ||
            createClinic.isPending
          }
          onClick={() => {
            const key = idempotencyKey || globalThis.crypto.randomUUID();
            setIdempotencyKey(key);
            createClinic.mutate({
              clinicName: clinicName.trim(),
              idempotencyKey: key,
              mode,
              ownerEmail: ownerEmail.trim(),
              ownerName: ownerName.trim(),
            });
          }}
          type="button"
        >
          {createClinic.isPending ? "Creando Clínica…" : "Crear Clínica"}
        </button>
        {visibleRegistration ? (
          <button
            className="border-border text-foreground hover:bg-muted min-h-11 rounded-lg border px-4 py-2.5 font-medium transition-colors"
            onClick={startNewRegistration}
            type="button"
          >
            Nueva alta
          </button>
        ) : null}
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          Ver una alta existente
          <select
            aria-label="Ver alta de Clínica existente"
            className="border-input bg-background text-foreground min-h-11 rounded-lg border px-3 py-2"
            onChange={(event) => {
              setRegistration(null);
              setSelectedClinicId(event.target.value);
            }}
            value={selectedClinicId}
          >
            <option value="">Seleccionar</option>
            {clinics.data?.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {createClinic.error || persistedRegistration.error ? (
        <p className="text-warning-foreground text-sm" role="alert">
          {(createClinic.error ?? persistedRegistration.error)?.message}
        </p>
      ) : null}

      {visibleRegistration ? (
        <RegistrationOutcome
          isRetrying={retryInvitation.isPending}
          onRetry={() =>
            retryInvitation.mutate({
              clinicId: visibleRegistration.clinic.id,
            })
          }
          registration={visibleRegistration}
        />
      ) : null}
      {retryInvitation.error ? (
        <p className="text-warning-foreground text-sm" role="alert">
          {retryInvitation.error.message}
        </p>
      ) : null}
    </section>
  );
}

function RegistrationOutcome({
  isRetrying,
  onRetry,
  registration,
}: {
  isRetrying: boolean;
  onRetry: () => void;
  registration: ClinicRegistration;
}) {
  const delivered = registration.invitation.delivery.status === "sent";

  return (
    <div
      className={`rounded-lg border p-4 text-sm ${
        delivered
          ? "border-success-border bg-success-muted/50"
          : "border-warning-border bg-warning-muted"
      }`}
      role={delivered ? "status" : "alert"}
    >
      <p className="font-semibold">
        Clínica {registration.clinic.name} creada correctamente.
      </p>
      <p className="mt-1">
        Tipo: {registration.clinic.isSynthetic ? "sintética" : "comercial"}.{" "}
        Invitación para {registration.invitation.email}:{" "}
        {delivered ? "enviada" : "pendiente de entrega"}.
      </p>
      {registration.clinic.isSynthetic ? (
        <p className="mt-2">
          Esta Clínica usa tráfico simulado y no puede recibir tráfico real de
          WhatsApp.
        </p>
      ) : null}
      {registration.invitation.delivery.lastError ? (
        <p className="mt-2">
          Fallo recuperable: {registration.invitation.delivery.lastError}. La
          Clínica ya existe; puedes reintentar la entrega.
        </p>
      ) : null}
      {registration.invitation.delivery.canRetry ? (
        <button
          className="border-warning-foreground/40 text-warning-foreground hover:bg-warning-foreground/10 mt-3 min-h-10 rounded-lg border px-3 py-2 font-medium transition-colors disabled:opacity-50"
          disabled={isRetrying}
          onClick={onRetry}
          type="button"
        >
          {isRetrying ? "Reintentando…" : "Reintentar invitación"}
        </button>
      ) : null}
    </div>
  );
}
