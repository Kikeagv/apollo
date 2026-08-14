"use client";

import { useEffect, useState } from "react";

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
    <section className="space-y-3 rounded-xl border border-slate-700 p-5">
      <div>
        <h2 className="text-xl font-semibold">Aviso de Escalamiento</h2>
        <p className="mt-1 text-sm text-slate-300">
          Panacea siempre conserva la tarea; este aviso simulado es adicional.
        </p>
      </div>
      <label className="block text-sm">
        <input
          checked={enabled}
          disabled={save.isPending || phone.length === 0}
          onChange={(event) =>
            save.mutate({
              enabled: event.target.checked,
              secretaryPhoneE164: phone || null,
            })
          }
          type="checkbox"
        />{" "}
        Avisar a secretaria por WhatsApp simulado
      </label>
      <label className="block text-sm">
        Número de secretaria (E.164)
        <input
          className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 px-3 py-2"
          disabled={save.isPending}
          onBlur={() =>
            save.mutate({ enabled, secretaryPhoneE164: phone || null })
          }
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+50370000000"
          type="tel"
          value={phone}
        />
      </label>
    </section>
  );
}
