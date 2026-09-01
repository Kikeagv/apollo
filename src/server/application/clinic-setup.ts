import {
  buildClinicSetupReview,
  CLINIC_SETUP_STEPS,
  type ClinicSetupEvaluationInput,
  type ClinicSetupReview,
  type ClinicSetupStepId,
} from "~/domain/clinic-setup";
import { drizzleClinicSetupStore } from "~/server/db/clinic-setup-store";

export type ClinicSetupReader = {
  read(input: {
    clinicId: string;
    identityId: string;
  }): Promise<ClinicSetupEvaluationInput | undefined>;
};

export type ClinicSetupProgressWriter = {
  saveStep(input: {
    clinicId: string;
    identityId: string;
    step: ClinicSetupStepId;
  }): Promise<boolean | undefined>;
};

export type ClinicSetupBasicsUpdater = {
  updateBasics(input: {
    clinicId: string;
    identityId: string;
    name: string;
  }): Promise<ClinicSetupEvaluationInput | undefined>;
};

export type ClinicReadinessDeclarer = {
  declare(input: {
    clinicId: string;
    identityId: string;
  }): Promise<ClinicSetupEvaluationInput | undefined>;
};

export class ClinicSetupAccessError extends Error {
  constructor() {
    super("La Identidad no puede consultar Configuración inicial");
    this.name = "ClinicSetupAccessError";
  }
}

export class ClinicReadinessNotReadyError extends Error {
  constructor() {
    super(
      "La Clínica necesita una ruta válida de Médico, Oferta y Horario antes de habilitar Asclepio",
    );
    this.name = "ClinicReadinessNotReadyError";
  }
}

/** Lee la guía resumible y calcula la preparación con las reglas de dominio. */
export async function getClinicSetup(
  input: { clinicId: string; identityId: string },
  reader: ClinicSetupReader = drizzleClinicSetupStore,
): Promise<ClinicSetupReview> {
  const evaluation = await reader.read(input);
  if (evaluation === undefined) throw new ClinicSetupAccessError();
  return buildClinicSetupReview(evaluation);
}

/** Persiste el paso visible para que la guía pueda retomarse más tarde. */
export async function saveClinicSetupStep(
  input: {
    clinicId: string;
    identityId: string;
    step: string;
  },
  writer: ClinicSetupProgressWriter = drizzleClinicSetupStore,
) {
  const step = parseStep(input.step);
  const saved = await writer.saveStep({ ...input, step });
  if (saved === undefined) throw new ClinicSetupAccessError();
  return saved;
}

/** Guarda los datos básicos de la Clínica sin convertirlos en activación. */
export async function updateClinicBasics(
  input: {
    clinicId: string;
    identityId: string;
    name: string;
  },
  updater: ClinicSetupBasicsUpdater = drizzleClinicSetupStore,
) {
  const name = requiredClinicName(input.name);
  const evaluation = await updater.updateBasics({ ...input, name });
  if (evaluation === undefined) throw new ClinicSetupAccessError();
  return evaluation;
}

/** Habilita explícitamente Asclepio después de volver a comprobar la capacidad. */
export async function declareClinicReady(
  input: { clinicId: string; identityId: string },
  declarer: ClinicReadinessDeclarer = drizzleClinicSetupStore,
) {
  const evaluation = await declarer.declare(input);
  if (evaluation === undefined) throw new ClinicSetupAccessError();
  const review = buildClinicSetupReview(evaluation);
  if (review.firstValidRoute === null) {
    throw new ClinicReadinessNotReadyError();
  }
  return {
    ...review,
    readiness: { ...review.readiness, asclepioEnabled: true },
  } satisfies ClinicSetupReview;
}

function parseStep(value: string): ClinicSetupStepId {
  if (
    !CLINIC_SETUP_STEPS.some(
      (candidate): candidate is (typeof CLINIC_SETUP_STEPS)[number] =>
        candidate.id === value,
    )
  ) {
    throw new Error("El paso de Configuración inicial no es válido");
  }
  return value as ClinicSetupStepId;
}

function requiredClinicName(value: string) {
  const name = value.trim();
  if (name.length === 0)
    throw new Error("El nombre de la Clínica es obligatorio");
  if (name.length > 120) {
    throw new Error("El nombre de la Clínica no puede exceder 120 caracteres");
  }
  return name;
}
