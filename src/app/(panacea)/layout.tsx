import { PanaceaShell } from "~/app/panacea-shell";
import { doctorProfileProgress } from "~/domain/panacea-team";
import { findOwnDoctorProfile } from "~/server/application/doctor-profile";

import { requirePanaceaSession } from "./route-access";

export default async function PanaceaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const context = await requirePanaceaSession();
  const profile =
    context.clinic.role === "secretary"
      ? undefined
      : await findOwnDoctorProfile({
          clinicId: context.clinic.clinicId,
          identityId: context.clinic.identityId,
        });
  const doctorProfileIncomplete =
    profile !== undefined &&
    doctorProfileProgress(profile).status === "incomplete";

  return (
    <PanaceaShell
      clinic={context.clinic}
      doctorProfileIncomplete={doctorProfileIncomplete}
      user={{ email: context.user.email, name: context.user.name }}
    >
      {children}
    </PanaceaShell>
  );
}
