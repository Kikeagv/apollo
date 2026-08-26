"use client";

import { PanaceaRouteError } from "~/app/panacea-route-error";

export default function SettingsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PanaceaRouteError title="Configuración" {...props} />;
}
