import { describe, expect, it } from "vitest";

import { formNumberValue, formValue } from "./form-values";

describe("formValue", () => {
  it("returns the submitted text value", () => {
    const data = new FormData();
    data.set("name", "María López");

    expect(formValue(data, "name")).toBe("María López");
  });

  it("preserves existing empty-value handling for missing and file fields", () => {
    const data = new FormData();
    data.set("attachment", new File(["content"], "consent.pdf"));

    expect(formValue(data, "missing")).toBe("");
    expect(formValue(data, "attachment")).toBe("");
  });
});

describe("formNumberValue", () => {
  it("converts a submitted text value to a number", () => {
    const data = new FormData();
    data.set("durationMinutes", "30");

    expect(formNumberValue(data, "durationMinutes")).toBe(30);
  });
});
