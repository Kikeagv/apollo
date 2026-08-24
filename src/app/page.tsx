import { getSession } from "~/server/better-auth/server";
import { env } from "~/env";
import {
  CLINIC_SESSION_COOKIE,
  CLINIC_TRUSTED_DEVICE_COOKIE,
  findTrustedClinicContext,
} from "~/server/application/clinic-access";
import { findOwnDoctorProfile } from "~/server/application/doctor-profile";
import { cookies } from "next/headers";

import { PasswordRecoveryForm } from "./password-recovery-form";
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
import { VoiceNoteTranscriptionSettingsSection } from "./voice-note-transcription-settings-section";
import { SupportAccessSection } from "./support-access-section";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ recuperar?: string; verificar?: string }>;
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
  const { recuperar, verificar } = await searchParams;
  const profile =
    context === undefined
      ? undefined
      : await findOwnDoctorProfile({
          clinicId: context.clinicId,
          identityId: context.identityId,
        });

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <section className="border-border bg-card w-full max-w-xl space-y-6 rounded-xl border p-6 shadow-sm sm:p-8">
        <p className="text-primary text-sm font-semibold tracking-[0.16em]">
          PRAXIA
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">
          Praxia
        </h1>
        {context ? (
          <>
            <ClinicSessionActivity />
            <p className="text-lg">{context.clinicName}</p>
            <p>
              Aún no hay información para mostrar en esta Clínica. Esta es su
              área de trabajo.
            </p>
            <SupportAccessSection />
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
            {context.role === "owner" ? (
              <VoiceNoteTranscriptionSettingsSection />
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
              Confirme el inicio desde este navegador antes de abrir Praxia.
            </p>
            <VerifyClinicOtpForm />
          </>
        ) : recuperar === "1" ? (
          <PasswordRecoveryForm
            turnstileSiteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          />
        ) : (
          <ClinicSignInForm />
        )}
      </section>
    </main>
  );
}
