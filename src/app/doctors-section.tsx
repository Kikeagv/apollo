"use client";

import { type FormEvent, useState } from "react";
import { MoreHorizontal } from "lucide-react";

import { CLINIC_TIMEZONE } from "~/clinic-timezone";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { PanaceaTeamDoctor } from "~/server/application/panacea-team";
import { api } from "~/trpc/react";
import { CapacityConflicts } from "./capacity-conflicts";
import { formValue } from "./form-values";
import { PanaceaQueryError, PanaceaQueryLoading } from "./panacea-query-state";

/** Equipo visible para el propietario: invitaciones, progreso y estado histórico. */
export function DoctorsSection() {
  const [result, setResult] = useState<string>();
  const [doctorToView, setDoctorToView] = useState<PanaceaTeamDoctor>();
  const [doctorToDeactivate, setDoctorToDeactivate] = useState<{
    id: string;
    name: string;
  }>();
  const utils = api.useUtils();
  const team = api.panacea.listTeam.useQuery();
  const invite = api.panacea.inviteAdditionalDoctor.useMutation({
    onSuccess: (invitation) => {
      setResult(`Invitación enviada a ${invitation.recipientName}.`);
      void team.refetch();
      void utils.panacea.getConfigurationOverview.invalidate();
    },
  });
  const deactivate = api.panacea.deactivateDoctor.useMutation({
    onSuccess: (doctor) => {
      setResult(
        `Médico desactivado: ${doctor.publicName ?? "sin nombre público"}.`,
      );
      setDoctorToDeactivate(undefined);
      void team.refetch();
      void utils.panacea.getConfigurationOverview.invalidate();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setResult(undefined);
    invite.mutate({
      email: formValue(data, "email"),
      name: formValue(data, "name"),
    });
  }

  function confirmDeactivation() {
    if (doctorToDeactivate === undefined) return;
    deactivate.mutate({ doctorId: doctorToDeactivate.id });
  }

  const incompleteProfiles =
    team.data?.doctors.filter(
      (doctor) => doctor.profile.status === "incomplete",
    ) ?? [];

  return (
    <section
      aria-busy={team.isLoading || deactivate.isPending}
      aria-labelledby="team-doctors-title"
      className="space-y-5"
      data-team-section="true"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold" id="team-doctors-title">
            Médicos
          </h2>
          <p className="text-muted-foreground mt-1 text-sm leading-6">
            Revise quién puede atender Citas y el progreso de sus perfiles.
          </p>
        </div>
        {team.data ? (
          <Badge variant="outline">
            {team.data.doctors.filter((doctor) => doctor.active).length} activos
          </Badge>
        ) : null}
      </div>

      {incompleteProfiles.length > 0 ? (
        <Alert variant="warning">
          <AlertTitle>Hay perfiles de Médico pendientes</AlertTitle>
          <AlertDescription>
            {incompleteProfiles.length === 1
              ? "Un Médico todavía debe completar su perfil."
              : `${incompleteProfiles.length} Médicos todavía deben completar su perfil.`}{" "}
            El equipo puede seguir usando Praxia mientras se completa la
            configuración.
          </AlertDescription>
        </Alert>
      ) : null}

      {team.error ? (
        <PanaceaQueryError
          error={team.error}
          onRetry={() => void team.refetch()}
          title="Equipo"
        />
      ) : team.isLoading ? (
        <PanaceaQueryLoading label="Cargando Equipo" />
      ) : null}

      <Card>
        <CardHeader className="border-border border-b">
          <CardTitle>Invitar un Médico</CardTitle>
          <p className="text-muted-foreground text-sm leading-6">
            La invitación vence en 72 horas y habilita el perfil propio al
            aceptarse.
          </p>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={submit}>
            <FieldGroup className="gap-4 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <Field>
                <FieldLabel htmlFor="team-doctor-name">Nombre</FieldLabel>
                <FieldContent>
                  <Input
                    id="team-doctor-name"
                    maxLength={120}
                    name="name"
                    required
                  />
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor="team-doctor-email">Correo</FieldLabel>
                <FieldContent>
                  <Input
                    id="team-doctor-email"
                    name="email"
                    required
                    type="email"
                  />
                </FieldContent>
              </Field>
              <Button disabled={invite.isPending} type="submit">
                {invite.isPending ? "Enviando…" : "Invitar Médico"}
              </Button>
            </FieldGroup>
          </form>
          {result ? (
            <p aria-live="polite" className="text-success mt-4 text-sm">
              {result}
            </p>
          ) : null}
          {invite.error ? (
            <Alert className="mt-4" variant="destructive">
              <AlertTitle>No se pudo enviar la invitación</AlertTitle>
              <AlertDescription>{invite.error.message}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-border border-b">
          <CardTitle>Perfiles del equipo</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {team.data === undefined ? null : team.data.doctors.length === 0 ? (
            <div className="border-border rounded-lg border border-dashed p-6 text-center text-sm">
              Todavía no hay Médicos activos en la Clínica.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table
                aria-label="Médicos de la Clínica"
                className="w-full min-w-[40rem] text-left text-sm"
              >
                <thead className="text-muted-foreground border-border border-b text-xs">
                  <tr>
                    <th className="px-3 py-3 font-medium" scope="col">
                      Médico
                    </th>
                    <th className="px-3 py-3 font-medium" scope="col">
                      Perfil
                    </th>
                    <th className="px-3 py-3 font-medium" scope="col">
                      Estado
                    </th>
                    <th
                      className="px-3 py-3 text-right font-medium"
                      scope="col"
                    >
                      Acción
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {team.data?.doctors.map((doctor) => {
                    const displayName = doctor.publicName ?? doctor.name;
                    return (
                      <tr key={doctor.id}>
                        <th className="px-3 py-4 font-normal" scope="row">
                          <div className="flex items-center gap-3">
                            <Avatar aria-hidden="true">
                              <AvatarFallback>
                                {initials(displayName)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {displayName}
                              </span>
                              <span className="text-muted-foreground block truncate text-xs">
                                {doctor.email}
                              </span>
                            </span>
                          </div>
                        </th>
                        <td className="px-3 py-4 align-top">
                          <Badge
                            variant={
                              doctor.profile.status === "complete"
                                ? "success"
                                : "warning"
                            }
                          >
                            {doctor.profile.status === "complete"
                              ? "Perfil completo"
                              : `Perfil ${doctor.profile.completedSteps}/${doctor.profile.totalSteps}`}
                          </Badge>
                          {doctor.primarySpecialty ? (
                            <span className="text-muted-foreground mt-1 block text-xs">
                              {doctor.primarySpecialty}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-4 align-top">
                          <Badge
                            variant={doctor.active ? "outline" : "warning"}
                          >
                            {doctor.active ? "Activo" : "Desactivado"}
                          </Badge>
                        </td>
                        <td className="px-3 py-4 text-right align-top">
                          <div className="flex justify-end gap-2">
                            <Button
                              disabled={!doctor.active || deactivate.isPending}
                              onClick={() =>
                                setDoctorToDeactivate({
                                  id: doctor.id,
                                  name: displayName,
                                })
                              }
                              size="lg"
                              type="button"
                              variant="destructive"
                            >
                              Desactivar
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                aria-label={`Acciones para Médico ${displayName}`}
                                className="hover:bg-muted inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg transition-colors"
                              >
                                <MoreHorizontal
                                  aria-hidden="true"
                                  className="size-4"
                                />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                <DropdownMenuItem
                                  onClick={() => setDoctorToView(doctor)}
                                >
                                  Ver perfil
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {deactivate.error ? (
        <Alert variant="destructive">
          <AlertTitle>No se pudo desactivar el Médico</AlertTitle>
          <AlertDescription>
            <p>{deactivate.error.message}</p>
            <CapacityConflicts
              conflicts={deactivate.error.data?.capacityConflicts}
            />
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="border-border border-b">
          <CardTitle>Invitaciones</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {team.data === undefined ? null : team.data.invitations.length ===
            0 ? (
            <div className="border-border rounded-lg border border-dashed p-6 text-center text-sm">
              No hay invitaciones de Médico registradas.
            </div>
          ) : (
            <ul
              aria-label="Invitaciones de Médicos"
              className="divide-border divide-y"
            >
              {team.data?.invitations.map((invitation) => (
                <li
                  className="flex flex-col gap-2 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                  key={invitation.id}
                >
                  <span>
                    <span className="block font-medium">
                      {invitation.recipientName}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {invitation.email}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-xs">
                    <Badge
                      variant={
                        invitation.status === "pending"
                          ? "warning"
                          : invitation.status === "accepted"
                            ? "success"
                            : "outline"
                      }
                    >
                      {invitationStatusLabel(invitation.status)}
                    </Badge>
                    <time
                      className="text-muted-foreground tabular-nums"
                      dateTime={invitation.expiresAt.toISOString()}
                    >
                      Vence {formatDate(invitation.expiresAt)}
                    </time>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !deactivate.isPending) setDoctorToDeactivate(undefined);
        }}
        open={doctorToDeactivate !== undefined}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Desactivar Médico</AlertDialogTitle>
          <AlertDialogDescription>
            {doctorToDeactivate
              ? `Se conservará el historial de ${doctorToDeactivate.name}, pero dejará de aparecer en nuevas Opciones de atención. Resuelva primero cualquier Cita o Reserva temporal afectada.`
              : null}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deactivate.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deactivate.isPending}
              onClick={confirmDeactivation}
            >
              {deactivate.isPending ? "Desactivando…" : "Desactivar Médico"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setDoctorToView(undefined);
        }}
        open={doctorToView !== undefined}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Perfil de Médico: {doctorToView?.publicName ?? doctorToView?.name}
            </DialogTitle>
            <DialogDescription>
              Detalle del alcance y progreso visible para el propietario de la
              Clínica.
            </DialogDescription>
          </DialogHeader>
          {doctorToView ? (
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Correo</dt>
                <dd className="mt-1 font-medium">{doctorToView.email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Especialidad</dt>
                <dd className="mt-1 font-medium">
                  {doctorToView.primarySpecialty ?? "Pendiente"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Progreso</dt>
                <dd className="mt-1 font-medium">
                  {doctorToView.profile.completedSteps}/
                  {doctorToView.profile.totalSteps} pasos completados
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Estado</dt>
                <dd className="mt-1 font-medium">
                  {doctorToView.active ? "Activo" : "Desactivado"}
                </dd>
              </div>
            </dl>
          ) : null}
          <DialogFooter>
            <DialogClose>Cerrar</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function invitationStatusLabel(status: "accepted" | "expired" | "pending") {
  return status === "accepted"
    ? "Aceptada"
    : status === "expired"
      ? "Vencida"
      : "Pendiente";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(value);
}
