"use client";

import { useEffect, useState, type FormEvent } from "react";

import { normalizeSecretaryPhoneE164 } from "~/domain/whatsapp-operational-policies";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { api } from "~/trpc/react";
import {
  PanaceaQueryEmpty,
  PanaceaQueryError,
  PanaceaQueryLoading,
} from "./panacea-query-state";
import { WhatsAppPolicyFeedback } from "./whatsapp-policy-feedback";

/** Control del Médico propietario para el aviso adicional de Escalamiento. */
export function EscalationNotificationSettingsSection() {
  const settings = api.panacea.getEscalationNotificationSettings.useQuery();
  const [enabled, setEnabled] = useState(false);
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const save = api.panacea.setEscalationNotificationSettings.useMutation({
    onSuccess: () => {
      void settings.refetch();
    },
  });

  const settingsData = settings.data;
  const savedEnabled = settingsData?.enabled ?? false;
  const savedPhone = settingsData?.secretaryPhoneE164 ?? null;
  useEffect(() => {
    if (settingsData === undefined) return;
    setEnabled(settingsData.enabled);
    setPhone(settingsData.secretaryPhoneE164 ?? "");
    setPhoneError(null);
  }, [settingsData]);

  const enabledChanged = enabled !== savedEnabled;
  const phoneChanged = phone !== (savedPhone ?? "");

  function saveSettings(form?: HTMLFormElement) {
    save.reset();
    const formData = form === undefined ? undefined : new FormData(form);
    const requestedEnabled =
      formData === undefined
        ? enabled
        : formData.get("escalation-notifications-enabled") !== null;
    const phoneEntry = formData?.get("secretary-phone");
    const requestedPhone =
      formData === undefined
        ? phone
        : typeof phoneEntry === "string"
          ? phoneEntry
          : "";
    setEnabled(requestedEnabled);
    setPhone(requestedPhone);
    try {
      const secretaryPhoneE164 = normalizeSecretaryPhoneE164(requestedPhone);
      if (requestedEnabled && secretaryPhoneE164 === null) {
        throw new Error("El aviso requiere un número E.164 de secretaria");
      }
      setPhoneError(null);
      save.mutate({
        enabled: requestedEnabled,
        secretaryPhoneE164,
      });
    } catch (error) {
      setPhoneError(
        error instanceof Error
          ? error.message
          : "El número de secretaria no es válido",
      );
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveSettings(event.currentTarget);
  }

  return (
    <section
      aria-labelledby="escalation-notification-title"
      className="space-y-5"
      data-whatsapp-policy="escalation-notifications"
    >
      <Card>
        <CardHeader className="border-border border-b">
          <h2
            className="text-xl font-semibold"
            id="escalation-notification-title"
          >
            Aviso de Escalamiento
          </h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            La tarea siempre queda registrada; este aviso simulado es adicional.
          </p>
        </CardHeader>
        <CardContent className="pt-6">
          {settings.error ? (
            <PanaceaQueryError
              error={settings.error}
              onRetry={() => void settings.refetch()}
              title="avisos de Escalamiento"
            />
          ) : settings.isLoading ? (
            <PanaceaQueryLoading label="Cargando avisos de Escalamiento" />
          ) : settings.data === undefined ? (
            <PanaceaQueryEmpty
              description="No hay preferencias de aviso disponibles para este alcance. Vuelva a intentar la carga."
              onRetry={() => void settings.refetch()}
              title="Sin avisos de Escalamiento configurados"
            />
          ) : (
            <form aria-busy={save.isPending} onSubmit={submit}>
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="escalation-notifications-enabled">
                      Avisar a secretaria por WhatsApp simulado
                    </FieldLabel>
                    <FieldDescription id="escalation-notifications-description">
                      Valor actual: {savedEnabled ? "Activado" : "Desactivado"}.
                      El aviso solo se envía cuando existe un Escalamiento.
                      {enabledChanged ? (
                        <>
                          {" "}
                          Cambio pendiente:{" "}
                          {enabled ? "Activado" : "Desactivado"}.
                        </>
                      ) : null}
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    aria-describedby="escalation-notifications-description"
                    checked={enabled}
                    disabled={save.isPending}
                    id="escalation-notifications-enabled"
                    name="escalation-notifications-enabled"
                    onCheckedChange={(checked) => {
                      setEnabled(checked);
                      setPhoneError(null);
                      save.reset();
                    }}
                  />
                </Field>
                <Field data-invalid={phoneError ? "true" : undefined}>
                  <FieldLabel htmlFor="secretary-phone">
                    Número de secretaria (E.164)
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      aria-describedby={`secretary-phone-description${phoneError ? " secretary-phone-error" : ""}`}
                      aria-invalid={phoneError ? true : undefined}
                      autoComplete="tel"
                      disabled={save.isPending}
                      id="secretary-phone"
                      name="secretary-phone"
                      onChange={(event) => {
                        setPhone(event.target.value);
                        setPhoneError(null);
                        save.reset();
                      }}
                      placeholder="+50370000000"
                      type="tel"
                      value={phone}
                    />
                    <FieldDescription id="secretary-phone-description">
                      {savedPhone ? (
                        <>Valor actual: {savedPhone}.</>
                      ) : (
                        "Valor actual: sin número de secretaria."
                      )}{" "}
                      Use formato E.164, por ejemplo +50370000000.
                      {phoneChanged ? (
                        <> Cambio pendiente: {phone || "sin número"}.</>
                      ) : null}
                    </FieldDescription>
                    <FieldError id="secretary-phone-error">
                      {phoneError}
                    </FieldError>
                  </FieldContent>
                </Field>
              </FieldGroup>
              <Button className="mt-5" disabled={save.isPending} type="submit">
                {save.isPending ? "Guardando…" : "Guardar avisos"}
              </Button>
              <div className="mt-4">
                <WhatsAppPolicyFeedback
                  mutation={save}
                  onRetry={saveSettings}
                  successMessage="Los avisos de Escalamiento quedaron actualizados."
                />
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
