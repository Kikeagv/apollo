import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readLandingFile = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const readLandingAsset = (path: string) =>
  readFileSync(new URL(path, import.meta.url));
const normalizeHtml = (html: string) => html.replace(/\s+/g, " ").trim();

describe("contrato público de la landing de Praxia", () => {
  it("expone la categoría, la promesa aprobada y una conversión consistente", () => {
    const home = readLandingFile("./index.html");
    const normalizedHome = normalizeHtml(home);

    expect(normalizedHome).toContain(
      "<title>Software para clínicas en El Salvador | Praxia</title>",
    );
    expect(normalizedHome).toContain(
      'content="Organiza la agenda de tu clínica y gestiona la atención administrativa de citas por WhatsApp. Solicita una demo de Praxia."',
    );
    expect(normalizedHome).toContain(
      "Software para clínicas que organiza tu agenda y la atención por WhatsApp",
    );
    expect(normalizedHome).toContain(
      "Praxia ayuda a confirmar, reprogramar y cancelar citas según la capacidad real de tu clínica, mientras tu equipo conserva el control.",
    );
    expect(normalizedHome).not.toContain("Agendar una demo");
    expect(normalizedHome).not.toContain("mailto:");

    expect(normalizedHome).toContain('<a href="#producto">Producto</a>');
    expect(normalizedHome).toContain(
      '<a href="#como-funciona">Cómo funciona</a>',
    );
    expect(normalizedHome).toContain(
      '<a href="#para-clinicas">Para clínicas</a>',
    );
    expect(normalizedHome).toMatch(
      /<a class="nav__login"[^>]*href="https:\/\/app\.usepraxia\.com"\s*>\s*Iniciar sesión\s*<\/a\s*>/,
    );
    expect(normalizedHome.match(/<a\b[^>]*href="\/demo"/g)).toHaveLength(3);
    expect(normalizedHome).toContain('href="/privacidad"');
    expect(normalizedHome).toContain('href="/terminos"');
  });

  it("incluye seis preguntas y tres evidencias públicas con datos sintéticos", () => {
    const home = readLandingFile("./index.html");
    const normalizedHome = normalizeHtml(home);

    expect(normalizedHome).toContain('id="evidencia"');
    expect(normalizedHome).toContain("Agenda y disponibilidad");
    expect(normalizedHome).toContain("Atención por WhatsApp");
    expect(normalizedHome).toContain("Pendientes e intervención humana");
    expect(normalizedHome.match(/data-evidence="[^"]+"/g)).toEqual([
      'data-evidence="agenda"',
      'data-evidence="whatsapp"',
      'data-evidence="pending"',
    ]);

    expect(normalizedHome.match(/<details\b/g)).toHaveLength(7);
    expect(normalizedHome.match(/<summary>/g)).toHaveLength(6);
    expect(normalizedHome).toContain("¿Qué puede automatizar Praxia?");
    expect(normalizedHome).toContain("¿Qué conserva bajo control el equipo?");
    expect(normalizedHome).toContain(
      "¿Qué límites tiene la atención por WhatsApp?",
    );
    expect(normalizedHome).toContain("¿Para qué tipo de Clínica está pensada?");
    expect(normalizedHome).toContain(
      "¿Qué ocurre cuando una solicitud necesita a una persona?",
    );
    expect(normalizedHome).toContain(
      "¿Qué sucede después de solicitar una demo?",
    );

    const informativeImageTags = [
      ...normalizedHome.matchAll(/<img\b[^>]*data-evidence-image[^>]*>/g),
    ].map((match) => match[0]);
    expect(informativeImageTags).toHaveLength(3);
    expect(informativeImageTags.every((tag) => /\balt="[^"]+"/.test(tag))).toBe(
      true,
    );
  });

  it("mantiene el hero accesible sin JavaScript y publica un social card separado", () => {
    const home = readLandingFile("./index.html");
    const normalizedHome = normalizeHtml(home);
    const styles = readLandingFile("./styles.css");

    expect(normalizedHome).toMatch(
      /<script>\s*document\.documentElement\.classList\.add\("js"\);?\s*<\/script>/,
    );
    expect(normalizedHome).toContain('<picture class="hero__art">');
    expect(normalizedHome).toContain(
      '<source media="(max-width: 720px)" srcset="/public/clinic-campus-hero-mobile.webp" type="image/webp" />',
    );
    expect(normalizedHome).toContain(
      '<img class="hero__illustration" src="/public/clinic-campus-hero.webp"',
    );
    expect(normalizedHome).toContain('alt="" aria-hidden="true"');
    expect(styles).toContain("[data-reveal] {\n  opacity: 1;");
    expect(styles).toContain(".js [data-reveal] {\n  opacity: 0;");
    expect(normalizedHome).toContain(
      'content="https://www.usepraxia.com/public/og/praxia-clinicas-1200x630.png"',
    );
    expect(normalizedHome).toContain(
      '<meta property="og:image:width" content="1200" />',
    );
    expect(normalizedHome).toContain(
      '<meta property="og:image:height" content="630" />',
    );

    const socialCard = readLandingAsset(
      "./public/og/praxia-clinicas-1200x630.png",
    );
    expect(socialCard.toString("ascii", 1, 4)).toBe("PNG");
    expect(socialCard.readUInt32BE(16)).toBe(1200);
    expect(socialCard.readUInt32BE(20)).toBe(630);
  });
});
