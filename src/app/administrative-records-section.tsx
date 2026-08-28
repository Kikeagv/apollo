"use client";

import { type FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { Separator } from "~/components/ui/separator";
import type {
  ContactDirectoryEntry,
  ContactPhoneMatch,
  PatientAdministrativeDetail,
  PatientDirectoryEntry,
  PatientSearchTarget,
} from "~/server/application/administrative-records";
import type { AppointmentEventType } from "~/server/application/manual-appointments";
import { api } from "~/trpc/react";
import { formValue } from "./form-values";
import { PanaceaQueryError, PanaceaQueryLoading } from "./panacea-query-state";

const EMPTY_PATIENT_ID = "00000000-0000-0000-0000-000000000000";

export function AdministrativeRecordsSection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedPatientId = searchParams.get("patient") ?? undefined;
  const [query, setQuery] = useState("");
  const [searchTarget, setSearchTarget] =
    useState<PatientSearchTarget>("patients");
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [incompleteRegistrationOpen, setIncompleteRegistrationOpen] =
    useState(false);
  const [result, setResult] = useState<string>();
  const [registrationPatientName, setRegistrationPatientName] = useState("");
  const [registrationBirthDate, setRegistrationBirthDate] = useState("");
  const [registrationContactName, setRegistrationContactName] = useState("");
  const [registrationPhone, setRegistrationPhone] = useState("");
  const [registrationContactMode, setRegistrationContactMode] = useState<
    "new" | "existing"
  >("new");
  const [incompleteName, setIncompleteName] = useState("");
  const [incompleteBirthDate, setIncompleteBirthDate] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactMode, setContactMode] = useState<"new" | "existing">("new");
  const [contactRelationship, setContactRelationship] = useState<
    "contact" | "tutor"
  >("contact");
  const [guardianDui, setGuardianDui] = useState("");

  const directory = api.panacea.listPatientDirectory.useQuery({
    query,
    searchTarget,
  });
  const patientDetail = api.panacea.getPatientAdministrativeDetail.useQuery(
    { patientId: selectedPatientId ?? EMPTY_PATIENT_ID },
    { enabled: selectedPatientId !== undefined },
  );
  const registrationContactMatch = api.panacea.findContactByPhone.useQuery(
    { phone: registrationPhone },
    { enabled: canLookupPhone(registrationPhone) },
  );
  const contactMatch = api.panacea.findContactByPhone.useQuery(
    { phone: contactPhone },
    { enabled: canLookupPhone(contactPhone) },
  );

  const registerPatient = api.panacea.registerPatient.useMutation({
    onSuccess: async ({ patient, reusedContact }) => {
      setResult(
        reusedContact
          ? "Paciente " +
              patient.name +
              " creado y Contacto existente reutilizado."
          : "Paciente " + patient.name + " creado con su Contacto inicial.",
      );
      resetRegistration();
      setRegistrationOpen(false);
      await directory.refetch();
      selectPatient(patient.id);
    },
  });
  const createIncompletePatient =
    api.panacea.createIncompletePatient.useMutation({
      onSuccess: async (patient) => {
        setResult(
          "Ficha incompleta de " +
            patient.name +
            " creada. Vincule un Contacto antes de crear una Cita.",
        );
        setIncompleteName("");
        setIncompleteBirthDate("");
        setIncompleteRegistrationOpen(false);
        await directory.refetch();
        selectPatient(patient.id);
      },
    });
  const addPatientContact = api.panacea.addPatientContact.useMutation({
    onSuccess: async (link) => {
      setResult(
        link.relationship === "tutor"
          ? "Tutela de " +
              link.contact.name +
              " registrada y pendiente de verificación."
          : "Contacto " + link.contact.name + " vinculado al Paciente.",
      );
      resetContactForm();
      await Promise.all([directory.refetch(), patientDetail.refetch()]);
    },
  });
  const verifyPatientGuardianship =
    api.panacea.verifyPatientGuardianship.useMutation({
      onSuccess: async (link) => {
        if (link === undefined) return;
        setResult("Tutela de " + link.contact.name + " verificada.");
        await patientDetail.refetch();
      },
    });

  const patientDetailMutationError =
    addPatientContact.error ?? verifyPatientGuardianship.error;
  const mutationPending =
    registerPatient.isPending ||
    createIncompletePatient.isPending ||
    addPatientContact.isPending ||
    verifyPatientGuardianship.isPending;

  function selectPatient(patientId: string) {
    router.push("/pacientes?patient=" + patientId);
  }

  function closePatientDetail() {
    router.push("/pacientes");
  }

  function resetRegistration() {
    setRegistrationPatientName("");
    setRegistrationBirthDate("");
    setRegistrationContactName("");
    setRegistrationPhone("");
    setRegistrationContactMode("new");
  }

  function resetContactForm() {
    setContactName("");
    setContactPhone("");
    setContactMode("new");
    setContactRelationship("contact");
    setGuardianDui("");
  }

  function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const phone = formValue(data, "contactPhone");
    registerPatient.mutate({
      birthDate: formValue(data, "birthDate"),
      contact:
        registrationContactMode === "existing" &&
        registrationContactMatch.data !== undefined
          ? {
              contactId: registrationContactMatch.data.id,
              kind: "existing",
            }
          : {
              kind: "new",
              name: formValue(data, "contactName"),
              phone,
            },
      patientName: formValue(data, "patientName"),
    });
  }

  function submitIncompletePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    createIncompletePatient.mutate({
      birthDate: formValue(data, "birthDate"),
      name: formValue(data, "name"),
    });
  }

  function submitAdditionalContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedPatientId === undefined) return;
    const data = new FormData(event.currentTarget);
    const relationship = formValue(data, "relationship") as "contact" | "tutor";
    addPatientContact.mutate({
      contact:
        contactMode === "existing" && contactMatch.data !== undefined
          ? { contactId: contactMatch.data.id, kind: "existing" }
          : {
              kind: "new",
              name: formValue(data, "contactName"),
              phone: formValue(data, "contactPhone"),
            },
      guardianDui:
        relationship === "tutor" ? formValue(data, "guardianDui") : undefined,
      patientId: selectedPatientId,
      relationship,
    });
  }

  return (
    <>
      <section
        aria-labelledby="administrative-records-title"
        className="space-y-5"
      >
        <Card>
          <CardHeader className="border-border border-b">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle>
                  <h2 id="administrative-records-title">
                    Fichas administrativas
                  </h2>
                </CardTitle>
                <CardDescription>
                  Trabaje desde el Paciente y resuelva sus Contactos y Vínculos
                  sin separar el alta en formularios técnicos.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  data-testid="new-patient-button"
                  onClick={() => setRegistrationOpen(true)}
                  type="button"
                >
                  Nuevo Paciente
                </Button>
                <Button
                  onClick={() => setIncompleteRegistrationOpen(true)}
                  type="button"
                  variant="outline"
                >
                  Crear Ficha incompleta
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_13rem] md:items-end">
              <Field>
                <FieldLabel htmlFor="patient-directory-search">
                  Buscar{" "}
                  {searchTarget === "patients" ? "Pacientes" : "Contactos"}
                </FieldLabel>
                <FieldContent>
                  <Input
                    aria-describedby="patient-directory-search-help"
                    data-testid="patient-directory-search"
                    id="patient-directory-search"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={
                      searchTarget === "patients"
                        ? "Nombre de la persona atendida"
                        : "Nombre o teléfono del Contacto"
                    }
                    type="search"
                    value={query}
                  />
                  <p
                    className="text-muted-foreground text-xs"
                    id="patient-directory-search-help"
                  >
                    La búsqueda de Pacientes es distinta de la búsqueda de
                    Contactos.
                  </p>
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor="patient-directory-target">
                  Buscar por
                </FieldLabel>
                <FieldContent>
                  <NativeSelect
                    id="patient-directory-target"
                    onChange={(event) =>
                      setSearchTarget(event.target.value as PatientSearchTarget)
                    }
                    value={searchTarget}
                  >
                    <NativeSelectOption value="patients">
                      Pacientes
                    </NativeSelectOption>
                    <NativeSelectOption value="contacts">
                      Contactos
                    </NativeSelectOption>
                  </NativeSelect>
                </FieldContent>
              </Field>
            </div>

            {result ? (
              <Alert className="border-primary/30 bg-primary/5">
                <AlertTitle>Actualización registrada</AlertTitle>
                <AlertDescription>{result}</AlertDescription>
              </Alert>
            ) : null}
            {directory.error ? (
              <PanaceaQueryError
                error={directory.error}
                onRetry={() => void directory.refetch()}
                title="Pacientes"
              />
            ) : directory.isLoading ? (
              <PanaceaQueryLoading label="Cargando Pacientes" />
            ) : searchTarget === "patients" ? (
              <PatientDirectoryList
                onCreate={() => setRegistrationOpen(true)}
                onSelect={selectPatient}
                patients={directory.data?.patients ?? []}
              />
            ) : (
              <ContactDirectoryList
                contacts={directory.data?.contacts ?? []}
                onClear={() => setQuery("")}
                onSelectPatient={selectPatient}
              />
            )}
          </CardContent>
        </Card>
      </section>

      <Dialog
        onOpenChange={(open) => {
          setRegistrationOpen(open);
          if (!open) resetRegistration();
        }}
        open={registrationOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo Paciente</DialogTitle>
            <DialogDescription>
              Registre la persona atendida junto con su Contacto inicial. La
              operación crea Paciente, Contacto y Vínculo atómicamente.
            </DialogDescription>
          </DialogHeader>
          <form
            aria-describedby={
              registerPatient.error ? "patient-registration-error" : undefined
            }
            className="mt-6 space-y-5"
            onSubmit={submitRegistration}
          >
            <FieldGroup className="gap-4">
              <RecordField
                id="registration-patient-name"
                label="Nombre del Paciente"
                name="patientName"
                onChange={setRegistrationPatientName}
                value={registrationPatientName}
              />
              <RecordField
                id="registration-patient-birth-date"
                label="Fecha de nacimiento"
                name="birthDate"
                onChange={setRegistrationBirthDate}
                type="date"
                value={registrationBirthDate}
              />
            </FieldGroup>
            <div className="border-border space-y-4 rounded-lg border p-4">
              <div>
                <h3 className="font-medium">Contacto inicial</h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  El Contacto identifica al titular del teléfono; no se
                  convierte en Paciente principal.
                </p>
              </div>
              <RecordField
                id="registration-contact-phone"
                label="Teléfono"
                name="contactPhone"
                onChange={(value) => {
                  setRegistrationPhone(value);
                  setRegistrationContactMode("new");
                }}
                placeholder="+503 7123-4567"
                type="tel"
                value={registrationPhone}
              />
              {registrationContactMatch.data ? (
                <ContactMatchNotice
                  contact={registrationContactMatch.data}
                  onReuse={() => setRegistrationContactMode("existing")}
                  reused={registrationContactMode === "existing"}
                />
              ) : null}
              {registrationContactMode === "new" ? (
                <RecordField
                  id="registration-contact-name"
                  label="Nombre del Contacto"
                  name="contactName"
                  onChange={setRegistrationContactName}
                  required
                  value={registrationContactName}
                />
              ) : (
                <SelectedContact contact={registrationContactMatch.data} />
              )}
            </div>
            <MutationError
              error={registerPatient.error}
              id="patient-registration-error"
            />
            <DialogFooter>
              <DialogClose type="button">Cancelar</DialogClose>
              <Button
                data-testid="save-new-patient-button"
                disabled={mutationPending}
                type="submit"
              >
                {registerPatient.isPending ? "Guardando…" : "Crear Paciente"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          setIncompleteRegistrationOpen(open);
          if (!open) {
            setIncompleteName("");
            setIncompleteBirthDate("");
          }
        }}
        open={incompleteRegistrationOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear Ficha de Paciente incompleta</DialogTitle>
            <DialogDescription>
              Use esta acción secundaria solo si todavía no tiene un Contacto.
              La ficha quedará visible para completar después y no podrá usarla
              para una Cita manual hasta vincular un Contacto.
            </DialogDescription>
          </DialogHeader>
          <form
            aria-describedby={
              createIncompletePatient.error
                ? "incomplete-patient-error"
                : undefined
            }
            className="mt-6 space-y-5"
            onSubmit={submitIncompletePatient}
          >
            <FieldGroup className="gap-4">
              <RecordField
                id="incomplete-patient-name"
                label="Nombre del Paciente"
                name="name"
                onChange={setIncompleteName}
                value={incompleteName}
              />
              <RecordField
                id="incomplete-patient-birth-date"
                label="Fecha de nacimiento"
                name="birthDate"
                onChange={setIncompleteBirthDate}
                type="date"
                value={incompleteBirthDate}
              />
            </FieldGroup>
            <MutationError
              error={createIncompletePatient.error}
              id="incomplete-patient-error"
            />
            <DialogFooter>
              <DialogClose type="button">Cancelar</DialogClose>
              <Button
                disabled={mutationPending}
                type="submit"
                variant="outline"
              >
                {createIncompletePatient.isPending
                  ? "Guardando…"
                  : "Crear ficha incompleta"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet
        onOpenChange={(open) => {
          if (!open) closePatientDetail();
        }}
        open={selectedPatientId !== undefined}
      >
        <SheetContent className="!w-[min(42rem,calc(100vw-1rem))] overflow-y-auto p-0">
          <SheetHeader className="border-border border-b pr-16">
            <SheetTitle>
              {patientDetail.data?.patient.name ?? "Ficha de Paciente"}
            </SheetTitle>
            <SheetDescription>
              Detalle administrativo, Contactos vinculados y continuidad de
              Citas.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-6 px-6 py-6">
            {patientDetail.error ? (
              <PanaceaQueryError
                error={patientDetail.error}
                onRetry={() => void patientDetail.refetch()}
                title="la ficha del Paciente"
              />
            ) : patientDetail.isLoading ? (
              <PanaceaQueryLoading label="Cargando ficha del Paciente" />
            ) : patientDetail.data === undefined ? (
              <Alert variant="destructive">
                <AlertTitle>Paciente no encontrado</AlertTitle>
                <AlertDescription>
                  La ficha no existe en la Clínica actual o ya no está
                  disponible.
                </AlertDescription>
              </Alert>
            ) : (
              <PatientDetail
                contactMatch={contactMatch.data}
                contactMode={contactMode}
                contactName={contactName}
                contactPhone={contactPhone}
                contactRelationship={contactRelationship}
                detail={patientDetail.data}
                guardianDui={guardianDui}
                mutationError={patientDetailMutationError?.message}
                mutationPending={mutationPending}
                onContactNameChange={setContactName}
                onContactPhoneChange={(value) => {
                  setContactPhone(value);
                  setContactMode("new");
                }}
                onContactRelationshipChange={setContactRelationship}
                onGuardianDuiChange={setGuardianDui}
                onReuseContact={() => setContactMode("existing")}
                onSubmitContact={submitAdditionalContact}
                onVerify={(linkId) =>
                  verifyPatientGuardianship.mutate({ linkId })
                }
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function PatientDirectoryList({
  onCreate,
  onSelect,
  patients,
}: {
  onCreate: () => void;
  onSelect: (patientId: string) => void;
  patients: PatientDirectoryEntry[];
}) {
  if (patients.length === 0) {
    return (
      <EmptyDirectory
        actionLabel="Crear Paciente"
        message="No hay Pacientes que coincidan con la búsqueda."
        onAction={onCreate}
      />
    );
  }
  return (
    <div aria-label="Lista de Pacientes" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">Pacientes</h3>
        <span className="text-muted-foreground text-sm">
          {patients.length} resultado{patients.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="divide-border divide-y rounded-xl border">
        {patients.map((patient) => (
          <li key={patient.id}>
            <button
              className="hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-ring/50 flex w-full items-center justify-between gap-4 p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
              data-testid={"patient-row-" + patient.id}
              onClick={() => onSelect(patient.id)}
              type="button"
            >
              <span className="min-w-0 space-y-1">
                <span className="block truncate font-medium">
                  {patient.name}
                </span>
                <span className="text-muted-foreground block text-sm">
                  {patient.birthDate
                    ? "Nacimiento: " + formatDate(patient.birthDate)
                    : "Fecha de nacimiento pendiente"}
                </span>
              </span>
              <span className="flex shrink-0 flex-wrap justify-end gap-2">
                <Badge
                  variant={patient.contactCount === 0 ? "warning" : "outline"}
                >
                  {patient.contactCount === 0 ? "Ficha incompleta" : "Completa"}
                </Badge>
                <span className="text-muted-foreground hidden text-xs sm:inline">
                  {patient.contactCount} Contacto(s) ·{" "}
                  {patient.appointmentCount} Cita(s)
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContactDirectoryList({
  contacts,
  onClear,
  onSelectPatient,
}: {
  contacts: ContactDirectoryEntry[];
  onClear: () => void;
  onSelectPatient: (patientId: string) => void;
}) {
  if (contacts.length === 0) {
    return (
      <EmptyDirectory
        actionLabel="Limpiar búsqueda"
        message="No hay Contactos que coincidan con la búsqueda."
        onAction={onClear}
      />
    );
  }
  return (
    <div aria-label="Directorio de Contactos" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">Contactos</h3>
        <span className="text-muted-foreground text-sm">
          {contacts.length} resultado{contacts.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {contacts.map((contact) => (
          <li className="border-border rounded-xl border p-4" key={contact.id}>
            <p className="font-medium">{contact.name}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {contact.phoneE164}
            </p>
            <div className="mt-3 space-y-2">
              <p className="text-muted-foreground text-xs">
                {contact.patientIds.length === 0
                  ? "Sin Pacientes vinculados"
                  : "Pacientes vinculados"}
              </p>
              {contact.patientIds.length ? (
                <div className="flex flex-wrap gap-2">
                  {contact.patientIds.map((patientId, index) => (
                    <Button
                      key={patientId}
                      onClick={() => onSelectPatient(patientId)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {contact.patientNames[index] ?? "Abrir Paciente"}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PatientDetail({
  contactMatch,
  contactMode,
  contactName,
  contactPhone,
  contactRelationship,
  detail,
  guardianDui,
  mutationError,
  mutationPending,
  onContactNameChange,
  onContactPhoneChange,
  onContactRelationshipChange,
  onGuardianDuiChange,
  onReuseContact,
  onSubmitContact,
  onVerify,
}: {
  contactMatch: ContactPhoneMatch | undefined;
  contactMode: "new" | "existing";
  contactName: string;
  contactPhone: string;
  contactRelationship: "contact" | "tutor";
  detail: PatientAdministrativeDetail;
  guardianDui: string;
  mutationError?: string;
  mutationPending: boolean;
  onContactNameChange: (value: string) => void;
  onContactPhoneChange: (value: string) => void;
  onContactRelationshipChange: (relationship: "contact" | "tutor") => void;
  onGuardianDuiChange: (value: string) => void;
  onReuseContact: () => void;
  onSubmitContact: (event: FormEvent<HTMLFormElement>) => void;
  onVerify: (linkId: string) => void;
}) {
  const incomplete = detail.contacts.length === 0;
  return (
    <div className="space-y-6">
      <MutationError error={mutationError} id="patient-detail-error" />
      {incomplete ? (
        <Alert className="border-border bg-muted/40">
          <AlertTitle>Ficha incompleta</AlertTitle>
          <AlertDescription>
            Esta ficha no puede utilizarse para una Cita manual. Agregue o
            reutilice un Contacto vinculado usando el formulario de abajo.
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="patient-identity-title" className="space-y-3">
        <h3 className="font-medium" id="patient-identity-title">
          Datos del Paciente
        </h3>
        <dl className="bg-muted/30 grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
          <InfoItem label="Nombre" value={detail.patient.name} />
          <InfoItem
            label="Fecha de nacimiento"
            value={
              detail.patient.birthDate
                ? formatDate(detail.patient.birthDate)
                : "Pendiente"
            }
          />
        </dl>
      </section>

      <section aria-labelledby="patient-contacts-title" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium" id="patient-contacts-title">
            Contactos y Vínculos
          </h3>
          <Badge variant="outline">
            {detail.contacts.length} vinculado
            {detail.contacts.length === 1 ? "" : "s"}
          </Badge>
        </div>
        {detail.contacts.length ? (
          <ul className="space-y-3">
            {detail.contacts.map((link) => (
              <li className="border-border rounded-xl border p-4" key={link.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{link.contact.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {link.contact.phoneE164}
                    </p>
                  </div>
                  <Badge
                    variant={
                      link.relationship === "tutor" ? "warning" : "outline"
                    }
                  >
                    {link.relationship === "tutor" ? "Tutor" : "Contacto"}
                  </Badge>
                </div>
                {link.relationship === "tutor" ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
                    <span>
                      DUI: {link.guardianDui ?? "Pendiente"} · Tutela{" "}
                      {link.guardianshipVerificationStatus === "verified"
                        ? "verificada"
                        : "pendiente de verificación"}
                    </span>
                    {link.guardianshipVerificationStatus === "pending" ? (
                      <Button
                        disabled={mutationPending}
                        onClick={() => onVerify(link.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Verificar tutela
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-border text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
            Todavía no hay Contactos vinculados.
          </p>
        )}
      </section>

      <section
        aria-labelledby="add-patient-contact-title"
        className="space-y-3"
      >
        <h3 className="font-medium" id="add-patient-contact-title">
          Agregar Contacto o Tutor
        </h3>
        <form
          aria-describedby={mutationError ? "patient-detail-error" : undefined}
          className="border-border space-y-4 rounded-xl border p-4"
          onSubmit={onSubmitContact}
        >
          <RecordField
            id="patient-contact-phone"
            label="Teléfono"
            name="contactPhone"
            onChange={onContactPhoneChange}
            placeholder="+503 7123-4567"
            type="tel"
            value={contactPhone}
          />
          {contactMatch ? (
            <ContactMatchNotice
              contact={contactMatch}
              onReuse={onReuseContact}
              reused={contactMode === "existing"}
            />
          ) : null}
          {contactMode === "new" ? (
            <RecordField
              id="patient-contact-name"
              label="Nombre"
              name="contactName"
              onChange={onContactNameChange}
              required
              value={contactName}
            />
          ) : (
            <SelectedContact contact={contactMatch} />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="patient-contact-relationship">
                Tipo de Vínculo
              </FieldLabel>
              <FieldContent>
                <NativeSelect
                  id="patient-contact-relationship"
                  name="relationship"
                  onChange={(event) =>
                    onContactRelationshipChange(
                      event.target.value as "contact" | "tutor",
                    )
                  }
                  value={contactRelationship}
                >
                  <NativeSelectOption value="contact">
                    Contacto
                  </NativeSelectOption>
                  <NativeSelectOption value="tutor">Tutor</NativeSelectOption>
                </NativeSelect>
              </FieldContent>
            </Field>
            {contactRelationship === "tutor" ? (
              <RecordField
                id="patient-contact-guardian-dui"
                label="DUI del Tutor"
                name="guardianDui"
                onChange={onGuardianDuiChange}
                placeholder="########-#"
                required
                value={guardianDui}
              />
            ) : null}
          </div>
          <Button disabled={mutationPending} type="submit">
            {mutationPending ? "Guardando…" : "Vincular Contacto"}
          </Button>
        </form>
      </section>

      <Separator />

      <section
        aria-labelledby="patient-appointments-title"
        className="space-y-3"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium" id="patient-appointments-title">
            Citas y eventos administrativos
          </h3>
          <Badge variant="outline">
            {detail.appointments.length} Cita
            {detail.appointments.length === 1 ? "" : "s"}
          </Badge>
        </div>
        {detail.appointments.length ? (
          <ul className="space-y-3">
            {detail.appointments.map((appointment) => (
              <li
                className="border-border rounded-xl border p-4"
                key={appointment.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{appointment.service.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {formatClinicDateTime(appointment.startsAt)} ·{" "}
                      {appointment.doctor.name}
                    </p>
                  </div>
                  <Badge
                    variant={
                      appointment.status === "cancelled" ? "warning" : "default"
                    }
                  >
                    {appointment.status === "cancelled"
                      ? "Cancelada"
                      : "Activa"}
                  </Badge>
                </div>
                {appointment.events.length ? (
                  <ul className="text-muted-foreground mt-3 space-y-1 border-t pt-3 text-xs">
                    {appointment.events.map((event, index) => (
                      <li
                        key={[
                          event.type,
                          event.occurredAt.toISOString(),
                          index,
                        ].join("-")}
                      >
                        {appointmentEventLabel(event.type)} ·{" "}
                        {formatClinicDateTime(event.occurredAt)}
                        {event.recipient ? (
                          <> · Notificación a {event.recipient.name}</>
                        ) : null}
                        {event.reason ? <> · {event.reason}</> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-border text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
            No hay Citas activas o canceladas ni eventos para mostrar.
          </p>
        )}
      </section>
    </div>
  );
}

function ContactMatchNotice({
  contact,
  onReuse,
  reused,
}: {
  contact: { name: string; patientIds: string[]; phoneE164: string };
  onReuse: () => void;
  reused: boolean;
}) {
  return (
    <Alert className="border-primary/30 bg-primary/5">
      <AlertTitle>Contacto existente encontrado</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {contact.name} ya usa este teléfono y conserva{" "}
          {contact.patientIds.length} Vínculo
          {contact.patientIds.length === 1 ? "" : "s"} existente
          {contact.patientIds.length === 1 ? "" : "s"}.
        </span>
        <Button
          aria-pressed={reused}
          onClick={onReuse}
          size="sm"
          type="button"
          variant={reused ? "secondary" : "outline"}
        >
          {reused ? "Contacto seleccionado" : "Reutilizar Contacto"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function SelectedContact({
  contact,
}: {
  contact: { name: string; phoneE164: string } | undefined;
}) {
  return contact ? (
    <div className="bg-muted/40 rounded-lg border p-3 text-sm">
      <p className="font-medium">Contacto seleccionado: {contact.name}</p>
      <p className="text-muted-foreground">{contact.phoneE164}</p>
    </div>
  ) : null;
}

function EmptyDirectory({
  actionLabel,
  message,
  onAction,
}: {
  actionLabel: string;
  message: string;
  onAction: () => void;
}) {
  return (
    <div className="border-border bg-muted/20 rounded-xl border border-dashed p-8 text-center">
      <p className="font-medium">{message}</p>
      <p className="text-muted-foreground mt-1 text-sm">
        {actionLabel === "Crear Paciente"
          ? "Use Nuevo Paciente para iniciar una ficha completa."
          : "Pruebe otra búsqueda o cambie el tipo de directorio."}
      </p>
      <Button
        className="mt-4"
        onClick={onAction}
        size="sm"
        type="button"
        variant="outline"
      >
        {actionLabel}
      </Button>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function RecordField({
  id,
  label,
  maxLength = 120,
  name,
  onChange,
  placeholder,
  required = true,
  type = "text",
  value,
}: {
  id: string;
  label: string;
  maxLength?: number;
  name?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: "date" | "tel" | "text";
  value: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FieldContent>
        <Input
          id={id}
          maxLength={type === "date" ? undefined : maxLength}
          name={name ?? id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          type={type}
          value={value}
        />
      </FieldContent>
    </Field>
  );
}

function canLookupPhone(value: string) {
  const normalized = value.trim().replace(/[()\s.-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(normalized);
}

function MutationError({
  error,
  id,
}: {
  error: { message: string } | string | null | undefined;
  id: string;
}) {
  const message = typeof error === "string" ? error : error?.message;
  return message ? (
    <p
      aria-live="assertive"
      className="text-destructive text-sm"
      id={id}
      role="alert"
    >
      {message}
    </p>
  ) : null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeZone: "America/El_Salvador",
  }).format(new Date(value + "T00:00:00.000Z"));
}

function formatClinicDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    hour12: true,
    timeStyle: "short",
    timeZone: "America/El_Salvador",
  }).format(new Date(value));
}

function appointmentEventLabel(type: AppointmentEventType) {
  const labels: Record<AppointmentEventType, string> = {
    cancelled: "Cita cancelada",
    "manual-cancellation-failed": "Falló la notificación de cancelación",
    "manual-cancellation-sent": "Cancelación notificada",
    "manual-confirmation-failed": "Falló la notificación de confirmación",
    "manual-confirmation-sent": "Confirmación notificada",
    "manual-created": "Cita manual creada",
    "no-show-alerted": "Inasistencia alertada",
    "no-show-auto-cancelled": "Cita cancelada automáticamente",
    "reminder-delivered": "Recordatorio entregado",
    "reminder-delivery-failed": "Falló la entrega del recordatorio",
    "reminder-failed": "Falló el recordatorio",
    "reminder-sent": "Recordatorio enviado",
    "reservation-confirmed": "Reserva confirmada",
    "reminder-claimed": "Recordatorio tomado",
    rescheduled: "Cita reprogramada",
    "self-management-escalated": "Escalada a atención humana",
  };
  return labels[type] ?? "Evento administrativo";
}
