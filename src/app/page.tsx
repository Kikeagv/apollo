import { getSession } from "~/server/better-auth/server";
import {
  CLINIC_SESSION_COOKIE,
  CLINIC_TRUSTED_DEVICE_COOKIE,
  findTrustedClinicContext,
} from "~/server/application/clinic-access";
import { findOwnDoctorProfile } from "~/server/application/doctor-profile";
import { cookies } from "next/headers";

import { ClinicSessionActivity } from "./clinic-session-activity";
import { ClinicSignInForm } from "./clinic-sign-in-form";
import { ConversationEscalationsSection } from "./conversation-escalations-section";
import { EscalationNotificationSettingsSection } from "./escalation-notification-settings-section";
import { DoctorProfileSetup } from "./doctor-profile-setup";
import { AvailabilitySection } from "./availability-section";
import { AdministrativeRecordsSection } from "./administrative-records-section";
import { AppointmentSelfManagementEscalationsSection } from "./appointment-self-management-escalations-section";
import { CareOptionsSection } from "./care-options-section";
import { DoctorsSection } from "./doctors-section";
import { ManualAppointmentsSection } from "./manual-appointments-section";
import { NoShowPolicySection } from "./no-show-policy-section";
import { TransactionalDeliveryAlertsSection } from "./transactional-delivery-alerts-section";
import { ServiceCatalogSection } from "./service-catalog-section";
import { SyntheticClinicalActionForm } from "./synthetic-clinical-action-form";
import { VerifyClinicOtpForm } from "./verify-clinic-otp-form";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ verificar?: string }>;
}) {
  const session = await getSession();
  const trustedDeviceToken = (await cookies()).get(
    CLINIC_TRUSTED_DEVICE_COOKIE,
  )?.value;
  const clinicSessionToken = (await cookies()).get(
    CLINIC_SESSION_COOKIE,
  )?.value;
  const context =
    session === null
      ? undefined
      : await findTrustedClinicContext({
          identityId: session.user.id,
          clinicSessionToken,
          trustedDeviceToken,
        });
  const { verificar } = await searchParams;
  const profile =
    context === undefined
      ? undefined
      : await findOwnDoctorProfile({
          clinicId: context.clinicId,
          identityId: context.identityId,
        });

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <section className="w-full max-w-xl space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm font-medium tracking-[0.2em] text-teal-300">
          PRAXIA
        </p>
        <h1 className="text-4xl font-semibold">Panacea</h1>
        {context ? (
          <>
            <ClinicSessionActivity />
            <p className="text-lg">{context.clinicName}</p>
            <p>
              Aún no hay información para mostrar en esta Clínica. Esta es su
              Panacea vacía.
            </p>
            {profile ? <DoctorProfileSetup initialProfile={profile} /> : null}
            <AdministrativeRecordsSection />
            <ConversationEscalationsSection />
            <AppointmentSelfManagementEscalationsSection />
            <TransactionalDeliveryAlertsSection />
            <ManualAppointmentsSection />
            {context.role === "owner" ? <DoctorsSection /> : null}
            {context.role === "owner" ? <NoShowPolicySection /> : null}
            {context.role === "owner" ? (
              <EscalationNotificationSettingsSection />
            ) : null}
            {context.role === "owner" || context.role === "doctor" ? (
              <>
                <ServiceCatalogSection
                  canCreateServices={context.role === "owner"}
                />
                <AvailabilitySection canManageAll={context.role === "owner"} />
                <CareOptionsSection />
              </>
            ) : null}
            <SyntheticClinicalActionForm />
          </>
        ) : session && verificar === "otp" ? (
          <>
            <p>
              Confirme el inicio desde este navegador antes de abrir Panacea.
            </p>
            <VerifyClinicOtpForm />
          </>
        ) : (
          <ClinicSignInForm />
        )}
      </section>
    </main>
  );
}
