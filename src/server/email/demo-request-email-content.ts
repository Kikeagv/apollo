import type { DemoRequest, DemoRequestContext } from "~/domain/demo-request";

export const DEMO_REQUEST_EMAIL_TO = "contact@enriqueagv.com";
export const DEMO_REQUEST_EMAIL_SUBJECT = "Nueva solicitud de demo de Praxia";

export function demoRequestRoleLabel(role: DemoRequest["role"]) {
  const labels: Record<DemoRequest["role"], string> = {
    other: "Otro",
    owner: "Médico propietario",
    secretary: "Secretaria",
  };
  return labels[role];
}

export function demoRequestContactLabel(
  channel: DemoRequest["preferredContact"],
) {
  return channel === "whatsapp" ? "WhatsApp" : "Correo electrónico";
}

export function demoRequestContextLabel(context: DemoRequestContext) {
  const labels: Record<DemoRequestContext, string> = {
    agenda: "Agenda y capacidad de atención",
    operations: "Operación general de la Clínica",
    other: "Otro tema comercial",
    whatsapp: "Atención administrativa por WhatsApp",
  };
  return labels[context];
}

/** El correo no incluye IP, token, honeypot ni datos ajenos al formulario. */
export function formatDemoRequestEmail(request: DemoRequest) {
  const attribution = request.attribution;
  return [
    "Solicitud de demo de Praxia",
    "",
    `Representante: ${request.representativeName}`,
    `Clínica: ${request.clinicName}`,
    `Rol: ${demoRequestRoleLabel(request.role)}`,
    `Correo: ${request.email}`,
    `Canal preferido: ${demoRequestContactLabel(request.preferredContact)}`,
    ...(request.preferredContact === "whatsapp"
      ? [`Teléfono: ${request.phone ?? "No indicado"}`]
      : []),
    `Contexto comercial: ${request.context === undefined ? "No indicado" : demoRequestContextLabel(request.context)}`,
    "",
    "Atribución:",
    `UTM source: ${attribution.utmSource ?? "No indicado"}`,
    `UTM medium: ${attribution.utmMedium ?? "No indicado"}`,
    `UTM campaign: ${attribution.utmCampaign ?? "No indicado"}`,
    `Landing page: ${attribution.landingPage ?? "No indicado"}`,
    `Referrer: ${attribution.referrer ?? "No indicado"}`,
  ].join("\n");
}
