import { PanaceaShell } from "~/app/panacea-shell";

import { requirePanaceaSession } from "./route-access";

export default async function PanaceaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const context = await requirePanaceaSession();

  return (
    <PanaceaShell
      clinic={context.clinic}
      user={{ email: context.user.email, name: context.user.name }}
    >
      {children}
    </PanaceaShell>
  );
}
