"use client";

import { PanaceaRouteError } from "~/app/panacea-route-error";

export default function CalendarError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PanaceaRouteError title="Calendario" {...props} />;
}
