"use client";

import Link from "next/link";

import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import {
  visiblePanaceaConfigurationSections,
  type PanaceaRole,
} from "~/domain/panacea-shell";
import { api } from "~/trpc/react";
import { PanaceaQueryError, PanaceaQueryLoading } from "./panacea-query-state";

export function PanaceaSettingsIndex({ role }: { role: PanaceaRole }) {
  const sections = visiblePanaceaConfigurationSections(role);
  const overview = api.panacea.getConfigurationOverview.useQuery();

  return (
    <section
      aria-labelledby="settings-index-title"
      className="space-y-5"
      data-settings-index="true"
    >
      <div>
        <h2 className="text-xl font-semibold" id="settings-index-title">
          Áreas de configuración
        </h2>
        <p className="text-muted-foreground mt-1 leading-6 text-pretty">
          Elija un área para revisar o cambiar la capacidad de atención de la
          Clínica.
        </p>
      </div>
      {overview.error ? (
        <PanaceaQueryError
          error={overview.error}
          onRetry={() => void overview.refetch()}
          title="Configuración"
        />
      ) : overview.isLoading ? (
        <PanaceaQueryLoading label="Cargando estado de Configuración" />
      ) : overview.data === undefined ? (
        <div className="border-border bg-muted/20 rounded-xl border border-dashed p-6 text-sm">
          No hay áreas de Configuración disponibles para este alcance.
        </div>
      ) : (
        <nav aria-label="Subsecciones de Configuración">
          <ul className="grid gap-4 md:grid-cols-2">
            {sections.map((section) => {
              const area = overview.data.areas.find(
                (candidate) => candidate.id === section.id,
              );
              if (area === undefined) return null;

              return (
                <li key={section.id}>
                  <ConfigurationAreaCard area={area} />
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      {role === "doctor" ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm leading-6">
          Su alcance se limita a sus Servicios, Horarios, Bloqueos y Opciones de
          atención. La configuración de otros Médicos permanece protegida.
        </p>
      ) : null}
    </section>
  );
}

function ConfigurationAreaCard({
  area,
}: {
  area: {
    description: string;
    href: string;
    id: string;
    label: string;
    nextAction: string;
    progress: { completed: number; total: number };
    status: "attention" | "complete" | "not-started";
  };
}) {
  const descriptionId = `configuration-area-${area.id}-description`;
  const progressLabel = `Progreso de ${area.label}: ${area.progress.completed} de ${area.progress.total}`;

  return (
    <Card className="hover:border-primary/40 h-full transition-[border-color,box-shadow] hover:shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle>{area.label}</CardTitle>
          <ConfigurationStatusBadge status={area.status} />
        </div>
        <CardDescription id={descriptionId}>{area.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Progress
            aria-label={progressLabel}
            className="flex-1"
            max={area.progress.total}
            value={area.progress.completed}
          />
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {area.progress.completed}/{area.progress.total}
          </span>
        </div>
        <p className="text-muted-foreground text-sm">
          Siguiente acción:{" "}
          <span className="text-foreground">{area.nextAction}</span>
        </p>
        <Link
          aria-describedby={descriptionId}
          className="focus-visible:border-ring focus-visible:ring-ring/30 text-primary inline-flex min-h-11 items-center rounded-lg text-sm font-medium underline-offset-4 transition-colors outline-none hover:underline focus-visible:ring-3"
          href={area.href}
        >
          Abrir {area.label}
          <span aria-hidden="true" className="ml-1">
            →
          </span>
        </Link>
      </CardContent>
    </Card>
  );
}

function ConfigurationStatusBadge({
  status,
}: {
  status: "attention" | "complete" | "not-started";
}) {
  if (status === "complete") {
    return <Badge variant="success">Listo</Badge>;
  }
  if (status === "attention") {
    return <Badge variant="warning">Requiere atención</Badge>;
  }
  return <Badge variant="outline">Sin configurar</Badge>;
}
