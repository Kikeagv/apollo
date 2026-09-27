import { describe, expect, it } from "vitest";

import {
  getNextSupervisionTab,
  supervisionTabs,
  type SupervisionTabId,
} from "./supervision-navigation";

describe("supervision tab keyboard navigation", () => {
  it.each([
    ["overview", "ArrowRight", "whatsapp"],
    ["whatsapp", "ArrowLeft", "overview"],
    ["system", "ArrowRight", "overview"],
    ["overview", "ArrowLeft", "system"],
    ["payments", "Home", "overview"],
    ["overview", "End", "system"],
  ] as const)("moves %s with %s to %s", (current, key, expected) => {
    expect(getNextSupervisionTab(current, key)).toBe(expected);
  });

  it("does not move on unrelated keys", () => {
    expect(getNextSupervisionTab("payments", "Enter")).toBeNull();
    expect(supervisionTabs.map(({ id }) => id)).toEqual([
      "overview",
      "whatsapp",
      "payments",
      "support",
      "templates",
      "system",
    ] satisfies SupervisionTabId[]);
  });
});
