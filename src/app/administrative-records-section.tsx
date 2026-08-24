"use client";

import { type FormEvent, type ReactNode, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "~/components/ui/native-select";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";
import { formValue } from "./form-values";

export function AdministrativeRecordsSection() {
  const [result, setResult] = useState<string>();
  const records = api.panacea.listAdministrativeRecords.useQuery();
  const pendingGuardianshipVerifications =
    api.panacea.listPendingGuardianshipVerifications.useQuery();
  const cancelledAppointments =
    api.panacea.listCancelledManualAppointments.useQuery();
  const createContact = api.panacea.createContact.useMutation({
    onSuccess: (contact) => {
      setResult(`Contacto ${contact.name} creado.`);
      void records.refetch();
    },
  });
  const updateContact = api.panacea.updateContact.useMutation({
    onSuccess: (contact) => {
      setResult(`Contacto ${contact.name} actualizado.`);
      void records.refetch();
    },
  });
  const createPatient = api.panacea.createPatient.useMutation({
    onSuccess: (patient) => {
      setResult(`Paciente ${patient.name} creado.`);
      void records.refetch();
    },
  });
  const updatePatient = api.panacea.updatePatient.useMutation({
    onSuccess: (patient) => {
      setResult(`Paciente ${patient.name} actualizado.`);
      void records.refetch();
    },
  });
  const createLink = api.panacea.createContactPatientLink.useMutation({
    onSuccess: () => {
      setResult("Vínculo Contacto–Paciente registrado.");
      void records.refetch();
    },
  });

  function createContactRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    createContact.mutate({
      name: formValue(data, "name"),
      phone: formValue(data, "phone"),
    });
  }

  function updateContactRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    updateContact.mutate({
      id: formValue(data, "id"),
      name: formValue(data, "name"),
      phone: formValue(data, "phone"),
    });
  }

  function createPatientRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    createPatient.mutate({
      birthDate: formValue(data, "birthDate"),
      name: formValue(data, "name"),
    });
  }

  function updatePatientRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    updatePatient.mutate({
      birthDate: formValue(data, "birthDate"),
      id: formValue(data, "id"),
      name: formValue(data, "name"),
    });
  }

  function linkRecords(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    createLink.mutate({
      contactId: formValue(data, "contactId"),
      patientId: formValue(data, "patientId"),
    });
  }

  const error =
    createContact.error ??
    updateContact.error ??
    createPatient.error ??
    updatePatient.error ??
    createLink.error;
  const pending =
    createContact.isPending ||
    updateContact.isPending ||
    createPatient.isPending ||
    updatePatient.isPending ||
    createLink.isPending;
  const queryError =
    records.error ??
    pendingGuardianshipVerifications.error ??
    cancelledAppointments.error;

  function refetchRecords() {
    void Promise.all([
      records.refetch(),
      pendingGuardianshipVerifications.refetch(),
      cancelledAppointments.refetch(),
    ]);
  }

  return (
    <section
      aria-labelledby="administrative-records-title"
      className="space-y-5"
    >
      <Card>
        <CardHeader className="border-border border-b">
          <h2
            className="text-xl font-semibold"
            id="administrative-records-title"
          >
            Fichas administrativas
          </h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            Registre Contactos, Pacientes y sus Vínculos explícitos para
            preparar la atención.
          </p>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <section
            aria-labelledby="guardianship-title"
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950"
          >
            <h3 className="font-medium" id="guardianship-title">
              Tutelas pendientes de verificación
            </h3>
            {pendingGuardianshipVerifications.isLoading ? (
              <Skeleton className="mt-3 h-5 w-56 bg-amber-100" />
            ) : pendingGuardianshipVerifications.data?.length ? (
              <ul className="mt-3 space-y-2 text-sm leading-6">
                {pendingGuardianshipVerifications.data.map((task) => (
                  <li key={task.id}>
                    Verificar la tutela de {task.tutor.name} (DUI{" "}
                    {task.guardianDui}) sobre {task.patient.name} antes de su
                    primera visita.
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm leading-6 text-amber-900">
                No hay tutelas pendientes.
              </p>
            )}
          </section>
          {queryError ? (
            <Alert variant="destructive">
              <AlertTitle>No se pudieron cargar todas las fichas</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>{queryError.message}</span>
                <Button
                  onClick={refetchRecords}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <form
              className="border-border bg-muted/40 space-y-4 rounded-lg border p-4"
              onSubmit={createContactRecord}
            >
              <div>
                <h3 className="font-medium">Nuevo Contacto</h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  Registre un contacto de la clínica.
                </p>
              </div>
              <FieldGroup className="gap-4">
                <RecordField id="new-contact-name" label="Nombre" name="name" />
                <RecordField
                  id="new-contact-phone"
                  label="Teléfono E.164"
                  name="phone"
                  placeholder="+50371234567"
                  type="tel"
                />
              </FieldGroup>
              <Button disabled={pending} type="submit">
                {createContact.isPending ? "Guardando…" : "Crear Contacto"}
              </Button>
            </form>
            <form
              className="border-border bg-muted/40 space-y-4 rounded-lg border p-4"
              onSubmit={createPatientRecord}
            >
              <div>
                <h3 className="font-medium">Nuevo Paciente</h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  Registre la ficha administrativa del paciente.
                </p>
              </div>
              <FieldGroup className="gap-4">
                <RecordField id="new-patient-name" label="Nombre" name="name" />
                <RecordField
                  id="new-patient-birth-date"
                  label="Fecha de nacimiento"
                  name="birthDate"
                  type="date"
                />
              </FieldGroup>
              <Button disabled={pending} type="submit">
                {createPatient.isPending ? "Guardando…" : "Crear Paciente"}
              </Button>
            </form>
          </div>

          <Separator />
          <form
            className="border-border bg-muted/40 grid gap-4 rounded-lg border p-4 sm:grid-cols-3 sm:items-end"
            onSubmit={linkRecords}
          >
            <Field>
              <FieldLabel htmlFor="link-contact" id="link-contact-label">
                Contacto
              </FieldLabel>
              <FieldContent>
                <NativeSelect
                  aria-labelledby="link-contact-label"
                  className="w-full"
                  id="link-contact"
                  name="contactId"
                  required
                >
                  <NativeSelectOption value="">
                    Seleccione un Contacto
                  </NativeSelectOption>
                  {records.data?.contacts.map((contact) => (
                    <NativeSelectOption key={contact.id} value={contact.id}>
                      {contact.name} · {contact.phoneE164}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="link-patient" id="link-patient-label">
                Paciente
              </FieldLabel>
              <FieldContent>
                <NativeSelect
                  aria-labelledby="link-patient-label"
                  className="w-full"
                  id="link-patient"
                  name="patientId"
                  required
                >
                  <NativeSelectOption value="">
                    Seleccione un Paciente
                  </NativeSelectOption>
                  {records.data?.patients.map((patient) => (
                    <NativeSelectOption key={patient.id} value={patient.id}>
                      {patient.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FieldContent>
            </Field>
            <Button
              className="w-full sm:w-fit"
              disabled={
                pending ||
                records.data?.contacts.length === 0 ||
                records.data?.patients.length === 0
              }
              type="submit"
            >
              {createLink.isPending ? "Guardando…" : "Vincular"}
            </Button>
          </form>

          {result ? (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
              <AlertTitle>Actualización registrada</AlertTitle>
              <AlertDescription className="text-emerald-900">
                {result}
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>No se pudo guardar el cambio</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : null}
          {records.isLoading ? (
            <RecordsSkeleton />
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              <RecordList
                emptyMessage="No hay Contactos registrados."
                heading="Contactos"
                isEmpty={records.data?.contacts.length === 0}
              >
                {records.data?.contacts.map((contact) => (
                  <form
                    className="border-border bg-background space-y-4 rounded-lg border p-4"
                    id={`contact-${contact.id}`}
                    key={contact.id}
                    onSubmit={updateContactRecord}
                  >
                    <input name="id" type="hidden" value={contact.id} />
                    <FieldGroup className="gap-4">
                      <RecordField
                        defaultValue={contact.name}
                        id={`contact-name-${contact.id}`}
                        label="Nombre"
                        name="name"
                      />
                      <RecordField
                        defaultValue={contact.phoneE164}
                        id={`contact-phone-${contact.id}`}
                        label="Teléfono E.164"
                        name="phone"
                        type="tel"
                      />
                    </FieldGroup>
                    <p className="text-muted-foreground text-xs leading-5">
                      Vinculado con {contact.patientIds.length} Paciente(s).
                    </p>
                    <Button disabled={pending} type="submit">
                      {updateContact.isPending
                        ? "Guardando…"
                        : "Guardar Contacto"}
                    </Button>
                  </form>
                ))}
              </RecordList>
              <RecordList
                emptyMessage="No hay Pacientes registrados."
                heading="Pacientes"
                isEmpty={records.data?.patients.length === 0}
              >
                {records.data?.patients.map((patient) => (
                  <form
                    className="border-border bg-background space-y-4 rounded-lg border p-4"
                    id={`patient-${patient.id}`}
                    key={patient.id}
                    onSubmit={updatePatientRecord}
                  >
                    <input name="id" type="hidden" value={patient.id} />
                    <FieldGroup className="gap-4">
                      <RecordField
                        defaultValue={patient.name}
                        id={`patient-name-${patient.id}`}
                        label="Nombre"
                        name="name"
                      />
                      <RecordField
                        defaultValue={patient.birthDate ?? undefined}
                        id={`patient-birth-date-${patient.id}`}
                        label="Fecha de nacimiento"
                        name="birthDate"
                        type="date"
                      />
                    </FieldGroup>
                    <p className="text-muted-foreground text-xs leading-5">
                      Vinculado con {patient.contactIds.length} Contacto(s).
                    </p>
                    {cancelledAppointments.data
                      ?.filter(
                        (appointment) => appointment.patient.id === patient.id,
                      )
                      .map((appointment) => {
                        const cancellation = appointment.events.find(
                          (event) => event.type === "cancelled",
                        );
                        return (
                          <div
                            className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950"
                            key={appointment.id}
                          >
                            <p>
                              Cita cancelada: {appointment.service.name} ·{" "}
                              {formatClinicDateTime(appointment.startsAt)}
                              {cancellation?.reason
                                ? ` · ${cancellation.reason}`
                                : ""}
                            </p>
                            <ul className="ml-4 list-disc text-amber-900">
                              {appointment.events.map((event) => (
                                <li
                                  key={`${event.type}-${event.occurredAt.toISOString()}`}
                                >
                                  {event.type === "manual-created"
                                    ? "Cita manual creada"
                                    : "Cita cancelada"}{" "}
                                  Usuario de clínica {event.actorClinicUserId} ·{" "}
                                  {formatClinicDateTime(event.occurredAt)}
                                  {event.reason ? ` · ${event.reason}` : ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    <Button disabled={pending} type="submit">
                      {updatePatient.isPending
                        ? "Guardando…"
                        : "Guardar Paciente"}
                    </Button>
                  </form>
                ))}
              </RecordList>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function RecordField({
  defaultValue,
  id,
  label,
  name,
  placeholder,
  type = "text",
}: {
  defaultValue?: string;
  id: string;
  label: string;
  name: string;
  placeholder?: string;
  type?: "date" | "tel" | "text";
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FieldContent>
        <Input
          defaultValue={defaultValue}
          id={id}
          maxLength={type === "date" ? undefined : 120}
          name={name}
          placeholder={placeholder}
          required
          type={type}
        />
      </FieldContent>
    </Field>
  );
}

function RecordList({
  children,
  emptyMessage,
  heading,
  isEmpty,
}: {
  children: ReactNode;
  emptyMessage: string;
  heading: string;
  isEmpty: boolean | undefined;
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-medium">{heading}</h3>
      {isEmpty ? (
        <p className="border-border bg-muted/30 text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          {emptyMessage}
        </p>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </div>
  );
}

function RecordsSkeleton() {
  return (
    <div
      aria-label="Cargando fichas administrativas"
      className="grid gap-5 lg:grid-cols-2"
      role="status"
    >
      {Array.from({ length: 2 }, (_, index) => (
        <div className="space-y-3" key={index}>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

function formatClinicDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    hour12: true,
    timeStyle: "short",
    timeZone: "America/El_Salvador",
  }).format(new Date(value));
}
