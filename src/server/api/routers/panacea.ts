import { publicProcedure } from "~/server/api/trpc";

export const panaceaRouter = {
  status: publicProcedure.query(() => ({
    service: "panacea",
    status: "ready" as const,
  })),
};
