import Link from "next/link";

import {
  visiblePanaceaConfigurationSections,
  type PanaceaRole,
} from "~/domain/panacea-shell";

export function PanaceaSettingsIndex({ role }: { role: PanaceaRole }) {
  const sections = visiblePanaceaConfigurationSections(role);

  return (
    <section aria-labelledby="settings-index-title" className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold" id="settings-index-title">
          Áreas de configuración
        </h2>
        <p className="text-muted-foreground mt-1 leading-6 text-pretty">
          Elija un área para revisar o cambiar la capacidad de atención de la
          Clínica.
        </p>
      </div>
      <nav aria-label="Subsecciones de Configuración">
        <ul className="grid gap-4 md:grid-cols-2">
          {sections.map((section) => (
            <li key={section.id}>
              <Link
                className="border-border bg-card hover:border-primary/50 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-ring/30 group block rounded-xl border p-5 transition-[border-color,background-color] outline-none focus-visible:ring-3"
                href={section.href}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-base font-semibold">
                    {section.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </span>
                <span className="text-muted-foreground mt-2 block text-sm leading-6 text-pretty">
                  {section.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {role === "doctor" ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm leading-6">
          Su alcance se limita a sus Servicios, Horarios, Bloqueos y Opciones de
          atención. La configuración de otros Médicos permanece protegida.
        </p>
      ) : null}
    </section>
  );
}
