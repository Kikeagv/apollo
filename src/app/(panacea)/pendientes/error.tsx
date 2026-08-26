"use client";

import { PanaceaRouteError } from "~/app/panacea-route-error";

export default function PendingError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PanaceaRouteError title="Pendientes" {...props} />;
}
