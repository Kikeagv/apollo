import { describe, expect, it } from "vitest";

import { createClinicOnboarding } from "./clinic-onboarding";

describe("casos de uso de alta de Clínica", () => {
  it("crea una Clínica sintética, invita al médico propietario y audita la invitación", () => {
    const onboarding = createClinicOnboarding();

    const invitation = onboarding.createClinic({
      superadminId: "superadmin-1",
      clinic: { name: "Clínica Aurora", isSynthetic: true },
      owner: { name: "Dra. Ana Reyes", email: "ana@aurora.test" },
    });

    expect(invitation.clinic).toMatchObject({
      name: "Clínica Aurora",
      isSynthetic: true,
    });
    expect(onboarding.sentEmails).toContainEqual(
      expect.objectContaining({
        kind: "clinic-owner-invitation",
        to: "ana@aurora.test",
      }),
    );
    expect(onboarding.auditEvents).toContainEqual(
      expect.objectContaining({
        action: "clinic-owner-invited",
        actorId: "superadmin-1",
        clinicId: invitation.clinic.id,
      }),
    );
  });

  it("exige OTP por correo para un navegador nuevo y abre la Panacea vacía", () => {
    const onboarding = createClinicOnboarding();
    const invitation = createAndAcceptInvitation(
      onboarding,
      "Clínica Aurora",
      "ana@aurora.test",
    );

    const login = onboarding.startLogin({
      email: "ana@aurora.test",
      password: "Contraseña-segura-1",
      deviceId: "navegador-nuevo",
    });

    expect(login).toMatchObject({ status: "otp-required" });
    const otp = onboarding.sentEmails.at(-1);
    expect(otp).toMatchObject({ kind: "login-otp", to: "ana@aurora.test" });
    if (otp?.kind !== "login-otp" || login.status !== "otp-required") {
      throw new Error("Se esperaba un OTP de acceso");
    }

    const session = onboarding.completeLogin({
      challengeId: login.challengeId,
      otp: otp.otp,
    });
    expect(onboarding.openPanacea(session.sessionId)).toEqual({
      clinic: invitation.clinic,
      patients: [],
    });
  });

  it("niega la lectura y mutación de otra Clínica", () => {
    const onboarding = createClinicOnboarding();
    const aurora = activateOwner(
      onboarding,
      "Clínica Aurora",
      "ana@aurora.test",
      "navegador-ana",
    );
    const cedro = activateOwner(
      onboarding,
      "Clínica Cedro",
      "carlos@cedro.test",
      "navegador-carlos",
    );

    onboarding.createSyntheticPatient({
      sessionId: aurora.sessionId,
      clinicId: aurora.clinic.id,
      name: "Paciente de Aurora",
    });

    expect(onboarding.openPanacea(cedro.sessionId)).toEqual({
      clinic: cedro.clinic,
      patients: [],
    });
    expect(() =>
      onboarding.createSyntheticPatient({
        sessionId: aurora.sessionId,
        clinicId: cedro.clinic.id,
        name: "Intento cruzado",
      }),
    ).toThrow("La sesión no tiene acceso a esta Clínica");
  });

  it("audita un fallo de acceso sin conservar contraseñas ni OTP", () => {
    const onboarding = createClinicOnboarding();
    createAndAcceptInvitation(onboarding, "Clínica Aurora", "ana@aurora.test");

    expect(() =>
      onboarding.startLogin({
        email: "ana@aurora.test",
        password: "incorrecta",
        deviceId: "navegador-nuevo",
      }),
    ).toThrow("Credenciales inválidas");

    const audit = JSON.stringify(onboarding.auditEvents);
    expect(audit).toContain("identity-login-failed");
    expect(audit).not.toContain("incorrecta");
    expect(audit).not.toContain("Contraseña-segura-1");
  });
});

function createAndAcceptInvitation(
  onboarding: ReturnType<typeof createClinicOnboarding>,
  clinicName: string,
  email: string,
) {
  const invitation = onboarding.createClinic({
    superadminId: "superadmin-1",
    clinic: { name: clinicName, isSynthetic: true },
    owner: { name: `Propietario de ${clinicName}`, email },
  });
  onboarding.acceptInvitation({
    token: invitation.token,
    password: "Contraseña-segura-1",
  });
  return invitation;
}

function activateOwner(
  onboarding: ReturnType<typeof createClinicOnboarding>,
  clinicName: string,
  email: string,
  deviceId: string,
) {
  const invitation = createAndAcceptInvitation(onboarding, clinicName, email);
  const login = onboarding.startLogin({
    email,
    password: "Contraseña-segura-1",
    deviceId,
  });
  if (login.status !== "otp-required") throw new Error("Se esperaba OTP");
  const emailWithOtp = onboarding.sentEmails.at(-1);
  if (emailWithOtp?.kind !== "login-otp")
    throw new Error("Se esperaba OTP por correo");
  const session = onboarding.completeLogin({
    challengeId: login.challengeId,
    otp: emailWithOtp.otp,
  });
  return { clinic: invitation.clinic, sessionId: session.sessionId };
}
