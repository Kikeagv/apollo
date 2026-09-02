import { expect, test } from "@playwright/test";

test("la aplicación queda fuera del índice mediante cabecera HTTP", async ({
  request,
}) => {
  const routes = [
    { expectedStatus: 200, path: "/" },
    { expectedStatus: 307, path: "/calendario" },
  ] as const;

  for (const route of routes) {
    const response = await request.get(route.path, { maxRedirects: 0 });

    expect(response.status(), route.path).toBe(route.expectedStatus);
    expect(response.headers()["x-robots-tag"], route.path).toBe(
      "noindex, follow",
    );

    if (route.path === "/calendario") {
      expect(response.headers().location, route.path).toBe("/");
    }
  }
});
