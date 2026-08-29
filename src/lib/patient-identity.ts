export function joinPatientName(givenNames: string, familyNames: string) {
  return [givenNames, familyNames]
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .join(" ");
}
