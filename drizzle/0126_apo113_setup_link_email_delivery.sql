ALTER TABLE "pg-drizzle_whatsapp_onboarding_audit_event"
  DROP CONSTRAINT "whatsapp_onboarding_audit_action";
--> statement-breakpoint
ALTER TABLE "pg-drizzle_whatsapp_onboarding_audit_event"
  ADD CONSTRAINT "whatsapp_onboarding_audit_action"
  CHECK (
    "action" IN (
      'customer-confirmed',
      'customer-created',
      'onboarding-provider-unavailable',
      'offboarding-authorized',
      'preflight-executed',
      'setup-link-confirmed',
      'setup-link-created',
      'setup-link-expired',
      'setup-link-email-failed',
      'setup-link-email-sent',
      'setup-link-provider-unavailable',
      'setup-link-regenerated',
      'setup-link-revoked',
      'setup-link-used'
    )
  );
