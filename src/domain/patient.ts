/** Calcula la mayoría de edad en la fecha indicada, según el calendario UTC. */
export function isAdultPatient(birthDate: string, at: Date) {
  const eighteenthBirthday = new Date(`${birthDate}T00:00:00.000Z`);
  eighteenthBirthday.setUTCFullYear(eighteenthBirthday.getUTCFullYear() + 18);
  return eighteenthBirthday <= at;
}
