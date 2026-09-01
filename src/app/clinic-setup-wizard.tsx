"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

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
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Progress } from "~/components/ui/progress";
import {
  CLINIC_SETUP_STEPS,
  CLINIC_TERMS_URL,
  type ClinicSetupReview,
  type ClinicSetupStepId,
} from "~/domain/clinic-setup";
import { CLINIC_TIMEZONE } from "~/clinic-timezone";
import { formValue } from "~/app/form-values";
import { api } from "~/trpc/react";
import { PanaceaQueryError, PanaceaQueryLoading } from "./panacea-query-state";

export function ClinicSetupEntryCard() {
  const setup = api.panacea.getClinicSetup.useQuery();

  if (setup.isLoading) {
    return (
      <Card aria-busy="true" data-clinic-setup-entry="true">
        <CardContent className="pt-6">
          <div className="bg-muted h-5 w-48 animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }
  if (setup.error || setup.data === undefined) return null;

  const status = setup.data.readiness.status;
  return (
    <Card data-clinic-setup-entry="true">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Configuración inicial de la Clínica</CardTitle>
            <CardDescription className="mt-1">
              Prepare la primera ruta de atención y decida cuándo habilitar la
              atención por WhatsApp de Praxia.
            </CardDescription>
          </div>
          <ReadinessBadge
            status={status}
            enabled={setup.data.readiness.asclepioEnabled}
            termsAccepted={setup.data.terms.accepted}
          />
        </div>
        <Progress
          aria-label={`Configuración inicial: ${setup.data.progress.completed} de ${setup.data.progress.total}`}
          max={setup.data.progress.total}
          value={setup.data.progress.completed}
        />
      </CardHeader>
      <CardFooter className="border-border border-t pt-6">
        <Link
          className="text-primary focus-visible:ring-ring/30 inline-flex min-h-11 items-center rounded-lg text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3"
          href="/configuracion/inicial"
        >
          Abrir configuración inicial <span aria-hidden="true">→</span>
        </Link>
      </CardFooter>
    </Card>
  );
}

export function ClinicSetupWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setup = api.panacea.getClinicSetup.useQuery();
  const utils = api.useUtils();
  const [activeStep, setActiveStep] = useState<ClinicSetupStepId>();
  const [declarationOpen, setDeclarationOpen] = useState(false);
  const [savedBasics, setSavedBasics] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const saveStep = api.panacea.saveClinicSetupStep.useMutation({
    onSuccess: () => {
      void utils.panacea.getClinicSetup.invalidate();
    },
  });
  const updateBasics = api.panacea.updateClinicBasics.useMutation({
    onSuccess: () => {
      setSavedBasics(true);
      void utils.panacea.getClinicSetup.invalidate();
    },
  });
  const declareReady = api.panacea.declareClinicReady.useMutation({
    onSuccess: () => {
      setDeclarationOpen(false);
      void utils.panacea.getClinicSetup.invalidate();
    },
  });

  const requestedStep = parseStep(searchParams.get("step"));
  useEffect(() => {
    if (setup.data === undefined) return;
    setActiveStep(
      (current) => current ?? requestedStep ?? setup.data.currentStep,
    );
  }, [requestedStep, setup.data]);

  if (setup.error) {
    return (
      <PanaceaQueryError
        error={setup.error}
        onRetry={() => void setup.refetch()}
        title="Configuración inicial"
      />
    );
  }
  if (setup.isLoading || setup.data === undefined) {
    return <PanaceaQueryLoading label="Cargando Configuración inicial" />;
  }

  const review = setup.data;
  const selectedStep = activeStep ?? requestedStep ?? review.currentStep;

  function navigateTo(stepId: ClinicSetupStepId) {
    setActiveStep(stepId);
    saveStep.mutate({ step: stepId });
  }

  function continueTo(stepId: ClinicSetupStepId) {
    saveStep.mutate(
      { step: stepId },
      {
        onSuccess: () => {
          setActiveStep(stepId);
          setSavedBasics(false);
          void setup.refetch();
        },
      },
    );
  }

  function openConfiguration(stepId: ClinicSetupStepId, href: string) {
    saveStep.mutate({ step: stepId }, { onSuccess: () => router.push(href) });
  }

  function submitBasics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    updateBasics.mutate({ name: formValue(data, "clinicName") });
  }

  return (
    <section
      aria-labelledby="clinic-setup-title"
      className="space-y-5"
      data-clinic-setup-wizard="true"
    >
      <Card>
        <CardHeader className="border-border gap-4 border-b">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl space-y-1">
              <p className="text-primary text-xs font-semibold tracking-[0.14em] uppercase">
                Guía de configuración
              </p>
              <h2 className="text-xl font-medium" id="clinic-setup-title">
                Prepare la primera ruta de atención
              </h2>
              <CardDescription>
                Puede guardar cada paso, salir y retomarlo después. Completar
                esta guía no activa WhatsApp automáticamente.
              </CardDescription>
            </div>
            <ReadinessBadge
              enabled={review.readiness.asclepioEnabled}
              status={review.readiness.status}
              termsAccepted={review.terms.accepted}
            />
          </div>
          <div className="flex items-center gap-3">
            <Progress
              aria-label={`Progreso de Configuración inicial: ${review.progress.completed} de ${review.progress.total}`}
              className="flex-1"
              max={review.progress.total}
              value={review.progress.completed}
            />
            <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
              {review.progress.completed}/{review.progress.total}
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <nav aria-label="Pasos de Configuración inicial">
            <Accordion
              className="space-y-2"
              onValueChange={(value) => {
                const nextStep =
                  typeof value[0] === "string"
                    ? parseStep(value[0])
                    : undefined;
                if (nextStep !== undefined && nextStep !== selectedStep) {
                  navigateTo(nextStep);
                }
              }}
              value={[selectedStep]}
            >
              {review.steps.map((candidate) => (
                <AccordionItem key={candidate.id} value={candidate.id}>
                  <AccordionHeader>
                    <AccordionTrigger
                      aria-current={
                        candidate.id === selectedStep ? "step" : undefined
                      }
                      data-clinic-setup-step={candidate.id}
                    >
                      <span className="flex min-w-0 items-start gap-3">
                        <StepStateMark state={candidate.state} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            {candidate.label}
                          </span>
                          <span className="text-muted-foreground mt-0.5 block text-xs leading-5">
                            {candidate.summary}
                          </span>
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="text-muted-foreground"
                      >
                        {candidate.id === selectedStep ? "−" : "+"}
                      </span>
                    </AccordionTrigger>
                  </AccordionHeader>
                  <AccordionPanel>
                    <div aria-live="polite" className="min-w-0">
                      <StepContent
                        onDeclare={() => setDeclarationOpen(true)}
                        onContinue={continueTo}
                        onOpenConfiguration={openConfiguration}
                        onSubmitBasics={submitBasics}
                        onTermsAcceptedChange={setTermsAccepted}
                        review={review}
                        savedBasics={savedBasics}
                        step={candidate}
                        termsAccepted={termsAccepted}
                        updateBasicsPending={updateBasics.isPending}
                      />
                    </div>
                  </AccordionPanel>
                </AccordionItem>
              ))}
            </Accordion>
          </nav>
          <div aria-live="polite" className="min-w-0">
            {updateBasics.error ? (
              <Alert className="mt-5" variant="destructive">
                <AlertTitle>No se pudieron guardar los datos</AlertTitle>
                <AlertDescription>
                  {updateBasics.error.message}
                </AlertDescription>
              </Alert>
            ) : null}
            {saveStep.error ? (
              <Alert className="mt-5" variant="destructive">
                <AlertTitle>No se pudo guardar el paso</AlertTitle>
                <AlertDescription>{saveStep.error.message}</AlertDescription>
              </Alert>
            ) : null}
            {declareReady.error ? (
              <Alert className="mt-5" variant="destructive">
                <AlertTitle>No se pudo declarar la Clínica</AlertTitle>
                <AlertDescription>
                  {declareReady.error.message}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        </CardContent>
        <CardFooter className="border-border text-muted-foreground border-t text-sm leading-6">
          La activación del número de WhatsApp se configura por separado en{" "}
          <Link
            className="text-primary ml-1 underline underline-offset-4"
            href="/configuracion/whatsapp"
          >
            Atención por WhatsApp
          </Link>
          .
        </CardFooter>
      </Card>
      {selectedStep === "review" ? (
        <AlertDialog onOpenChange={setDeclarationOpen} open={declarationOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>¿Declarar lista la Clínica?</AlertDialogTitle>
            <AlertDialogDescription>
              Praxia podrá ofrecer nuevas Opciones por WhatsApp usando la ruta
              válida que acaba de revisar. Podrá seguir ajustando la
              configuración y las Citas existentes no se modificarán. Al
              confirmar, registraremos la aceptación de los Términos de uso de
              Praxia, versión {review.terms.currentVersion}, junto con su
              identidad.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={declareReady.isPending}>
                Volver
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={declareReady.isPending}
                onClick={() => declareReady.mutate({ termsAccepted: true })}
              >
                {declareReady.isPending ? "Declarando…" : "Declarar lista"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </section>
  );
}

function StepContent({
  onDeclare,
  onContinue,
  onOpenConfiguration,
  onSubmitBasics,
  onTermsAcceptedChange,
  review,
  savedBasics,
  step,
  termsAccepted,
  updateBasicsPending,
}: {
  onDeclare: () => void;
  onContinue: (step: ClinicSetupStepId) => void;
  onOpenConfiguration: (step: ClinicSetupStepId, href: string) => void;
  onSubmitBasics: (event: FormEvent<HTMLFormElement>) => void;
  onTermsAcceptedChange: (accepted: boolean) => void;
  review: ClinicSetupReview;
  savedBasics: boolean;
  step: ClinicSetupReview["steps"][number];
  termsAccepted: boolean;
  updateBasicsPending: boolean;
}) {
  switch (step.id) {
    case "clinic":
      return (
        <Card className="shadow-none ring-1">
          <CardHeader>
            <CardTitle>{step.label}</CardTitle>
            <CardDescription>
              Confirme el nombre que identificará a esta Clínica en Praxia.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form key={review.clinicName} onSubmit={onSubmitBasics}>
              <fieldset disabled={updateBasicsPending}>
                <FieldGroup className="gap-4">
                  <Field>
                    <FieldLabel htmlFor="clinic-setup-name">
                      Nombre de la Clínica
                    </FieldLabel>
                    <FieldContent>
                      <Input
                        defaultValue={review.clinicName}
                        id="clinic-setup-name"
                        maxLength={120}
                        name="clinicName"
                        required
                      />
                      <FieldDescription>
                        Este dato no habilita la atención por WhatsApp de Praxia
                        por sí solo.
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldGroup>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button disabled={updateBasicsPending} type="submit">
                    {updateBasicsPending ? "Guardando…" : "Guardar datos"}
                  </Button>
                  {savedBasics ? (
                    <span className="text-success text-sm" role="status">
                      Datos guardados.
                    </span>
                  ) : null}
                </div>
              </fieldset>
            </form>
          </CardContent>
          <CardFooter className="border-border justify-end border-t pt-6">
            <Button onClick={() => onContinue("team")} type="button">
              Continuar a Equipo →
            </Button>
          </CardFooter>
        </Card>
      );
    case "team":
      return (
        <ConfigurationStepCard
          description="Complete al menos un perfil de Médico para crear la primera ruta. Los perfiles adicionales pueden completarse después."
          label={step.label}
          onOpen={() => onOpenConfiguration("team", "/configuracion/equipo")}
          openLabel="Abrir Equipo"
          summary={step.summary}
        >
          <PartialConfiguration review={review} />
          <StepFooter onContinue={onContinue} next="services" />
        </ConfigurationStepCard>
      );
    case "services":
      return (
        <ConfigurationStepCard
          description="Cree un Servicio y una Oferta activa con duración, buffer y precio válidos."
          label={step.label}
          onOpen={() =>
            onOpenConfiguration("services", "/configuracion/servicios")
          }
          openLabel="Abrir Servicios"
          summary={step.summary}
        >
          {review.blockers.some((blocker) => blocker.code === "services") ? (
            <Alert variant="warning">
              <AlertTitle>Oferta activa pendiente</AlertTitle>
              <AlertDescription>
                La primera ruta necesita una Oferta vinculada a un Médico con
                perfil completo.
              </AlertDescription>
            </Alert>
          ) : null}
          <StepFooter onContinue={onContinue} next="availability" />
        </ConfigurationStepCard>
      );
    case "availability":
      return (
        <ConfigurationStepCard
          description="Defina un Horario vigente y compruebe que genera Opciones futuras para la Agenda."
          label={step.label}
          onOpen={() =>
            onOpenConfiguration("availability", "/configuracion/disponibilidad")
          }
          openLabel="Abrir Disponibilidad"
          summary={step.summary}
        >
          {review.blockers.some(
            (blocker) => blocker.code === "availability",
          ) ? (
            <Alert variant="warning">
              <AlertTitle>Capacidad futura pendiente</AlertTitle>
              <AlertDescription>
                La Agenda debe encontrar al menos una Opción completa, sin
                Bloqueos ni ocupaciones, dentro de los próximos días.
              </AlertDescription>
            </Alert>
          ) : null}
          <StepFooter onContinue={onContinue} next="review" />
        </ConfigurationStepCard>
      );
    case "review":
      return (
        <ReviewStep
          onDeclare={onDeclare}
          onContinue={onContinue}
          onTermsAcceptedChange={onTermsAcceptedChange}
          review={review}
          termsAccepted={termsAccepted}
        />
      );
  }
}

function ConfigurationStepCard({
  children,
  description,
  label,
  onOpen,
  openLabel,
  summary,
}: {
  children: React.ReactNode;
  description: string;
  label: string;
  onOpen: () => void;
  openLabel: string;
  summary: string;
}) {
  return (
    <Card className="shadow-none ring-1">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border-border bg-muted/20 rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Resumen actual
          </p>
          <p className="mt-1 text-sm font-medium">{summary}</p>
        </div>
        <Button onClick={onOpen} type="button" variant="outline">
          {openLabel}
        </Button>
        {children}
      </CardContent>
    </Card>
  );
}

function StepFooter({
  next,
  onContinue,
}: {
  next: ClinicSetupStepId;
  onContinue: (step: ClinicSetupStepId) => void;
}) {
  return (
    <div className="border-border mt-5 flex justify-end border-t pt-5">
      <Button onClick={() => onContinue(next)} type="button">
        Continuar →
      </Button>
    </div>
  );
}

function ReviewStep({
  onDeclare,
  onContinue,
  onTermsAcceptedChange,
  review,
  termsAccepted,
}: {
  onContinue: (step: ClinicSetupStepId) => void;
  onDeclare: () => void;
  onTermsAcceptedChange: (accepted: boolean) => void;
  review: ClinicSetupReview;
  termsAccepted: boolean;
}) {
  const route = review.firstValidRoute;
  const hasAcceptedTerms = review.terms.accepted || termsAccepted;
  return (
    <Card className="shadow-none ring-1">
      <CardHeader>
        <CardTitle>Revisión de capacidad</CardTitle>
        <CardDescription>
          Esta comprobación usa la misma Agenda que utilizará Praxia para
          atender por WhatsApp. La declaración final requiere una acción
          explícita del propietario.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {route ? (
          <div className="border-success-border bg-success-muted/40 rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-success-foreground text-xs font-semibold tracking-wide uppercase">
                  Primera ruta válida
                </p>
                <h3 className="mt-1 font-semibold">
                  {route.doctor.name} · {route.service.name}
                </h3>
              </div>
              <Badge variant="success">Capacidad encontrada</Badge>
            </div>
            <dl className="text-muted-foreground mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt>Especialidad</dt>
                <dd className="text-foreground font-medium">
                  {route.doctor.specialty}
                </dd>
              </div>
              <div>
                <dt>Horario vigente desde</dt>
                <dd className="text-foreground font-medium">
                  {formatDate(route.scheduleEffectiveFrom)}
                </dd>
              </div>
              <div>
                <dt>Primera Opción</dt>
                <dd className="text-foreground font-medium">
                  {formatDateTime(route.firstOptionStartsAt)}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <Alert variant="warning">
            <AlertTitle>La Clínica aún está pendiente</AlertTitle>
            <AlertDescription>
              {review.blockers.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {review.blockers.map((blocker) => (
                    <li key={blocker.code}>{blocker.message}</li>
                  ))}
                </ul>
              ) : (
                "La Agenda todavía no encontró una ruta completa de atención."
              )}
            </AlertDescription>
          </Alert>
        )}
        {review.partialConfiguration.length > 0 ? (
          <div className="border-border rounded-xl border p-4">
            <h3 className="font-medium">Configuración parcial</h3>
            <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5 text-sm">
              {review.partialConfiguration.map((item) => (
                <li key={item.code}>{item.message}</li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-3 text-sm leading-6">
              Estos pendientes no bloquean la primera ruta válida.
            </p>
          </div>
        ) : null}
        <div
          className="border-border bg-muted/20 rounded-xl border p-4"
          data-clinic-setup-terms="true"
        >
          <p className="text-primary text-xs font-semibold tracking-wide uppercase">
            Condiciones de uso
          </p>
          <h3 className="mt-1 font-medium">Aceptación de la Clínica</h3>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            Para habilitar la atención por WhatsApp de Praxia, el propietario
            debe aceptar los términos que regulan el acceso y uso de Praxia por
            la Clínica y su equipo.
          </p>
          <label className="border-border bg-background mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm leading-6 has-[:disabled]:cursor-default has-[:disabled]:opacity-75">
            <input
              aria-describedby="clinic-setup-terms-description"
              checked={hasAcceptedTerms}
              className="accent-primary focus-visible:border-ring focus-visible:ring-ring/30 mt-0.5 size-5 shrink-0 rounded outline-none focus-visible:ring-3"
              disabled={review.terms.accepted}
              id="clinic-setup-terms"
              onChange={(event) => onTermsAcceptedChange(event.target.checked)}
              type="checkbox"
            />
            <span>
              He leído y acepto los{" "}
              <Link
                className="text-primary font-medium underline underline-offset-4"
                href={CLINIC_TERMS_URL}
                rel="noreferrer"
                target="_blank"
              >
                Términos de uso de Praxia
              </Link>{" "}
              (versión {review.terms.currentVersion}) y confirmo que tengo
              autorización para aceptarlos en nombre de la Clínica.
            </span>
          </label>
          <p
            className="text-muted-foreground mt-3 text-xs leading-5"
            id="clinic-setup-terms-description"
          >
            Esta aceptación de la Clínica no sustituye el aviso ni el
            consentimiento que correspondan a Pacientes, Contactos, Tutores o
            personal.
          </p>
          {review.terms.accepted ? (
            <p className="text-success-foreground mt-3 text-sm" role="status">
              Aceptación registrada para la versión {review.terms.version}.
            </p>
          ) : null}
        </div>
        {review.readiness.asclepioEnabled ? (
          <Alert variant="success">
            <AlertTitle>Praxia está habilitada</AlertTitle>
            <AlertDescription>
              Las nuevas Opciones se calculan con la capacidad vigente de la
              Clínica.
            </AlertDescription>
          </Alert>
        ) : route ? (
          <Alert variant="default">
            <AlertTitle>La declaración sigue pendiente</AlertTitle>
            <AlertDescription>
              Guardar la configuración no habilita la atención por WhatsApp de
              Praxia. Use el botón de declaración para confirmar esta decisión.
            </AlertDescription>
          </Alert>
        ) : null}
        {!review.readiness.asclepioEnabled && route ? (
          <Button
            data-clinic-setup-declare="true"
            disabled={!hasAcceptedTerms}
            onClick={onDeclare}
            type="button"
          >
            Declarar lista para Praxia
          </Button>
        ) : null}
        {!review.readiness.asclepioEnabled && route && !hasAcceptedTerms ? (
          <p className="text-muted-foreground text-sm leading-6" role="status">
            Acepte los Términos de uso para habilitar la declaración.
          </p>
        ) : null}
        {!route && review.readiness.status === "pending" ? (
          <p className="text-muted-foreground text-sm leading-6">
            Al perder la última ruta, la atención por WhatsApp de Praxia deja de
            ofrecer nuevas Opciones. Las Citas existentes permanecen intactas.
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="border-border justify-between gap-3 border-t pt-6">
        <Button
          onClick={() => onContinue("availability")}
          type="button"
          variant="outline"
        >
          Volver a Disponibilidad
        </Button>
        <span className="text-muted-foreground text-xs">
          Revisión calculada al abrir este paso
        </span>
      </CardFooter>
    </Card>
  );
}

function PartialConfiguration({ review }: { review: ClinicSetupReview }) {
  if (review.partialConfiguration.length === 0) return null;
  return (
    <div className="border-border rounded-xl border p-4 text-sm">
      <p className="font-medium">Configuración parcial</p>
      <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">
        {review.partialConfiguration.map((item) => (
          <li key={item.code}>{item.message}</li>
        ))}
      </ul>
    </div>
  );
}

function StepStateMark({
  state,
}: {
  state: "complete" | "current" | "pending";
}) {
  return (
    <span
      aria-hidden="true"
      className="border-border text-muted-foreground data-[state=complete]:border-success-border data-[state=complete]:bg-success-muted data-[state=complete]:text-success-foreground data-[state=current]:border-primary data-[state=current]:text-primary flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
      data-state={state}
    >
      {state === "complete" ? "✓" : state === "current" ? "•" : "–"}
    </span>
  );
}

function ReadinessBadge({
  enabled,
  status,
  termsAccepted,
}: {
  enabled: boolean;
  status: "pending" | "ready";
  termsAccepted: boolean;
}) {
  if (enabled) return <Badge variant="success">Praxia habilitada</Badge>;
  if (status === "ready" && !termsAccepted) {
    return <Badge variant="warning">Aceptación pendiente</Badge>;
  }
  if (status === "ready") {
    return <Badge variant="warning">Listo para declarar</Badge>;
  }
  return <Badge variant="outline">Configuración pendiente</Badge>;
}

function parseStep(value: string | null): ClinicSetupStepId | undefined {
  return CLINIC_SETUP_STEPS.some((step) => step.id === value)
    ? (value as ClinicSetupStepId)
    : undefined;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(`${value}T00:00:00-06:00`));
}

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(value));
}
