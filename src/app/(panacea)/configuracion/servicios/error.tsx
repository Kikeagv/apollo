"use client";

import { PanaceaRouteError } from "~/app/panacea-route-error";

export default function ServicesSettingsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PanaceaRouteError title="Servicios" {...props} />;
}
