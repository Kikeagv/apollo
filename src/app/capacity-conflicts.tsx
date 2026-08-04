type CapacityConflict = {
  id: string;
  kind: "active-temporary-reservation" | "confirmed-appointment";
  startsAt: string;
};

export function CapacityConflicts({
  conflicts,
}: {
  conflicts: CapacityConflict[] | null | undefined;
}) {
  if (!conflicts?.length) return null;

  return (
    <ul className="list-inside list-disc">
      {conflicts.map((conflict) => (
        <li key={conflict.id}>
          {conflict.kind === "confirmed-appointment"
            ? "Cita confirmada"
            : "Reserva temporal activa"}{" "}
          desde {new Date(conflict.startsAt).toLocaleString("es-SV")}
        </li>
      ))}
    </ul>
  );
}
