"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

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
import { doctorProfileProgress } from "~/domain/panacea-team";
import { api } from "~/trpc/react";
import { formValue } from "./form-values";

export function DoctorProfileSetup({
  initialProfile,
}: {
  initialProfile: {
    primarySpecialty: string | null;
    publicName: string | null;
  };
}) {
  const router = useRouter();
  const [completed, setCompleted] = useState(
    () => doctorProfileProgress(initialProfile).status === "complete",
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const [result, setResult] = useState<string>();
  const utils = api.useUtils();
  const completion = api.panacea.completeOwnDoctorProfile.useMutation({
    onSuccess: () => {
      setCompleted(true);
      setResult("Perfil de Médico guardado.");
      void Promise.all([
        utils.panacea.getConfigurationOverview.invalidate(),
        utils.panacea.listTeam.invalidate(),
      ]);
      router.refresh();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    completion.mutate({
      primarySpecialty: formValue(data, "primarySpecialty"),
      publicName: formValue(data, "publicName"),
    });
  }

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  return (
    <section aria-labelledby="doctor-profile-setup-title" className="space-y-5">
      <Card>
        <CardHeader className="border-border border-b">
          <h2
            className="text-xl font-semibold tracking-tight"
            id="doctor-profile-setup-title"
          >
            Configuración inicial
          </h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            Su perfil de Médico ya está vinculado a esta Clínica. Complete estos
            datos para publicar su capacidad de atención; esta tarea no bloquea
            su acceso normal a Praxia.
          </p>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <ol className="text-muted-foreground list-inside list-decimal space-y-1 leading-6">
            <li>
              {completed
                ? "Perfil de Médico completado"
                : "Completar su perfil de Médico"}
            </li>
            <li>Configurar el primer Servicio</li>
            <li>Definir el primer Horario vigente</li>
          </ol>
          {!completed ? (
            <Alert variant="warning">
              <AlertTitle>Perfil pendiente, sin bloqueo</AlertTitle>
              <AlertDescription>
                Puede seguir usando Praxia y revisar esta configuración cuando
                esté listo. Complete los dos datos para publicar su capacidad de
                atención.
              </AlertDescription>
            </Alert>
          ) : null}
          <form
            aria-busy={completion.isPending}
            className="space-y-4"
            onSubmit={submit}
          >
            <fieldset disabled={!isHydrated}>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="doctor-public-name">
                    Nombre público
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      defaultValue={initialProfile.publicName ?? ""}
                      id="doctor-public-name"
                      maxLength={120}
                      name="publicName"
                      required
                    />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel htmlFor="doctor-primary-specialty">
                    Especialidad principal
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      defaultValue={initialProfile.primarySpecialty ?? ""}
                      id="doctor-primary-specialty"
                      maxLength={160}
                      name="primarySpecialty"
                      required
                    />
                  </FieldContent>
                </Field>
              </FieldGroup>
              <Button
                className="mt-4"
                disabled={completion.isPending}
                type="submit"
              >
                {completion.isPending ? "Guardando…" : "Guardar perfil"}
              </Button>
            </fieldset>
          </form>
          {result ? (
            <Alert variant="success">
              <AlertTitle>Perfil actualizado</AlertTitle>
              <AlertDescription>{result}</AlertDescription>
            </Alert>
          ) : null}
          {completion.error ? (
            <Alert variant="destructive">
              <AlertTitle>No se pudo guardar el perfil</AlertTitle>
              <AlertDescription>{completion.error.message}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
