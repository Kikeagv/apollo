"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CLINIC_TIMEZONE } from "~/clinic-timezone";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  PENDING_CATEGORIES,
  type PendingCase,
  type PendingCategory,
  type PendingCategoryFilter,
  type PendingConversationTrigger,
  type PendingPriority,
  type PendingStatus,
} from "~/domain/pending";
import { whatsappInboundMessageTypeLabel } from "~/domain/whatsapp-inbound";
import type { ConversationEscalationResolution } from "~/server/application/conversation-escalations";
import { api } from "~/trpc/react";
import { PanaceaQueryError, PanaceaQueryLoading } from "./panacea-query-state";

const CATEGORY_LABELS: Record<PendingCategory, string> = {
  appointment: "Escalamientos de Citas",
  conversation: "Escalamientos de conversaciones",
  delivery: "Entregas fallidas",
};

const PRIORITY_LABELS: Record<PendingPriority, string> = {
  high: "Alta",
  low: "Baja",
  normal: "Normal",
  urgent: "Urgente",
};

/** Bandeja maestra de trabajo humano; cada detalle conserva su comando de dominio. */
export function PendingInboxSection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const category = parseCategory(searchParams.get("category"));
  const status = parseStatus(searchParams.get("status"));
  const selectedKey = searchParams.get("selected");
  const [isMobile, setIsMobile] = useState(false);
  const [resolutionTarget, setResolutionTarget] = useState<
    { category: PendingCategory; id: string } | undefined
  >();
  const [resolutionEvidence, setResolutionEvidence] = useState("");
  const [lastResolution, setLastResolution] =
    useState<ConversationEscalationResolution | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const syncMobile = () => setIsMobile(media.matches);
    syncMobile();
    media.addEventListener("change", syncMobile);
    return () => media.removeEventListener("change", syncMobile);
  }, []);

  const pending = api.panacea.listPendingCases.useQuery({ category, status });
  const resolve = api.panacea.resolvePendingCase.useMutation({
    onSuccess: async (resolution) => {
      if (resolution !== true) {
        setLastResolution(resolution);
      }
      await pending.refetch();
      setResolutionTarget(undefined);
      updateUrl({ selected: undefined });
    },
  });
  const selected = pending.data?.items.find(
    (pendingCase) => pendingCaseKey(pendingCase) === selectedKey,
  );
  const selectedResolutionError =
    selected !== undefined &&
    resolutionTarget?.category === selected.category &&
    resolutionTarget?.id === selected.id
      ? resolve.error
      : undefined;

  function updateUrl(updates: {
    category?: PendingCategoryFilter;
    selected?: string;
    status?: PendingStatus;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === "all" || value === "open") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const query = params.toString();
    router.push("/pendientes" + (query ? "?" + query : ""), { scroll: false });
  }

  function selectCategory(nextCategory: PendingCategoryFilter) {
    updateUrl({ category: nextCategory, selected: undefined });
  }

  function selectStatus(nextStatus: PendingStatus) {
    updateUrl({ selected: undefined, status: nextStatus });
  }

  function selectPending(pendingCase: PendingCase) {
    setResolutionEvidence("");
    updateUrl({ selected: pendingCaseKey(pendingCase) });
  }

  function closeDetail() {
    setResolutionEvidence("");
    updateUrl({ selected: undefined });
  }

  function resolvePending(pendingCase: PendingCase) {
    setResolutionTarget({ category: pendingCase.category, id: pendingCase.id });
    const evidence =
      pendingCase.category === "delivery"
        ? resolutionEvidence.trim()
        : undefined;
    resolve.mutate({
      category: pendingCase.category,
      id: pendingCase.id,
      ...(evidence === undefined ? {} : { resolutionEvidence: evidence }),
    });
  }

  const detail = selected ? (
    <PendingDetail
      error={selectedResolutionError ?? undefined}
      isResolving={
        resolve.isPending &&
        resolutionTarget?.category === selected.category &&
        resolutionTarget?.id === selected.id
      }
      onResolve={() => resolvePending(selected)}
      onRetry={() => resolvePending(selected)}
      pending={selected}
      resolutionEvidence={resolutionEvidence}
      onResolutionEvidenceChange={setResolutionEvidence}
    />
  ) : null;

  return (
    <section aria-label="Bandeja de Pendientes" className="space-y-5">
      <div className="flex flex-col gap-4">
        <div
          aria-label="Estado de Pendientes"
          className="border-border bg-muted/30 inline-flex w-fit rounded-lg border p-1"
          role="tablist"
        >
          <button
            aria-selected={status === "open"}
            className={tabClassName(status === "open")}
            onClick={() => selectStatus("open")}
            role="tab"
            type="button"
          >
            Abiertos
          </button>
          <button
            aria-selected={status === "resolved"}
            className={tabClassName(status === "resolved")}
            onClick={() => selectStatus("resolved")}
            role="tab"
            type="button"
          >
            Historial resuelto
          </button>
        </div>
        <div
          aria-label="Filtrar Pendientes por categoría"
          className="flex flex-wrap gap-2"
          role="group"
        >
          <CategoryFilterButton
            active={category === "all"}
            count={pending.data?.total ?? 0}
            label="Todos"
            onClick={() => selectCategory("all")}
          />
          {PENDING_CATEGORIES.map((pendingCategory) => (
            <CategoryFilterButton
              active={category === pendingCategory}
              count={pending.data?.counts[pendingCategory] ?? 0}
              key={pendingCategory}
              label={CATEGORY_LABELS[pendingCategory]}
              onClick={() => selectCategory(pendingCategory)}
              testId={"pending-filter-" + pendingCategory}
            />
          ))}
        </div>
      </div>

      {lastResolution ? (
        <Alert aria-live="polite">
          <AlertTitle>Escalamiento reanudado</AlertTitle>
          <AlertDescription className="space-y-1">
            <p>Reanudado por: {lastResolution.resolvedBy.name}</p>
            <p>Fecha de reanudación: {formatDate(lastResolution.resolvedAt)}</p>
            <p>
              Siguiente acción: continuar la conversación; el asistente de la
              Clínica vuelve a atender mensajes de texto.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
        <Card className="min-w-0" data-pending-list="true">
          <CardHeader className="border-border border-b">
            <CardTitle>
              {status === "open" ? "Trabajo por resolver" : "Trabajo resuelto"}
            </CardTitle>
            <CardDescription>
              {pending.data?.items.length ?? 0}{" "}
              {status === "open" ? "casos abiertos" : "casos en el historial"}
              {category !== "all"
                ? " · " + CATEGORY_LABELS[category].toLocaleLowerCase("es-SV")
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {pending.error ? (
              <PanaceaQueryError
                error={pending.error}
                onRetry={() => void pending.refetch()}
                title="Pendientes"
              />
            ) : pending.isLoading ? (
              <PanaceaQueryLoading label="Cargando Pendientes" />
            ) : pending.data?.items.length === 0 ? (
              <PendingEmptyState status={status} />
            ) : (
              <ul className="divide-border divide-y" role="list">
                {pending.data?.items.map((pendingCase) => (
                  <PendingRow
                    isSelected={pendingCaseKey(pendingCase) === selectedKey}
                    key={pendingCaseKey(pendingCase)}
                    onSelect={() => selectPending(pendingCase)}
                    pending={pendingCase}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <aside
          aria-label="Detalle del pendiente"
          className="hidden min-w-0 md:block"
        >
          {detail ?? <PendingDetailEmpty />}
        </aside>
      </div>

      {isMobile ? (
        <Sheet
          open={selected !== undefined}
          onOpenChange={(open) => !open && closeDetail()}
        >
          <SheetContent aria-label="Detalle del pendiente" side="right">
            <SheetHeader>
              <SheetTitle>Detalle del pendiente</SheetTitle>
              <SheetDescription>
                Revise el contexto y ejecute la acción específica del caso.
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 overflow-y-auto px-6 pb-6">{detail}</div>
          </SheetContent>
        </Sheet>
      ) : null}
    </section>
  );
}

function CategoryFilterButton({
  active,
  count,
  label,
  onClick,
  testId,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <Button
      aria-pressed={active}
      data-testid={testId}
      onClick={onClick}
      size="sm"
      type="button"
      variant={active ? "default" : "outline"}
    >
      {label}
      <Badge
        aria-label={count + " casos"}
        className={
          active
            ? "bg-primary-foreground/15 text-primary-foreground"
            : undefined
        }
        variant={active ? "default" : "outline"}
      >
        {count}
      </Badge>
    </Button>
  );
}

function PendingRow({
  isSelected,
  onSelect,
  pending,
}: {
  isSelected: boolean;
  onSelect: () => void;
  pending: PendingCase;
}) {
  return (
    <li className="relative py-3 first:pt-0 last:pb-0">
      <button
        aria-pressed={isSelected}
        className="focus-visible:border-ring focus-visible:ring-ring/30 hover:bg-muted/50 flex min-h-20 w-full flex-col items-start gap-2 rounded-lg border border-transparent p-3 text-left transition-colors outline-none focus-visible:ring-3"
        onClick={onSelect}
        type="button"
      >
        <span className="flex w-full flex-wrap items-center gap-2 pr-2">
          <Badge variant="outline">{categoryLabel(pending.category)}</Badge>
          <Badge
            variant={pending.priority === "urgent" ? "warning" : "default"}
          >
            {priorityLabel(pending.priority)}
          </Badge>
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            {formatDate(pending.createdAt)}
          </span>
        </span>
        <span className="text-sm font-medium">{pendingSummary(pending)}</span>
        <span className="text-primary text-xs">
          {pending.status === "open"
            ? "Acción: " + pendingActionLabel(pending)
            : "Acción ejecutada: " + pendingActionLabel(pending)}
        </span>
        <span className="text-muted-foreground text-xs">
          Estado: {pending.status === "open" ? "Abierto" : "Resuelto"}
        </span>
      </button>
    </li>
  );
}

function PendingDetail({
  error,
  isResolving,
  onResolve,
  onRetry,
  onResolutionEvidenceChange,
  pending,
  resolutionEvidence,
}: {
  error?: { message: string };
  isResolving: boolean;
  onResolve: () => void;
  onRetry: () => void;
  onResolutionEvidenceChange: (value: string) => void;
  pending: PendingCase;
  resolutionEvidence: string;
}) {
  const requiresResolutionEvidence =
    pending.category === "delivery" && pending.status === "open";
  const canResolve =
    !requiresResolutionEvidence || resolutionEvidence.trim() !== "";

  return (
    <Card className="h-fit" data-pending-detail="true">
      <CardHeader className="border-border border-b">
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <CardTitle>Detalle del pendiente</CardTitle>
          <Badge variant={pending.status === "open" ? "warning" : "default"}>
            {pending.status === "open" ? "Abierto" : "Resuelto"}
          </Badge>
        </div>
        <CardDescription>{categoryLabel(pending.category)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-6">
        <dl className="grid gap-3 text-sm">
          <DetailField label="Caso">{pendingSummary(pending)}</DetailField>
          <DetailField label="Prioridad">
            {priorityLabel(pending.priority)}
          </DetailField>
          <DetailField label="Recibido">
            {formatDate(pending.createdAt)}
          </DetailField>
          {pending.resolvedAt ? (
            <DetailField label="Resuelto">
              {formatDate(pending.resolvedAt)}
            </DetailField>
          ) : null}
          {pending.category === "conversation" &&
          pending.status === "resolved" ? (
            <DetailField label="Reanudado por">
              {pending.resolvedBy?.name ?? "Actor no disponible"}
            </DetailField>
          ) : null}
          {pending.category === "conversation" &&
          pending.sourceMessageType !== null ? (
            <DetailField label="Tipo de mensaje">
              {whatsappInboundMessageTypeLabel(pending.sourceMessageType)}
            </DetailField>
          ) : null}
        </dl>

        <PendingSpecificDetail pending={pending} />

        {requiresResolutionEvidence ? (
          <div className="space-y-2">
            <Label htmlFor={"delivery-evidence-" + pending.id}>
              Evidencia de la acción (obligatoria)
            </Label>
            <Textarea
              id={"delivery-evidence-" + pending.id}
              maxLength={500}
              onChange={(event) =>
                onResolutionEvidenceChange(event.target.value)
              }
              placeholder="Describa qué verificó o qué acción realizó."
              value={resolutionEvidence}
            />
            <p className="text-muted-foreground text-xs">
              Resolver la alerta conserva los intentos y no envía otra
              notificación por WhatsApp.
            </p>
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>No se pudo resolver este caso</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{error.message}</p>
              <Button
                disabled={isResolving}
                onClick={onRetry}
                size="sm"
                type="button"
                variant="outline"
              >
                {isResolving ? "Reintentando…" : "Reintentar resolución"}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {pending.status === "open" ? (
          <Button
            disabled={isResolving || !canResolve}
            onClick={onResolve}
            type="button"
          >
            {isResolving ? "Resolviendo…" : pendingActionLabel(pending)}
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">
            Este caso permanece en el historial; sus eventos y registros no se
            eliminaron.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PendingSpecificDetail({ pending }: { pending: PendingCase }) {
  switch (pending.category) {
    case "conversation":
      return (
        <div className="border-border bg-muted/30 space-y-2 rounded-lg border p-4 text-sm">
          <p className="font-medium">Motivo del Escalamiento</p>
          <p>
            {conversationTriggerLabel(
              pending.trigger,
              pending.sourceMessageType,
            )}
          </p>
          {pending.sourceMessageType !== null ? (
            <p className="text-muted-foreground">
              Tipo de mensaje conservado:{" "}
              {whatsappInboundMessageTypeLabel(pending.sourceMessageType)}. No
              se descargó ni interpretó automáticamente.
            </p>
          ) : null}
          {pending.status === "open" ? (
            <p className="text-muted-foreground">
              El diálogo permanece detenido hasta que una persona cierre este
              Escalamiento; esa acción registra el actor que lo reanuda.
            </p>
          ) : (
            <p className="text-muted-foreground">
              El diálogo fue reanudado mediante el cierre explícito de este
              Escalamiento.
            </p>
          )}
        </div>
      );
    case "appointment":
      return (
        <div className="border-border bg-muted/30 space-y-2 rounded-lg border p-4 text-sm">
          <p className="font-medium">Solicitud de Cita</p>
          <p>
            {pending.contact.name} solicitó{" "}
            {appointmentActionLabel(pending.action)}.
          </p>
          <p className="text-muted-foreground">
            Identificador de Cita: {pending.appointmentId}
          </p>
          {pending.requestedStartsAt ? (
            <p className="text-muted-foreground">
              Nuevo inicio solicitado: {formatDate(pending.requestedStartsAt)}
            </p>
          ) : null}
        </div>
      );
    case "delivery":
      return (
        <div className="border-border bg-muted/30 space-y-2 rounded-lg border p-4 text-sm">
          <p className="font-medium">Entrega transaccional fallida</p>
          <p>{deliveryKindLabel(pending.delivery.kind)}</p>
          <p className="text-muted-foreground">
            Intentos registrados: {pending.delivery.attempts}
          </p>
          <p className="text-muted-foreground break-words">
            Clave de entrega: {pending.delivery.idempotencyKey}
          </p>
          {pending.delivery.lastError ? (
            <p className="text-destructive">
              Último error: {pending.delivery.lastError}
            </p>
          ) : null}
          {pending.delivery.resolutionEvidence ? (
            <p className="text-muted-foreground break-words">
              Evidencia de resolución: {pending.delivery.resolutionEvidence}
            </p>
          ) : null}
        </div>
      );
  }
}

function PendingEmptyState({ status }: { status: PendingStatus }) {
  return (
    <div className="border-border bg-muted/20 rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">
        {status === "open"
          ? "No hay trabajo humano pendiente."
          : "Todavía no hay casos resueltos."}
      </p>
      <p className="text-muted-foreground mt-2 text-sm">
        {status === "open"
          ? "Los Escalamientos y Entregas fallidas aparecerán aquí cuando requieran atención."
          : "Los casos atendidos permanecerán disponibles en este historial."}
      </p>
    </div>
  );
}

function PendingDetailEmpty() {
  return (
    <Card className="h-fit">
      <CardContent className="text-muted-foreground p-8 text-center text-sm">
        Seleccione un caso para revisar su contexto y la acción autorizada.
      </CardContent>
    </Card>
  );
}

function DetailField({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

function parseCategory(value: string | null): PendingCategoryFilter {
  return value !== null &&
    (value === "all" || PENDING_CATEGORIES.includes(value as PendingCategory))
    ? (value as PendingCategoryFilter)
    : "all";
}

function parseStatus(value: string | null): PendingStatus {
  return value === "resolved" ? "resolved" : "open";
}

function pendingCaseKey(pending: PendingCase) {
  return pending.category + ":" + pending.id;
}

function categoryLabel(category: PendingCategory) {
  return category === "conversation"
    ? "Conversación"
    : category === "appointment"
      ? "Cita"
      : "Entrega";
}

function priorityLabel(priority: PendingPriority | null) {
  return priority === null
    ? "Sin prioridad registrada"
    : PRIORITY_LABELS[priority];
}

function pendingSummary(pending: PendingCase) {
  switch (pending.category) {
    case "conversation":
      return pending.contact.name;
    case "appointment":
      return (
        pending.contact.name + " · " + appointmentActionLabel(pending.action)
      );
    case "delivery":
      return deliveryKindLabel(pending.delivery.kind);
  }
}

function pendingActionLabel(pending: PendingCase) {
  switch (pending.category) {
    case "conversation":
      return "Cerrar Escalamiento de conversación";
    case "appointment":
      return "Resolver solicitud de Cita";
    case "delivery":
      return "Marcar Alerta de Entrega como resuelta";
  }
}

function conversationTriggerLabel(
  trigger: PendingConversationTrigger,
  sourceMessageType: string | null,
) {
  if (trigger === "unsupported-message" && sourceMessageType !== null) {
    return `La persona envió un mensaje de tipo ${whatsappInboundMessageTypeLabel(sourceMessageType).toLocaleLowerCase("es-SV")}; no se descargó ni interpretó y requiere atención humana.`;
  }
  switch (trigger) {
    case "business-app":
      return "La persona escribió desde WhatsApp Business App; el asistente de la Clínica permanece en silencio.";
    case "human-request":
      return "La persona solicitó atención humana.";
    case "frustration":
      return "La persona expresó frustración.";
    case "guardianship-pending":
      return "La representación autorizada de un Tutor requiere verificación.";
    case "misunderstanding":
      return "Se produjeron dos fallos consecutivos de comprensión.";
    case "voice-transcription-disabled":
      return "La transcripción de nota de voz está desactivada.";
    case "voice-transcription-failed":
      return "Falló la transcripción de una nota de voz.";
    case "unsupported-message":
      return "El tipo de mensaje requiere atención humana y no se interpretó automáticamente.";
  }
}

function appointmentActionLabel(action: "cancel" | "reschedule") {
  return action === "cancel" ? "cancelarla" : "reprogramarla";
}

function deliveryKindLabel(
  kind: "appointment-message" | "appointment-reminder" | "daily-agenda-pdf",
) {
  if (kind === "appointment-message") return "Mensaje de Cita";
  return kind === "appointment-reminder"
    ? "Recordatorio de Cita"
    : "PDF de agenda diaria";
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(value));
}

function tabClassName(active: boolean) {
  return active
    ? "bg-background text-foreground focus-visible:ring-ring/30 min-h-10 rounded-md px-3 text-sm font-medium shadow-sm outline-none focus-visible:ring-3"
    : "text-muted-foreground hover:text-foreground focus-visible:ring-ring/30 min-h-10 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-3";
}
