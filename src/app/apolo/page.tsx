import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  CLINIC_TRUSTED_DEVICE_COOKIE,
  findTrustedSuperadminAccess,
  isSuperadminIdentity,
} from "~/server/application/clinic-access";
import { getSession } from "~/server/better-auth/server";

import { ApoloOperations } from "./apolo-operations";

export default async function ApoloOperationsPage() {
  const session = await getSession();
  if (session === null) redirect("/");
  if (!(await isSuperadminIdentity(session.user.id))) redirect("/");

  const cookieStore = await cookies();
  const authorized = await findTrustedSuperadminAccess({
    identityId: session.user.id,
    trustedDeviceToken: cookieStore.get(CLINIC_TRUSTED_DEVICE_COOKIE)?.value,
  });
  if (!authorized) redirect("/");

  return <ApoloOperations />;
}
