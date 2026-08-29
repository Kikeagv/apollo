import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readLandingFile = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("contrato público de Solicitud de demo", () => {
  it("expone desde la landing un formulario nativo con los roles aprobados", () => {
    const home = readLandingFile("./index.html");
    const demo = readLandingFile("./demo.html");

    expect(home).toContain('href="/demo"');
    expect(home).not.toContain("mailto:contact@enriqueagv.com");
    expect(demo).toMatch(
      /<form\b[^>]*action="https:\/\/app\.usepraxia\.com\/api\/demo"[^>]*method="post"/s,
    );
    expect(demo).toContain('name="role"');
    expect(demo).toContain('value="owner"');
    expect(demo).toContain('value="secretary"');
    expect(demo).toContain('value="other"');
    expect(demo).toContain('name="turnstileToken"');
    expect(demo).toContain('name="website"');
    expect(demo).toContain('name="context"');
    expect(demo).toContain('value="agenda"');
    expect(demo).toContain('href="/privacidad"');
    expect(demo).toContain("<noscript>");

    const formFieldNames = [
      ...demo.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g),
    ].map((match) => match[1]);
    expect(formFieldNames).not.toEqual(
      expect.arrayContaining(["patient", "patientName", "clinicalData"]),
    );
  });

  it("mantiene una composición de formulario compacta y de una columna", () => {
    const demo = readLandingFile("./demo.html");
    const styles = readLandingFile("./styles.css");

    expect(demo).not.toContain('<p class="kicker">Solicitud de demo</p>');
    expect(demo).not.toContain('<p class="kicker">Hablemos de Praxia</p>');
    expect(demo).not.toContain("Los campos marcados con * son necesarios.");
    expect(styles).toMatch(
      /\.demo-form-grid\s*\{[\s\S]*grid-template-columns:\s*1fr;/,
    );
    expect(styles).toMatch(
      /\.demo-field select\s*\{[\s\S]*appearance:\s*none;[\s\S]*padding-right:\s*3rem;/,
    );
    expect(styles).toContain("background-position: right 1rem center");
    expect(styles).toContain("font-size: clamp(2.35rem, 4.5vw, 4rem);");
    expect(styles).toContain("font-size: clamp(1.65rem, 3vw, 2.35rem);");
  });

  it("mantiene la confirmación fuera del índice y sin promesa de respuesta", () => {
    const confirmation = readLandingFile("./demo/recibido.html");
    const nginx = readLandingFile("./nginx.conf");
    const dockerfile = readLandingFile("./Dockerfile");

    expect(confirmation).toContain(
      '<meta name="robots" content="noindex, follow" />',
    );
    expect(confirmation).not.toMatch(/SLA|24 horas|tiempo fijo/i);
    expect(dockerfile).toContain(
      "COPY index.html terminos.html privacidad.html demo.html",
    );
    expect(dockerfile).toContain("COPY demo/ /usr/share/nginx/html/demo/");
    expect(dockerfile).toContain("ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY");
    expect(nginx).toContain("location = /demo {");
    expect(nginx).toContain("location = /demo/recibido");
    expect(nginx).toContain('X-Robots-Tag "noindex, follow"');
  });

  it("publica en privacidad los proveedores y el alcance de la atribución", () => {
    const privacy = readLandingFile("./privacidad.html");

    expect(privacy).toContain("Solicitud de demo");
    expect(privacy).toContain("WhatsApp opcional");
    expect(privacy).toContain("UTM source");
    expect(privacy).toContain("Cloudflare Insights");
    expect(privacy).toContain("Resend");
    expect(privacy).toContain("12 meses");
    expect(privacy).toContain("derechos");
  });
});
