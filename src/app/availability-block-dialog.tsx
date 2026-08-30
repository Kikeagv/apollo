"use client";

import { type FormEvent, useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { FieldError } from "~/components/ui/field";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "~/components/ui/native-select";
import { api } from "~/trpc/react";
import { CLINIC_TIMEZONE, CLINIC_UTC_OFFSET } from "~/clinic-timezone";
import { CapacityConflicts } from "./capacity-conflicts";
import { formValue } from "./form-values";

type AvailabilityDoctor = { id: string; name: string };

type PendingBlock = {
  doctorId: string;
  endsAt: Date;
  privateLabel?: string;
  startsAt: Date;
};

export function AvailabilityBlockDialog({
  doctors,
  initialDoctorId,
  initialEndsAt,
  initialStartsAt,
  onSuccess,
  onOpenChange,
  open,
  triggerLabel = "Nuevo Bloqueo",
}: {
  doctors: readonly AvailabilityDoctor[];
  initialDoctorId?: string;
  initialEndsAt?: string;
  initialStartsAt?: string;
  onSuccess?: () => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  triggerLabel?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pendingBlock, setPendingBlock] = useState<PendingBlock>();
  const [result, setResult] = useState<string>();
  const [doctorId, setDoctorId] = useState(initialDoctorId ?? "");
  const [startsAt, setStartsAt] = useState(initialStartsAt ?? "");
  const [endsAt, setEndsAt] = useState(initialEndsAt ?? "");
  const dialogOpen = open ?? internalOpen;
  const create = api.panacea.createAvailabilityBlock.useMutation({
    onSuccess: () => {
      setResult("Bloqueo creado. La Agenda recalculará las Opciones futuras.");
      setPendingBlock(undefined);
      setConfirmationOpen(false);
      setDialogOpen(false);
      onSuccess?.();
    },
    onError: () => setResult(undefined),
  });

  useEffect(() => {
    if (!dialogOpen) return;
    setDoctorId(initialDoctorId ?? doctors[0]?.id ?? "");
    setStartsAt(initialStartsAt ?? "");
    setEndsAt(initialEndsAt ?? "");
    setResult(undefined);
  }, [dialogOpen, doctors, initialDoctorId, initialEndsAt, initialStartsAt]);

  function setDialogOpen(nextOpen: boolean) {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const starts = localDateTime(formValue(data, "startsAt"));
    const ends = localDateTime(formValue(data, "endsAt"));
    if (Number.isNaN(starts.valueOf()) || Number.isNaN(ends.valueOf())) {
      setResult("Indique un inicio y un fin válidos.");
      return;
    }
    setPendingBlock({
      doctorId: formValue(data, "doctorId"),
      endsAt: ends,
      privateLabel: formValue(data, "privateLabel") || undefined,
      startsAt: starts,
    });
    setConfirmationOpen(true);
  }

  const error = create.error;
  const errorId = "availability-block-error";
  const mutationFieldProps = error
    ? ({
        "aria-describedby": errorId,
        "aria-invalid": true,
      } as const)
    : {};
  const selectedDoctor = doctors.find(
    (doctor) => doctor.id === pendingBlock?.doctorId,
  );

  return (
    <>
      <Dialog
        onOpenChange={(nextOpen) => {
          setDialogOpen(nextOpen);
          if (!nextOpen) setConfirmationOpen(false);
        }}
        open={dialogOpen}
      >
        <DialogTrigger render={<Button size="lg" type="button" />}>
          {triggerLabel}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear Bloqueo</DialogTitle>
            <DialogDescription>
              La excepción se guardará en la zona horaria de la Clínica:{" "}
              {CLINIC_TIMEZONE}.
            </DialogDescription>
          </DialogHeader>
          <form className="mt-6 grid gap-4" onSubmit={submit}>
            <label className="grid gap-1.5 text-sm font-medium">
              Médico
              <NativeSelect
                {...mutationFieldProps}
                disabled={doctors.length === 0}
                name="doctorId"
                onChange={(event) => setDoctorId(event.target.value)}
                required
                value={doctorId}
              >
                {doctors.map((doctor) => (
                  <NativeSelectOption key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Etiqueta privada (opcional)
              <Input
                {...mutationFieldProps}
                maxLength={160}
                name="privateLabel"
                placeholder="Reunión, vacaciones…"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Inicio
                <Input
                  {...mutationFieldProps}
                  name="startsAt"
                  onChange={(event) => setStartsAt(event.target.value)}
                  required
                  type="datetime-local"
                  value={startsAt}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Fin
                <Input
                  {...mutationFieldProps}
                  name="endsAt"
                  onChange={(event) => setEndsAt(event.target.value)}
                  required
                  type="datetime-local"
                  value={endsAt}
                />
              </label>
            </div>
            <DialogFooter>
              <DialogClose type="button">Cancelar</DialogClose>
              <Button disabled={doctors.length === 0} type="submit">
                Revisar Bloqueo
              </Button>
            </DialogFooter>
          </form>
          {result ? (
            <p className="text-muted-foreground mt-3 text-sm">{result}</p>
          ) : null}
          {error ? (
            <div className="text-destructive mt-3 space-y-2 text-sm">
              <FieldError id={errorId}>{error.message}</FieldError>
              <CapacityConflicts conflicts={error.data?.capacityConflicts} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {result && !dialogOpen ? (
        <p className="text-muted-foreground mt-2 text-sm" role="status">
          {result}
        </p>
      ) : null}
      <AlertDialog
        onOpenChange={(nextOpen) => {
          setConfirmationOpen(nextOpen);
          if (!nextOpen) setPendingBlock(undefined);
        }}
        open={confirmationOpen}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            ¿Confirmar reducción de capacidad?
          </AlertDialogTitle>
          <AlertDialogDescription>
            El Bloqueo impedirá nuevas Opciones en ese intervalo para{" "}
            {selectedDoctor?.name ?? "el Médico seleccionado"}. Si existe una
            Cita confirmada o una Reserva activa, el cambio se rechazará de
            forma completa y mostrará el conflicto.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={create.isPending}>
              Volver
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={create.isPending || pendingBlock === undefined}
              onClick={() => {
                if (pendingBlock === undefined) return;
                create.mutate(pendingBlock);
              }}
            >
              {create.isPending ? "Creando…" : "Confirmar Bloqueo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function localDateTime(value: string) {
  return new Date(`${value}:00${CLINIC_UTC_OFFSET}`);
}
