import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readLandingFile = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const publicPages = [
  {
    description:
      "Organiza la agenda de tu clínica y gestiona la atención administrativa de citas por WhatsApp. Solicita una demo de Praxia.",
    file: "./index.html",
    title: "Software para clínicas en El Salvador | Praxia",
    url: "https://www.usepraxia.com",
  },
  {
    description:
      "Solicita una demo de Praxia para revisar la operación administrativa de tu Clínica, sin compartir datos de Pacientes.",
    file: "./demo.html",
    title: "Solicitar una demo | Praxia",
    url: "https://www.usepraxia.com/demo",
  },
  {
    description:
      "Aviso de privacidad de Praxia: datos que tratamos, finalidades, proveedores, conservación y derechos de las personas titulares.",
    file: "./privacidad.html",
    title: "Aviso de privacidad | Praxia",
    url: "https://www.usepraxia.com/privacidad",
  },
  {
    description:
      "Términos de uso de Praxia: reglas para el servicio de operación administrativa de Clínicas, sus cuentas, datos y proveedores.",
    file: "./terminos.html",
    title: "Términos de uso | Praxia",
    url: "https://www.usepraxia.com/terminos",
  },
] as const;

function metaContent(document: string, property: string) {
  const tag = new RegExp(`<meta[^>]*property="${property}"[^>]*>`, "i").exec(
    document,
  )?.[0];
  return /\bcontent="([^"]*)"/i.exec(tag ?? "")?.[1];
}

function namedMetaContent(document: string, name: string) {
  const tag = new RegExp(`<meta[^>]*name="${name}"[^>]*>`, "i").exec(
    document,
  )?.[0];
  return /\bcontent="([^"]*)"/i.exec(tag ?? "")?.[1];
}

describe("contrato SEO público de Praxia", () => {
  it("alinea title, canonical y Open Graph en cada URL indexable", () => {
    for (const page of publicPages) {
      const document = readLandingFile(page.file);

      expect(document).toContain(`<title>${page.title}</title>`);
      expect(namedMetaContent(document, "description")).toBe(page.description);
      expect(document).toContain(`<link rel="canonical" href="${page.url}" />`);
      expect(metaContent(document, "og:url")).toBe(page.url);
      expect(metaContent(document, "og:title")).toBe(page.title);
      expect(metaContent(document, "og:description")).toBe(page.description);
      expect(metaContent(document, "og:type")).toBe("website");
      expect(metaContent(document, "og:site_name")).toBe("Praxia");
      expect(metaContent(document, "og:image")).toMatch(
        /^https:\/\/www\.usepraxia\.com\//,
      );
      expect(document).not.toMatch(
        /<meta[^>]*property="og:url"[^>]*content="https:\/\/(?:usepraxia\.com|app\.usepraxia\.com)/i,
      );
    }
  });

  it("publica solo las cuatro URLs canónicas e indexables en XML", () => {
    const sitemap = readLandingFile("./sitemap.xml");
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1],
    );

    expect(sitemap).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(sitemap).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(sitemap.trim()).toMatch(/<\/urlset>$/);
    expect(locations).toEqual([
      "https://www.usepraxia.com/",
      "https://www.usepraxia.com/demo",
      "https://www.usepraxia.com/privacidad",
      "https://www.usepraxia.com/terminos",
    ]);
    expect(sitemap).not.toContain("/demo/recibido");
  });

  it("permite los crawlers aprobados y anuncia el sitemap desde robots", () => {
    const robots = readLandingFile("./robots.txt");

    expect(robots).toMatch(/User-agent: \*[\s\S]*?Allow: \//);
    expect(robots).toContain(
      "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    );
    for (const crawler of ["OAI-SearchBot", "GPTBot", "Google-Extended"]) {
      expect(robots).toMatch(
        new RegExp(`User-agent: ${crawler}\\s+Allow: /`, "i"),
      );
    }
    expect(robots).toContain("Sitemap: https://www.usepraxia.com/sitemap.xml");
    expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/im);
  });

  it("limita el JSON-LD a hechos públicos verificables", () => {
    for (const page of publicPages) {
      const document = readLandingFile(page.file);
      const scripts = [
        ...document.matchAll(
          /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi,
        ),
      ];

      expect(scripts).toHaveLength(1);
      const script = scripts[0];
      if (script === undefined) throw new Error("Falta JSON-LD público");
      const structuredData = JSON.parse(script[1] ?? "null") as {
        "@graph": Array<{ "@type": string }>;
      };

      expect(structuredData["@graph"].map((item) => item["@type"])).toEqual([
        "Organization",
        "WebSite",
        "WebPage",
      ]);
      expect(JSON.stringify(structuredData)).not.toMatch(
        /Offer|SoftwareApplication|price|Review|AggregateRating|testimonial|rating|result/i,
      );
    }
  });

  it("empaqueta robots y sitemap en la imagen y conserva sus rutas públicas", () => {
    const dockerfile = readLandingFile("./Dockerfile");
    const nginx = readLandingFile("./nginx.conf");

    expect(dockerfile).toContain(
      "COPY index.html terminos.html privacidad.html demo.html robots.txt sitemap.xml",
    );
    expect(nginx).toContain("location = /robots.txt");
    expect(nginx).toContain("location = /sitemap.xml");
  });
});
