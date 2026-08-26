export type PanaceaRole = "owner" | "doctor" | "secretary";

export type PanaceaDestination =
  "calendar" | "patients" | "pending" | "settings";

export type PanaceaConfigurationSection =
  "team" | "services" | "availability" | "whatsapp";

export type PanaceaDestinationDefinition = {
  description: string;
  href: string;
  id: PanaceaDestination;
  label: string;
};

export const PANACEA_DESTINATIONS = [
  {
    description: "La agenda de la Clínica y sus Citas.",
    href: "/calendario",
    id: "calendar",
    label: "Calendario",
  },
  {
    description: "Fichas administrativas de Pacientes y Contactos.",
    href: "/pacientes",
    id: "patients",
    label: "Pacientes",
  },
  {
    description: "Trabajo que requiere atención de una persona.",
    href: "/pendientes",
    id: "pending",
    label: "Pendientes",
  },
  {
    description: "Equipo, capacidad y reglas de atención.",
    href: "/configuracion",
    id: "settings",
    label: "Configuración",
  },
] as const satisfies readonly PanaceaDestinationDefinition[];

export const PANACEA_CONFIGURATION_SECTIONS = [
  {
    description: "Médicos, invitaciones y perfiles de la Clínica.",
    href: "/configuracion/equipo",
    id: "team",
    label: "Equipo",
  },
  {
    description: "Servicios y Ofertas de servicio activas.",
    href: "/configuracion/servicios",
    id: "services",
    label: "Servicios",
  },
  {
    description: "Horarios vigentes, Bloqueos y Opciones de atención.",
    href: "/configuracion/disponibilidad",
    id: "availability",
    label: "Disponibilidad",
  },
  {
    description: "Reglas de inasistencia, avisos y transcripción.",
    href: "/configuracion/whatsapp",
    id: "whatsapp",
    label: "Atención por WhatsApp",
  },
] as const satisfies ReadonlyArray<{
  description: string;
  href: string;
  id: PanaceaConfigurationSection;
  label: string;
}>;

const DESTINATIONS_BY_ROLE: Record<PanaceaRole, readonly PanaceaDestination[]> =
  {
    doctor: ["calendar", "patients", "pending", "settings"],
    owner: ["calendar", "patients", "pending", "settings"],
    secretary: ["calendar", "patients", "pending"],
  };

const CONFIGURATION_BY_ROLE: Record<
  PanaceaRole,
  readonly PanaceaConfigurationSection[]
> = {
  doctor: ["services", "availability"],
  owner: ["team", "services", "availability", "whatsapp"],
  secretary: [],
};

export function canAccessPanaceaDestination(
  role: PanaceaRole,
  destination: PanaceaDestination,
) {
  return DESTINATIONS_BY_ROLE[role].includes(destination);
}

export function canAccessPanaceaConfigurationSection(
  role: PanaceaRole,
  section: PanaceaConfigurationSection,
) {
  return CONFIGURATION_BY_ROLE[role].includes(section);
}

export function visiblePanaceaDestinations(role: PanaceaRole) {
  return PANACEA_DESTINATIONS.filter(({ id }) =>
    canAccessPanaceaDestination(role, id),
  );
}

export function visiblePanaceaConfigurationSections(role: PanaceaRole) {
  const visible = new Set(CONFIGURATION_BY_ROLE[role]);
  return PANACEA_CONFIGURATION_SECTIONS.filter(({ id }) => visible.has(id));
}

export function panaceaRoleLabel(role: PanaceaRole) {
  switch (role) {
    case "owner":
      return "Médico propietario";
    case "doctor":
      return "Médico";
    case "secretary":
      return "Secretaria";
  }
}
