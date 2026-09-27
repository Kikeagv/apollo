import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SupervisionTabs } from "./supervision-tabs";

describe("pestañas de supervisión", () => {
  it("expone el patrón de tabs accesible y la pestaña seleccionada", () => {
    const html = renderToStaticMarkup(
      createElement(SupervisionTabs, {
        value: "overview",
        onChange: vi.fn(),
      }),
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Secciones de supervisión"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-controls="supervision-panel-overview"');
    expect(html).toContain("focus-visible:outline-2");
    expect(html).toContain(">Plantillas</button>");
    expect(html).toContain(">Sistema</button>");
  });
});
