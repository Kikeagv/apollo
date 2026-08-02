import { createHash } from "node:crypto";

export type Clinic = {
  id: string;
  isSynthetic: boolean;
  name: string;
};

export type AuditEvent = {
  action:
    | "clinic-owner-invited"
    | "identity-invitation-accepted"
    | "identity-login-failed"
    | "identity-login-succeeded";
  actorId?: string;
  clinicId?: string;
  identityId?: string;
  occurredAt: string;
};

export type SentEmail =
  | { invitationToken: string; kind: "clinic-owner-invitation"; to: string }
  | { kind: "login-otp"; otp: string; to: string };

type Identity = {
  email: string;
  id: string;
  passwordHash: string;
};

type Invitation = {
  clinicId: string;
  email: string;
  ownerName: string;
  token: string;
  used: boolean;
};

type Membership = {
  active: boolean;
  clinicId: string;
  identityId: string;
  role: "owner";
};

type LoginChallenge = {
  deviceId: string;
  identityId: string;
  otp: string;
};

type Patient = {
  clinicId: string;
  id: string;
  name: string;
};

type Session = {
  clinicId: string;
  identityId: string;
};

/**
 * Adaptador simulado para el seam de casos de uso. La implementación de
 * producción conserva los mismos comandos sobre Better Auth, Drizzle y RLS.
 */
export function createClinicOnboarding() {
  const clinics = new Map<string, Clinic>();
  const identities = new Map<string, Identity>();
  const identitiesByEmail = new Map<string, string>();
  const invitations = new Map<string, Invitation>();
  const memberships: Membership[] = [];
  const loginChallenges = new Map<string, LoginChallenge>();
  const patients: Patient[] = [];
  const sessions = new Map<string, Session>();
  const trustedDevices = new Set<string>();
  const auditEvents: AuditEvent[] = [];
  const sentEmails: SentEmail[] = [];
  let nextId = 1;

  const createId = (kind: string) => `${kind}-${nextId++}`;

  function audit(event: Omit<AuditEvent, "occurredAt">) {
    auditEvents.push({ ...event, occurredAt: new Date(0).toISOString() });
  }

  function createSession(identityId: string, deviceId: string) {
    const membership = memberships.find(
      (candidate) => candidate.identityId === identityId && candidate.active,
    );
    if (membership === undefined) {
      throw new Error("La Identidad no tiene una membresía activa");
    }

    trustedDevices.add(`${identityId}:${deviceId}`);
    const sessionId = createId("session");
    sessions.set(sessionId, { clinicId: membership.clinicId, identityId });
    audit({
      action: "identity-login-succeeded",
      identityId,
      clinicId: membership.clinicId,
    });
    return { sessionId };
  }

  function requireClinicalContext(sessionId: string, clinicId: string) {
    const session = sessions.get(sessionId);
    if (session?.clinicId !== clinicId) {
      throw new Error("La sesión no tiene acceso a esta Clínica");
    }
    return session;
  }

  return {
    auditEvents,
    sentEmails,

    createClinic(input: {
      superadminId: string;
      clinic: { isSynthetic: boolean; name: string };
      owner: { email: string; name: string };
    }) {
      if (!input.clinic.isSynthetic) {
        throw new Error("Este recorrido solo admite Clínicas sintéticas");
      }

      const clinic: Clinic = { id: createId("clinic"), ...input.clinic };
      const token = createId("invitation");
      clinics.set(clinic.id, clinic);
      invitations.set(token, {
        token,
        clinicId: clinic.id,
        email: input.owner.email,
        ownerName: input.owner.name,
        used: false,
      });
      sentEmails.push({
        kind: "clinic-owner-invitation",
        to: input.owner.email,
        invitationToken: token,
      });
      audit({
        action: "clinic-owner-invited",
        actorId: input.superadminId,
        clinicId: clinic.id,
      });
      return { clinic, token };
    },

    acceptInvitation(input: { password: string; token: string }) {
      const invitation = invitations.get(input.token);
      if (invitation === undefined || invitation.used) {
        throw new Error("La invitación no es válida");
      }

      const identityId = createId("identity");
      const identity: Identity = {
        id: identityId,
        email: invitation.email,
        passwordHash: hashPassword(input.password),
      };
      invitation.used = true;
      identities.set(identityId, identity);
      identitiesByEmail.set(identity.email, identityId);
      memberships.push({
        clinicId: invitation.clinicId,
        identityId,
        role: "owner",
        active: true,
      });
      audit({
        action: "identity-invitation-accepted",
        clinicId: invitation.clinicId,
        identityId,
      });
    },

    startLogin(input: { deviceId: string; email: string; password: string }) {
      const identityId = identitiesByEmail.get(input.email);
      const identity =
        identityId === undefined ? undefined : identities.get(identityId);
      if (identity?.passwordHash !== hashPassword(input.password)) {
        audit({ action: "identity-login-failed", identityId });
        throw new Error("Credenciales inválidas");
      }

      if (trustedDevices.has(`${identity.id}:${input.deviceId}`)) {
        return {
          status: "authenticated" as const,
          ...createSession(identity.id, input.deviceId),
        };
      }

      const challengeId = createId("login-challenge");
      const otp = createOtp(challengeId);
      loginChallenges.set(challengeId, {
        identityId: identity.id,
        deviceId: input.deviceId,
        otp,
      });
      sentEmails.push({ kind: "login-otp", to: identity.email, otp });
      return { status: "otp-required" as const, challengeId };
    },

    completeLogin(input: { challengeId: string; otp: string }) {
      const challenge = loginChallenges.get(input.challengeId);
      if (challenge?.otp !== input.otp) {
        audit({ action: "identity-login-failed" });
        throw new Error("OTP inválido");
      }

      loginChallenges.delete(input.challengeId);
      return createSession(challenge.identityId, challenge.deviceId);
    },

    openPanacea(sessionId: string) {
      const session = sessions.get(sessionId);
      if (session === undefined) throw new Error("La sesión no es válida");
      const clinic = clinics.get(session.clinicId);
      if (clinic === undefined) throw new Error("La Clínica no existe");

      return {
        clinic,
        patients: patients
          .filter((patient) => patient.clinicId === session.clinicId)
          .map(({ id, name }) => ({ id, name })),
      };
    },

    createSyntheticPatient(input: {
      clinicId: string;
      name: string;
      sessionId: string;
    }) {
      requireClinicalContext(input.sessionId, input.clinicId);
      const patient = {
        id: createId("patient"),
        clinicId: input.clinicId,
        name: input.name,
      };
      patients.push(patient);
      return patient;
    },
  };
}

function hashPassword(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

function createOtp(challengeId: string) {
  return createHash("sha256").update(challengeId).digest("hex").slice(0, 6);
}
