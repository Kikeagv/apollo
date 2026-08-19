import { describe, expect, it, vi } from "vitest";

import {
  PASSWORD_BLOCK_DURATION_MS,
  findPasswordBlock,
  registerPasswordFailure,
  type IdentityPasswordBlockStore,
} from "./identity-password-block";

function createStore(initialFailures: Date[] = []) {
  const failures = [...initialFailures];
  const clearFailures = vi.fn<IdentityPasswordBlockStore["clearFailures"]>(
    async () => {
      failures.length = 0;
    },
  );
  const countRecentFailures = vi.fn<
    IdentityPasswordBlockStore["countRecentFailures"]
  >(async ({ since }) => {
    const recent = failures.filter((at) => at >= since);
    return { count: recent.length, latestAt: recent.at(-1) };
  });
  const recordFailure = vi.fn<IdentityPasswordBlockStore["recordFailure"]>(
    async ({ now }) => {
      failures.push(now);
      return { failureCount: failures.length };
    },
  );
  const store: IdentityPasswordBlockStore = {
    clearFailures,
    countRecentFailures,
    recordFailure,
  };
  return { countRecentFailures, failures, store };
}

describe("Bloqueo temporal de identidad", () => {
  it("notifica por correo exactamente al quinto intento fallido", async () => {
    const { store } = createStore();
    const sendBlockNotice = vi.fn(async () => undefined);
    const input = { email: "ana@example.test", identityId: "identity-1" };

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(
        registerPasswordFailure(input, { sendBlockNotice, store }),
      ).resolves.toBe(false);
    }
    expect(sendBlockNotice).not.toHaveBeenCalled();

    await expect(
      registerPasswordFailure(input, { sendBlockNotice, store }),
    ).resolves.toBe(true);
    expect(sendBlockNotice).toHaveBeenCalledOnce();
    expect(sendBlockNotice).toHaveBeenCalledWith("ana@example.test");
  });

  it("no bloquea con menos de cinco intentos dentro de la ventana", async () => {
    const now = new Date("2026-08-18T12:00:00Z");
    const { store } = createStore([
      new Date(now.getTime() - 10 * 60 * 1000),
      new Date(now.getTime() - 9 * 60 * 1000),
      new Date(now.getTime() - 8 * 60 * 1000),
      new Date(now.getTime() - 7 * 60 * 1000),
    ]);

    await expect(
      findPasswordBlock({ identityId: "identity-1", now }, store),
    ).resolves.toBeUndefined();
  });

  it("bloquea hasta 15 minutos después del quinto intento", async () => {
    const now = new Date("2026-08-18T12:00:00Z");
    const latest = new Date(now.getTime() - 10 * 60 * 1000);
    const { store } = createStore([
      new Date(now.getTime() - 14 * 60 * 1000),
      new Date(now.getTime() - 13 * 60 * 1000),
      new Date(now.getTime() - 12 * 60 * 1000),
      new Date(now.getTime() - 11 * 60 * 1000),
      latest,
    ]);

    const block = await findPasswordBlock(
      { identityId: "identity-1", now },
      store,
    );
    expect(block).toEqual(
      new Date(latest.getTime() + PASSWORD_BLOCK_DURATION_MS),
    );
  });

  it("ignora intentos anteriores a la ventana de 15 minutos", async () => {
    const now = new Date("2026-08-18T12:00:00Z");
    const stale = [
      new Date(now.getTime() - 20 * 60 * 1000),
      new Date(now.getTime() - 19 * 60 * 1000),
      new Date(now.getTime() - 18 * 60 * 1000),
      new Date(now.getTime() - 17 * 60 * 1000),
      new Date(now.getTime() - 16 * 60 * 1000),
    ];
    const { store, countRecentFailures } = createStore(stale);

    await expect(
      findPasswordBlock({ identityId: "identity-1", now }, store),
    ).resolves.toBeUndefined();
    expect(countRecentFailures).toHaveBeenCalledWith({
      identityId: "identity-1",
      since: new Date(now.getTime() - PASSWORD_BLOCK_DURATION_MS),
    });
  });

  it("limpia los intentos tras una contraseña correcta", async () => {
    const { failures, store } = createStore([new Date()]);
    await store.clearFailures("identity-1");
    expect(failures).toEqual([]);
  });
});
