import { cache } from "react";
import { cookies } from "next/headers";

import {
  canAccessPanaceaDestination,
  type PanaceaDestination,
} from "~/domain/panacea-shell";
import { getSession } from "~/server/better-auth/server";
import {
  CLINIC_SESSION_COOKIE,
  CLINIC_TRUSTED_DEVICE_COOKIE,
  findTrustedClinicContext,
  type ClinicContext,
} from "~/server/application/clinic-access";

export type PanaceaSessionContext = {
  clinic: ClinicContext;
  user: {
    email: string;
    id: string;
    name: string;
  };
};

export type PanaceaContextReader = () => Promise<
  PanaceaSessionContext | undefined
>;

/** Lee la Sesión de clínica una vez por render y conserva el contexto de RLS. */
export const getPanaceaSessionContext = cache(
  async (): Promise<PanaceaSessionContext | undefined> => {
    const session = await getSession();
    if (session === null) return undefined;

    const cookieStore = await cookies();
    const clinic = await findTrustedClinicContext({
      clinicSessionToken: cookieStore.get(CLINIC_SESSION_COOKIE)?.value,
      identityId: session.user.id,
      trustedDeviceToken: cookieStore.get(CLINIC_TRUSTED_DEVICE_COOKIE)?.value,
    });
    if (clinic === undefined) return undefined;

    return {
      clinic,
      user: {
        email: session.user.email,
        id: session.user.id,
        name: session.user.name,
      },
    };
  },
);

export function createPanaceaRouteAccess(readContext: PanaceaContextReader) {
  return {
    async resolve(destination: PanaceaDestination) {
      const context = await readContext();
      if (context === undefined) {
        return { status: "unauthenticated" as const };
      }
      if (!canAccessPanaceaDestination(context.clinic.role, destination)) {
        return { context, status: "forbidden" as const };
      }
      return { context, status: "allowed" as const };
    },
  };
}

export const panaceaRouteAccess = createPanaceaRouteAccess(
  getPanaceaSessionContext,
);
