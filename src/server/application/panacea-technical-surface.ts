import type { PanaceaRole } from "~/domain/panacea-shell";

/** Mantiene el tooling sintético fuera de producción y de roles operativos. */
export function canAccessPanaceaTechnicalSurface(input: {
  nodeEnv: string;
  role: PanaceaRole;
}) {
  return input.nodeEnv !== "production" && input.role === "owner";
}
