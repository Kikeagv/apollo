export const MAX_PASSWORD_FAILURES = 5;
export const PASSWORD_BLOCK_DURATION_MS = 15 * 60 * 1000;
export const PASSWORD_BLOCK_WINDOW_MS = PASSWORD_BLOCK_DURATION_MS;

export type IdentityPasswordBlockStore = {
  clearFailures(identityId: string): Promise<void>;
  countRecentFailures(input: {
    identityId: string;
    since: Date;
  }): Promise<{ count: number; latestAt?: Date }>;
  recordFailure(input: {
    identityId: string;
    now: Date;
  }): Promise<{ failureCount: number }>;
};

/**
 * Registra una contraseña incorrecta. Al alcanzar el máximo dentro de la
 * ventana devuelve `true` y notifica por correo; el Bloqueo temporal queda
 * activo aunque la entrega del aviso falle.
 */
export async function registerPasswordFailure(
  input: { email: string; identityId: string },
  deps: {
    sendBlockNotice(email: string): Promise<void>;
    store: IdentityPasswordBlockStore;
  },
): Promise<boolean> {
  const { failureCount } = await deps.store.recordFailure({
    identityId: input.identityId,
    now: new Date(),
  });
  if (failureCount < MAX_PASSWORD_FAILURES) return false;
  await deps.sendBlockNotice(input.email);
  return true;
}

/** Devuelve el instante hasta el que la Identidad está bloqueada, si aplica. */
export async function findPasswordBlock(
  input: { identityId: string; now?: Date },
  store: IdentityPasswordBlockStore,
): Promise<Date | undefined> {
  const now = input.now ?? new Date();
  const { count, latestAt } = await store.countRecentFailures({
    identityId: input.identityId,
    since: new Date(now.getTime() - PASSWORD_BLOCK_WINDOW_MS),
  });
  if (count < MAX_PASSWORD_FAILURES || latestAt === undefined) return undefined;
  const blockedUntil = new Date(
    latestAt.getTime() + PASSWORD_BLOCK_DURATION_MS,
  );
  return blockedUntil > now ? blockedUntil : undefined;
}
