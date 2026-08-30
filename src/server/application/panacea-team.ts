import {
  doctorProfileProgress,
  type DoctorProfileProgress,
} from "~/domain/panacea-team";
import { drizzlePanaceaTeamReader } from "~/server/db/panacea-team-store";

export type PanaceaTeamDoctorRecord = {
  active: boolean;
  email: string;
  id: string;
  name: string;
  primarySpecialty: string | null;
  publicName: string | null;
  role: "doctor" | "owner";
};

export type PanaceaTeamInvitation = {
  email: string;
  expiresAt: Date;
  id: string;
  recipientName: string;
  status: "accepted" | "expired" | "pending";
};

export type PanaceaTeamReaderResult = {
  doctors: PanaceaTeamDoctorRecord[];
  invitations: PanaceaTeamInvitation[];
};

export type PanaceaTeamReader = {
  read(input: {
    clinicId: string;
    identityId: string;
  }): Promise<PanaceaTeamReaderResult | undefined>;
};

export type PanaceaTeamDoctor = PanaceaTeamDoctorRecord & {
  profile: DoctorProfileProgress;
};

export type PanaceaTeam = {
  doctors: PanaceaTeamDoctor[];
  invitations: PanaceaTeamInvitation[];
};

export class PanaceaTeamAccessError extends Error {
  constructor() {
    super("Solo el Médico propietario puede consultar el Equipo");
    this.name = "PanaceaTeamAccessError";
  }
}

/** Prepara el estado operativo del Equipo sin convertir un perfil incompleto en bloqueo. */
export async function listPanaceaTeam(
  input: { clinicId: string; identityId: string },
  reader: PanaceaTeamReader = drizzlePanaceaTeamReader,
): Promise<PanaceaTeam> {
  const team = await reader.read(input);
  if (team === undefined) throw new PanaceaTeamAccessError();

  return {
    doctors: team.doctors.map((doctor) => ({
      ...doctor,
      profile: doctorProfileProgress(doctor),
    })),
    invitations: team.invitations,
  };
}
