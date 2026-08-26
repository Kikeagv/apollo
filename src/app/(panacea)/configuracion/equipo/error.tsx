"use client";

import { PanaceaRouteError } from "~/app/panacea-route-error";

export default function TeamSettingsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PanaceaRouteError title="Equipo" {...props} />;
}
