"use client";

import { PanaceaRouteError } from "~/app/panacea-route-error";

export default function AvailabilitySettingsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PanaceaRouteError title="Disponibilidad" {...props} />;
}
