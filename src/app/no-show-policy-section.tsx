"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  NO_SHOW_POLICIES,
  NO_SHOW_POLICY_LABELS,
  isNoShowPolicy,
  type NoShowPolicy,
} from "~/domain/whatsapp-operational-policies";
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
import {
  NativeSelect,
  NativeSelectOption,
} from "~/components/ui/native-select";
import { api } from "~/trpc/react";
import {
  PanaceaQueryEmpty,
  PanaceaQueryError,
  PanaceaQueryLoading,
} from "./panacea-query-state";
import { WhatsAppPolicyFeedback } from "./whatsapp-policy-feedback";

/** Control de Panacea para la Política de inasistencia por silencio. */
export function NoShowPolicySection() {
  const policy = api.panacea.getNoShowPolicy.useQuery();
  const [selectedPolicy, setSelectedPolicy] = useState<NoShowPolicy>("alert");
  const [policyError, setPolicyError] = useState<string | null>(null);
  const update = api.panacea.setNoShowPolicy.useMutation({
    onSuccess: () => {
      void policy.refetch();
    },
  });

  useEffect(() => {
    if (policy.data !== undefined) {
      setSelectedPolicy(policy.data);
      setPolicyError(null);
    }
  }, [policy.data]);

  function savePolicy(form?: HTMLFormElement) {
    update.reset();
    const formValue =
      form === undefined
        ? selectedPolicy
        : new FormData(form).get("no-show-policy");
    if (!isNoShowPolicy(formValue)) {
      setPolicyError("Seleccione una política de inasistencia válida");
      return;
    }
    setSelectedPolicy(formValue);
    setPolicyError(null);
    update.mutate({ policy: formValue });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    savePolicy(event.currentTarget);
  }

  return (
    <section
      aria-labelledby="no-show-policy-title"
      className="space-y-5"
      data-whatsapp-policy="no-show"
    >
      <Card>
        <CardHeader className="border-border border-b">
          <h2 className="text-xl font-semibold" id="no-show-policy-title">
            Inasistencia por silencio
          </h2>
          <p className="text-muted-foreground leading-6 text-pretty">
            Tras el recordatorio de 20 horas, conserve la Cita o cancélela
            automáticamente si el Contacto no respondió.
          </p>
        </CardHeader>
        <CardContent className="pt-6">
          {policy.error ? (
            <PanaceaQueryError
              error={policy.error}
              onRetry={() => void policy.refetch()}
              title="la política de inasistencia"
            />
          ) : policy.isLoading ? (
            <PanaceaQueryLoading label="Cargando la política de inasistencia" />
          ) : policy.data === undefined ? (
            <PanaceaQueryEmpty
              description="No hay una política disponible para este alcance. Vuelva a intentar la carga."
              onRetry={() => void policy.refetch()}
              title="Sin política de inasistencia configurada"
            />
          ) : (
            <form aria-busy={update.isPending} onSubmit={submit}>
              <FieldGroup>
                <Field data-invalid={policyError ? "true" : undefined}>
                  <FieldLabel htmlFor="no-show-policy">
                    Política de inasistencia
                  </FieldLabel>
                  <FieldContent>
                    <NativeSelect
                      aria-describedby={`no-show-policy-description${policyError ? " no-show-policy-error" : ""}`}
                      aria-invalid={policyError ? true : undefined}
                      disabled={update.isPending}
                      id="no-show-policy"
                      name="no-show-policy"
                      onChange={(event) => {
                        if (isNoShowPolicy(event.target.value)) {
                          setSelectedPolicy(event.target.value);
                          setPolicyError(null);
                        } else {
                          setPolicyError(
                            "Seleccione una política de inasistencia válida",
                          );
                        }
                        update.reset();
                      }}
                      required
                      value={selectedPolicy}
                    >
                      {NO_SHOW_POLICIES.map((option) => (
                        <NativeSelectOption key={option} value={option}>
                          {NO_SHOW_POLICY_LABELS[option]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription id="no-show-policy-description">
                      Valor actual: {NO_SHOW_POLICY_LABELS[policy.data]}
                    </FieldDescription>
                    <FieldError id="no-show-policy-error">
                      {policyError}
                    </FieldError>
                  </FieldContent>
                </Field>
              </FieldGroup>
              <Button
                className="mt-5"
                disabled={update.isPending}
                type="submit"
              >
                {update.isPending ? "Guardando…" : "Guardar política"}
              </Button>
              <div className="mt-4">
                <WhatsAppPolicyFeedback
                  mutation={update}
                  onRetry={() => savePolicy()}
                  successMessage="La política de inasistencia quedó actualizada."
                />
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
