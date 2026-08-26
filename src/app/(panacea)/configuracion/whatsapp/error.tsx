"use client";

import { PanaceaRouteError } from "~/app/panacea-route-error";

export default function WhatsAppSettingsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PanaceaRouteError title="Atención por WhatsApp" {...props} />;
}
