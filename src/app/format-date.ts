import { CLINIC_TIMEZONE } from "~/clinic-timezone";

export function formatDateTime(value: Date | string | null) {
  if (value === null) return "No registrado";
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date(value));
}
