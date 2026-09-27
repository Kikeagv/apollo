export type SupervisionTabId =
  "overview" | "whatsapp" | "payments" | "support" | "templates" | "system";

export const supervisionTabs: ReadonlyArray<{
  id: SupervisionTabId;
  label: string;
}> = [
  { id: "overview", label: "Resumen" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "payments", label: "Pagos" },
  { id: "support", label: "Soporte" },
  { id: "templates", label: "Plantillas" },
  { id: "system", label: "Sistema" },
];

/** Devuelve el destino de las teclas del patrón de pestañas WAI-ARIA. */
export function getNextSupervisionTab(
  current: SupervisionTabId,
  key: string,
): SupervisionTabId | null {
  const index = supervisionTabs.findIndex((tab) => tab.id === current);
  if (index < 0) return null;
  if (key === "Home") return supervisionTabs[0]?.id ?? null;
  if (key === "End") return supervisionTabs.at(-1)?.id ?? null;
  if (key === "ArrowRight") {
    return supervisionTabs[(index + 1) % supervisionTabs.length]?.id ?? null;
  }
  if (key === "ArrowLeft") {
    return (
      supervisionTabs[
        (index - 1 + supervisionTabs.length) % supervisionTabs.length
      ]?.id ?? null
    );
  }
  return null;
}
