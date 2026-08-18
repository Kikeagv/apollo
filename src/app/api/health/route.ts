/** Liveness de producción: 200 sin dependencias de base de datos o sesión. */
export async function GET() {
  return Response.json({ status: "ok" });
}
