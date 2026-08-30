import {
  buildPanaceaConfigurationOverview,
  type PanaceaConfigurationOverview,
  type PanaceaConfigurationOverviewInput,
} from "~/domain/panacea-configuration";
import { drizzlePanaceaConfigurationReader } from "~/server/db/panacea-configuration-store";

export type PanaceaConfigurationReader = {
  read(input: {
    clinicId: string;
    identityId: string;
  }): Promise<PanaceaConfigurationOverviewInput | undefined>;
};

export class PanaceaConfigurationAccessError extends Error {
  constructor() {
    super("La Identidad no puede consultar Configuración");
    this.name = "PanaceaConfigurationAccessError";
  }
}

/** Lee la capacidad visible y construye el índice accionable de Configuración. */
export async function getPanaceaConfigurationOverview(
  input: { clinicId: string; identityId: string },
  reader: PanaceaConfigurationReader = drizzlePanaceaConfigurationReader,
): Promise<PanaceaConfigurationOverview> {
  const configuration = await reader.read(input);
  if (configuration === undefined) {
    throw new PanaceaConfigurationAccessError();
  }
  return buildPanaceaConfigurationOverview(configuration);
}
