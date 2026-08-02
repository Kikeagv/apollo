import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";

import { env } from "~/env";
import { db } from "~/server/db";
import { sendSimulatedIdentityEmail } from "~/server/email/simulated-identity-email";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg", // or "pg" or "mysql"
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  plugins: [
    emailOTP({
      disableSignUp: true,
      sendVerificationOTP: sendSimulatedIdentityEmail,
      storeOTP: "hashed",
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
