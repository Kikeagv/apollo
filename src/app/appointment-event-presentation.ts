import type { AppointmentEventType } from "~/domain/appointment-events";

const appointmentEventLabels: Record<AppointmentEventType, string> = {
  cancelled: "Cita cancelada",
  "manual-cancellation-failed":
    "No se pudo enviar el aviso de cancelación por WhatsApp",
  "manual-cancellation-sent": "Aviso de cancelación por WhatsApp enviado",
  "manual-confirmation-failed":
    "No se pudo enviar la confirmación por WhatsApp",
  "manual-confirmation-sent": "Confirmación por WhatsApp enviada",
  "appointment-delivery-status": "Estado de entrega por WhatsApp",
  "appointment-reschedule-failed":
    "No se pudo enviar el aviso de reprogramación por WhatsApp",
  "appointment-reschedule-sent": "Aviso de reprogramación por WhatsApp enviado",
  "appointment-confirmation-failed":
    "No se pudo enviar la confirmación por WhatsApp",
  "appointment-confirmation-sent": "Confirmación por WhatsApp enviada",
  "appointment-cancellation-failed":
    "No se pudo enviar el aviso de cancelación por WhatsApp",
  "appointment-cancellation-sent": "Aviso de cancelación por WhatsApp enviado",
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
  "self-management-escalated":
    "Solicitud de autogestión escalada a una persona",
  "self-management-resolved":
    "Solicitud de autogestión resuelta por una persona",
};

export function appointmentEventLabel(type: AppointmentEventType) {
  return appointmentEventLabels[type];
}
