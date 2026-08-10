export function formValue(data: FormData, field: string) {
  const value = data.get(field);
  return typeof value === "string" ? value : "";
}

export function formNumberValue(data: FormData, field: string) {
  return Number(formValue(data, field));
}

export function formValues(data: FormData, field: string) {
  return data
    .getAll(field)
    .filter((value): value is string => typeof value === "string");
}
