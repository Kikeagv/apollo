"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Field, FieldContent, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";

/** Control del Médico propietario para el aviso adicional de Escalamiento. */
export function EscalationNotificationSettingsSection() {
  const settings = api.panacea.getEscalationNotificationSettings.useQuery();
  const [phone, setPhone] = useState("");
  useEffect(() => {
    setPhone(settings.data?.secretaryPhoneE164 ?? "");
  }, [settings.data?.secretaryPhoneE164]);
  const save = api.panacea.setEscalationNotificationSettings.useMutation({
    onSuccess: () => settings.refetch(),
  });
  const enabled = settings.data?.enabled ?? false;

  return (
    <section className="space-y-5">
      <Card>
        <CardHeader className="border-border border-b">
          <h2 className="text-xl font-semibold">Aviso de Escalamiento</h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            La tarea siempre queda registrada; este aviso simulado es adicional.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <label className="flex items-start gap-3 text-sm">
            <input
              checked={enabled}
              className="accent-primary mt-0.5 size-4"
              disabled={save.isPending || phone.length === 0}
              onChange={(event) =>
                save.mutate({
                  enabled: event.target.checked,
                  secretaryPhoneE164: phone || null,
                })
              }
              type="checkbox"
            />
            <span>Avisar a secretaria por WhatsApp simulado</span>
          </label>
          <Field>
            <FieldLabel htmlFor="secretary-phone">
              Número de secretaria (E.164)
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={save.isPending}
                id="secretary-phone"
                onBlur={() =>
                  save.mutate({ enabled, secretaryPhoneE164: phone || null })
                }
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+50370000000"
                type="tel"
                value={phone}
              />
            </FieldContent>
          </Field>
        </CardContent>
      </Card>
    </section>
  );
}
