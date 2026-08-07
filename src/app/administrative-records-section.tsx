"use client";

import { type FormEvent, useState } from "react";

import { api } from "~/trpc/react";

export function AdministrativeRecordsSection() {
  const [result, setResult] = useState<string>();
  const records = api.panacea.listAdministrativeRecords.useQuery();
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
      name: value(data, "name"),
      phone: value(data, "phone"),
    });
  }

  function updateContactRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    updateContact.mutate({
      id: value(data, "id"),
      name: value(data, "name"),
      phone: value(data, "phone"),
    });
  }

  function createPatientRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    createPatient.mutate({
      birthDate: value(data, "birthDate"),
      name: value(data, "name"),
    });
  }

  function updatePatientRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    updatePatient.mutate({
      birthDate: value(data, "birthDate"),
      id: value(data, "id"),
      name: value(data, "name"),
    });
  }

  function linkRecords(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    createLink.mutate({
      contactId: value(data, "contactId"),
      patientId: value(data, "patientId"),
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

  return (
    <section className="space-y-4 rounded-xl border border-slate-700 p-5">
      <div>
        <h2 className="text-xl font-semibold">Fichas administrativas</h2>
        <p className="mt-1 text-sm text-slate-300">
          Registre Contactos, Pacientes y sus Vínculos explícitos para preparar
          la atención.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <form className="grid gap-2" onSubmit={createContactRecord}>
          <h3 className="font-medium">Nuevo Contacto</h3>
          <Field label="Nombre" name="name" />
          <Field
            label="Teléfono E.164"
            name="phone"
            placeholder="+50371234567"
            type="tel"
          />
          <button className={buttonClass} disabled={pending} type="submit">
            Crear Contacto
          </button>
        </form>
        <form className="grid gap-2" onSubmit={createPatientRecord}>
          <h3 className="font-medium">Nuevo Paciente</h3>
          <Field label="Nombre" name="name" />
          <Field label="Fecha de nacimiento" name="birthDate" type="date" />
          <button className={buttonClass} disabled={pending} type="submit">
            Crear Paciente
          </button>
        </form>
      </div>
      <form
        className="grid gap-2 rounded border border-slate-800 p-3 sm:grid-cols-3"
        onSubmit={linkRecords}
      >
        <label className="text-sm">
          Contacto
          <select className={inputClass} name="contactId" required>
            <option value="">Seleccione un Contacto</option>
            {records.data?.contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name} · {contact.phoneE164}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Paciente
          <select className={inputClass} name="patientId" required>
            <option value="">Seleccione un Paciente</option>
            {records.data?.patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className={`${buttonClass} self-end`}
          disabled={
            pending ||
            records.data?.contacts.length === 0 ||
            records.data?.patients.length === 0
          }
          type="submit"
        >
          Vincular
        </button>
      </form>
      {result ? <p className="text-sm text-teal-300">{result}</p> : null}
      {error ? <p className="text-sm text-rose-300">{error.message}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <RecordList heading="Contactos">
          {records.data?.contacts.map((contact) => (
            <form
              className="grid gap-2 rounded border border-slate-800 p-3"
              key={contact.id}
              onSubmit={updateContactRecord}
            >
              <input name="id" type="hidden" value={contact.id} />
              <Field defaultValue={contact.name} label="Nombre" name="name" />
              <Field
                defaultValue={contact.phoneE164}
                label="Teléfono E.164"
                name="phone"
                type="tel"
              />
              <p className="text-xs text-slate-400">
                Vinculado con {contact.patientIds.length} Paciente(s).
              </p>
              <button className={buttonClass} disabled={pending} type="submit">
                Guardar Contacto
              </button>
            </form>
          ))}
        </RecordList>
        <RecordList heading="Pacientes">
          {records.data?.patients.map((patient) => (
            <form
              className="grid gap-2 rounded border border-slate-800 p-3"
              key={patient.id}
              onSubmit={updatePatientRecord}
            >
              <input name="id" type="hidden" value={patient.id} />
              <Field defaultValue={patient.name} label="Nombre" name="name" />
              <Field
                defaultValue={patient.birthDate ?? undefined}
                label="Fecha de nacimiento"
                name="birthDate"
                type="date"
              />
              <p className="text-xs text-slate-400">
                Vinculado con {patient.contactIds.length} Contacto(s).
              </p>
              <button className={buttonClass} disabled={pending} type="submit">
                Guardar Paciente
              </button>
            </form>
          ))}
        </RecordList>
      </div>
    </section>
  );
}

function Field({
  defaultValue,
  label,
  name,
  placeholder,
  type = "text",
}: {
  defaultValue?: string;
  label: string;
  name: string;
  placeholder?: string;
  type?: "date" | "tel" | "text";
}) {
  return (
    <label className="text-sm">
      {label}
      <input
        className={inputClass}
        defaultValue={defaultValue}
        maxLength={type === "date" ? undefined : 120}
        name={name}
        placeholder={placeholder}
        required
        type={type}
      />
    </label>
  );
}

function RecordList({
  children,
  heading,
}: {
  children: React.ReactNode;
  heading: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="font-medium">{heading}</h3>
      {children}
    </div>
  );
}

function value(data: FormData, field: string) {
  const formValue = data.get(field);
  return typeof formValue === "string" ? formValue : "";
}

const inputClass =
  "mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2";
const buttonClass =
  "w-fit rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50";
