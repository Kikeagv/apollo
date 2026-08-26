import { notFound, redirect } from "next/navigation";

import {
  canAccessPanaceaConfigurationSection,
  type PanaceaConfigurationSection,
  type PanaceaDestination,
} from "~/domain/panacea-shell";
import {
  getPanaceaSessionContext,
  panaceaRouteAccess,
} from "~/server/application/panacea-shell";

export async function requirePanaceaSession() {
  const context = await getPanaceaSessionContext();
  if (context === undefined) redirect("/");
  return context;
}

export async function requirePanaceaDestination(
  destination: PanaceaDestination,
) {
  const access = await panaceaRouteAccess.resolve(destination);
  if (access.status === "unauthenticated") redirect("/");
  if (access.status === "forbidden") notFound();
  return access.context;
}

export async function requirePanaceaConfigurationSection(
  section: PanaceaConfigurationSection,
) {
  const context = await requirePanaceaDestination("settings");
  if (!canAccessPanaceaConfigurationSection(context.clinic.role, section)) {
    notFound();
  }
  return context;
}
