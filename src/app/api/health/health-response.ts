import type { WhatsAppRuntimeDiagnostic } from "~/domain/whatsapp-runtime";

/**
 * Proyección pública mínima del health check del runtime. `configured` solo
 * confirma que los secretos centrales están presentes; no prueba una
 * Conexión de WhatsApp por Clínica. Nunca incluye nombres de variables,
 * mensajes del proveedor ni valores sensibles.
 */
export function createHealthResponse(
  diagnostic: WhatsAppRuntimeDiagnostic,
): Response {
  const whatsapp = {
    configured: diagnostic.configured,
    provider: diagnostic.provider,
  };
  if (!diagnostic.configured) {
    return Response.json(
      {
        reason: "whatsapp-runtime-not-configured",
        status: "error",
        whatsapp,
      },
      { status: 503 },
    );
  }
  return Response.json({ status: "ok", whatsapp });
}
