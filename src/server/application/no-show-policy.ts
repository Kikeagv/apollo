import {
  isNoShowPolicy,
  type NoShowPolicy,
} from "~/domain/whatsapp-operational-policies";

export type NoShowPolicyStore = {
  getNoShowPolicy(input: {
    clinicId: string;
    identityId: string;
  }): Promise<NoShowPolicy | undefined>;
  setNoShowPolicy(input: {
    clinicId: string;
    identityId: string;
    policy: NoShowPolicy;
  }): Promise<boolean>;
};

export class NoShowPolicyAccessError extends Error {
  constructor() {
    super(
      "Solo el Médico propietario puede configurar la política de inasistencia",
    );
    this.name = "NoShowPolicyAccessError";
  }
}

/** Consulta la Política de inasistencia que aplicará el planificador. */
export async function getNoShowPolicy(
  input: { clinicId: string; identityId: string },
  store: NoShowPolicyStore,
) {
  const policy = await store.getNoShowPolicy(input);
  if (policy === undefined) throw new NoShowPolicyAccessError();
  return policy;
}

/** Cambia explícitamente entre alerta y cancelación tras el tercer recordatorio. */
export async function setNoShowPolicy(
  input: { clinicId: string; identityId: string; policy: NoShowPolicy },
  store: NoShowPolicyStore,
) {
  if (!isNoShowPolicy(input.policy)) {
    throw new Error("La política de inasistencia no es válida");
  }
  if (!(await store.setNoShowPolicy(input)))
    throw new NoShowPolicyAccessError();
  return input.policy;
}
