import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("landing pública de Praxia", () => {
  test("expone el valor del producto, evidencia accesible y navegación rastreable", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(
      "Software para clínicas en El Salvador | Praxia",
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Software para clínicas que organiza tu agenda y la atención por WhatsApp",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Praxia ayuda a confirmar, reprogramar y cancelar citas según la capacidad real de tu clínica, mientras tu equipo conserva el control.",
        { exact: true },
      ),
    ).toBeVisible();

    const demoLinks = page.locator('a.button[href="/demo"]');
    await expect(demoLinks).toHaveCount(3);
    for (const link of await demoLinks.all()) {
      await expect(link).toContainText("Solicitar una demo");
    }

    await expect(
      page.getByRole("navigation", { name: "Navegación principal" }),
    ).toContainText("Producto");
    await expect(page.locator('a[href="#producto"]').first()).toHaveAttribute(
      "href",
      "#producto",
    );
    await expect(
      page.locator('a[href="#como-funciona"]').first(),
    ).toHaveAttribute("href", "#como-funciona");
    await expect(
      page.locator('a[href="#para-clinicas"]').first(),
    ).toHaveAttribute("href", "#para-clinicas");
    await expect(
      page.getByRole("link", { name: "Iniciar sesión" }).first(),
    ).toHaveAttribute("href", "https://app.usepraxia.com");

    await expect(page.locator("[data-evidence]")).toHaveCount(3);
    await expect(page.locator("[data-evidence-image]")).toHaveCount(3);
    for (const image of await page.locator("[data-evidence-image]").all()) {
      await expect(image).toHaveAttribute("alt", /.+/);
    }
    await expect(page.locator(".faq details")).toHaveCount(6);
    await expect(
      page.locator('meta[property="og:image:width"]'),
    ).toHaveAttribute("content", "1200");
    await expect(
      page.locator('meta[property="og:image:height"]'),
    ).toHaveAttribute("content", "630");

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test("permite navegación por teclado y abre la FAQ sin JavaScript adicional", async ({
    page,
  }) => {
    await page.goto("/");

    const skipLink = page.getByRole("link", { name: "Saltar al contenido" });
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#inicio")).toBeFocused();

    const productLink = page.locator('a[href="#producto"]').first();
    await productLink.focus();
    await expect(productLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#producto$/);
    await expect(
      page.getByRole("heading", {
        name: "Agenda, WhatsApp y equipo en un mismo flujo.",
      }),
    ).toBeVisible();

    const firstQuestion = page.locator(".faq summary").first();
    await firstQuestion.focus();
    await expect(firstQuestion).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".faq details").first()).toHaveAttribute(
      "open",
      "",
    );
    await expect(
      page.getByText(
        "Puede confirmar, reprogramar y cancelar Citas dentro de la capacidad y las reglas administrativas de tu clínica.",
        { exact: true },
      ),
    ).toBeVisible();
  });

  test("prioriza el copy y el CTA en móvil y conserva la lectura sin JS/reduced motion", async ({
    browser,
  }) => {
    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await mobile.goto("/");
    await expect(
      mobile.getByRole("heading", {
        level: 1,
        name: "Software para clínicas que organiza tu agenda y la atención por WhatsApp",
      }),
    ).toBeVisible();
    await expect(
      mobile.locator('a.button[href="/demo"]').first(),
    ).toBeVisible();
    const mobileMenu = mobile.locator(".nav__menu summary");
    await expect(mobileMenu).toBeVisible();
    await mobileMenu.click();
    await expect(mobile.locator(".nav__menu-panel")).toBeVisible();
    await expect(
      mobile
        .locator(".nav__menu-panel")
        .getByRole("link", { name: "Producto" }),
    ).toBeVisible();
    await expect(
      mobile.locator(".nav__menu-panel").getByRole("link", {
        name: "Iniciar sesión",
      }),
    ).toHaveAttribute("href", "https://app.usepraxia.com");
    expect(
      await mobile.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await expect(mobile.locator(".hero__illustration")).toBeVisible();
    await mobile.close();

    const narrow = await browser.newPage({
      viewport: { width: 320, height: 844 },
    });
    await narrow.goto("/");
    const narrowCta = narrow.locator('header a.button[href="/demo"]');
    await expect(narrowCta).toBeVisible();
    const narrowCtaBox = await narrowCta.boundingBox();
    expect(narrowCtaBox).not.toBeNull();
    expect(narrowCtaBox!.x + narrowCtaBox!.width).toBeLessThanOrEqual(320);
    expect(
      await narrow.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    await narrow.close();

    const reducedMotion = await browser.newPage();
    await reducedMotion.emulateMedia({ reducedMotion: "reduce" });
    await reducedMotion.goto("/");
    await expect(reducedMotion.locator("#hero-title")).toBeVisible();
    await expect(
      reducedMotion.locator('a.button[href="/demo"]').first(),
    ).toBeVisible();
    await reducedMotion.close();

    const withoutJavaScript = await browser.newPage({
      javaScriptEnabled: false,
    });
    await withoutJavaScript.goto("/");
    await expect(withoutJavaScript.locator("#hero-title")).toBeVisible();
    await expect(
      withoutJavaScript.locator('a.button[href="/demo"]').first(),
    ).toBeVisible();
    await expect(
      withoutJavaScript.locator("[data-evidence]").first(),
    ).toBeVisible();
    expect(
      await withoutJavaScript
        .locator("#hero-title")
        .evaluate((element) => getComputedStyle(element).opacity),
    ).toBe("1");
    await withoutJavaScript.close();
  });
});
