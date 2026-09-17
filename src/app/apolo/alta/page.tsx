import { notFound, redirect } from "next/navigation";

import { getSession } from "~/server/better-auth/server";
import { inSuperadminTransaction } from "~/server/db/clinic-context";

import { ClinicRegistrationPanel } from "../clinic-registration-panel";

export default async function ClinicRegistrationPage() {
  const session = await getSession();
  if (session === null) redirect("/");

  try {
    await inSuperadminTransaction(session.user.id, async () => undefined);
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-4xl p-6 sm:p-10">
      <ClinicRegistrationPanel />
    </main>
  );
}
